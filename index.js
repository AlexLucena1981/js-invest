const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const WebSocket = require('ws');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve os arquivos da pasta public
app.use(express.static('public'));

// ==========================================
// VARIÁVEIS DE ESTADO GLOBAL
// ==========================================
let closePrices = [];
let ws = null;
let currentSymbol = 'btcusdt';
let currentStrategyId = 'rei_das_binarias'; // Estratégia padrão ao abrir

let activeSignals = []; 
let scoreboard = { win1: 0, winG1: 0, winG2: 0, loss: 0 };

// ==========================================
// 1. BANCO DE DADOS DE SCRIPTS (Simulação SaaS)
// ==========================================
const strategiesDB = [
    {
        id: "rei_das_binarias",
        name: "👑 Rei das Binárias (Original)",
        indicators: {
            sma1: { type: "SMA", period: 1 },
            sma34: { type: "SMA", period: 34 }
        },
        conditions: {
            call: "current.buffer1 > current.wmaSinal && prev.buffer1 < prev.wmaSinal",
            put: "current.buffer1 < current.wmaSinal && prev.buffer1 > prev.wmaSinal"
        },
        isComplex: true 
    },
    {
        id: "cruzamento_sma",
        name: "Script: Cruzamento Simples (5x20)",
        indicators: {
            fast: { type: "SMA", period: 5 },
            slow: { type: "SMA", period: 20 }
        },
        conditions: {
            call: "current.fast > current.slow && prev.fast <= prev.slow",
            put: "current.fast < current.slow && prev.fast >= prev.slow"
        }
    },
    {
        id: "reversao_extrema",
        name: "Script: Reversão Extrema (SMA 2 x SMA 50)",
        indicators: {
            agulhada: { type: "SMA", period: 2 },
            tendencia: { type: "SMA", period: 50 }
        },
        conditions: {
            call: "current.agulhada > current.tendencia && prev.agulhada <= prev.tendencia",
            put: "current.agulhada < current.tendencia && prev.agulhada >= prev.tendencia"
        }
    }
];

// ==========================================
// 2. FUNÇÕES MATEMÁTICAS (Indicadores)
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

// ==========================================
// 3. O MOTOR DE REGRAS DINÂMICAS (JSON PARSER)
// ==========================================
function evaluateStrategy(prices, strategyConfig) {
    if (prices.length < 50) return null;

    // LÓGICA ESPECIAL PARA O "REI DAS BINÁRIAS"
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

    // LÓGICA DINÂMICA PARA NOVOS SCRIPTS
    let current = {};
    let prev = {};

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
// 4. CONEXÃO COM A CORRETORA (Websocket Binance)
// ==========================================
async function startConnection(symbol) {
    if (ws) ws.close();
    
    closePrices = [];
    activeSignals = []; 
    scoreboard = { win1: 0, winG1: 0, winG2: 0, loss: 0 };
    io.emit('scoreboard', scoreboard);
    
    const currentStrategy = strategiesDB.find(s => s.id === currentStrategyId);
    
    io.emit('status', { msg: `Carregando histórico de ${symbol.toUpperCase()}...` });

    try {
        const response = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=1m&limit=100`);
        const klines = response.data;
        
        for (let i = 0; i < klines.length - 1; i++) {
            closePrices.push(parseFloat(klines[i][4]));
        }
        
        io.emit('status', { msg: `JS Invest analisando o mercado (${symbol.toUpperCase()})...` });
        
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

                const newSignalType = evaluateStrategy(closePrices, currentStrategy);
                if (newSignalType) {
                    const newSig = {
                        id: Date.now(),
                        type: newSignalType,
                        time: new Date().toLocaleTimeString(),
                        step: 0,
                        status: 'Aguardando Vela...'
                    };
                    activeSignals.push(newSig); 
                    io.emit('new_signal_history', newSig); 
                    io.emit('signal', { type: newSignalType, time: newSig.time }); 
                }
            }
        });
    } catch (error) {
        console.error('Erro na conexão da API:', error);
        io.emit('status', { msg: 'Erro de conexão com o mercado. Tentando novamente...' });
    }
}

// ==========================================
// 5. COMUNICAÇÃO COM O FRONTEND E INJEÇÃO DE SCRIPT
// ==========================================
io.on('connection', (socket) => {
    socket.emit('status', { msg: 'Conectado ao Motor JS Invest.' });
    
    // Manda a lista atual
    socket.emit('available_strategies', strategiesDB.map(s => ({ id: s.id, name: s.name })));
    
    socket.on('change_coin', (newSymbol) => {
        socket.emit('clear_history'); 
        currentSymbol = newSymbol;
        startConnection(currentSymbol);
    });

    socket.on('change_strategy', (newStrategyId) => {
        socket.emit('clear_history'); 
        currentStrategyId = newStrategyId;
        startConnection(currentSymbol); 
    });

    // RECEBE O SCRIPT NOVO DO PAINEL
    socket.on('add_new_strategy', (newStrategy) => {
        const exists = strategiesDB.find(s => s.id === newStrategy.id);
        if (!exists) {
            strategiesDB.push(newStrategy);
            console.log(`✅ Novo Script Injetado no Motor: ${newStrategy.name}`);
            
            // Atualiza o menu de todos os usuários
            io.emit('available_strategies', strategiesDB.map(s => ({ id: s.id, name: s.name })));
        }
    });
});

startConnection(currentSymbol);

server.listen(3000, () => {
    console.log('🚀 Motor JS Invest operando na porta 3000!');
});