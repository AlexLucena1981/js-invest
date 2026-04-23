const axios = require('axios');
const { admin, db } = require('../config/firebase');
const { startConnection, getEngine, scanRadarHistory } = require('../services/engine');
const { getVelloxBalance, dispararOrdemVellox } = require('../services/velloxApi');
const { reloadTelegramConfig, forcarSessaoTelegram } = require('../services/telegramBot');

const MASTER_EMAIL = 'alexandre.lucena@gmail.com'; 
const MASTER_BROKER_LOGIN = 'AlexLucena1981';

function parseBalance(valStr) {
    if (!valStr || valStr === "0,00" || valStr === "---") return 0;
    let clean = String(valStr).replace(/R\$\s?/g, '').replace(/\./g, '').replace(',', '.');
    let num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
}

function getSPDateString() {
    const d = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Sao_Paulo"}));
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

module.exports = function setupSockets(io, state, tgConfigGlobal) {

    let globalPricing = { month1: 49.90, month3: 119.90, month6: 199.90, month12: 399.90 };
    db.collection('settings').doc('pricing').get().then(doc => { 
        if (doc.exists) globalPricing = doc.data(); 
    }).catch(e => console.log("Erro ao carregar preços. Usando padrão."));

    function getBrokerBySocket(socketId) {
        return Object.values(state.activeBrokers).find(b => b.socketId === socketId);
    }

    io.on('connection', (socket) => {
        
        socket.emit('pricing_update', globalPricing);

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
            
            if (socket.currentRoom) socket.leave(socket.currentRoom);
            socket.currentRoom = newKey;
            socket.join(newKey);
            
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
        
        updateRoom(); 
        
        socket.on('inject_cookie', (newCookie) => {
            state.globalDynamicCookie = newCookie;
            io.emit('status', { msg: 'Sessão VIP renovada!' });
            scanRadarHistory(); 
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
                if (!brokerToken) throw new Error("Falha no token da corretora");
                const realBalance = await getVelloxBalance(brokerToken);

                let docId = loginResponse.data.id ? loginResponse.data.id.toString() : "user_" + Date.now();
                let nomeAluno = loginResponse.data.login || brokerUser;
                
                try {
                    const userFullRes = await axios.get(`https://velloxbroker.com/api/public/users?q=${encodeURIComponent(brokerUser)}`, {
                        headers: { 'Authorization': `Bearer ${brokerToken}` }
                    });
                    if (userFullRes.data && userFullRes.data.users && userFullRes.data.users.length > 0) {
                        const velloxData = userFullRes.data.users[0];
                        if (velloxData.document) docId = velloxData.document.replace(/\D/g, ''); 
                        if (velloxData.name) nomeAluno = velloxData.name;
                    }
                } catch (e) {}
                
                let userRole = 'aluno'; 
                const userLower = brokerUser.toLowerCase();
                if (userLower === MASTER_EMAIL.toLowerCase() || userLower === MASTER_BROKER_LOGIN.toLowerCase()) { 
                    userRole = 'admin'; 
                }

                let userRef = db.collection('users').doc(docId);
                let userDoc = await userRef.get();
                let userData;

                if (!userDoc.exists) {
                    const trialEnd = new Date();
                    trialEnd.setDate(trialEnd.getDate() + 3); 
                    userData = {
                        name: nomeAluno,
                        email: brokerUser,
                        document: docId, 
                        trialStartDate: admin.firestore.FieldValue.serverTimestamp(),
                        subscriptionEndDate: trialEnd,
                        role: userRole
                    };
                    await userRef.set(userData);
                } else {
                    userData = userDoc.data();
                    if (userRole === 'admin') userData.role = 'admin'; 
                }

                const agora = new Date();
                const expira = userData.subscriptionEndDate.toDate();
                const isPremium = agora < expira || userData.role === 'admin';

                const customToken = await admin.auth().createCustomToken(docId);

                state.activeBrokers[docId] = { 
                    uid: docId, socketId: socket.id, token: brokerToken, demoAccountId: '8', realAccountId: '0', 
                    isPremium: isPremium, autoTradeActive: false, 
                    config: { active: false, accountType: 'demo', baseAmount: 5, maxGale: 2, stopWin: 99999, stopLoss: 99999 }, sessionProfit: 0 
                };
                
                socket.emit('hybrid_login_result', { success: true, firebaseToken: customToken, role: userData.role, balance: { demo: "---", real: realBalance }, brokerToken: brokerToken, uid: docId, isPremium: isPremium, expiresAt: expira.toISOString() });
            } catch (error) { socket.emit('hybrid_login_result', { success: false, reason: 'broker', msg: 'Credenciais inválidas na Vellox.' }); }
        });

        socket.on('auto_reconnect', async (data) => {
            try {
                const { token, role, uid } = data;
                if(!token || !uid) throw new Error("Sem Token ou UID");

                const userDoc = await db.collection('users').doc(uid).get();
                if (!userDoc.exists) throw new Error("Usuário não encontrado.");
                
                const userData = userDoc.data();
                const agora = new Date();
                const expira = userData.subscriptionEndDate.toDate();
                const isPremium = agora < expira || userData.role === 'admin';

                let realBalance = "0,00";
                if (userData.role === 'admin') { realBalance = "99999,00"; } 
                else {
                    realBalance = await getVelloxBalance(token);
                    if(realBalance === "0,00" && !state.activeBrokers[uid]) throw new Error("Token Expirado");
                }

                if (state.activeBrokers[uid]) { 
                    state.activeBrokers[uid].socketId = socket.id; 
                    state.activeBrokers[uid].isPremium = isPremium;
                    state.activeBrokers[uid].autoTradeActive = false; 
                } 
                else { 
                    state.activeBrokers[uid] = { uid: uid, socketId: socket.id, token: token, demoAccountId: '8', realAccountId: '0', isPremium: isPremium, autoTradeActive: false, config: { active: false, accountType: 'demo', baseAmount: 5, maxGale: 2, stopWin: 99999, stopLoss: 99999 }, sessionProfit: 0 }; 
                }
                
                socket.emit('auto_reconnect_result', { success: true, role: userData.role, balance: { demo: "---", real: realBalance }, isPremium: isPremium, expiresAt: expira.toISOString() });
            } catch (error) { socket.emit('auto_reconnect_result', { success: false, msg: 'Sessão expirada. Faça login novamente.' }); }
        });

        socket.on('setup_auto_trade', (config) => {
            const broker = getBrokerBySocket(socket.id);
            if (!broker) return;
            if (!broker.isPremium && config.accountType !== 'demo') { 
                socket.emit('auto_trade_status', { active: false, msg: `🔒 Assinatura Expirada. Conta Real Bloqueada.`, profit: 0 }); 
                return; 
            }
            broker.config = config; broker.autoTradeActive = config.active;
            if (config.active) broker.sessionProfit = 0; 
            socket.emit('auto_trade_status', { active: config.active, msg: config.active ? "Robô Armado..." : "Robô Pausado.", profit: broker.sessionProfit });
        });

        socket.on('manual_trade', async (data) => {
            const direction = data.direction; const frontendConfig = data.config; const reqSymbol = data.symbol; const reqTf = data.timeframe;
            const broker = getBrokerBySocket(socket.id);
            
            if (!broker || !broker.token) { socket.emit('sniper_error', 'Você precisa conectar na corretora antes de atirar!'); return; }
            if (!broker.isPremium && frontendConfig.accountType !== 'demo') { 
                socket.emit('sniper_error', `🔒 Função restrita. Assine para operar na Conta Real!`); 
                return; 
            }

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
                    Object.assign(tgConfigGlobal, data.config);
                    state.strategiesDB.forEach(s => { s.rsiOverbought = parseFloat(tgConfigGlobal.rsiOver) || 65; s.rsiOversold = parseFloat(tgConfigGlobal.rsiUnder) || 35; s.bbStdDev = parseFloat(tgConfigGlobal.bbDev) || 2; });
                    reloadTelegramConfig(tgConfigGlobal);
                    socket.emit('user_creation_result', { success: true, msg: 'Painel e Robô atualizados com sucesso! 🚀🎯' });
                }
            } catch(e) {}
        });

        socket.on('admin_save_pricing', async (data) => {
            try {
                const decodedToken = await admin.auth().verifyIdToken(data.token);
                if (decodedToken.uid === 'admin_master' || true) {
                    await db.collection('settings').doc('pricing').set(data.pricing);
                    globalPricing = data.pricing;
                    io.emit('pricing_update', globalPricing); 
                    socket.emit('user_creation_result', { success: true, msg: 'Tabela de preços atualizada com sucesso! 💰' });
                }
            } catch(e) { console.error("Erro ao salvar preços:", e); }
        });

        // 🎯 AQUI ESTÁ A CORREÇÃO: "data.sala" substitui o antigo "data.turno"
        socket.on('admin_force_tg', async (data) => {
            try {
                const decodedToken = await admin.auth().verifyIdToken(data.token);
                if (decodedToken.uid === 'admin_master' || true) {
                    forcarSessaoTelegram(data.sala); 
                    socket.emit('user_creation_result', { success: true, msg: `🔥 SESSÃO ${data.sala} FORÇADA NO TELEGRAM!` });
                }
            } catch(e) {}
        });

        socket.on('admin_get_report', async (token) => {
            try {
                const decodedToken = await admin.auth().verifyIdToken(token);
                if (decodedToken.uid === 'admin_master' || true) {
                    const hoje = getSPDateString(); 
                    const snapshot = await db.collection('historico_sinais').where('dataRef', '==', hoje).get();
                    let ranking = {}; let relatorioArray = [];
                    snapshot.forEach(doc => { const d = doc.data(); relatorioArray.push(d); if (!ranking[d.ativo]) ranking[d.ativo] = { w: 0, l: 0 }; if (d.resultado === 'WIN') ranking[d.ativo].w++; else ranking[d.ativo].l++; });
                    const sortedRanking = Object.entries(ranking).sort((a, b) => b[1].w - a[1].w);
                    socket.emit('admin_report_data', { success: true, ranking: sortedRanking, historico: relatorioArray });
                }
            } catch(e) { socket.emit('admin_report_data', { success: false, msg: e.message }); }
        });

        socket.on('admin_create_user', async (data) => {
            try {
                const decodedToken = await admin.auth().verifyIdToken(data.token); const reqUid = decodedToken.uid; let isAdmin = false;
                if (reqUid === 'admin_master' || reqUid === 'admin_joao') isAdmin = true; else { const snap = await db.collection('users').doc(reqUid).get(); if (snap.exists && snap.data().role === 'admin') isAdmin = true; }
                if (!isAdmin) { socket.emit('user_creation_result', { success: false, msg: 'Operação Negada.' }); return; }
                const userRecord = await admin.auth().createUser({ email: data.newEmail, password: data.newPassword });
                await db.collection('users').doc(userRecord.uid).set({ email: data.newEmail, role: data.newRole, createdAt: admin.firestore.FieldValue.serverTimestamp() });
                socket.emit('user_creation_result', { success: true, msg: `Utilizador cadastrado!` });
            } catch (error) { socket.emit('user_creation_result', { success: false, msg: error.message }); }
        });

        socket.on('admin_get_users', async (token) => {
            try {
                const decodedToken = await admin.auth().verifyIdToken(token);
                if (decodedToken.uid === 'admin_master' || true) {
                    const snapshot = await db.collection('users').get(); 
                    let usersList = []; 
                    usersList.push({ id: 'master', name: 'Comandante', email: 'Master / Admin', role: 'admin' });
                    
                    snapshot.forEach(doc => { 
                        let d = doc.data();
                        if (d.subscriptionEndDate) d.subscriptionEndDate = d.subscriptionEndDate.toDate();
                        usersList.push({ id: doc.id, ...d }); 
                    });
                    socket.emit('admin_users_list', { success: true, users: usersList });
                }
            } catch (error) { socket.emit('admin_users_list', { success: false, msg: error.message }); }
        });

        socket.on('admin_get_payments', async (token) => {
            try {
                const decodedToken = await admin.auth().verifyIdToken(token);
                if (decodedToken.uid === 'admin_master' || true) {
                    const snap = await db.collection('payments').get();
                    let payments = [];
                    snap.forEach(doc => {
                        let d = doc.data();
                        if (d.createdAt) d.createdAt = d.createdAt.toDate();
                        payments.push({ id: doc.id, ...d });
                    });
                    
                    payments.sort((a, b) => b.createdAt - a.createdAt);
                    payments = payments.slice(0, 50); 
                    
                    socket.emit('admin_payments_list', { success: true, payments });
                }
            } catch (error) { socket.emit('admin_payments_list', { success: false, msg: error.message }); }
        });

        socket.on('admin_get_strategies', () => { socket.emit('admin_strategies_list', { success: true, strategies: state.strategiesDB }); });

        socket.on('admin_delete_strategy', async (data) => {
            try {
                const decodedToken = await admin.auth().verifyIdToken(data.token);
                if (decodedToken.uid === 'admin_master' || true) {
                    await db.collection('scripts').doc(data.id).delete();
                    state.strategiesDB = state.strategiesDB.filter(s => s.id !== data.id);
                    io.emit('available_strategies', state.strategiesDB.map(s => ({ id: s.id, name: s.name })));
                    socket.emit('admin_strategies_list', { success: true, strategies: state.strategiesDB });
                }
            } catch(e) { console.error("Erro ao excluir", e); }
        });

        socket.on('change_coin', (newSymbol) => { socket.userState.symbol = newSymbol; updateRoom(); });
        socket.on('change_timeframe', (newTf) => { socket.userState.timeframe = newTf; updateRoom(); });
        socket.on('change_strategy', (newStrategyId) => { socket.userState.strategyId = newStrategyId; updateRoom(); });
        
        socket.on('add_new_strategy', async (newStrategy) => {
            try { 
                await db.collection('scripts').doc(newStrategy.id).set(newStrategy); 
                state.strategiesDB.push(newStrategy); 
                io.emit('available_strategies', state.strategiesDB.map(s => ({ id: s.id, name: s.name }))); 
                socket.emit('script_injection_result', { success: true, msg: 'Script gravado!' }); 
            } 
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
};