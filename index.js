const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const WebSocket = require('ws');
const axios = require('axios');
const admin = require("firebase-admin"); 

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// ==========================================
// 1. INICIALIZANDO O BANCO DE DADOS (FIRESTORE)
// ==========================================
const serviceAccount = require("./firebase-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// ==========================================
// VARIÁVEIS DE ESTADO GLOBAL E PERMISSÕES
// ==========================================
const MASTER_EMAIL = 'alexandre.lucena@gmail.com'; // E-mail dono do sistema

let closePrices = [];
let ws = null;
let currentSymbol = 'btcusdt';
let currentStrategyId = ''; 

let activeSignals = []; 
let signalHistory = []; 
let scoreboard = { win1: 0, winG1: 0, winG2: 0, loss: 0 };
let currentEngineStatus = "Aguardando inicialização..."; 
let currentConnectionId = 0; 

let strategiesDB = [];

async function loadStrategiesFromDB() {
    try {
        const snapshot = await db.collection('scripts').get();
        strategiesDB = [];
        snapshot.forEach(doc => {
            strategiesDB.push(doc.data());
        });

        if (strategiesDB.length > 0) {
            console.log(`🔥 ${strategiesDB.length} scripts carregados do Firebase!`);
            currentStrategyId = strategiesDB[0].id; 
            startConnection(currentSymbol); 
        } else {
            console.log("⚠️ Nenhum script encontrado no banco de dados.");
            updateStatus("Aguardando injeção de scripts no banco...");
        }
        io.emit('available_strategies', strategiesDB.map(s => ({ id: s.id, name: s.name })));
    } catch (error) {
        console.error("Erro ao ler do Firebase:", error);
    }
}

function calculateSMA(data, period) {
    if (data.length < period) return null;
    return data.slice(-period).reduce((a, b) => a + b, 0) / period;
}
function calculateWMA(data, period) {
    if (data.length < period) return null;
    const slice = data.slice(-period);
    let sum = 0, weightSum = 0;
    for (let i = 0; i < period; i++) {
        const weight = i + 1;
        sum += slice[i] * weight;
        weightSum += weight;
    }
    return sum / weightSum;
}

function updateStatus(msg) {
    currentEngineStatus = msg;
    io.emit('status', { msg });
}

function evaluateStrategy(prices, strategyConfig) {
    if (!prices || prices.length < 50) return null;

    if (strategyConfig.isComplex && strategyConfig.id === 'rei_das_binarias') {
        let buf1 = [];
        for(let i = 10; i >= 0; i--) {
            let slice = prices.slice(0, prices.length - i);
            let sma1 = calculateSMA(slice, 1);
            let sma34 = calculateSMA(slice, 34);
            if(sma1 === null || sma34 === null) return null;
            buf1.push(sma1 - sma34);
        }
        
        const currentB1 = buf1[10];
        const prevB1 = buf1[9];
        const currentB2 = calculateWMA(buf1.slice(-5), 5);
        const prevB2 = calculateWMA(buf1.slice(-6, -1), 5);

        if (currentB1 > currentB2 && prevB1 < prevB2) return 'CALL';
        if (currentB1 < currentB2 && prevB1 > prevB2) return 'PUT';
        return null;
    }

    let current = {}, prev = {};
    for (const [key, config] of Object.entries(strategyConfig.indicators)) {
        if (config.type === 'SMA') {
            current[key] = calculateSMA(prices, config.period);
            prev[key] = calculateSMA(prices.slice(0, -1), config.period);
        }
    }
    if (Object.values(current).includes(null)) return null;

    try {
        const isCall = new Function('current', 'prev', `return ${strategyConfig.conditions.call};`)(current, prev);
        const isPut = new Function('current', 'prev', `return ${strategyConfig.conditions.put};`)(current, prev);

        if (isCall) return 'CALL';
        if (isPut) return 'PUT';
    } catch (e) { 
        console.error("Erro na regra da estratégia:", e); 
    }
    return null;
}

// ==========================================
// 4. MOTOR DE CONEXÃO
// ==========================================
async function startConnection(symbol) {
    currentConnectionId++;
    const myConnectionId = currentConnectionId;

    if (ws) { ws.terminate(); ws = null; }
    
    closePrices = [];
    activeSignals = []; 
    signalHistory = []; 
    scoreboard = { win1: 0, winG1: 0, winG2: 0, loss: 0 };
    
    const currentStrategy = strategiesDB.find(s => s.id === currentStrategyId);
    if (!currentStrategy) {
        updateStatus(`Erro: Estratégia não encontrada.`);
        return;
    }
    updateStatus(`Carregando histórico de ${symbol.toUpperCase()}...`);

    try {
        const response = await axios.get(`https://data-api.binance.vision/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=1m&limit=100`);
        if (myConnectionId !== currentConnectionId) return; 

        const klines = response.data;
        
        for (let i = 0; i < klines.length - 1; i++) {
            const k_time = klines[i][0];
            const k_o = parseFloat(klines[i][1]); 
            const k_c = parseFloat(klines[i][4]); 
            
            activeSignals = activeSignals.filter(sig => {
                const isGreen = k_c > k_o;
                const isRed = k_c < k_o;
                const won = (sig.type === 'CALL' && isGreen) || (sig.type === 'PUT' && isRed);

                if (won) {
                    if (sig.step === 0) { sig.status = 'WIN 1ª 🎯'; scoreboard.win1++; }
                    else if (sig.step === 1) { sig.status = 'WIN G1 🎯'; scoreboard.winG1++; }
                    else if (sig.step === 2) { sig.status = 'WIN G2 🎯'; scoreboard.winG2++; }
                    return false; 
                } else {
                    sig.step++;
                    if (sig.step > 2) { sig.status = 'LOSS 🔴'; scoreboard.loss++; return false; } 
                    else { sig.status = `Gale ${sig.step}...`; return true; }
                }
            });

            closePrices.push(k_c);
            
            if (activeSignals.length === 0) {
                const newSigType = evaluateStrategy(closePrices, currentStrategy);
                if (newSigType) {
                    const newSig = {
                        id: k_time, type: newSigType,
                        time: new Date(k_time).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
                        step: 0, status: 'Aguardando Vela...'
                    };
                    activeSignals.push(newSig);
                    signalHistory.unshift(newSig); 
                    if (signalHistory.length > 20) signalHistory.pop(); 
                }
            }
        }
        
        io.emit('scoreboard', scoreboard);
        io.emit('history_dump', signalHistory);
        updateStatus(`Analisando o mercado (${symbol.toUpperCase()})...`);
        
        ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_1m`);
        
        ws.on('message', (data) => {
            if (myConnectionId !== currentConnectionId) return;
            try {
                const kline = JSON.parse(data).k;
                const currentPrice = parseFloat(kline.c);
                const isCandleClosed = kline.x;
                const currentOpen = parseFloat(kline.o);
                
                const secondsLeft = 60 - new Date().getSeconds();
                io.emit('price_update', { price: currentPrice, secondsLeft });

                if (closePrices.length > 50 && !isCandleClosed) {
                    if (activeSignals.length === 0) {
                        let tempPrices = [...closePrices, currentPrice];
                        if (tempPrices.length > 150) tempPrices.shift();
                        const tempSignal = evaluateStrategy(tempPrices, currentStrategy);
                        if (tempSignal === 'CALL') io.emit('pre_alert', { call: true, put: false });
                        else if (tempSignal === 'PUT') io.emit('pre_alert', { call: false, put: true });
                        else io.emit('pre_alert', { call: false, put: false }); 
                    } else {
                        io.emit('pre_alert', { call: false, put: false });
                    }
                }

                if (isCandleClosed) { 
                    closePrices.push(currentPrice);
                    if (closePrices.length > 150) closePrices.shift();

                    activeSignals = activeSignals.filter(sig => {
                        const isGreen = currentPrice > currentOpen;
                        const isRed = currentPrice < currentOpen;
                        const won = (sig.type === 'CALL' && isGreen) || (sig.type === 'PUT' && isRed);

                        if (won) {
                            if (sig.step === 0) { sig.status = 'WIN 1ª 🎯'; scoreboard.win1++; }
                            else if (sig.step === 1) { sig.status = 'WIN G1 🎯'; scoreboard.winG1++; }
                            else if (sig.step === 2) { sig.status = 'WIN G2 🎯'; scoreboard.winG2++; }
                            io.emit('signal_result', sig); io.emit('scoreboard', scoreboard); 
                            return false; 
                        } else {
                            sig.step++;
                            if (sig.step > 2) {
                                sig.status = 'LOSS 🔴'; scoreboard.loss++;
                                io.emit('signal_result', sig); io.emit('scoreboard', scoreboard); 
                                return false; 
                            } else {
                                sig.status = `Gale ${sig.step}...`; io.emit('signal_result', sig);
                                return true; 
                            }
                        }
                    });

                    if (activeSignals.length === 0) {
                        const newSignalType = evaluateStrategy(closePrices, currentStrategy);
                        if (newSignalType) {
                            const newSig = { 
                                id: Date.now(), type: newSignalType, 
                                time: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }), 
                                step: 0, status: 'Aguardando Vela...' 
                            };
                            activeSignals.push(newSig); 
                            signalHistory.unshift(newSig); 
                            if (signalHistory.length > 20) signalHistory.pop();
                            io.emit('new_signal_history', newSig); 
                            io.emit('signal', { type: newSignalType, time: newSig.time }); 
                        }
                    }
                }
            } catch (e) {
                console.error("Erro no WebSocket:", e);
            }
        });

        ws.on('error', (err) => {
            if (myConnectionId !== currentConnectionId) return;
            updateStatus('Sinal da corretora perdido. Reconectando em 5s...');
            setTimeout(() => startConnection(currentSymbol), 5000);
        });
        ws.on('close', () => {
            if (myConnectionId !== currentConnectionId) return;
            updateStatus('Conexão encerrada. Reiniciando o motor em 5s...');
            setTimeout(() => startConnection(currentSymbol), 5000);
        });

    } catch (error) {
        if (myConnectionId !== currentConnectionId) return; 
        updateStatus(`Falha de conexão com a Binance. Tentando novamente em 5s...`);
        setTimeout(() => startConnection(currentSymbol), 5000);
    }
}

// ==========================================
// 5. COMUNICAÇÃO COM O FRONTEND E ADMINISTRAÇÃO
// ==========================================
io.on('connection', (socket) => {
    socket.emit('status', { msg: currentEngineStatus });
    socket.emit('available_strategies', strategiesDB.map(s => ({ id: s.id, name: s.name })));
    socket.emit('scoreboard', scoreboard);
    socket.emit('history_dump', signalHistory);
    
    socket.on('check_role', async (token) => {
        try {
            const decodedToken = await admin.auth().verifyIdToken(token);
            const email = decodedToken.email;

            if (email.toLowerCase() === MASTER_EMAIL.toLowerCase()) {
                socket.emit('role_result', { role: 'admin' });
                return;
            }
            
            const snapshot = await db.collection('users').where('email', '==', email).get();
            if (!snapshot.empty) {
                socket.emit('role_result', { role: snapshot.docs[0].data().role });
            } else {
                socket.emit('role_result', { role: 'aluno' });
            }
        } catch (error) {
            console.error("Erro ao validar token de segurança:", error);
            socket.emit('role_result', { role: 'aluno' });
        }
    });

    socket.on('admin_create_user', async (data) => {
        try {
            const decodedToken = await admin.auth().verifyIdToken(data.token);
            const requesterEmail = decodedToken.email;
            
            let isAdmin = false;
            
            if (requesterEmail.toLowerCase() === MASTER_EMAIL.toLowerCase()) {
                isAdmin = true;
            } else {
                const snap = await db.collection('users').where('email', '==', requesterEmail).get();
                if (!snap.empty && snap.docs[0].data().role === 'admin') isAdmin = true;
            }

            if (!isAdmin) {
                socket.emit('user_creation_result', { success: false, msg: 'Operação Negada: Você não é administrador.' });
                return;
            }

            const userRecord = await admin.auth().createUser({
                email: data.newEmail,
                password: data.newPassword,
            });
            
            await db.collection('users').doc(userRecord.uid).set({
                email: data.newEmail,
                role: data.newRole,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            socket.emit('user_creation_result', { success: true, msg: `Usuário [${data.newEmail}] cadastrado com sucesso!` });
        } catch (error) {
            socket.emit('user_creation_result', { success: false, msg: error.message });
        }
    });

    // NOVO: LISTAR USUÁRIOS
    socket.on('admin_get_users', async (token) => {
        try {
            const decodedToken = await admin.auth().verifyIdToken(token);
            const requesterEmail = decodedToken.email;
            
            let isAdmin = false;
            if (requesterEmail.toLowerCase() === MASTER_EMAIL.toLowerCase()) {
                isAdmin = true;
            } else {
                const snap = await db.collection('users').where('email', '==', requesterEmail).get();
                if (!snap.empty && snap.docs[0].data().role === 'admin') isAdmin = true;
            }

            if (!isAdmin) {
                socket.emit('admin_users_list', { success: false, msg: 'Acesso Negado.' });
                return;
            }

            // Puxa a lista do Firestore
            const snapshot = await db.collection('users').get();
            let usersList = [];
            
            // Adiciona o Master para aparecer na lista visualmente também
            usersList.push({ id: 'master', email: MASTER_EMAIL, role: 'admin (Master)' });

            snapshot.forEach(doc => {
                // Previne de mostrar o master duplicado caso você tenha se cadastrado na collection também
                if(doc.data().email.toLowerCase() !== MASTER_EMAIL.toLowerCase()) {
                    usersList.push({ id: doc.id, ...doc.data() });
                }
            });

            socket.emit('admin_users_list', { success: true, users: usersList });
        } catch (error) {
            socket.emit('admin_users_list', { success: false, msg: error.message });
        }
    });

    socket.on('change_coin', (newSymbol) => {
        currentSymbol = newSymbol;
        startConnection(currentSymbol);
    });

    socket.on('change_strategy', (newStrategyId) => {
        currentStrategyId = newStrategyId;
        startConnection(currentSymbol); 
    });

    socket.on('add_new_strategy', async (newStrategy) => {
        try {
            const exists = strategiesDB.find(s => s.id === newStrategy.id);
            if (!exists) {
                await db.collection('scripts').doc(newStrategy.id).set(newStrategy);
                strategiesDB.push(newStrategy);
                io.emit('available_strategies', strategiesDB.map(s => ({ id: s.id, name: s.name })));
            }
        } catch (e) { console.error("Erro ao salvar nova estratégia:", e); }
    });
});

loadStrategiesFromDB();

server.listen(3000, () => {
    console.log('🚀 Motor JS Invest operando na porta 3000!');
});