const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const WebSocket = require('ws');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// ==========================================
// VARIÁVEIS DE ESTADO GLOBAL
// ==========================================
let closePrices = [];
let ws = null;
let currentSymbol = 'btcusdt';
let currentStrategyId = 'rei_das_binarias'; 

let activeSignals = []; 
let signalHistory = []; // MEMÓRIA DE CURTO PRAZO
let scoreboard = { win1: 0, winG1: 0, winG2: 0, loss: 0 };
let currentEngineStatus = "Aguardando inicialização..."; 

// ==========================================
// 1. BANCO DE DADOS DE SCRIPTS
// ==========================================
const strategiesDB = [
    {
        id: "rei_das_binarias",
        name: "👑 Rei das Binárias (Original)",
        indicators: { sma1: { type: "SMA", period: 1 }, sma34: { type: "SMA", period: 34 } },
        conditions: {
            call: "current.buffer1 > current.wmaSinal && prev.buffer1 < prev.wmaSinal",
            put: "current.buffer1 < current.wmaSinal && prev.buffer1 > prev.wmaSinal"
        },
        isComplex: true 
    },
    {
        id: "cruzamento_sma",
        name: "Script: Cruzamento Simples (5x20)",
        indicators: { fast: { type: "SMA", period: 5 }, slow: { type: "SMA", period: 20 } },
        conditions: {
            call: "current.fast > current.slow && prev.fast <= prev.slow",
            put: "current.fast < current.slow && prev.fast >= prev.slow"
        }
    }
];

// ==========================================
// 2. FUNÇÕES MATEMÁTICAS
// ==========================================
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
    console.log(`[MOTOR] ${msg}`);
}

// ==========================================
// 3. MOTOR DE REGRAS DINÂMICAS
// ==========================================
function evaluateStrategy(prices, strategyConfig) {
    if (prices.length < 50) return null;

    if (strategyConfig.isComplex && strategyConfig.id === 'rei_das_binarias') {
        let buf1 = [];
        for(let i = 10; i >= 0; i--) {
            let slice = prices.slice(0, prices.length - i);
            buf1.push(calculateSMA(slice, 1) - calculateSMA(slice, 34));
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
    } catch (e) { console.error("Erro na regra da estratégia:", e); }
    return null;
}

// ==========================================
// 4. MOTOR DE CONEXÃO E EXECUÇÃO
// ==========================================
async function startConnection(symbol) {
    if (ws) { ws.terminate(); ws = null; }
    
    closePrices = [];
    activeSignals = []; 
    signalHistory = []; 
    scoreboard = { win1: 0, winG1: 0, winG2: 0, loss: 0 };
    
    const currentStrategy = strategiesDB.find(s => s.id === currentStrategyId);
    updateStatus(`Carregando histórico de ${symbol.toUpperCase()}...`);

    try {
        // Usa a API de dados públicos da Binance para não sofrer bloqueio de IP
        const response = await axios.get(`https://data-api.binance.vision/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=1m&limit=100`);
        const klines = response.data;
        
        // BACKTEST INSTANTÂNEO
        for (let i = 0; i < klines.length - 1; i++) {
            const k_time = klines[i][0];
            const k_o = parseFloat(klines[i][1]); 
            const k_c = parseFloat(klines[i][4]); 
            
            // Resolve sinais pendentes
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
                        sig.status = 'LOSS 🔴'; scoreboard.loss++;
                        return false; 
                    } else {
                        sig.status = `Gale ${sig.step}...`;
                        return true; 
                    }
                }
            });

            closePrices.push(k_c);
            
            // Busca nova entrada (Com a hora formatada para o Brasil)
            const newSigType = evaluateStrategy(closePrices, currentStrategy);
            if (newSigType) {
                const newSig = {
                    id: k_time,
                    type: newSigType,
                    time: new Date(k_time).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
                    step: 0,
                    status: 'Aguardando Vela...'
                };
                activeSignals.push(newSig);
                signalHistory.unshift(newSig); 
                if (signalHistory.length > 20) signalHistory.pop(); 
            }
        }
        
        // Envia o placar e a tabela cheia
        io.emit('scoreboard', scoreboard);
        io.emit('history_dump', signalHistory);

        updateStatus(`Analisando o mercado (${symbol.toUpperCase()})...`);
        
        ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_1m`);
        
        ws.on('message', (data) => {
            const kline = JSON.parse(data).k;
            const currentPrice = parseFloat(kline.c);
            const isCandleClosed = kline.x;
            const currentOpen = parseFloat(kline.o);
            
            const secondsLeft = 60 - new Date().getSeconds();
            io.emit('price_update', { price: currentPrice, secondsLeft });

            // FASE 1: PRÉ-ALERTA
            if (closePrices.length > 50 && !isCandleClosed) {
                let tempPrices = [...closePrices, currentPrice];
                if (tempPrices.length > 150) tempPrices.shift();
                
                const tempSignal = evaluateStrategy(tempPrices, currentStrategy);
                
                if (tempSignal === 'CALL') io.emit('pre_alert', { call: true, put: false });
                else if (tempSignal === 'PUT') io.emit('pre_alert', { call: false, put: true });
                else io.emit('pre_alert', { call: false, put: false }); 
            }

            // FASE 2: GATILHO OFICIAL
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
                        io.emit('signal_result', sig);
                        io.emit('scoreboard', scoreboard); 
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

                // Busca nova entrada ao vivo (Com a hora formatada para o Brasil)
                const newSignalType = evaluateStrategy(closePrices, currentStrategy);
                if (newSignalType) {
                    const newSig = { 
                        id: Date.now(), 
                        type: newSignalType, 
                        time: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }), 
                        step: 0, 
                        status: 'Aguardando Vela...' 
                    };
                    activeSignals.push(newSig); 
                    signalHistory.unshift(newSig); 
                    if (signalHistory.length > 20) signalHistory.pop();

                    io.emit('new_signal_history', newSig); 
                    io.emit('signal', { type: newSignalType, time: newSig.time }); 
                }
            }
        });

        ws.on('error', (err) => {
            updateStatus('Sinal da corretora perdido. Reconectando em 5s...');
            setTimeout(() => startConnection(currentSymbol), 5000);
        });

        ws.on('close', () => {
            updateStatus('Conexão encerrada. Reiniciando o motor em 5s...');
            setTimeout(() => startConnection(currentSymbol), 5000);
        });

    } catch (error) {
        let motivo = error.response ? `Erro ${error.response.status}` : error.message;
        updateStatus(`Falha ao puxar histórico (${motivo}). Tentando novamente em 5s...`);
        setTimeout(() => startConnection(currentSymbol), 5000);
    }
}

// ==========================================
// 5. COMUNICAÇÃO COM O FRONTEND
// ==========================================
io.on('connection', (socket) => {
    socket.emit('status', { msg: currentEngineStatus });
    socket.emit('available_strategies', strategiesDB.map(s => ({ id: s.id, name: s.name })));
    socket.emit('scoreboard', scoreboard);
    socket.emit('history_dump', signalHistory);
    
    socket.on('change_coin', (newSymbol) => {
        currentSymbol = newSymbol;
        startConnection(currentSymbol);
    });

    socket.on('change_strategy', (newStrategyId) => {
        currentStrategyId = newStrategyId;
        startConnection(currentSymbol); 
    });

    socket.on('add_new_strategy', (newStrategy) => {
        const exists = strategiesDB.find(s => s.id === newStrategy.id);
        if (!exists) {
            strategiesDB.push(newStrategy);
            io.emit('available_strategies', strategiesDB.map(s => ({ id: s.id, name: s.name })));
        }
    });
});

startConnection(currentSymbol);

server.listen(3000, () => {
    console.log('🚀 Motor JS Invest operando na porta 3000!');
});