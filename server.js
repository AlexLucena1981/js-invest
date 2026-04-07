const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');

// Importação dos Módulos
const { admin, db } = require('./config/firebase');
const { initEngine, startConnection, getEngine } = require('./services/engine');
const { dispararOrdemVellox } = require('./services/velloxApi');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const MASTER_EMAIL = 'alexandre.lucena@gmail.com'; 
const MASTER_BROKER_LOGIN = 'AlexLucena1981';

// ============================================================================
// 🎯 O ESTADO GLOBAL DA APLICAÇÃO (Sem placares globais, tudo isolado!)
// ============================================================================
const state = {
    globalDynamicCookie: "locale=eyJpdiI6IkgvYk5XeTFiVUhoczRlQmM2RTZJMFE9PSIsInZhbHVlIjoiNktFOUs2T1lHTXhIN2JnSndzUG9leVczeWRmZ1RwMmJGc2tZQTVaaUh0RVJQSTNUOW9TMWFkSFR6SUxFeHVZZCIsIm1hYyI6ImJjMTFhOGUyNzY1NjA3ZDk3ZGJmMjdhZWU1MmI2NzVjNTg5YzIzYjM5ZWM3NDY5OWRjMTJhYmY1YWU0M2Y0Y2UiLCJ0YWciOiIifQ==; XSRF-TOKEN=eyJpdiI6IkJXTkh4d0NXZlFaQzhVZXpQZkZaa2c9PSIsInZhbHVlIjoidkU4cTBHbUVjZHhTeTkvUGh0YTNMZGpoZTRXV0xaU3hxeEdrTmk4TFVpYThWYnlkREFiVnFDNFNTVFJWVHFnTUFUdEZITzJzV3hOMUp3MzVYR0JwbTdHa2NrZ3JOSHM0R3MyVjVxbnFQZkdzTnpkb3pOS0hjWWU2QTlKdHExMGsiLCJtYWMiOiIzODZmM2MyM2IzMzc3ZjUxMWM4NDU0ZTA5YmMyNjZkZWEyMzdkOWFjMTA3OTdmYmFmNzgxZGNmZjI4ZmE1Yzg2IiwidGFnIjoiIn0=; laravel_session=eyJpdiI6Im8wQkZoRm1EaDYrcXhpSDFVRnZnN3c9PSIsInZhbHVlIjoic2JIb2tDMWhON0pBc3FoYjZpajhaTitweDdRQUs5TUVqamdNdXZBMytQTXFNaHNuSTYvTnpXUjJ4bzBhSEhseHZ0aWFRN0lkSWd1aTBJamZQMEs2YnJ4aFBZTmNxZGpzdkZ3b2VtL3JyS042eEZlWStzemxmNEpDVjlPN1FyemkiLCJtYWMiOiIwMmEwN2VlN2QyYzVjYmFkNGU0YzRlNzgxZTg2NzFiYjY3NmIwNjEyODE2MWU2Y2JlOWFlY2YzOGY1M2U1MzZhIiwidGFnIjoiIn0=",
    activeEngines: {}, 
    currentEngineKey: '', // Será montada dinamicamente: symbol_tf_strategy
    currentSymbol: 'btcusdt',
    currentTimeframe: '1m',
    currentStrategyId: '', 
    currentEngineStatus: "Aguardando inicialização...", 
    strategiesDB: [],
    activeBrokers: {}, 
    availableCoins: {}
};

initEngine(io, state);

// ============================================================================
// CARREGAMENTO DE INÍCIO
// ============================================================================
async function loadStrategiesFromDB() {
    try {
        const snapshot = await db.collection('scripts').get();
        state.strategiesDB = [];
        
        snapshot.forEach(doc => { 
            state.strategiesDB.push(doc.data()); 
        });

        if (state.strategiesDB.length > 0) {
            console.log(`🔥 ${state.strategiesDB.length} scripts carregados do Firebase!`);
            state.currentStrategyId = state.strategiesDB[0].id; 
            // Atualiza a chave mestre para ter a estratégia inclusa
            state.currentEngineKey = `${state.currentSymbol.toLowerCase()}_${state.currentTimeframe}_${state.currentStrategyId}`;
            startConnection(state.currentSymbol, state.currentTimeframe); 
        } else {
            console.log("⚠️ Nenhum script encontrado.");
            state.currentEngineStatus = "Aguardando injeção de scripts...";
            io.emit('status', { msg: state.currentEngineStatus });
        }
        io.emit('available_strategies', state.strategiesDB.map(s => ({ id: s.id, name: s.name })));
    } catch (error) { console.error("Erro ao ler do Firebase:", error); }
}

function loadAvailableCoins() {
    state.availableCoins = {
        "🟠 Criptomoedas (Binance)": ['btcusdt', 'ethusdt', 'ltcusdt', 'adausdt', 'bnbusdt', 'dogeusdt', 'solusdt', 'xrpusdt'],
        "🔵 Forex (Vellox)": ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD'],
        "🟣 Ações (Vellox)": ['AAPL', 'TSLA', 'MSFT', 'AMZN', 'META', 'GOOGL', 'NFLX'],
        "🟡 Commodities": ['XAUUSD', 'XAGUSD', 'USOIL'],
        "🔴 OTC (Fim de Semana)": ['EURUSDOTC', 'GBPUSDOTC', 'USDJPYOTC', 'BTCUSDTOTC']
    };
    io.emit('available_coins', state.availableCoins);
}

function blockIfTrading(socket, msg) {
    let targetEng = getEngine(state.currentSymbol, state.currentTimeframe, state.currentStrategyId);
    const isBotTrading = Object.values(state.activeBrokers).some(b => b.autoTradeActive);
    const hasRealTrade = targetEng.activeSignals.some(s => s.isManual || (isBotTrading && s.step >= 0)); 
    
    if (hasRealTrade) {
        socket.emit('sniper_error', `🔒 MOTOR TRAVADO: ${msg}`);
        socket.emit('engine_state', { symbol: state.currentSymbol, timeframe: state.currentTimeframe, strategy: state.currentStrategyId });
        socket.emit('scoreboard', targetEng.scoreboard);
        socket.emit('history_dump', targetEng.signalHistory);
        return true;
    }
    return false;
}

// ============================================================================
// COMUNICAÇÃO FRONT-END (SOCKETS)
// ============================================================================
io.on('connection', (socket) => {
    
    socket.emit('status', { msg: state.currentEngineStatus });
    socket.emit('available_strategies', state.strategiesDB.map(s => ({ id: s.id, name: s.name })));
    socket.emit('available_coins', state.availableCoins); 
    socket.emit('engine_state', { symbol: state.currentSymbol, timeframe: state.currentTimeframe, strategy: state.currentStrategyId });
    
    // Envia o placar isolado do motor atual assim que alguém se conecta
    let initEng = getEngine(state.currentSymbol, state.currentTimeframe, state.currentStrategyId);
    socket.emit('scoreboard', initEng ? initEng.scoreboard : { win1: 0, winG1: 0, winG2: 0, loss: 0 });
    socket.emit('history_dump', initEng ? initEng.signalHistory : []);
    
    socket.on('inject_cookie', (newCookie) => {
        state.globalDynamicCookie = newCookie;
        io.emit('status', { msg: 'Sessão VIP renovada!' });
        startConnection(state.currentSymbol, state.currentTimeframe); 
    });

    socket.on('hybrid_login', async ({ brokerUser, brokerPass }) => {
        try {
            const loginData = new URLSearchParams();
            loginData.append('user', brokerUser); loginData.append('pass', brokerPass);
            const loginResponse = await axios.post(`https://velloxbroker.com/api/login`, loginData, { headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' } });
            
            const brokerToken = loginResponse.data.token || loginResponse.data.access_token;
            if (!brokerToken) throw new Error("BROKER_FAIL");

            let uid = brokerUser.replace(/[^a-zA-Z0-9]/g, ''); if (!uid) uid = 'user_' + Date.now();
            let userRole = 'aluno'; const userLower = brokerUser.toLowerCase();
            if (userLower === MASTER_EMAIL.toLowerCase() || userLower === MASTER_BROKER_LOGIN.toLowerCase()) { uid = 'admin_master'; userRole = 'admin'; } 
            
            const customToken = await admin.auth().createCustomToken(uid);
            let realBalance = "0,00";
            try {
                const balanceResponse = await axios.get(`https://velloxbroker.com/api/public/users/balance`, { headers: { 'Authorization': `Bearer ${brokerToken}` } });
                realBalance = balanceResponse.data.credit || "0,00";
            } catch (e) {}

            state.activeBrokers[socket.id] = { 
                socketId: socket.id, token: brokerToken, demoAccountId: '8', realAccountId: '0', autoTradeActive: false, 
                config: { active: false, accountType: 'demo', baseAmount: 5, maxGale: 2, stopWin: 99999, stopLoss: 99999 }, sessionProfit: 0 
            };
            socket.emit('hybrid_login_result', { success: true, firebaseToken: customToken, role: userRole, balance: { demo: "---", real: realBalance }, brokerToken: brokerToken });
        } catch (error) { socket.emit('hybrid_login_result', { success: false, reason: 'broker', msg: 'Credenciais inválidas.' }); }
    });

    socket.on('auto_reconnect', async (data) => {
        try {
            const { token, role } = data;
            if(!token) throw new Error("Sem Token");
            let realBalance = "0,00";
            try {
                const balanceResponse = await axios.get(`https://velloxbroker.com/api/public/users/balance`, { headers: { 'Authorization': `Bearer ${token}` } });
                realBalance = balanceResponse.data.credit || "0,00";
            } catch (e) { throw new Error("Token expirado"); }

            state.activeBrokers[socket.id] = { socketId: socket.id, token: token, demoAccountId: '8', realAccountId: '0', autoTradeActive: false, config: { active: false, accountType: 'demo', baseAmount: 5, maxGale: 2, stopWin: 99999, stopLoss: 99999 }, sessionProfit: 0 };
            socket.emit('auto_reconnect_result', { success: true, role: role, balance: { demo: "--- (Dê 1 tiro para carregar)", real: realBalance } });
        } catch (error) { socket.emit('auto_reconnect_result', { success: false, msg: 'Sessão expirada. Faça login novamente.' }); }
    });

    socket.on('setup_auto_trade', (config) => {
        if (state.activeBrokers[socket.id]) {
            state.activeBrokers[socket.id].config = config; state.activeBrokers[socket.id].autoTradeActive = config.active;
            if (config.active) state.activeBrokers[socket.id].sessionProfit = 0; 
            socket.emit('auto_trade_status', { active: config.active, msg: config.active ? "Robô Armado..." : "Robô Pausado.", profit: state.activeBrokers[socket.id].sessionProfit });
        }
    });

    socket.on('manual_trade', async (data) => {
        const direction = data.direction; const frontendConfig = data.config; const reqSymbol = data.symbol; const reqTf = data.timeframe;
        const broker = state.activeBrokers[socket.id];
        if (!broker || !broker.token) { socket.emit('sniper_error', 'Você precisa conectar na corretora antes de atirar!'); return; }

        let targetEng = getEngine(reqSymbol, reqTf, state.currentStrategyId);
        const hasManualSignal = targetEng.activeSignals.some(s => s.isManual);
        if (hasManualSignal) { socket.emit('sniper_error', 'Aguarde! Já existe um tiro Sniper em andamento.'); return; }
        if (targetEng.currentGlobalPrice === 0) { socket.emit('sniper_error', 'Aguardando preço da corretora...'); return; }

        if (frontendConfig) { broker.config.accountType = frontendConfig.accountType; broker.config.baseAmount = frontendConfig.baseAmount; broker.config.maxGale = frontendConfig.maxGale; }
        let isDemo = broker.config ? broker.config.accountType === 'demo' : true;
        let amount = broker.config ? parseFloat(broker.config.baseAmount).toFixed(2).replace('.', ',') : '5,00';

        const result = await dispararOrdemVellox(broker, isDemo, reqSymbol.toUpperCase(), direction, amount, targetEng.currentGlobalPrice, reqTf);

        if (result.success) {
            socket.emit('sniper_success', `Ordem enviada com sucesso!`);
            if (result.balance) socket.emit('update_balance', { isDemo: isDemo, balance: result.balance });

            const manualSig = { id: Date.now(), type: direction, symbol: reqSymbol.toUpperCase(), timeframe: reqTf, time: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }), step: 0, status: '⚡ Sniper...', entryPrice: targetEng.currentGlobalPrice, isManual: true };
            targetEng.activeSignals.push(manualSig); targetEng.signalHistory.unshift(manualSig); if (targetEng.signalHistory.length > 20) targetEng.signalHistory.pop();
            io.emit('new_signal_history', manualSig);
        } else { socket.emit('sniper_error', result.msg); }
    });

    // 🎯 CHAVES ISOLADAS (O Fim do Placar Misturado)
    socket.on('change_coin', (newSymbol) => { 
        if (blockIfTrading(socket, 'Aguarde a operação finalizar para trocar de Ativo!')) return;
        state.currentSymbol = newSymbol; 
        state.currentEngineKey = `${state.currentSymbol.toLowerCase()}_${state.currentTimeframe}_${state.currentStrategyId}`;
        io.emit('engine_state', { symbol: state.currentSymbol, timeframe: state.currentTimeframe, strategy: state.currentStrategyId });
        startConnection(state.currentSymbol, state.currentTimeframe); 
    });
    
    socket.on('change_timeframe', (newTf) => { 
        if (blockIfTrading(socket, 'Aguarde a operação finalizar para trocar o Tempo Gráfico!')) return;
        state.currentTimeframe = newTf; 
        state.currentEngineKey = `${state.currentSymbol.toLowerCase()}_${state.currentTimeframe}_${state.currentStrategyId}`;
        io.emit('engine_state', { symbol: state.currentSymbol, timeframe: state.currentTimeframe, strategy: state.currentStrategyId });
        startConnection(state.currentSymbol, state.currentTimeframe); 
    });

    socket.on('change_strategy', (newStrategyId) => { 
        if (blockIfTrading(socket, 'Aguarde a operação finalizar para trocar de Estratégia!')) return;
        state.currentStrategyId = newStrategyId; 
        state.currentEngineKey = `${state.currentSymbol.toLowerCase()}_${state.currentTimeframe}_${state.currentStrategyId}`;
        startConnection(state.currentSymbol, state.currentTimeframe); 
    });

    socket.on('add_new_strategy', async (newStrategy) => {
        try {
            await db.collection('scripts').doc(newStrategy.id).set(newStrategy); 
            state.strategiesDB.push(newStrategy); 
            io.emit('available_strategies', state.strategiesDB.map(s => ({ id: s.id, name: s.name }))); 
            socket.emit('script_injection_result', { success: true, msg: 'Script gravado!' });
        } catch (e) { socket.emit('script_injection_result', { success: false, msg: 'Erro: ' + e.message }); }
    });

    socket.on('disconnect', () => { if (state.activeBrokers[socket.id]) delete state.activeBrokers[socket.id]; });
});

loadStrategiesFromDB();
loadAvailableCoins();
server.listen(3000, () => { console.log('🚀 Terminal HFT JS Invest operando na porta 3000!'); });