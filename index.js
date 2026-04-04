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

// ============================================================================
// 1. INICIALIZANDO O BANCO DE DADOS (FIRESTORE)
// ============================================================================
const serviceAccount = require("./firebase-key.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// ============================================================================
// 2. VARIÁVEIS DE ESTADO GLOBAL E TRAVAS DE SEGURANÇA
// ============================================================================
const MASTER_EMAIL = 'alexandre.lucena@gmail.com'; 
const MASTER_BROKER_LOGIN = 'AlexLucena1981';

let closePrices = [];
let ws = null;
let currentSymbol = 'btcusdt';
let currentStrategyId = ''; 
let currentGlobalPrice = 0; 

let activeSignals = []; 
let signalHistory = []; 
let scoreboard = { win1: 0, winG1: 0, winG2: 0, loss: 0 };
let currentEngineStatus = "Aguardando inicialização..."; 

let currentConnectionId = 0; 
let lastClosedCandleTime = 0; 
let lastResolvedCandleTime = 0; // Trava de Respiro (Evita metralhadora de sinais)

let strategiesDB = [];
let activeBrokers = {}; 
let availableCoins = ['btcusdt', 'ethusdt', 'solusdt', 'bnbusdt']; // Fallback seguro

// ============================================================================
// 3. CARREGAMENTO DE DADOS E MOEDAS (BINANCE API)
// ============================================================================
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

async function loadAvailableCoins() {
    try {
        const response = await axios.get('https://api.binance.com/api/v3/exchangeInfo');
        const allSymbols = response.data.symbols;
        
        const usdtPairs = allSymbols.filter(s => s.quoteAsset === 'USDT' && s.status === 'TRADING');
        usdtPairs.sort((a, b) => a.baseAsset.localeCompare(b.baseAsset));

        availableCoins = usdtPairs.map(s => s.symbol.toLowerCase());
        console.log(`🌐 ${availableCoins.length} pares de Criptomoedas carregados da Binance!`);
        
        io.emit('available_coins', availableCoins);
    } catch (error) {
        console.error("Erro ao carregar moedas da Binance:", error.message);
    }
}

// ============================================================================
// 4. FUNÇÕES MATEMÁTICAS E CÁLCULO DE INDICADORES
// ============================================================================
function calculateSMA(data, period) {
    if (data.length < period) return null;
    const sum = data.slice(-period).reduce((a, b) => a + b, 0);
    return sum / period;
}

function calculateWMA(data, period) {
    if (data.length < period) return null;
    const slice = data.slice(-period);
    let sum = 0; let weightSum = 0;
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
        for (let i = 10; i >= 0; i--) {
            let slice = prices.slice(0, prices.length - i);
            let sma1 = calculateSMA(slice, 1);
            let sma34 = calculateSMA(slice, 34);
            if (sma1 === null || sma34 === null) return null;
            buf1.push(sma1 - sma34);
        }
        
        const currentB1 = buf1[10]; const prevB1 = buf1[9];
        const currentB2 = calculateWMA(buf1.slice(-5), 5); const prevB2 = calculateWMA(buf1.slice(-6, -1), 5);

        if (currentB1 > currentB2 && prevB1 < prevB2) return 'CALL';
        if (currentB1 < currentB2 && prevB1 > prevB2) return 'PUT';
        return null;
    }

    let current = {}; let prev = {};
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
        if (isCall) return 'CALL'; if (isPut) return 'PUT';
    } catch (e) { console.error("Erro na regra da estratégia:", e); }
    return null;
}

// ============================================================================
// 5. MÓDULO DE EXECUÇÃO NA CORRETORA E ATUALIZAÇÃO DE SALDO
// ============================================================================
async function dispararOrdemVellox(socketId, tokenUsuario, accountId, isDemo, symbol, direction, amount, currentPrice) {
    try {
        const tradeData = new URLSearchParams();
        tradeData.append('transaction_account_id', accountId); 
        tradeData.append('expiration', '1'); 
        tradeData.append('amount', amount); 
        tradeData.append('direction', direction === 'CALL' ? '1' : '0'); 
        tradeData.append('symbol', symbol.toUpperCase()); 
        tradeData.append('symbol_price', currentPrice.toString()); 

        const API_BASE_URL = 'https://velloxbroker.com';
        
        const response = await axios.put(`${API_BASE_URL}/api/public/applications/transaction`, tradeData, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Bearer ${tokenUsuario}` 
            }
        });

        console.log(`[✅ DISPARO EXECUTADO] R$ ${amount} | Direção: ${direction} | Conta ID: ${accountId}`);

        let novoSaldo = response.data.user_credit;
        if (!novoSaldo && response.data.data) novoSaldo = response.data.data.user_credit;

        return { success: true, balance: novoSaldo };

    } catch (error) {
        console.error(`[❌ ERRO NO DISPARO]`, error.response ? error.response.data : error.message);
        return { success: false, msg: error.response ? JSON.stringify(error.response.data) : error.message };
    }
}

// ============================================================================
// 6. GESTOR DE RISCO E LUCRO (COM STOP WIN E LOSS)
// ============================================================================
function updateBrokerProfits(step, isWin, isManual = false) {
    Object.values(activeBrokers).forEach(broker => {
        if (!isManual && !broker.autoTradeActive) return; 
        if (step > broker.config.maxGale) return; 

        let amountBet = broker.config.baseAmount * Math.pow(2, step);
        
        if (isWin) {
            let lucroLiquido = (amountBet * 0.85); 
            let retornoTotal = amountBet + lucroLiquido;
            broker.sessionProfit += lucroLiquido;

            io.to(broker.socketId).emit('win_balance_update', {
                isDemo: broker.config.accountType === 'demo',
                prize: retornoTotal
            });
        } else {
            broker.sessionProfit -= amountBet; 
        }

        let stopReason = null;
        if (broker.sessionProfit <= -broker.config.stopLoss) stopReason = `🛑 STOP LOSS ATINGIDO! (Perda: R$ ${broker.sessionProfit.toFixed(2)})`;
        if (broker.sessionProfit >= broker.config.stopWin) stopReason = `🏆 META BATIDA! (Lucro: R$ ${broker.sessionProfit.toFixed(2)})`;

        if (stopReason) {
            broker.autoTradeActive = false; 
            io.to(broker.socketId).emit('auto_trade_status', { active: false, msg: stopReason, profit: broker.sessionProfit });
        } else {
            const msgStatus = broker.autoTradeActive ? "Robô Operando..." : "Robô Pausado.";
            io.to(broker.socketId).emit('auto_trade_status', { active: broker.autoTradeActive, msg: msgStatus, profit: broker.sessionProfit });
        }
    });
}

// ============================================================================
// 7. MOTOR CENTRAL DE WEBSOCKET (BINANCE) E CÉREBRO DE GALE
// ============================================================================
async function startConnection(symbol) {
    currentConnectionId++;
    const myConnectionId = currentConnectionId;

    if (ws) { ws.terminate(); ws = null; }
    
    closePrices = []; activeSignals = []; signalHistory = []; 
    scoreboard = { win1: 0, winG1: 0, winG2: 0, loss: 0 };
    lastClosedCandleTime = 0; lastResolvedCandleTime = 0; 
    
    const currentStrategy = strategiesDB.find(s => s.id === currentStrategyId);
    if (!currentStrategy) return;

    updateStatus(`Carregando histórico de ${symbol.toUpperCase()}...`);

    try {
        const response = await axios.get(`https://data-api.binance.vision/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=1m&limit=100`);
        if (myConnectionId !== currentConnectionId) return; 

        const klines = response.data;
        for (let i = 0; i < klines.length - 1; i++) {
            const k_time = klines[i][0]; const k_o = parseFloat(klines[i][1]); const k_c = parseFloat(klines[i][4]); 
            
            activeSignals = activeSignals.filter(sig => {
                const isGreen = k_c > k_o; const isRed = k_c < k_o;
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
                        id: k_time, type: newSigType, symbol: currentSymbol.toUpperCase(),
                        time: new Date(k_time).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }), 
                        step: 0, status: 'Aguardando...', entryPrice: k_o, isManual: false
                    };
                    activeSignals.push(newSig); signalHistory.unshift(newSig); 
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
                const candleStartTime = kline.t;
                const secondsLeft = 60 - new Date().getSeconds();
                
                currentGlobalPrice = currentPrice;

                // Envia a telemetria ao vivo para o Gráfico Raio-X
                let currentActive = activeSignals.length > 0 ? activeSignals[0] : null;
                io.emit('price_update', { price: currentPrice, secondsLeft: secondsLeft, activeSignal: currentActive });

                // Alerta pré-fechamento (Apenas se a trava de respiro permitir)
                if (closePrices.length > 50 && !isCandleClosed && candleStartTime !== lastResolvedCandleTime) {
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
                    if (candleStartTime === lastClosedCandleTime) return; 
                    lastClosedCandleTime = candleStartTime;
                    
                    closePrices.push(currentPrice);
                    if (closePrices.length > 150) closePrices.shift();

                    let signalResolvedThisCandle = false;

                    activeSignals = activeSignals.filter(sig => {
                        const won = (sig.type === 'CALL' && currentPrice > sig.entryPrice) || (sig.type === 'PUT' && currentPrice < sig.entryPrice);
                        const prefix = sig.isManual ? '⚡ Sniper: ' : '';

                        if (won) {
                            if (sig.step === 0) { sig.status = prefix + 'WIN 1ª 🎯'; scoreboard.win1++; }
                            else if (sig.step === 1) { sig.status = prefix + 'WIN G1 🎯'; scoreboard.winG1++; }
                            else if (sig.step === 2) { sig.status = prefix + 'WIN G2 🎯'; scoreboard.winG2++; }
                            
                            updateBrokerProfits(sig.step, true, sig.isManual);
                            io.emit('signal_result', sig); io.emit('scoreboard', scoreboard); 
                            signalResolvedThisCandle = true; return false; 
                        } else {
                            updateBrokerProfits(sig.step, false, sig.isManual); 
                            sig.step++; 
                            
                            if (sig.step > 2) {
                                sig.status = prefix + 'LOSS 🔴'; scoreboard.loss++;
                                io.emit('signal_result', sig); io.emit('scoreboard', scoreboard); 
                                signalResolvedThisCandle = true; return false; 
                            } else {
                                sig.status = prefix + `Gale ${sig.step}...`; io.emit('signal_result', sig);
                                
                                Object.values(activeBrokers).forEach(async (broker) => {
                                    if (!sig.isManual && !broker.autoTradeActive) return;
                                    if (sig.step > broker.config.maxGale) return; 
                                    
                                    let valorGale = broker.config.baseAmount * Math.pow(2, sig.step);
                                    let isDemo = broker.config.accountType === 'demo';
                                    let accId = isDemo ? broker.demoAccountId : broker.realAccountId;
                                    
                                    const result = await dispararOrdemVellox(broker.socketId, broker.token, accId, isDemo, currentSymbol, sig.type, valorGale.toFixed(2).replace('.', ','), currentPrice);
                                    if (result.success && result.balance) io.to(broker.socketId).emit('update_balance', { isDemo: isDemo, balance: result.balance });
                                });
                                return true; 
                            }
                        }
                    });

                    // Registra Respiro: Dá 1 vela de pausa antes de procurar o próximo padrão
                    if (signalResolvedThisCandle) lastResolvedCandleTime = candleStartTime;

                    // Nova Entrada (Apenas se a fila estiver vazia E respeitar o Respiro)
                    if (activeSignals.length === 0 && candleStartTime !== lastResolvedCandleTime) {
                        const newSignalType = evaluateStrategy(closePrices, currentStrategy);
                        
                        if (newSignalType) {
                            const newSig = { 
                                id: Date.now(), type: newSignalType, symbol: currentSymbol.toUpperCase(),
                                time: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }), 
                                step: 0, status: 'Aguardando Vela...', entryPrice: currentPrice, isManual: false
                            };
                            
                            activeSignals.push(newSig); signalHistory.unshift(newSig); 
                            if (signalHistory.length > 20) signalHistory.pop();
                            
                            io.emit('new_signal_history', newSig); io.emit('signal', { type: newSignalType, time: newSig.time }); 
                            
                            Object.values(activeBrokers).forEach(async (broker) => {
                                if (!broker.autoTradeActive) return;
                                let valorInicial = parseFloat(broker.config.baseAmount).toFixed(2).replace('.', ',');
                                let isDemo = broker.config.accountType === 'demo';
                                let accId = isDemo ? broker.demoAccountId : broker.realAccountId;
                                
                                const result = await dispararOrdemVellox(broker.socketId, broker.token, accId, isDemo, currentSymbol, newSignalType, valorInicial, currentPrice);
                                if (result.success && result.balance) io.to(broker.socketId).emit('update_balance', { isDemo: isDemo, balance: result.balance });
                            });
                        }
                    }
                }
            } catch (e) { console.error("Erro no processamento do WebSocket:", e); }
        });

        ws.on('error', (err) => { 
            if (myConnectionId !== currentConnectionId) return; 
            console.error("Erro na conexão com a Binance:", err);
            setTimeout(() => startConnection(currentSymbol), 5000); 
        });
        
        ws.on('close', () => { 
            if (myConnectionId !== currentConnectionId) return; 
            console.log("Conexão WebSocket fechada. Reconectando...");
            setTimeout(() => startConnection(currentSymbol), 5000); 
        });

    } catch (error) { 
        if (myConnectionId !== currentConnectionId) return; 
        console.error("Falha ao buscar Klines iniciais:", error);
        setTimeout(() => startConnection(currentSymbol), 5000); 
    }
}

// ============================================================================
// 8. ROTAS DE COMUNICAÇÃO COM O FRONTEND (SOCKET.IO)
// ============================================================================
io.on('connection', (socket) => {
    
    socket.emit('status', { msg: currentEngineStatus });
    socket.emit('available_strategies', strategiesDB.map(s => ({ id: s.id, name: s.name })));
    socket.emit('available_coins', availableCoins); // 🌐 Lista dinâmica da Binance
    socket.emit('scoreboard', scoreboard);
    socket.emit('history_dump', signalHistory);
    
    socket.on('hybrid_login', async ({ brokerUser, brokerPass }) => {
        try {
            const loginData = new URLSearchParams();
            loginData.append('user', brokerUser); 
            loginData.append('pass', brokerPass);
            const API_BASE_URL = 'https://velloxbroker.com'; 
            
            const loginResponse = await axios.post(`${API_BASE_URL}/api/login`, loginData, { 
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' } 
            });
            
            const brokerToken = loginResponse.data.token || loginResponse.data.access_token;
            if (!brokerToken) throw new Error("BROKER_FAIL");

            let isSubscribed = false; let uid = ''; let userRole = 'aluno';
            const userLower = brokerUser.toLowerCase();
            
            if (userLower === MASTER_EMAIL.toLowerCase() || userLower === MASTER_BROKER_LOGIN.toLowerCase()) {
                isSubscribed = true; uid = 'admin_master'; userRole = 'admin';
            } else {
                const snapshot = await db.collection('users').where('email', '==', brokerUser).get();
                if (!snapshot.empty) { isSubscribed = true; uid = snapshot.docs[0].id; userRole = snapshot.docs[0].data().role; }
            }

            if (!isSubscribed) {
                socket.emit('hybrid_login_result', { success: false, reason: 'subscription', msg: 'Assinatura Inativa. Adquira seu acesso ao JS Invest para continuar.' });
                return;
            }

            const customToken = await admin.auth().createCustomToken(uid, { email: brokerUser });
            
            const balanceResponse = await axios.get(`${API_BASE_URL}/api/public/users/balance`, { headers: { 'Authorization': `Bearer ${brokerToken}` } });
            const realBalance = balanceResponse.data.credit || "0,00";
            
            activeBrokers[socket.id] = { 
                socketId: socket.id, token: brokerToken, demoAccountId: '8', realAccountId: '0', autoTradeActive: false, 
                config: { active: false, accountType: 'demo', baseAmount: 5, maxGale: 2, stopWin: 99999, stopLoss: 99999 }, sessionProfit: 0 
            };
            
            socket.emit('hybrid_login_result', { success: true, firebaseToken: customToken, role: userRole, balance: { demo: "--- (Dê 1 tiro para carregar)", real: realBalance } });

        } catch (error) {
            console.error("Erro no login híbrido:", error);
            socket.emit('hybrid_login_result', { success: false, reason: 'broker', msg: 'Credenciais da Corretora inválidas ou conta inexistente.' });
        }
    });

    socket.on('setup_auto_trade', (config) => {
        if (activeBrokers[socket.id]) {
            activeBrokers[socket.id].config = config;
            activeBrokers[socket.id].autoTradeActive = config.active;
            if (config.active) activeBrokers[socket.id].sessionProfit = 0; 
            socket.emit('auto_trade_status', { active: config.active, msg: config.active ? "Robô Armado e Analisando..." : "Robô Pausado.", profit: activeBrokers[socket.id].sessionProfit });
        }
    });

    // 🎯 O MODO SNIPER TOTALMENTE BLINDADO
    socket.on('manual_trade', async (data) => {
        const direction = data.direction;
        const frontendConfig = data.config;
        const broker = activeBrokers[socket.id];
        
        if (!broker || !broker.token) {
            socket.emit('sniper_error', 'Você precisa conectar na corretora antes de atirar!'); return; 
        }

        // Trava para não atropelar operação real rodando
        const isBotTrading = Object.values(activeBrokers).some(b => b.autoTradeActive);
        const hasRealSignal = activeSignals.some(s => s.isManual || isBotTrading);

        if (activeSignals.length > 0 && hasRealSignal) {
            socket.emit('sniper_error', 'Aguarde! Já existe uma operação real em andamento.'); return;
        }

        // Se for um sinal apenas visual da tela, o Sniper destrói e assume a prioridade!
        if (activeSignals.length > 0) activeSignals = []; 

        if (currentGlobalPrice === 0) {
            currentGlobalPrice = closePrices.length > 0 ? closePrices[closePrices.length - 1] : 0;
            if (currentGlobalPrice === 0) { socket.emit('sniper_error', 'Aguardando sincronização de preço com a Binance...'); return; }
        }

        if (frontendConfig) {
            if (!broker.config) broker.config = { active: false, stopWin: 99999, stopLoss: 99999 };
            broker.config.accountType = frontendConfig.accountType;
            broker.config.baseAmount = frontendConfig.baseAmount;
            broker.config.maxGale = frontendConfig.maxGale;
        }

        let accType = broker.config.accountType;
        let amount = parseFloat(broker.config.baseAmount).toFixed(2).replace('.', ',');
        let isDemo = accType === 'demo';
        let accId = isDemo ? broker.demoAccountId : broker.realAccountId;

        console.log(`[🎯 MODO SNIPER] Usuário atirando ${direction} R$ ${amount}...`);
        
        const result = await dispararOrdemVellox(broker.socketId, broker.token, accId, isDemo, currentSymbol, direction, amount, currentGlobalPrice);

        if (result.success) {
            socket.emit('sniper_success', `Ordem ${direction} enviada!`);
            if (result.balance) socket.emit('update_balance', { isDemo: isDemo, balance: result.balance });

            const manualSig = { 
                id: Date.now(), type: direction, symbol: currentSymbol.toUpperCase(),
                time: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }), 
                step: 0, status: '⚡ Sniper (Aguardando...)', entryPrice: currentGlobalPrice, isManual: true 
            };
            
            activeSignals.push(manualSig); signalHistory.unshift(manualSig);
            if (signalHistory.length > 20) signalHistory.pop();
            io.emit('new_signal_history', manualSig);
        } else {
            socket.emit('sniper_error', result.msg);
        }
    });

    socket.on('admin_create_user', async (data) => {
        try {
            const decodedToken = await admin.auth().verifyIdToken(data.token);
            const reqEmail = decodedToken.email || '';
            let isAdmin = false;
            
            if (reqEmail.toLowerCase() === MASTER_EMAIL.toLowerCase() || reqEmail.toLowerCase() === MASTER_BROKER_LOGIN.toLowerCase()) isAdmin = true;
            else { const snap = await db.collection('users').where('email', '==', reqEmail).get(); if (!snap.empty && snap.docs[0].data().role === 'admin') isAdmin = true; }

            if (!isAdmin) { socket.emit('user_creation_result', { success: false, msg: 'Operação Negada.' }); return; }

            const userRecord = await admin.auth().createUser({ email: data.newEmail, password: data.newPassword });
            await db.collection('users').doc(userRecord.uid).set({ email: data.newEmail, role: data.newRole, createdAt: admin.firestore.FieldValue.serverTimestamp() });
            socket.emit('user_creation_result', { success: true, msg: `Utilizador [${data.newEmail}] cadastrado!` });
        } catch (error) { socket.emit('user_creation_result', { success: false, msg: error.message }); }
    });

    socket.on('admin_get_users', async (token) => {
        try {
            const snapshot = await db.collection('users').get();
            let usersList = []; usersList.push({ id: 'master', email: 'Master / Admin', role: 'admin (Master)' });
            snapshot.forEach(doc => { usersList.push({ id: doc.id, ...doc.data() }); });
            socket.emit('admin_users_list', { success: true, users: usersList });
        } catch (error) { socket.emit('admin_users_list', { success: false, msg: error.message }); }
    });

    socket.on('change_coin', (newSymbol) => { currentSymbol = newSymbol; startConnection(currentSymbol); });
    socket.on('change_strategy', (newStrategyId) => { currentStrategyId = newStrategyId; startConnection(currentSymbol); });
    socket.on('add_new_strategy', async (newStrategy) => {
        try { const exists = strategiesDB.find(s => s.id === newStrategy.id); if (!exists) { await db.collection('scripts').doc(newStrategy.id).set(newStrategy); strategiesDB.push(newStrategy); io.emit('available_strategies', strategiesDB.map(s => ({ id: s.id, name: s.name }))); } } catch (e) { console.error("Erro:", e); }
    });

    socket.on('disconnect', () => { if (activeBrokers[socket.id]) delete activeBrokers[socket.id]; });
});

// Inicializa a aplicação
loadStrategiesFromDB();
loadAvailableCoins();

server.listen(3000, () => { console.log('🚀 Motor JS Invest operando na porta 3000!'); });