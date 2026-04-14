const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');

const { admin, db } = require('./config/firebase');
const { initEngine, startConnection, getEngine, scanRadarHistory } = require('./services/engine');
const { getVelloxBalance, dispararOrdemVellox } = require('./services/velloxApi');

const { initTelegramBot, reloadTelegramConfig, forcarSessaoTelegram } = require('./services/telegramBot');

const app = express();
const server = http.createServer(app);

const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.use(express.static('public'));

const MASTER_EMAIL = 'alexandre.lucena@gmail.com'; 
const MASTER_BROKER_LOGIN = 'AlexLucena1981';

const MIN_BALANCE_PLUS = 100.00;

function parseBalance(valStr) {
    if (!valStr || valStr === "0,00" || valStr === "---") return 0;
    let clean = String(valStr).replace(/R\$\s?/g, '').replace(/\./g, '').replace(',', '.');
    let num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
}

const state = {
    globalDynamicCookie: "locale=eyJpdiI6IkgvYk5XeTFiVUhoczRlQmM2RTZJMFE9PSIsInZhbHVlIjoiNktFOUs2T1lHTXhIN2JnSndzUG9leVczeWRmZ1RwMmJGc2tZQTVaaUh0RVJQSTNUOW9TMWFkSFR6SUxFeHVZZCIsIm1hYyI6ImJjMTFhOGUyNzY1NjA3ZDk3ZGJmMjdhZWU1MmI2NzVjNTg5YzIzYjM5ZWM3NDY5OWRjMTJhYmY1YWU0M2Y0Y2UiLCJ0YWciOiIifQ==; XSRF-TOKEN=eyJpdiI6IkJXTkh4d0NXZlFaQzhVZXpQZkZaa2c9PSIsInZhbHVlIjoidkU4cTBHbUVjZHhTeTkvUGh0YTNMZGpoZTRXV0xaU3hxeEdrTmk4TFVpYThWYnlkREFiVnFDNFNTVFJWVHFnTUFUdEZITzJzV3hOMUp3MzVYR0JwbTdHa2NrZ3JOSHM0R3MyVjVxbnFQZkdzTnpkb3pOS0hjWWU2QTlKdHExMGsiLCJtYWMiOiIzODZmM2MyM2IzMzc3ZjUxMWM4NDU0ZTA5YmMyNjZkZWEyMzdkOWFjMTA3OTdmYmFmNzgxZGNmZjI4ZmE1Yzg2IiwidGFnIjoiIn0=; laravel_session=eyJpdiI6Im8wQkZoRm1EaDYrcXhpSDFVRnZnN3c9PSIsInZhbHVlIjoic2JIb2tDMWhON0pBc3FoYjZpajhaTitweDdRQUs5TUVqamdNdXZBMytQTXFNaHNuSTYvTnpXUjJ4bzBhSEhseHZ0aWFRN0lkSWd1aTBJamZQMEs2YnJ4aFBZTmNxZGpzdkZ3b2VtL3JyS042eEZlWStzemxmNEpDVjlPN1FyemkiLCJtYWMiOiIwMmEwN2VlN2QyYzVjYmFkNGU0YzRlNzgxZTg2NzFiYjY3NmIwNjEyODE2MWU2Y2JlOWFlY2YzOGY1M2U1MzZhIiwidGFnIjoiIn0=",
    activeEngines: {}, currentEngineKey: '', currentSymbol: 'btcusdt', currentTimeframe: '1m', currentStrategyId: '', 
    currentEngineStatus: "Aguardando inicialização...", strategiesDB: [], activeBrokers: {}, availableCoins: {},
    radarStats: { total: 0, byAsset: {}, byHour: {} } 
};

initEngine(io, state);

let tgConfigGlobal = {
    dias: '1-5', horaManha: '09:00', horaTarde: '15:00',
    msgDespertar: "👨‍💻 *Atenção!* Iniciando análise do mercado para a sessão...",
    msgWin: "✅ *WIN DE PRIMEIRA!* 🎯",
    msgLoss: "🔴 *LOSS!* O mercado não respeitou a análise."
};

async function loadSystemData() {
    try {
        const snapshot = await db.collection('scripts').get();
        state.strategiesDB = [];
        snapshot.forEach(doc => { state.strategiesDB.push(doc.data()); });

        if (state.strategiesDB.length > 0) {
            state.currentStrategyId = state.strategiesDB[0].id; 
            state.currentEngineKey = `${state.currentSymbol.toLowerCase()}_${state.currentTimeframe}_${state.currentStrategyId}`;
            startConnection(state.currentSymbol, state.currentTimeframe); 
            scanRadarHistory(); 
        } else {
            state.currentEngineStatus = "Aguardando injeção de scripts...";
            io.emit('status', { msg: state.currentEngineStatus });
        }
        io.emit('available_strategies', state.strategiesDB.map(s => ({ id: s.id, name: s.name })));

        const tgDoc = await db.collection('settings').doc('telegram').get();
        if (tgDoc.exists) tgConfigGlobal = { ...tgConfigGlobal, ...tgDoc.data() };
        
        initTelegramBot(state, tgConfigGlobal);

    } catch (error) { console.error("Erro Firebase:", error); }
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

function getBrokerBySocket(socketId) {
    return Object.values(state.activeBrokers).find(b => b.socketId === socketId);
}

io.on('connection', (socket) => {
    socket.emit('status', { msg: state.currentEngineStatus });
    socket.emit('available_strategies', state.strategiesDB.map(s => ({ id: s.id, name: s.name })));
    socket.emit('available_coins', state.availableCoins); 
    socket.emit('engine_state', { symbol: state.currentSymbol, timeframe: state.currentTimeframe, strategy: state.currentStrategyId });
    socket.emit('radar_stats_update', state.radarStats); 
    
    let initEng = getEngine(state.currentSymbol, state.currentTimeframe, state.currentStrategyId);
    socket.emit('scoreboard', initEng ? initEng.scoreboard : { win1: 0, winG1: 0, winG2: 0, loss: 0 });
    socket.emit('history_dump', initEng ? initEng.signalHistory : []);
    
    socket.on('inject_cookie', (newCookie) => {
        state.globalDynamicCookie = newCookie;
        io.emit('status', { msg: 'Sessão VIP renovada!' });
        startConnection(state.currentSymbol, state.currentTimeframe); 
        scanRadarHistory(); 
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
            else { const snapshot = await db.collection('users').where('email', '==', brokerUser).get(); if (!snapshot.empty) { uid = snapshot.docs[0].id; userRole = snapshot.docs[0].data().role; } }

            const customToken = await admin.auth().createCustomToken(uid);
            
            const realBalance = await getVelloxBalance(brokerToken);
            const numBalance = parseBalance(realBalance);
            const isPremium = numBalance >= MIN_BALANCE_PLUS;

            state.activeBrokers[uid] = { 
                uid: uid, socketId: socket.id, token: brokerToken, demoAccountId: '8', realAccountId: '0', 
                isPremium: isPremium, autoTradeActive: false, 
                config: { active: false, accountType: 'demo', baseAmount: 5, maxGale: 2, stopWin: 99999, stopLoss: 99999 }, sessionProfit: 0 
            };
            
            socket.emit('hybrid_login_result', { success: true, firebaseToken: customToken, role: userRole, balance: { demo: "---", real: realBalance }, brokerToken: brokerToken, uid: uid, isPremium: isPremium });
        } catch (error) { socket.emit('hybrid_login_result', { success: false, reason: 'broker', msg: 'Credenciais inválidas.' }); }
    });

    socket.on('auto_reconnect', async (data) => {
        try {
            const { token, role, uid } = data;
            if(!token || !uid) throw new Error("Sem Token ou UID");

            const realBalance = await getVelloxBalance(token);
            if(realBalance === "0,00" && !state.activeBrokers[uid]) throw new Error("Token Expirado");

            const numBalance = parseBalance(realBalance);
            const isPremium = numBalance >= MIN_BALANCE_PLUS;

            if (state.activeBrokers[uid]) { 
                state.activeBrokers[uid].socketId = socket.id; 
                state.activeBrokers[uid].isPremium = isPremium;
                // 🔥 TRAVA DE SEGURANÇA: Se ele fez F5 ou reconectou, GARANTIMOS que o robô nasce desligado!
                state.activeBrokers[uid].autoTradeActive = false; 
            } 
            else { 
                state.activeBrokers[uid] = { uid: uid, socketId: socket.id, token: token, demoAccountId: '8', realAccountId: '0', isPremium: isPremium, autoTradeActive: false, config: { active: false, accountType: 'demo', baseAmount: 5, maxGale: 2, stopWin: 99999, stopLoss: 99999 }, sessionProfit: 0 }; 
            }
            
            socket.emit('auto_reconnect_result', { success: true, role: role, balance: { demo: "---", real: realBalance }, isPremium: isPremium });
        } catch (error) { socket.emit('auto_reconnect_result', { success: false, msg: 'Sessão expirada. Faça login novamente.' }); }
    });

    socket.on('setup_auto_trade', (config) => {
        const broker = getBrokerBySocket(socket.id);
        if (!broker) return;
        if (!broker.isPremium) { socket.emit('auto_trade_status', { active: false, msg: `🔒 Modo Free. Deposite R$ ${MIN_BALANCE_PLUS} para liberar.`, profit: 0 }); return; }
        broker.config = config; broker.autoTradeActive = config.active;
        if (config.active) broker.sessionProfit = 0; 
        socket.emit('auto_trade_status', { active: config.active, msg: config.active ? "Robô Armado..." : "Robô Pausado.", profit: broker.sessionProfit });
    });

    socket.on('manual_trade', async (data) => {
        const direction = data.direction; const frontendConfig = data.config; const reqSymbol = data.symbol; const reqTf = data.timeframe;
        const broker = getBrokerBySocket(socket.id);
        
        if (!broker || !broker.token) { socket.emit('sniper_error', 'Você precisa conectar na corretora antes de atirar!'); return; }
        if (!broker.isPremium) { socket.emit('sniper_error', `🔒 Função restrita ao Modo PLUS! Saldo mínimo: R$ ${MIN_BALANCE_PLUS}`); return; }

        let targetEng = getEngine(reqSymbol, reqTf, state.currentStrategyId);
        if (targetEng.lastTickTime > 0 && (Date.now() - targetEng.lastTickTime > 120000)) targetEng.activeSignals = [];

        const hasManualSignal = targetEng.activeSignals.some(s => s.isManual);
        if (hasManualSignal) { socket.emit('sniper_error', 'Aguarde! Já existe um tiro Sniper em andamento.'); return; }
        if (targetEng.currentGlobalPrice === 0) { socket.emit('sniper_error', 'Aguardando preço da corretora...'); return; }

        if (frontendConfig) { broker.config.accountType = frontendConfig.accountType; broker.config.baseAmount = parseFloat(frontendConfig.baseAmount); broker.config.maxGale = parseInt(frontendConfig.maxGale); }
        let isDemo = broker.config ? broker.config.accountType === 'demo' : true;
        let amount = broker.config ? parseFloat(broker.config.baseAmount).toFixed(2).replace('.', ',') : '5,00';

        const result = await dispararOrdemVellox(broker, isDemo, reqSymbol.toUpperCase(), direction, amount, targetEng.currentGlobalPrice, reqTf);

        if (result.success) {
            socket.emit('sniper_success', `Ordem enviada com sucesso!`);
            if (result.balance) socket.emit('update_balance', { isDemo: isDemo, balance: result.balance });
            const manualSig = { id: Date.now(), type: direction, symbol: reqSymbol.toUpperCase(), timeframe: reqTf, time: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }), step: 0, status: '⚡ Sniper...', entryPrice: targetEng.currentGlobalPrice, isManual: true, brokerUid: broker.uid };
            targetEng.activeSignals.push(manualSig); targetEng.signalHistory.unshift(manualSig); if (targetEng.signalHistory.length > 20) targetEng.signalHistory.pop();
            io.emit('new_signal_history', manualSig);
        } else { socket.emit('sniper_error', result.msg); }
    });

    socket.on('admin_get_tg_config', async (token) => {
        try {
            const decodedToken = await admin.auth().verifyIdToken(token);
            if (decodedToken.uid === 'admin_master') {
                socket.emit('admin_tg_config_data', tgConfigGlobal);
            }
        } catch(e) {}
    });

    socket.on('admin_save_tg_config', async (data) => {
        try {
            const decodedToken = await admin.auth().verifyIdToken(data.token);
            if (decodedToken.uid === 'admin_master') {
                await db.collection('settings').doc('telegram').set(data.config);
                tgConfigGlobal = data.config;
                reloadTelegramConfig(tgConfigGlobal);
                socket.emit('user_creation_result', { success: true, msg: 'Configurações do Telegram atualizadas e Relógios reprogramados com sucesso! ⏰✅' });
            }
        } catch(e) {}
    });

    socket.on('admin_force_tg', async (data) => {
        try {
            const decodedToken = await admin.auth().verifyIdToken(data.token);
            if (decodedToken.uid === 'admin_master') {
                forcarSessaoTelegram(data.turno);
                socket.emit('user_creation_result', { success: true, msg: `🔥 SESSÃO FORÇADA INICIADA! O Robô acabou de acordar para a sessão da ${data.turno}!` });
            }
        } catch(e) {}
    });

    socket.on('admin_create_user', async (data) => {
        try {
            const decodedToken = await admin.auth().verifyIdToken(data.token); const reqUid = decodedToken.uid; let isAdmin = false;
            if (reqUid === 'admin_master') isAdmin = true; else { const snap = await db.collection('users').doc(reqUid).get(); if (snap.exists && snap.data().role === 'admin') isAdmin = true; }
            if (!isAdmin) { socket.emit('user_creation_result', { success: false, msg: 'Operação Negada.' }); return; }
            const userRecord = await admin.auth().createUser({ email: data.newEmail, password: data.newPassword });
            await db.collection('users').doc(userRecord.uid).set({ email: data.newEmail, role: data.newRole, createdAt: admin.firestore.FieldValue.serverTimestamp() });
            socket.emit('user_creation_result', { success: true, msg: `Utilizador [${data.newEmail}] cadastrado!` });
        } catch (error) { socket.emit('user_creation_result', { success: false, msg: error.message }); }
    });

    socket.on('admin_get_users', async (token) => {
        try {
            const snapshot = await db.collection('users').get(); let usersList = []; usersList.push({ id: 'master', email: 'Master / Admin', role: 'admin (Master)' });
            snapshot.forEach(doc => { usersList.push({ id: doc.id, ...doc.data() }); });
            socket.emit('admin_users_list', { success: true, users: usersList });
        } catch (error) { socket.emit('admin_users_list', { success: false, msg: error.message }); }
    });

    socket.on('change_coin', (newSymbol) => { 
        state.currentSymbol = newSymbol; state.currentEngineKey = `${state.currentSymbol.toLowerCase()}_${state.currentTimeframe}_${state.currentStrategyId}`;
        io.emit('engine_state', { symbol: state.currentSymbol, timeframe: state.currentTimeframe, strategy: state.currentStrategyId }); 
        startConnection(state.currentSymbol, state.currentTimeframe); 
    });
    
    socket.on('change_timeframe', (newTf) => { 
        state.currentTimeframe = newTf; state.currentEngineKey = `${state.currentSymbol.toLowerCase()}_${state.currentTimeframe}_${state.currentStrategyId}`;
        io.emit('engine_state', { symbol: state.currentSymbol, timeframe: state.currentTimeframe, strategy: state.currentStrategyId }); 
        startConnection(state.currentSymbol, state.currentTimeframe); 
        scanRadarHistory(); 
    });

    socket.on('change_strategy', (newStrategyId) => { 
        state.currentStrategyId = newStrategyId; state.currentEngineKey = `${state.currentSymbol.toLowerCase()}_${state.currentTimeframe}_${state.currentStrategyId}`;
        startConnection(state.currentSymbol, state.currentTimeframe); 
        scanRadarHistory(); 
    });

    socket.on('add_new_strategy', async (newStrategy) => {
        try { await db.collection('scripts').doc(newStrategy.id).set(newStrategy); state.strategiesDB.push(newStrategy); io.emit('available_strategies', state.strategiesDB.map(s => ({ id: s.id, name: s.name }))); socket.emit('script_injection_result', { success: true, msg: 'Script gravado!' }); } 
        catch (e) { socket.emit('script_injection_result', { success: false, msg: 'Erro: ' + e.message }); }
    });

    // 🔥 VACINA ZUMBI: QUANDO O UTILIZADOR FECHA A ABA, O ROBÔ DELE DESLIGA NA HORA!
    socket.on('disconnect', () => { 
        for (let uid in state.activeBrokers) { 
            if (state.activeBrokers[uid].socketId === socket.id) { 
                state.activeBrokers[uid].socketId = null; 
                state.activeBrokers[uid].autoTradeActive = false; // DESLIGA O ROBÔ
            } 
        }
    });
});

loadSystemData();
loadAvailableCoins();
server.listen(3000, () => { console.log('🚀 Terminal JS Invest operando. (C/ Trava de Segurança Auto-Trade)'); });