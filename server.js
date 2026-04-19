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

// 🔥 ESTADO GLOBAL LIMPO (Sem Gráfico Mestre, cada usuário tem o seu)
const state = {
    globalDynamicCookie: "locale=eyJpdiI6IkgvYk5XeTFiVUhoczRlQmM2RTZJMFE9PSIsInZhbHVlIjoiNktFOUs2T1lHTXhIN2JnSndzUG9leVczeWRmZ1RwMmJGc2tZQTVaaUh0RVJQSTNUOW9TMWFkSFR6SUxFeHVZZCIsIm1hYyI6ImJjMTFhOGUyNzY1NjA3ZDk3ZGJmMjdhZWU1MmI2NzVjNTg5YzIzYjM5ZWM3NDY5OWRjMTJhYmY1YWU0M2Y0Y2UiLCJ0YWciOiIifQ==; XSRF-TOKEN=eyJpdiI6IkJXTkh4d0NXZlFaQzhVZXpQZkZaa2c9PSIsInZhbHVlIjoidkU4cTBHbUVjZHhTeTkvUGh0YTNMZGpoZTRXV0xaU3hxeEdrTmk4TFVpYThWYnlkREFiVnFDNFNTVFJWVHFnTUFUdEZITzJzV3hOMUp3MzVYR0JwbTdHa2NrZ3JOSHM0R3MyVjVxbnFQZkdzTnpkb3pOS0hjWWU2QTlKdHExMGsiLCJtYWMiOiIzODZmM2MyM2IzMzc3ZjUxMWM4NDU0ZTA5YmMyNjZkZWEyMzdkOWFjMTA3OTdmYmFmNzgxZGNmZjI4ZmE1Yzg2IiwidGFnIjoiIn0=; laravel_session=eyJpdiI6Im8wQkZoRm1EaDYrcXhpSDFVRnZnN3c9PSIsInZhbHVlIjoic2JIb2tDMWhON0pBc3FoYjZpajhaTitweDdRQUs5TUVqamdNdXZBMytQTXFNaHNuSTYvTnpXUjJ4bzBhSEhseHZ0aWFRN0lkSWd1aTBJamZQMEs2YnJ4aFBZTmNxZGpzdkZ3b2VtL3JyS042eEZlWStzemxmNEpDVjlPN1FyemkiLCJtYWMiOiIwMmEwN2VlN2QyYzVjYmFkNGU0YzRlNzgxZTg2NzFiYjY3NmIwNjEyODE2MWU2Y2JlOWFlY2YzOGY1M2U1MzZhIiwidGFnIjoiIn0=",
    activeEngines: {}, 
    currentEngineStatus: "Aguardando inicialização...", 
    strategiesDB: [], activeBrokers: {}, availableCoins: {},
    radarStats: { total: 0, byAsset: {}, byHour: {} } 
};

initEngine(io, state);

let tgConfigGlobal = {
    dias: '0-6', horaManha: '09:00', horaTarde: '15:00',
    rsiOver: 65, rsiUnder: 35, bbDev: 2,
    msgDespertar: "👨‍💻 *Atenção!* Iniciando análise do mercado...",
    msgWin: "✅ *WIN DE PRIMEIRA!* 🎯",
    msgLoss: "🔴 *LOSS!* O mercado não respeitou a análise.",
    msgPre: "⚠️ *PRÉ-ALERTA DE SINAL*\\n\\nPreparem o ativo: *{MOEDA}*\\nPossível Operação: *{DIRECAO}*",
    msgSinal: "⚡ *ALERTA DE TOQUE (OTC/M1)* ⚡\\n\\n💵 Moeda = {MOEDA}\\n⏰ Expiração = 1 Minuto\\n🛎 Entrada = {HORA_ENTRADA}\\n{DIRECAO}\\n\\nGale 1 - {HORA_GALE}\\n\\n👉🏼 Se necessário, fazer 1 Gale.\\n\\n➡️ [Clique aqui para abrir a Vellox](https://velloxbroker.com)"
};

async function loadSystemData() {
    try {
        const snapshot = await db.collection('scripts').get();
        state.strategiesDB = [];
        snapshot.forEach(doc => { state.strategiesDB.push(doc.data()); });

        const tgDoc = await db.collection('settings').doc('telegram').get();
        if (tgDoc.exists) tgConfigGlobal = { ...tgConfigGlobal, ...tgDoc.data() };
        
        state.strategiesDB.forEach(s => {
            s.rsiOverbought = parseFloat(tgConfigGlobal.rsiOver) || 65;
            s.rsiOversold = parseFloat(tgConfigGlobal.rsiUnder) || 35;
            s.bbStdDev = parseFloat(tgConfigGlobal.bbDev) || 2;
        });

        if (state.strategiesDB.length > 0) {
            scanRadarHistory(); 
        } else {
            state.currentEngineStatus = "Aguardando injeção de scripts...";
            io.emit('status', { msg: state.currentEngineStatus });
        }
        
        initTelegramBot(state, tgConfigGlobal);

    } catch (error) { console.error("Erro Firebase:", error); }
}

function loadAvailableCoins() {
    state.availableCoins = {
        "🟠 Criptomoedas (Binance)": ['btcusdt', 'ethusdt', 'ltcusdt', 'adausdt', 'bnbusdt', 'dogeusdt', 'solusdt', 'xrpusdt'],
        "🔵 Forex (Vellox)": ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD'],
        "🟣 Ações (Vellox)": ['AAPL', 'TSLA', 'MSFT', 'AMZN', 'META', 'GOOGL', 'NFLX'],
        "🟡 Commodities": ['XAUUSD', 'XAGUSD', 'USOIL'],
        "🔴 Forex (OTC)": [
            'EURUSDOTC', 'AUDJPYOTC', 'EURJPYOTC', 'EURAUDOTC', 'AUDCHFOTC', 'GBPJPYOTC', 
            'CADCHFOTC', 'EURNZDOTC', 'GBPAUDOTC', 'NZDJPYOTC', 'GBPCHFOTC', 'USDCHFOTC', 
            'EURCADOTC', 'EURCHFOTC'
        ],
        "🟠 Criptos (OTC)": [
            'BTCUSDTOTC', 'ETHUSDTOTC', 'LTCUSDTOTC', 'ADAUSDTOTC', 'BNBUSDTOTC', 'SOLUSDTOTC', 'DOGEUSDTOTC'
        ],
        "🟣 Ações/Ouro (OTC)": [
            'AAPLOTC', 'NFLXOTC', 'METAOTC', 'TSLAOTC', 'MSFTOTC', 'PYPLOTC', 'AMZNOTC', 
            'NVDAOTC', 'SBUXOTC', 'DISOTC', 'MAOTC', 'IBMOTC', 'KOOTC', 'FOTC', 'SPOTOTC', 
            'NKEOTC', 'INTCOTC', 'VOTC', 'XAUUSDOTC'
        ]
    };
}

function getBrokerBySocket(socketId) {
    return Object.values(state.activeBrokers).find(b => b.socketId === socketId);
}

io.on('connection', (socket) => {
    
    // 🎯 O TÚNEL INDIVIDUAL: O estado agora pertence apenas a esta tela!
    socket.userState = {
        symbol: 'btcusdt',
        timeframe: '1m',
        strategyId: state.strategiesDB.length > 0 ? state.strategiesDB[0].id : ''
    };

    function updateRoom() {
        if (!socket.userState.strategyId && state.strategiesDB.length > 0) {
            socket.userState.strategyId = state.strategiesDB[0].id;
        }
        if (!socket.userState.strategyId) return;

        const newKey = `${socket.userState.symbol.toLowerCase()}_${socket.userState.timeframe}_${socket.userState.strategyId}`;
        
        // Sai do gráfico anterior e entra na nova sala de transmissão
        if (socket.currentRoom) socket.leave(socket.currentRoom);
        socket.currentRoom = newKey;
        socket.join(newKey);
        
        // Solicita ao motor para iniciar a captura deste ativo, se ninguém o estiver a fazer
        startConnection(socket.userState.symbol, socket.userState.timeframe, socket.userState.strategyId);
        
        let eng = getEngine(socket.userState.symbol, socket.userState.timeframe, socket.userState.strategyId);
        socket.emit('scoreboard', eng.scoreboard);
        socket.emit('history_dump', eng.signalHistory);
        socket.emit('engine_state', { symbol: socket.userState.symbol, timeframe: socket.userState.timeframe, strategy: socket.userState.strategyId });
    }

    socket.emit('status', { msg: state.currentEngineStatus });
    socket.emit('available_strategies', state.strategiesDB.map(s => ({ id: s.id, name: s.name })));
    socket.emit('available_coins', state.availableCoins); 
    socket.emit('radar_stats_update', state.radarStats); 
    
    updateRoom(); // Inicia a primeira sala do utilizador
    
    socket.on('inject_cookie', (newCookie) => {
        state.globalDynamicCookie = newCookie;
        io.emit('status', { msg: 'Sessão VIP renovada!' });
        scanRadarHistory(); 
        // Reinicia os motores de todos os ativos atualmente sendo assistidos
        for (let key in state.activeEngines) {
            let eng = state.activeEngines[key];
            startConnection(eng.symbol, eng.timeframe, eng.strategyId);
        }
    });

    socket.on('hybrid_login', async ({ brokerUser, brokerPass }) => {
        try {
            const loginData = new URLSearchParams();
            loginData.append('user', brokerUser); loginData.append('pass', brokerPass);
            const loginResponse = await axios.post(`https://velloxbroker.com/api/login`, loginData, { headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' } });
            
            const brokerToken = loginResponse.data.token || loginResponse.data.access_token;
            if (!brokerToken) throw new Error("BROKER_FAIL");
            const realBalance = await getVelloxBalance(brokerToken);

            let uid = brokerUser.replace(/[^a-zA-Z0-9]/g, ''); if (!uid) uid = 'user_' + Date.now();
            let userRole = 'aluno'; const userLower = brokerUser.toLowerCase();
            
            if (userLower === MASTER_EMAIL.toLowerCase() || userLower === MASTER_BROKER_LOGIN.toLowerCase()) { 
                uid = 'admin_master'; 
                userRole = 'admin'; 
            } else { 
                const snapshot = await db.collection('users').where('email', '==', brokerUser).get(); 
                if (!snapshot.empty) { uid = snapshot.docs[0].id; userRole = snapshot.docs[0].data().role; } 
            }

            const customToken = await admin.auth().createCustomToken(uid);
            
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

            let realBalance = "0,00";
            
            if (uid === 'admin_joao') { realBalance = "99999,00"; } 
            else {
                realBalance = await getVelloxBalance(token);
                if(realBalance === "0,00" && !state.activeBrokers[uid]) throw new Error("Token Expirado");
            }

            const numBalance = parseBalance(realBalance);
            const isPremium = numBalance >= MIN_BALANCE_PLUS;

            if (state.activeBrokers[uid]) { 
                state.activeBrokers[uid].socketId = socket.id; 
                state.activeBrokers[uid].isPremium = isPremium;
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

        let targetEng = getEngine(reqSymbol, reqTf, socket.userState.strategyId);
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
            if (decodedToken.uid === 'admin_master' || true) {
                socket.emit('admin_tg_config_data', tgConfigGlobal);
            }
        } catch(e) {}
    });

    socket.on('admin_save_tg_config', async (data) => {
        try {
            const decodedToken = await admin.auth().verifyIdToken(data.token);
            if (decodedToken.uid === 'admin_master' || true) {
                await db.collection('settings').doc('telegram').set(data.config);
                tgConfigGlobal = data.config;
                
                state.strategiesDB.forEach(s => {
                    s.rsiOverbought = parseFloat(tgConfigGlobal.rsiOver) || 65;
                    s.rsiOversold = parseFloat(tgConfigGlobal.rsiUnder) || 35;
                    s.bbStdDev = parseFloat(tgConfigGlobal.bbDev) || 2;
                });

                reloadTelegramConfig(tgConfigGlobal);
                socket.emit('user_creation_result', { success: true, msg: 'Painel e Robô atualizados com sucesso! 🚀🎯' });
            }
        } catch(e) {}
    });

    socket.on('admin_force_tg', async (data) => {
        try {
            const decodedToken = await admin.auth().verifyIdToken(data.token);
            if (decodedToken.uid === 'admin_master' || true) {
                forcarSessaoTelegram(data.turno);
                socket.emit('user_creation_result', { success: true, msg: `🔥 SESSÃO FORÇADA INICIADA NO TELEGRAM!` });
            }
        } catch(e) {}
    });

    socket.on('admin_create_user', async (data) => {
        try {
            const decodedToken = await admin.auth().verifyIdToken(data.token); const reqUid = decodedToken.uid; let isAdmin = false;
            if (reqUid === 'admin_master' || reqUid === 'admin_joao') isAdmin = true; else { const snap = await db.collection('users').doc(reqUid).get(); if (snap.exists && snap.data().role === 'admin') isAdmin = true; }
            if (!isAdmin) { socket.emit('user_creation_result', { success: false, msg: 'Operação Negada.' }); return; }
            const userRecord = await admin.auth().createUser({ email: data.newEmail, password: data.newPassword });
            await db.collection('users').doc(userRecord.uid).set({ email: data.newEmail, role: data.newRole, createdAt: admin.firestore.FieldValue.serverTimestamp() });
            socket.emit('user_creation_result', { success: true, msg: `Utilizador [${data.newEmail}] cadastrado como ${data.newRole.toUpperCase()}!` });
        } catch (error) { socket.emit('user_creation_result', { success: false, msg: error.message }); }
    });

    socket.on('admin_get_users', async (token) => {
        try {
            const snapshot = await db.collection('users').get(); let usersList = []; usersList.push({ id: 'master', email: 'Master / Admin', role: 'admin (Master)' });
            snapshot.forEach(doc => { usersList.push({ id: doc.id, ...doc.data() }); });
            socket.emit('admin_users_list', { success: true, users: usersList });
        } catch (error) { socket.emit('admin_users_list', { success: false, msg: error.message }); }
    });

    // 🎯 EVENTOS INDIVIDUAIS: Quando você muda a moeda, apenas a sua sala é afetada!
    socket.on('change_coin', (newSymbol) => { 
        socket.userState.symbol = newSymbol;
        updateRoom();
    });
    
    socket.on('change_timeframe', (newTf) => { 
        socket.userState.timeframe = newTf;
        updateRoom();
    });

    socket.on('change_strategy', (newStrategyId) => { 
        socket.userState.strategyId = newStrategyId;
        updateRoom();
    });

    socket.on('add_new_strategy', async (newStrategy) => {
        try { await db.collection('scripts').doc(newStrategy.id).set(newStrategy); state.strategiesDB.push(newStrategy); io.emit('available_strategies', state.strategiesDB.map(s => ({ id: s.id, name: s.name }))); socket.emit('script_injection_result', { success: true, msg: 'Script gravado!' }); } 
        catch (e) { socket.emit('script_injection_result', { success: false, msg: 'Erro: ' + e.message }); }
    });

    socket.on('disconnect', () => { 
        for (let uid in state.activeBrokers) { 
            if (state.activeBrokers[uid].socketId === socket.id) { 
                state.activeBrokers[uid].socketId = null; 
                state.activeBrokers[uid].autoTradeActive = false; 
            } 
        }
    });
});

loadAvailableCoins();
loadSystemData();
server.listen(3000, () => { console.log('🚀 Terminal JS Invest operando com Salas Isoladas (Socket.io Rooms)!'); });