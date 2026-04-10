const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');

const { admin, db } = require('./config/firebase');
const { initEngine, startConnection, getEngine, scanRadarHistory } = require('./services/engine');
const { getVelloxBalance } = require('./services/velloxApi');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static('public'));

const MASTER_EMAIL = 'alexandre.lucena@gmail.com'; 
const MASTER_BROKER_LOGIN = 'AlexLucena1981';

const state = {
    globalDynamicCookie: "locale=eyJpdiI6IkgvYk5XeTFiVUhoczRlQmM2RTZJMFE9PSIsInZhbHVlIjoiNktFOUs2T1lHTXhIN2JnSndzUG9leVczeWRmZ1RwMmJGc2tZQTVaaUh0RVJQSTNUOW9TMWFkSFR6SUxFeHVZZCIsIm1hYyI6ImJjMTFhOGUyNzY1NjA3ZDk3ZGJmMjdhZWU1MmI2NzVjNTg5YzIzYjM5ZWM3NDY5OWRjMTJhYmY1YWU0M2Y0Y2UiLCJ0YWciOiIifQ==; XSRF-TOKEN=eyJpdiI6IkJXTkh4d0NXZlFaQzhVZXpQZkZaa2c9PSIsInZhbHVlIjoidkU4cTBHbUVjZHhTeTkvUGh0YTNMZGpoZTRXV0xaU3hxeEdrTmk4TFVpYThWYnlkREFiVnFDNFNTVFJWVHFnTUFUdEZITzJzV3hOMUp3MzVYR0JwbTdHa2NrZ3JOSHM0R3MyVjVxbnFQZkdzTnpkb3pOS0hjWWU2QTlKdHExMGsiLCJtYWMiOiIzODZmM2MyM2IzMzc3ZjUxMWM4NDU0ZTA5YmMyNjZkZWEyMzdkOWFjMTA3OTdmYmFmNzgxZGNmZjI4ZmE1Yzg2IiwidGFnIjoiIn0=; laravel_session=eyJpdiI6Im8wQkZoRm1EaDYrcXhpSDFVRnZnN3c9PSIsInZhbHVlIjoic2JIb2tDMWhON0pBc3FoYjZpajhaTitweDdRQUs5TUVqamdNdXZBMytQTXFNaHNuSTYvTnpXUjJ4bzBhSEhseHZ0aWFRN0lkSWd1aTBJamZQMEs2YnJ4aFBZTmNxZGpzdkZ3b2VtL3JyS042eEZlWStzemxmNEpDVjlPN1FyemkiLCJtYWMiOiIwMmEwN2VlN2QyYzVjYmFkNGU0YzRlNzgxZTg2NzFiYjY3NmIwNjEyODE2MWU2Y2JlOWFlY2YzOGY1M2U1MzZhIiwidGFnIjoiIn0=",
    activeEngines: {}, currentEngineKey: '', currentSymbol: 'btcusdt', currentTimeframe: '1m', currentStrategyId: '', 
    currentEngineStatus: "Aguardando inicialização...", strategiesDB: [], activeBrokers: {}, availableCoins: {},
    radarStats: { total: 0, byAsset: {}, byHour: {} } 
};

initEngine(io, state);

async function loadStrategiesFromDB() {
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
        // 🎯 AQUI: Assim que o Cookie entra, refaz o Backtest para puxar os OTC/Forex!
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

            state.activeBrokers[uid] = { 
                uid: uid, socketId: socket.id, token: brokerToken, demoAccountId: '8', realAccountId: '0', 
                autoTradeActive: false, config: { active: false, accountType: 'demo', baseAmount: 5, maxGale: 2, stopWin: 99999, stopLoss: 99999 }, sessionProfit: 0 
            };
            socket.emit('hybrid_login_result', { success: true, firebaseToken: customToken, role: userRole, balance: { demo: "---", real: realBalance }, brokerToken: brokerToken, uid: uid });
        } catch (error) { socket.emit('hybrid_login_result', { success: false, reason: 'broker', msg: 'Credenciais inválidas.' }); }
    });

    socket.on('auto_reconnect', async (data) => {
        try {
            const { token, role, uid } = data;
            if(!token || !uid) throw new Error("Sem Token ou UID");

            const realBalance = await getVelloxBalance(token);
            if(realBalance === "0,00" && !state.activeBrokers[uid]) throw new Error("Token Expirado");

            if (state.activeBrokers[uid]) { state.activeBrokers[uid].socketId = socket.id; } 
            else { state.activeBrokers[uid] = { uid: uid, socketId: socket.id, token: token, demoAccountId: '8', realAccountId: '0', autoTradeActive: false, config: { active: false, accountType: 'demo', baseAmount: 5, maxGale: 2, stopWin: 99999, stopLoss: 99999 }, sessionProfit: 0 }; }
            
            socket.emit('auto_reconnect_result', { success: true, role: role, balance: { demo: "---", real: realBalance } });
        } catch (error) { socket.emit('auto_reconnect_result', { success: false, msg: 'Sessão expirada. Faça login novamente.' }); }
    });

    socket.on('setup_auto_trade', (config) => { socket.emit('auto_trade_status', { active: false, msg: "Modo Análise Ativo.", profit: 0 }); });
    socket.on('manual_trade', async (data) => { socket.emit('sniper_error', 'O sistema está em Modo Análise. Por favor, opere manualmente na corretora.'); });

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

    socket.on('disconnect', () => { 
        for (let uid in state.activeBrokers) { if (state.activeBrokers[uid].socketId === socket.id) { state.activeBrokers[uid].socketId = null; } }
    });
});

loadStrategiesFromDB();
loadAvailableCoins();
server.listen(3000, () => { console.log('🚀 Terminal JS Invest operando no MODO ANÁLISE (Porta 3000)'); });