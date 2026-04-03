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
let currentGlobalPrice = 0; // Preço atualizado a cada tick para o Modo Sniper

let activeSignals = []; // Guarda as operações em andamento (Auto e Manual)
let signalHistory = []; // Histórico visual da tela
let scoreboard = { win1: 0, winG1: 0, winG2: 0, loss: 0 };
let currentEngineStatus = "Aguardando inicialização..."; 

// Travas Anti-Loop (Efeito Hydra) e Concorrência da Binance
let currentConnectionId = 0; 
let lastClosedCandleTime = 0; 

let strategiesDB = [];
let activeBrokers = {}; // Guarda a sessão, tokens e risco de cada usuário logado

// ============================================================================
// 3. CARREGAMENTO DE SCRIPTS DO FIREBASE
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

// ============================================================================
// 4. FUNÇÕES MATEMÁTICAS E CÁLCULO DE INDICADORES
// ============================================================================
function calculateSMA(data, period) {
    if (data.length < period) {
        return null;
    }
    const sum = data.slice(-period).reduce((a, b) => a + b, 0);
    return sum / period;
}

function calculateWMA(data, period) {
    if (data.length < period) {
        return null;
    }
    const slice = data.slice(-period);
    let sum = 0;
    let weightSum = 0;
    
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
    if (!prices || prices.length < 50) {
        return null;
    }

    // Lógica para script complexo (Rei das Binárias)
    if (strategyConfig.isComplex && strategyConfig.id === 'rei_das_binarias') {
        let buf1 = [];
        for (let i = 10; i >= 0; i--) {
            let slice = prices.slice(0, prices.length - i);
            let sma1 = calculateSMA(slice, 1);
            let sma34 = calculateSMA(slice, 34);
            
            if (sma1 === null || sma34 === null) {
                return null;
            }
            buf1.push(sma1 - sma34);
        }
        
        const currentB1 = buf1[10]; 
        const prevB1 = buf1[9];
        const currentB2 = calculateWMA(buf1.slice(-5), 5); 
        const prevB2 = calculateWMA(buf1.slice(-6, -1), 5);

        if (currentB1 > currentB2 && prevB1 < prevB2) {
            return 'CALL';
        }
        if (currentB1 < currentB2 && prevB1 > prevB2) {
            return 'PUT';
        }
        
        return null;
    }

    // Lógica para scripts simples baseados em JSON
    let current = {};
    let prev = {};
    
    for (const [key, config] of Object.entries(strategyConfig.indicators)) {
        if (config.type === 'SMA') {
            current[key] = calculateSMA(prices, config.period);
            prev[key] = calculateSMA(prices.slice(0, -1), config.period);
        }
    }
    
    if (Object.values(current).includes(null)) {
        return null;
    }

    try {
        const isCall = new Function('current', 'prev', `return ${strategyConfig.conditions.call};`)(current, prev);
        const isPut = new Function('current', 'prev', `return ${strategyConfig.conditions.put};`)(current, prev);
        
        if (isCall) {
            return 'CALL';
        }
        if (isPut) {
            return 'PUT';
        }
    } catch (e) { 
        console.error("Erro na regra da estratégia:", e); 
    }
    
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

        // Tenta capturar o saldo devolvido pela corretora
        let novoSaldo = response.data.user_credit;
        if (!novoSaldo && response.data.data) {
            novoSaldo = response.data.data.user_credit;
        }

        return { success: true, balance: novoSaldo };

    } catch (error) {
        console.error(`[❌ ERRO NO DISPARO]`, error.response ? error.response.data : error.message);
        return { success: false, msg: error.response ? JSON.stringify(error.response.data) : error.message };
    }
}

// ============================================================================
// 6. GESTOR DE RISCO E LUCRO (AGORA RECONHECE O MODO SNIPER)
// ============================================================================
function updateBrokerProfits(step, isWin, isManual = false) {
    Object.values(activeBrokers).forEach(broker => {
        
        // Se a entrada foi do robô, mas ele está desligado, não fazemos nada.
        // MAS se a entrada foi Manual (Sniper), nós computamos o lucro independentemente!
        if (!isManual && !broker.autoTradeActive) {
            return; 
        }

        // Respeita o limite máximo de Gales configurado pelo aluno
        if (step > broker.config.maxGale) {
            return; 
        }

        let amountBet = broker.config.baseAmount * Math.pow(2, step);
        
        if (isWin) {
            broker.sessionProfit += (amountBet * 0.85); // Lucro estimado em 85% de Payout
        } else {
            broker.sessionProfit -= amountBet; // Perda de 100% da mão apostada
        }

        let stopReason = null;
        
        if (broker.sessionProfit <= -broker.config.stopLoss) {
            stopReason = `🛑 STOP LOSS ATINGIDO! (Perda: R$ ${broker.sessionProfit.toFixed(2)})`;
        }
        
        if (broker.sessionProfit >= broker.config.stopWin) {
            stopReason = `🏆 META BATIDA! (Lucro: R$ ${broker.sessionProfit.toFixed(2)})`;
        }

        // Se bateu em algum limitador (Win ou Loss), desarma o robô imediatamente
        if (stopReason) {
            broker.autoTradeActive = false; 
            io.to(broker.socketId).emit('auto_trade_status', { 
                active: false, 
                msg: stopReason, 
                profit: broker.sessionProfit 
            });
        } else {
            // Só envia status de "Operando" se o robô realmente estiver ligado
            const msgStatus = broker.autoTradeActive ? "Robô Operando..." : "Robô Pausado.";
            io.to(broker.socketId).emit('auto_trade_status', { 
                active: broker.autoTradeActive, 
                msg: msgStatus, 
                profit: broker.sessionProfit 
            });
        }
    });
}

// ============================================================================
// 7. MOTOR CENTRAL DE WEBSOCKET (BINANCE) E CÉREBRO DE GALE
// ============================================================================
async function startConnection(symbol) {
    currentConnectionId++;
    const myConnectionId = currentConnectionId;

    if (ws) { 
        ws.terminate(); 
        ws = null; 
    }
    
    closePrices = []; 
    activeSignals = []; 
    signalHistory = []; 
    scoreboard = { win1: 0, winG1: 0, winG2: 0, loss: 0 };
    lastClosedCandleTime = 0; 
    
    const currentStrategy = strategiesDB.find(s => s.id === currentStrategyId);
    if (!currentStrategy) {
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
            
            // Popula o histórico de placar antes da conexão em tempo real
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
                    if (sig.step > 2) { 
                        sig.status = 'LOSS 🔴'; 
                        scoreboard.loss++; 
                        return false; 
                    } else { 
                        sig.status = `Gale ${sig.step}...`; 
                        return true; 
                    }
                }
            });

            closePrices.push(k_c);
            
            if (activeSignals.length === 0) {
                const newSigType = evaluateStrategy(closePrices, currentStrategy);
                if (newSigType) {
                    const newSig = { 
                        id: k_time, 
                        type: newSigType, 
                        time: new Date(k_time).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }), 
                        step: 0, 
                        status: 'Aguardando...',
                        entryPrice: k_o,
                        isManual: false
                    };
                    activeSignals.push(newSig); 
                    signalHistory.unshift(newSig); 
                    if (signalHistory.length > 20) {
                        signalHistory.pop(); 
                    }
                }
            }
        }
        
        io.emit('scoreboard', scoreboard);
        io.emit('history_dump', signalHistory);
        updateStatus(`Analisando o mercado (${symbol.toUpperCase()})...`);
        
        // Inicia a conexão em tempo real com a Binance
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
                
                // 🎯 Atualiza a mira global do Sniper o tempo todo
                currentGlobalPrice = currentPrice;

                io.emit('price_update', { price: currentPrice, secondsLeft });

                // Alerta pré-fechamento
                if (closePrices.length > 50 && !isCandleClosed) {
                    if (activeSignals.length === 0) {
                        let tempPrices = [...closePrices, currentPrice];
                        if (tempPrices.length > 150) {
                            tempPrices.shift();
                        }
                        
                        const tempSignal = evaluateStrategy(tempPrices, currentStrategy);
                        
                        if (tempSignal === 'CALL') {
                            io.emit('pre_alert', { call: true, put: false });
                        } else if (tempSignal === 'PUT') {
                            io.emit('pre_alert', { call: false, put: true });
                        } else {
                            io.emit('pre_alert', { call: false, put: false }); 
                        }
                    } else {
                        io.emit('pre_alert', { call: false, put: false });
                    }
                }

                // ==========================================
                // LÓGICA DE FECHAMENTO DE VELA (O CÉREBRO)
                // ==========================================
                if (isCandleClosed) { 
                    // Trava de Concorrência: Impede a Binance de enviar dois fechamentos seguidos
                    if (candleStartTime === lastClosedCandleTime) {
                        return; 
                    }
                    lastClosedCandleTime = candleStartTime;
                    
                    closePrices.push(currentPrice);
                    if (closePrices.length > 150) {
                        closePrices.shift();
                    }

                    // Processa todas as ordens em andamento (Auto-Trade e Sniper Manuais)
                    activeSignals = activeSignals.filter(sig => {
                        
                        // Verifica a vitória baseada no preço EXATO em que a ordem foi registrada
                        const won = (sig.type === 'CALL' && currentPrice > sig.entryPrice) || 
                                    (sig.type === 'PUT' && currentPrice < sig.entryPrice);

                        // Define o prefixo visual para a tabela do frontend
                        const prefix = sig.isManual ? '⚡ Sniper: ' : '';

                        if (won) {
                            if (sig.step === 0) { sig.status = prefix + 'WIN 1ª 🎯'; scoreboard.win1++; }
                            else if (sig.step === 1) { sig.status = prefix + 'WIN G1 🎯'; scoreboard.winG1++; }
                            else if (sig.step === 2) { sig.status = prefix + 'WIN G2 🎯'; scoreboard.winG2++; }
                            
                            updateBrokerProfits(sig.step, true, sig.isManual);
                            
                            io.emit('signal_result', sig); 
                            io.emit('scoreboard', scoreboard); 
                            return false; // Remove da fila
                        } else {
                            updateBrokerProfits(sig.step, false, sig.isManual); 
                            sig.step++; // Incrementa para o Gale
                            
                            if (sig.step > 2) {
                                sig.status = prefix + 'LOSS 🔴'; 
                                scoreboard.loss++;
                                
                                io.emit('signal_result', sig); 
                                io.emit('scoreboard', scoreboard); 
                                return false; // Perdeu tudo, remove da fila
                            } else {
                                sig.status = prefix + `Gale ${sig.step}...`; 
                                io.emit('signal_result', sig);
                                
                                // Disparo de Recuperação (Martingale)
                                Object.values(activeBrokers).forEach(async (broker) => {
                                    
                                    // Se a ordem for do robô e ele estiver desligado, ignora.
                                    // Mas se for uma ordem Sniper Manual, engatilha o Gale do mesmo jeito!
                                    if (!sig.isManual && !broker.autoTradeActive) {
                                        return;
                                    }

                                    // Respeita a trava de Gale do aluno
                                    if (sig.step > broker.config.maxGale) {
                                        return; 
                                    }
                                    
                                    let valorGale = broker.config.baseAmount * Math.pow(2, sig.step);
                                    let isDemo = broker.config.accountType === 'demo';
                                    let accId = isDemo ? broker.demoAccountId : broker.realAccountId;
                                    
                                    const result = await dispararOrdemVellox(broker.socketId, broker.token, accId, isDemo, currentSymbol, sig.type, valorGale.toFixed(2).replace('.', ','), currentPrice);
                                    
                                    if (result.success && result.balance) {
                                        io.to(broker.socketId).emit('update_balance', { isDemo: isDemo, balance: result.balance });
                                    }
                                });
                                
                                return true; // Mantém na fila para o próximo minuto
                            }
                        }
                    });

                    // Se a fila estiver vazia, procura um novo sinal automático da Estratégia
                    if (activeSignals.length === 0) {
                        const newSignalType = evaluateStrategy(closePrices, currentStrategy);
                        
                        if (newSignalType) {
                            const newSig = { 
                                id: Date.now(), 
                                type: newSignalType, 
                                time: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }), 
                                step: 0, 
                                status: 'Aguardando Vela...',
                                entryPrice: currentPrice, // O preço de entrada do robô é o fechamento da vela anterior
                                isManual: false
                            };
                            
                            activeSignals.push(newSig); 
                            signalHistory.unshift(newSig); 
                            if (signalHistory.length > 20) {
                                signalHistory.pop();
                            }
                            
                            io.emit('new_signal_history', newSig); 
                            io.emit('signal', { type: newSignalType, time: newSig.time }); 
                            
                            // Disparo da Primeira Entrada do Robô
                            Object.values(activeBrokers).forEach(async (broker) => {
                                if (!broker.autoTradeActive) {
                                    return;
                                }
                                
                                let valorInicial = parseFloat(broker.config.baseAmount).toFixed(2).replace('.', ',');
                                let isDemo = broker.config.accountType === 'demo';
                                let accId = isDemo ? broker.demoAccountId : broker.realAccountId;
                                
                                const result = await dispararOrdemVellox(broker.socketId, broker.token, accId, isDemo, currentSymbol, newSignalType, valorInicial, currentPrice);
                                
                                if (result.success && result.balance) {
                                    io.to(broker.socketId).emit('update_balance', { isDemo: isDemo, balance: result.balance });
                                }
                            });
                        }
                    }
                }
            } catch (e) { 
                console.error("Erro no processamento do WebSocket:", e); 
            }
        });

        // 🛡️ TRAVAS ANTI-LOOP (Efeito Hydra)
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
    
    // Sincroniza dados iniciais
    socket.emit('status', { msg: currentEngineStatus });
    socket.emit('available_strategies', strategiesDB.map(s => ({ id: s.id, name: s.name })));
    socket.emit('scoreboard', scoreboard);
    socket.emit('history_dump', signalHistory);
    
    // ------------------------------------------------------------------------
    // ROTA: LOGIN HÍBRIDO E GESTÃO DE ACESSO L-I-B-E-R-A-D-O
    // ------------------------------------------------------------------------
    socket.on('hybrid_login', async ({ brokerUser, brokerPass }) => {
        try {
            const loginData = new URLSearchParams();
            loginData.append('user', brokerUser); 
            loginData.append('pass', brokerPass);
            const API_BASE_URL = 'https://velloxbroker.com'; 
            
            const loginResponse = await axios.post(`${API_BASE_URL}/api/login`, loginData, { 
                headers: { 
                    'Accept': 'application/json', 
                    'Content-Type': 'application/x-www-form-urlencoded' 
                } 
            });
            
            const brokerToken = loginResponse.data.token || loginResponse.data.access_token;
            
            if (!brokerToken) {
                throw new Error("BROKER_FAIL");
            }

            // 🎯 FORÇADO PARA TESTES! Usa o e-mail como UID genérico
            let uid = brokerUser; 
            let userRole = 'aluno';
            const userLower = brokerUser.toLowerCase();
            
            // Bypass para o Master
            if (userLower === MASTER_EMAIL.toLowerCase() || userLower === MASTER_BROKER_LOGIN.toLowerCase()) {
                uid = 'admin_master'; 
                userRole = 'admin';
            } else {
                // Checa no Firestore se o email existe para definir regras (mas não bloqueia se não existir)
                const snapshot = await db.collection('users').where('email', '==', brokerUser).get();
                if (!snapshot.empty) {
                    uid = snapshot.docs[0].id; 
                    userRole = snapshot.docs[0].data().role;
                }
            }

            // A trava de isSubscribed foi totalmente removida! Bem-vindos aos testes livres.

            const customToken = await admin.auth().createCustomToken(uid, { email: brokerUser });
            
            const balanceResponse = await axios.get(`${API_BASE_URL}/api/public/users/balance`, { 
                headers: { 'Authorization': `Bearer ${brokerToken}` } 
            });
            
            const realBalance = balanceResponse.data.credit || "0,00";
            
            // Criando o perfil com um "Kit Padrão" para o Sniper não dar erro de "config null"
            activeBrokers[socket.id] = { 
                socketId: socket.id, 
                token: brokerToken, 
                demoAccountId: '8', 
                realAccountId: '0', 
                autoTradeActive: false, 
                config: {
                    active: false,
                    accountType: 'demo',
                    baseAmount: 5,
                    maxGale: 2,
                    stopWin: 99999,
                    stopLoss: 99999
                }, 
                sessionProfit: 0 
            };
            
            socket.emit('hybrid_login_result', { 
                success: true, 
                firebaseToken: customToken, 
                role: userRole,
                balance: { demo: "--- (Dê 1 tiro para carregar)", real: realBalance }
            });

        } catch (error) {
            console.error("Erro no login híbrido:", error);
            socket.emit('hybrid_login_result', { 
                success: false, 
                reason: 'broker', 
                msg: 'Credenciais da Corretora inválidas ou conta inexistente.' 
            });
        }
    });

    // ------------------------------------------------------------------------
    // ROTA: SETUP DO AUTO-TRADE E LIMITES
    // ------------------------------------------------------------------------
    socket.on('setup_auto_trade', (config) => {
        if (activeBrokers[socket.id]) {
            activeBrokers[socket.id].config = config;
            activeBrokers[socket.id].autoTradeActive = config.active;
            
            if (config.active) {
                activeBrokers[socket.id].sessionProfit = 0; // Zera o lucro ao reiniciar o robô
            }
            
            socket.emit('auto_trade_status', { 
                active: config.active, 
                msg: config.active ? "Robô Armado e Analisando..." : "Robô Pausado.", 
                profit: activeBrokers[socket.id].sessionProfit 
            });
        }
    });

    // ------------------------------------------------------------------------
    // 🎯 ROTA: DISPARO MANUAL (MODO SNIPER)
    // ------------------------------------------------------------------------
    socket.on('manual_trade', async (direction) => {
        const broker = activeBrokers[socket.id];
        
        if (!broker || !broker.token) {
            socket.emit('sniper_error', 'Você precisa conectar na corretora antes de atirar!');
            return; 
        }

        if (currentGlobalPrice === 0) {
            currentGlobalPrice = closePrices.length > 0 ? closePrices[closePrices.length - 1] : 0;
            if (currentGlobalPrice === 0) {
                socket.emit('sniper_error', 'Aguardando sincronização de preço com a Binance...');
                return;
            }
        }

        let accType = broker.config ? broker.config.accountType : 'demo';
        let amount = broker.config ? parseFloat(broker.config.baseAmount).toFixed(2).replace('.', ',') : '5,00';
        let isDemo = accType === 'demo';
        let accId = isDemo ? broker.demoAccountId : broker.realAccountId;

        console.log(`[🎯 MODO SNIPER] Usuário atirando ${direction} R$ ${amount}...`);
        
        // 1. Dispara a ordem imediatamente na corretora
        const result = await dispararOrdemVellox(broker.socketId, broker.token, accId, isDemo, currentSymbol, direction, amount, currentGlobalPrice);

        if (result.success) {
            
            socket.emit('sniper_success', `Ordem ${direction} enviada!`);
            
            if (result.balance) {
                socket.emit('update_balance', { isDemo: isDemo, balance: result.balance });
            }

            // 2. Injeta o sinal no motor do robô para buscar Win/Loss e ativar Gale!
            const manualSig = { 
                id: Date.now(), 
                type: direction, 
                time: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }), 
                step: 0, 
                status: '⚡ Sniper (Aguardando...)',
                entryPrice: currentGlobalPrice, // Grava a cotação no milissegundo do seu clique
                isManual: true // 🎯 ESSA É A TAG QUE OBRIGA O ROBÔ A PROCESSAR SEU SINAL!
            };
            
            activeSignals.push(manualSig);
            signalHistory.unshift(manualSig);
            
            if (signalHistory.length > 20) {
                signalHistory.pop();
            }
            
            io.emit('new_signal_history', manualSig);
        } else {
            socket.emit('sniper_error', result.msg);
        }
    });

    // ------------------------------------------------------------------------
    // ROTAS DE ADMINISTRAÇÃO E INJEÇÃO DE SCRIPTS
    // ------------------------------------------------------------------------
    socket.on('admin_create_user', async (data) => {
        try {
            const decodedToken = await admin.auth().verifyIdToken(data.token);
            const reqEmail = decodedToken.email || '';
            let isAdmin = false;
            
            if (reqEmail.toLowerCase() === MASTER_EMAIL.toLowerCase() || reqEmail.toLowerCase() === MASTER_BROKER_LOGIN.toLowerCase()) {
                isAdmin = true;
            } else {
                const snap = await db.collection('users').where('email', '==', reqEmail).get();
                if (!snap.empty && snap.docs[0].data().role === 'admin') {
                    isAdmin = true;
                }
            }

            if (!isAdmin) { 
                socket.emit('user_creation_result', { success: false, msg: 'Operação Negada.' }); 
                return; 
            }

            const userRecord = await admin.auth().createUser({ 
                email: data.newEmail, 
                password: data.newPassword 
            });
            
            await db.collection('users').doc(userRecord.uid).set({ 
                email: data.newEmail, 
                role: data.newRole, 
                createdAt: admin.firestore.FieldValue.serverTimestamp() 
            });
            
            socket.emit('user_creation_result', { success: true, msg: `Utilizador [${data.newEmail}] cadastrado!` });
        } catch (error) { 
            socket.emit('user_creation_result', { success: false, msg: error.message }); 
        }
    });

    socket.on('admin_get_users', async (token) => {
        try {
            const snapshot = await db.collection('users').get();
            let usersList = []; 
            
            usersList.push({ id: 'master', email: 'Master / Admin', role: 'admin (Master)' });
            
            snapshot.forEach(doc => { 
                usersList.push({ id: doc.id, ...doc.data() }); 
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
        } catch (e) {
            console.error("Erro ao adicionar script:", e);
        }
    });

    socket.on('disconnect', () => { 
        if (activeBrokers[socket.id]) {
            delete activeBrokers[socket.id]; 
        }
    });
});

// Inicializa a aplicação
loadStrategiesFromDB();

server.listen(3000, () => { 
    console.log('🚀 Motor JS Invest operando na porta 3000!'); 
});