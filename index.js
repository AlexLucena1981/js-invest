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

// 🎯 COOKIE DINÂMICO
let globalDynamicCookie = "locale=eyJpdiI6IkgvYk5XeTFiVUhoczRlQmM2RTZJMFE9PSIsInZhbHVlIjoiNktFOUs2T1lHTXhIN2JnSndzUG9leVczeWRmZ1RwMmJGc2tZQTVaaUh0RVJQSTNUOW9TMWFkSFR6SUxFeHVZZCIsIm1hYyI6ImJjMTFhOGUyNzY1NjA3ZDk3ZGJmMjdhZWU1MmI2NzVjNTg5YzIzYjM5ZWM3NDY5OWRjMTJhYmY1YWU0M2Y0Y2UiLCJ0YWciOiIifQ==; XSRF-TOKEN=eyJpdiI6ImVwUHYrRjZ4NU5CRCtiRklBOHpBY3c9PSIsInZhbHVlIjoiWW44emlWK01sRFE3dGlKaDFnY2R2YW1JN3hVaHRQa0tsUk5xQ25WSVFWVlRzVkw2bUZFamxYV0xLdlFkMFA1UXl5aTdWSTNTU1BpeEtPeHJINVN5R2svWHBnMWZ2V2hVeXMyOXdsNVlLZ0M1a1BtT1QzK1dxbjlzdGU1VWZJaWMiLCJtYWMiOiIxNmFiMmEyYTRjYTZmMzBjNGExNzI5OGQ2Yjk3MTNkYmJhNWJmN2I5NTUxODVhYjJmNTE1ODA4MjUxMGEzMzk3IiwidGFnIjoiIn0=; laravel_session=eyJpdiI6Imtvc0ZJWU1TcHNTR2FYWDV2RG0wTVE9PSIsInZhbHVlIjoiOWV0QXNSYjRubkRRZ0RUd2k2WGM0bDhXbDJ6OE8vNHBNSDhjZzQ0K3graHBIYlRlMkpHdTlVejF5SW1NNVhCQmFzK3BmR1hKVkwxb0xpMlVlbnBGZllZMGZYTXgrQXdnblF0V0l0S1k1bmlyT3QwaVArWnUzU3dLbjVHT3JYVDkiLCJtYWMiOiI3YjZhODVlNTM3OTE3MzQ0OTA2ZTAyZTM1MDk3OGYwNmY2MzA1MTQxZWU5YTU0YzAwNWE0MmI0OTAxZTgyZmVlIiwidGFnIjoiIn0=";

let closePrices = [];
let ws = null;
let otcInterval = null; 
let currentSymbol = 'btcusdt';
let currentStrategyId = ''; 
let currentTimeframe = '1m'; 
let currentGlobalPrice = 0; 

let activeSignals = []; 
let signalHistory = []; 
let scoreboard = { win1: 0, winG1: 0, winG2: 0, loss: 0 };
let currentEngineStatus = "Aguardando inicialização..."; 

let currentConnectionId = 0; 
let lastClosedCandleTime = 0; 
let lastResolvedCandleTime = 0; 

let strategiesDB = [];
let activeBrokers = {}; 
let availableCoins = {}; 

// ============================================================================
// 3. CARREGAMENTO DE DADOS E MOEDAS 
// ============================================================================
async function loadStrategiesFromDB() {
    try {
        const snapshot = await db.collection('scripts').get();
        strategiesDB = [];
        snapshot.forEach(doc => { strategiesDB.push(doc.data()); });

        if (strategiesDB.length > 0) {
            console.log(`🔥 ${strategiesDB.length} scripts carregados do Firebase!`);
            currentStrategyId = strategiesDB[0].id; 
            startConnection(currentSymbol); 
        } else {
            console.log("⚠️ Nenhum script encontrado no banco de dados.");
            updateStatus("Aguardando injeção de scripts no banco...");
        }
        io.emit('available_strategies', strategiesDB.map(s => ({ id: s.id, name: s.name })));
    } catch (error) { console.error("Erro ao ler do Firebase:", error); }
}

function loadAvailableCoins() {
    availableCoins = {
        "🟠 Criptomoedas (Binance)": ['btcusdt', 'ethusdt', 'ltcusdt', 'adausdt', 'bnbusdt', 'dogeusdt', 'solusdt', 'xrpusdt'],
        "🔵 Forex (Mercado Aberto)": ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD'],
        "🟣 Wall Street (Ações)": ['AAPL', 'TSLA', 'MSFT', 'AMZN', 'META', 'GOOGL', 'NFLX'],
        "🟡 Commodities": ['XAUUSD', 'XAGUSD', 'USOIL'],
        "🔴 Fim de Semana (OTC)": ['EURUSDOTC', 'GBPUSDOTC', 'USDJPYOTC', 'BTCUSDTOTC']
    };
    io.emit('available_coins', availableCoins);
}

// ============================================================================
// 4. MÓDULO MATEMÁTICO QUANTITATIVO
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

function calculateRSI(data, period) {
    if (data.length < period + 1) return null;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        let diff = data[i] - data[i - 1];
        if (diff > 0) gains += diff;
        else losses -= diff;
    }
    let avgGain = gains / period; let avgLoss = losses / period;
    for (let i = period + 1; i < data.length; i++) {
        let diff = data[i] - data[i - 1];
        let gain = diff > 0 ? diff : 0; let loss = diff < 0 ? -diff : 0;
        avgGain = ((avgGain * (period - 1)) + gain) / period;
        avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    }
    if (avgLoss === 0) return 100;
    let rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function calculateBollingerBands(data, period, stdDev) {
    if (data.length < period) return null;
    const slice = data.slice(-period);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
    const sd = Math.sqrt(variance);
    return { upper: sma + (sd * stdDev), lower: sma - (sd * stdDev), middle: sma };
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
            let sma1 = calculateSMA(slice, 1); let sma34 = calculateSMA(slice, 34);
            if (sma1 === null || sma34 === null) return null;
            buf1.push(sma1 - sma34);
        }
        const currentB1 = buf1[10]; const prevB1 = buf1[9];
        const currentB2 = calculateWMA(buf1.slice(-5), 5); const prevB2 = calculateWMA(buf1.slice(-6, -1), 5);

        if (currentB1 > currentB2 && prevB1 < prevB2) return 'CALL';
        if (currentB1 < currentB2 && prevB1 > prevB2) return 'PUT';
        return null;
    }

    let current = { price: prices[prices.length - 1] }; 
    let prev = { price: prices[prices.length - 2] };
    
    if (strategyConfig.indicators) {
        for (const [key, config] of Object.entries(strategyConfig.indicators)) {
            const type = config.type ? config.type.toUpperCase() : '';
            if (type === 'SMA') {
                current[key] = calculateSMA(prices, config.period); prev[key] = calculateSMA(prices.slice(0, -1), config.period);
            } else if (type === 'RSI') { 
                current[key] = calculateRSI(prices, config.period); prev[key] = calculateRSI(prices.slice(0, -1), config.period);
            } else if (type === 'BB') { 
                current[key] = calculateBollingerBands(prices, config.period, config.stdDev); prev[key] = calculateBollingerBands(prices.slice(0, -1), config.period, config.stdDev);
            }
        }
    }
    
    if (Object.values(current).includes(null)) return null;

    try {
        const isCall = new Function('current', 'prev', `return ${strategyConfig.conditions.call};`)(current, prev);
        const isPut = new Function('current', 'prev', `return ${strategyConfig.conditions.put};`)(current, prev);
        if (isCall) return 'CALL'; if (isPut) return 'PUT';
    } catch (e) { 
        if (!strategyConfig.errorLogged) {
            console.error(`⚠️ Erro na regra da estratégia: ${e.message}`);
            strategyConfig.errorLogged = true; 
        }
    }
    return null;
}

// ============================================================================
// 5. MÓDULO DE EXECUÇÃO E GESTÃO
// ============================================================================
async function dispararOrdemVellox(broker, isDemo, symbol, direction, amount, currentPrice) {
    let accountId = isDemo ? broker.demoAccountId : broker.realAccountId; 
    const expirationValue = currentTimeframe.replace('m', ''); 

    const executeTrade = async (accId) => {
        const tradeData = new URLSearchParams();
        tradeData.append('transaction_account_id', accId); 
        tradeData.append('expiration', expirationValue); 
        tradeData.append('amount', amount); 
        tradeData.append('direction', direction === 'CALL' ? '1' : '0'); 
        tradeData.append('symbol', symbol.toUpperCase()); 
        tradeData.append('symbol_price', currentPrice.toString()); 

        return await axios.put(`https://velloxbroker.com/api/public/applications/transaction`, tradeData, {
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Bearer ${broker.token}` }
        });
    };

    try {
        const response = await executeTrade(accountId);
        console.log(`[✅ DISPARO EXECUTADO] R$ ${amount} | Direção: ${direction} | Conta: ${accountId}`);
        let novoSaldo = response.data.user_credit || (response.data.data ? response.data.data.user_credit : null);
        return { success: true, balance: novoSaldo };

    } catch (error) {
        let errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;

        if (isDemo && errorMsg.includes("Conta de operação não encontrada")) {
            broker.demoAccountId = (broker.demoAccountId === '8') ? '15' : '8';
            accountId = broker.demoAccountId;
            try {
                const retryResponse = await executeTrade(accountId);
                let novoSaldo = retryResponse.data.user_credit || (retryResponse.data.data ? retryResponse.data.data.user_credit : null);
                return { success: true, balance: novoSaldo };
            } catch (retryError) { errorMsg = retryError.response ? JSON.stringify(retryError.response.data) : retryError.message; }
        }
        console.error(`[❌ ERRO NO DISPARO]`, errorMsg);
        return { success: false, msg: errorMsg };
    }
}

function updateBrokerProfits(step, isWin, isManual = false) {
    Object.values(activeBrokers).forEach(broker => {
        if (!isManual && !broker.autoTradeActive) return; 
        if (step > broker.config.maxGale) return; 

        let amountBet = broker.config.baseAmount * Math.pow(2, step);
        if (isWin) {
            let lucroLiquido = (amountBet * 0.85); 
            broker.sessionProfit += lucroLiquido;
            io.to(broker.socketId).emit('win_balance_update', { isDemo: broker.config.accountType === 'demo', prize: (amountBet + lucroLiquido) });
        } else { broker.sessionProfit -= amountBet; }

        let stopReason = null;
        if (broker.sessionProfit <= -broker.config.stopLoss) stopReason = `🛑 STOP LOSS ATINGIDO!`;
        if (broker.sessionProfit >= broker.config.stopWin) stopReason = `🏆 META BATIDA!`;

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
// 6. MOTOR DE VELAS E MÁQUINA DO TEMPO (HISTÓRICO)
// ============================================================================
function processHistoricalCandle(k_time, k_o, k_c, currentStrategy) {
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

async function handleCandleClose(closedPrice, candleStartTime) {
    if (candleStartTime === lastClosedCandleTime) return;
    lastClosedCandleTime = candleStartTime;
    
    closePrices.push(closedPrice);
    if (closePrices.length > 150) closePrices.shift();

    let signalResolvedThisCandle = false;

    activeSignals = activeSignals.filter(sig => {
        const won = (sig.type === 'CALL' && closedPrice > sig.entryPrice) || (sig.type === 'PUT' && closedPrice < sig.entryPrice);
        const prefix = sig.isManual ? '⚡ Sniper: ' : '';

        let currentMaxGale = 2;
        const bKeys = Object.keys(activeBrokers);
        if(bKeys.length > 0 && activeBrokers[bKeys[0]].config) {
            currentMaxGale = parseInt(activeBrokers[bKeys[0]].config.maxGale);
        }

        if (won) {
            if (sig.step === 0) { 
                sig.status = prefix + 'WIN 1ª 🎯'; 
                if (!sig.isManual) scoreboard.win1++; 
            }
            else if (sig.step === 1) { 
                sig.status = prefix + 'WIN G1 🎯'; 
                if (!sig.isManual) scoreboard.winG1++; 
            }
            else if (sig.step === 2) { 
                sig.status = prefix + 'WIN G2 🎯'; 
                if (!sig.isManual) scoreboard.winG2++; 
            }
            
            updateBrokerProfits(sig.step, true, sig.isManual);
            io.emit('signal_result', sig); io.emit('scoreboard', scoreboard); 
            signalResolvedThisCandle = true; return false; 
        } else {
            updateBrokerProfits(sig.step, false, sig.isManual); 
            sig.step++; 
            
            if (sig.step > currentMaxGale) {
                sig.status = prefix + 'LOSS 🔴'; 
                if (!sig.isManual) scoreboard.loss++; 
                io.emit('signal_result', sig); io.emit('scoreboard', scoreboard); 
                signalResolvedThisCandle = true; return false; 
            } else {
                sig.status = prefix + `Gale ${sig.step}...`; io.emit('signal_result', sig);
                
                Object.values(activeBrokers).forEach(async (broker) => {
                    if (!sig.isManual && !broker.autoTradeActive) return;
                    if (sig.step > broker.config.maxGale) return; 
                    
                    let valorGale = broker.config.baseAmount * Math.pow(2, sig.step);
                    let isDemo = broker.config.accountType === 'demo';
                    
                    const result = await dispararOrdemVellox(broker, isDemo, currentSymbol, sig.type, valorGale.toFixed(2).replace('.', ','), closedPrice);
                    if (result.success && result.balance) io.to(broker.socketId).emit('update_balance', { isDemo: isDemo, balance: result.balance });
                });
                return true; 
            }
        }
    });

    if (signalResolvedThisCandle) lastResolvedCandleTime = candleStartTime;

    if (activeSignals.length === 0 && candleStartTime !== lastResolvedCandleTime) {
        const currentStrategy = strategiesDB.find(s => s.id === currentStrategyId);
        const newSignalType = evaluateStrategy(closePrices, currentStrategy);
        
        if (newSignalType) {
            const newSig = { 
                id: Date.now(), type: newSignalType, symbol: currentSymbol.toUpperCase(),
                time: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }), 
                step: 0, status: 'Aguardando Vela...', entryPrice: closedPrice, isManual: false
            };
            
            activeSignals.push(newSig); signalHistory.unshift(newSig); 
            if (signalHistory.length > 20) signalHistory.pop();
            
            io.emit('new_signal_history', newSig); io.emit('signal', { type: newSignalType, time: newSig.time }); 
            
            Object.values(activeBrokers).forEach(async (broker) => {
                if (!broker.autoTradeActive) return;
                let valorInicial = parseFloat(broker.config.baseAmount).toFixed(2).replace('.', ',');
                let isDemo = broker.config.accountType === 'demo';
                
                const result = await dispararOrdemVellox(broker, isDemo, currentSymbol, newSignalType, valorInicial, closedPrice);
                if (result.success && result.balance) io.to(broker.socketId).emit('update_balance', { isDemo: isDemo, balance: result.balance });
            });
        }
    }
}

function handleCandleTick(currentPrice, isCandleClosed, candleStartTime) {
    currentGlobalPrice = currentPrice;
    const tfMinutes = parseInt(currentTimeframe.replace('m', ''));
    const now = new Date();
    const secondsLeft = (tfMinutes * 60) - ((now.getMinutes() % tfMinutes) * 60 + now.getSeconds());

    let currentActive = activeSignals.length > 0 ? activeSignals[0] : null;
    io.emit('price_update', { price: currentPrice, secondsLeft: secondsLeft, activeSignal: currentActive });

    if (closePrices.length > 50 && !isCandleClosed && candleStartTime !== lastResolvedCandleTime) {
        if (activeSignals.length === 0) {
            let tempPrices = [...closePrices, currentPrice];
            if (tempPrices.length > 150) tempPrices.shift();
            
            const currentStrategy = strategiesDB.find(s => s.id === currentStrategyId);
            const tempSignal = evaluateStrategy(tempPrices, currentStrategy);
            
            if (tempSignal === 'CALL') io.emit('pre_alert', { call: true, put: false });
            else if (tempSignal === 'PUT') io.emit('pre_alert', { call: false, put: true });
            else io.emit('pre_alert', { call: false, put: false }); 
        } else { io.emit('pre_alert', { call: false, put: false }); }
    }

    if (isCandleClosed) handleCandleClose(currentPrice, candleStartTime);
}

// ============================================================================
// 7. MOTOR CENTRAL DE CONEXÃO (ROTEADOR BINANCE vs UDF OTC/AÇÕES)
// ============================================================================
async function startConnection(symbol) {
    currentConnectionId++;
    const myConnectionId = currentConnectionId;

    if (ws) { 
        ws.removeAllListeners(); 
        ws.on('error', () => {}); 
        if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
            ws.terminate(); 
        }
        ws = null; 
    }
    if (otcInterval) { clearInterval(otcInterval); otcInterval = null; }
    
    closePrices = []; activeSignals = []; signalHistory = []; 
    scoreboard = { win1: 0, winG1: 0, winG2: 0, loss: 0 };
    lastClosedCandleTime = 0; lastResolvedCandleTime = 0; 
    currentGlobalPrice = 0; 

    io.emit('price_update', { price: 0, secondsLeft: 0, activeSignal: null });
    io.emit('scoreboard', scoreboard);
    io.emit('history_dump', []);
    io.emit('pre_alert', { call: false, put: false });
    
    // 🎯 A MÁGICA: Informa o front-end IMEDIATAMENTE sobre os selects corretos!
    io.emit('engine_state', { symbol: currentSymbol, timeframe: currentTimeframe, strategy: currentStrategyId });
    
    const tfMinutes = parseInt(currentTimeframe.replace('m', ''));
    const currentStrategy = strategiesDB.find(s => s.id === currentStrategyId);
    if (!currentStrategy) return;

    const cryptoBinance = ['btcusdt', 'ethusdt', 'ltcusdt', 'adausdt', 'bnbusdt', 'dogeusdt', 'solusdt', 'xrpusdt'];
    const useBinance = cryptoBinance.includes(symbol.toLowerCase());
    const isOTC = symbol.toUpperCase().includes('OTC');
    const marketLabel = isOTC ? 'OTC' : (useBinance ? 'Cripto' : 'Mercado Tradicional');

    if (!useBinance) { 
        updateStatus(`Carregando histórico de ${symbol.toUpperCase()} (${currentTimeframe.toUpperCase()})...`);
        try {
            const resolution = tfMinutes.toString();
            const to = Math.floor(Date.now() / 1000);
            const from = to - (150 * tfMinutes * 60); 

            const otcHeaders = {
                'accept': '*/*',
                'Cookie': globalDynamicCookie, 
                'X-Requested-With': 'XMLHttpRequest',
                'referer': 'https://velloxbroker.com/traderoom',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            };

            const url = `https://velloxbroker.com/publicapi/tradingview/udf-history?symbol=${symbol.toUpperCase()}&resolution=${resolution}&from=${from}&to=${to}&countback=150&site=velloxbroker.com`;
            const response = await axios.get(url, { headers: otcHeaders });

            if (myConnectionId !== currentConnectionId) return;

            if (response.data && response.data.s === 'ok') {
                const opens = response.data.o;
                const closes = response.data.c;
                const times = response.data.t;

                for (let i = 0; i < closes.length - 1; i++) {
                    processHistoricalCandle(times[i] * 1000, opens[i], closes[i], currentStrategy);
                }
                
                lastClosedCandleTime = times[times.length - 2]; 
                updateStatus(`Operando ${marketLabel} (${symbol.toUpperCase()}) em ${currentTimeframe.toUpperCase()}...`);
                io.emit('scoreboard', scoreboard);
                io.emit('history_dump', signalHistory);
            } else { updateStatus(`Aguardando dados de ${symbol.toUpperCase()}...`); }

            otcInterval = setInterval(async () => {
                if (myConnectionId !== currentConnectionId) return;
                try {
                    const pollTo = Math.floor(Date.now() / 1000);
                    const pollFrom = pollTo - (5 * tfMinutes * 60); 
                    const pollUrl = `https://velloxbroker.com/publicapi/tradingview/udf-history?symbol=${symbol.toUpperCase()}&resolution=${resolution}&from=${pollFrom}&to=${pollTo}&countback=3&site=velloxbroker.com`;

                    const pollRes = await axios.get(pollUrl, { headers: otcHeaders });
                    if (pollRes.data && pollRes.data.s === 'ok') {
                        const times = pollRes.data.t;
                        const closes = pollRes.data.c;
                        const latestTime = times[times.length - 1];
                        const latestClose = closes[closes.length - 1];

                        if (lastClosedCandleTime > 0 && latestTime > lastClosedCandleTime) {
                            const closedTime = times[times.length - 2];
                            const closedPrice = closes[closes.length - 2];
                            if (closedTime === lastClosedCandleTime) { handleCandleClose(closedPrice, closedTime); } 
                            else { lastClosedCandleTime = latestTime; }
                        }
                        if (lastClosedCandleTime === 0) lastClosedCandleTime = latestTime; 
                        handleCandleTick(latestClose, false, latestTime);
                    }
                } catch (e) {} 
            }, 1500);

        } catch (error) {
            console.error(`Erro na ignição de ${symbol}.`, error.message);
            if (myConnectionId === currentConnectionId) setTimeout(() => startConnection(currentSymbol), 5000); 
        }

    } else {
        updateStatus(`Carregando histórico Real de ${symbol.toUpperCase()} (${currentTimeframe.toUpperCase()})...`);
        try {
            const response = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${currentTimeframe}&limit=150`);
            if (myConnectionId !== currentConnectionId) return; 

            const klines = response.data;
            for (let i = 0; i < klines.length - 1; i++) {
                processHistoricalCandle(klines[i][0], parseFloat(klines[i][1]), parseFloat(klines[i][4]), currentStrategy);
            }
            
            updateStatus(`Operando Cripto Binance (${symbol.toUpperCase()}) em ${currentTimeframe.toUpperCase()}...`);
            io.emit('scoreboard', scoreboard);
            io.emit('history_dump', signalHistory);
            
            ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${currentTimeframe}`);
            
            ws.on('message', (data) => {
                if (myConnectionId !== currentConnectionId) return;
                try {
                    const kline = JSON.parse(data).k;
                    handleCandleTick(parseFloat(kline.c), kline.x, kline.t);
                } catch (e) { }
            });

            ws.on('error', () => { if (myConnectionId === currentConnectionId) setTimeout(() => startConnection(currentSymbol), 5000); });
            ws.on('close', () => { if (myConnectionId === currentConnectionId) setTimeout(() => startConnection(currentSymbol), 5000); });

        } catch (error) { 
            console.error("Falha ao buscar Klines:", error.message);
            if (myConnectionId === currentConnectionId) setTimeout(() => startConnection(currentSymbol), 5000); 
        }
    }
}

// ============================================================================
// 8. ROTAS DE COMUNICAÇÃO COM O FRONTEND E ADMINISTRAÇÃO
// ============================================================================
io.on('connection', (socket) => {
    
    socket.emit('status', { msg: currentEngineStatus });
    socket.emit('available_strategies', strategiesDB.map(s => ({ id: s.id, name: s.name })));
    socket.emit('available_coins', availableCoins); 
    socket.emit('scoreboard', scoreboard);
    socket.emit('history_dump', signalHistory);
    
    // 🎯 A MÁGICA: Informa o utilizador recém-chegado qual é a moeda que estamos a operar!
    socket.emit('engine_state', { symbol: currentSymbol, timeframe: currentTimeframe, strategy: currentStrategyId });
    
    socket.on('inject_cookie', (newCookie) => {
        globalDynamicCookie = newCookie;
        io.emit('status', { msg: 'Sessão VIP renovada! Recarregando Gráficos...' });
        startConnection(currentSymbol); 
    });

    socket.on('hybrid_login', async ({ brokerUser, brokerPass }) => {
        try {
            const loginData = new URLSearchParams();
            loginData.append('user', brokerUser); loginData.append('pass', brokerPass);
            const loginResponse = await axios.post(`https://velloxbroker.com/api/login`, loginData, { 
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' } 
            });
            
            const brokerToken = loginResponse.data.token || loginResponse.data.access_token;
            if (!brokerToken) throw new Error("BROKER_FAIL");

            let uid = brokerUser.replace(/[^a-zA-Z0-9]/g, ''); if (!uid) uid = 'user_' + Date.now();
            let userRole = 'aluno'; const userLower = brokerUser.toLowerCase();
            
            if (userLower === MASTER_EMAIL.toLowerCase() || userLower === MASTER_BROKER_LOGIN.toLowerCase()) { uid = 'admin_master'; userRole = 'admin'; } 
            else { const snapshot = await db.collection('users').where('email', '==', brokerUser).get(); if (!snapshot.empty) { uid = snapshot.docs[0].id; userRole = snapshot.docs[0].data().role; } }

            const customToken = await admin.auth().createCustomToken(uid);
            let realBalance = "0,00";
            try {
                const balanceResponse = await axios.get(`https://velloxbroker.com/api/public/users/balance`, { headers: { 'Authorization': `Bearer ${brokerToken}` } });
                realBalance = balanceResponse.data.credit || "0,00";
            } catch (e) {}

            activeBrokers[socket.id] = { 
                socketId: socket.id, token: brokerToken, demoAccountId: '8', realAccountId: '0', autoTradeActive: false, 
                config: { active: false, accountType: 'demo', baseAmount: 5, maxGale: 2, stopWin: 99999, stopLoss: 99999 }, sessionProfit: 0 
            };
            socket.emit('hybrid_login_result', { success: true, firebaseToken: customToken, role: userRole, balance: { demo: "--- (Dê 1 tiro para carregar)", real: realBalance } });

        } catch (error) { socket.emit('hybrid_login_result', { success: false, reason: 'broker', msg: 'Credenciais da Corretora inválidas ou conta inexistente.' }); }
    });

    socket.on('setup_auto_trade', (config) => {
        if (activeBrokers[socket.id]) {
            activeBrokers[socket.id].config = config; activeBrokers[socket.id].autoTradeActive = config.active;
            if (config.active) activeBrokers[socket.id].sessionProfit = 0; 
            socket.emit('auto_trade_status', { active: config.active, msg: config.active ? "Robô Armado e Analisando..." : "Robô Pausado.", profit: activeBrokers[socket.id].sessionProfit });
        }
    });

    socket.on('manual_trade', async (data) => {
        const direction = typeof data === 'string' ? data : data.direction;
        const frontendConfig = typeof data === 'string' ? null : data.config;
        
        const broker = activeBrokers[socket.id];
        if (!broker || !broker.token) { socket.emit('sniper_error', 'Você precisa conectar na corretora antes de atirar!'); return; }

        const hasManualSignal = activeSignals.some(s => s.isManual);
        if (hasManualSignal) { 
            socket.emit('sniper_error', 'Aguarde! Já existe um tiro Sniper em andamento.'); 
            return; 
        }

        if (currentGlobalPrice === 0) {
            currentGlobalPrice = closePrices.length > 0 ? closePrices[closePrices.length - 1] : 0;
            if (currentGlobalPrice === 0) { socket.emit('sniper_error', 'Aguardando sincronização de preço...'); return; }
        }

        if (frontendConfig) {
            if (!broker.config) broker.config = { active: false, stopWin: 99999, stopLoss: 99999 };
            broker.config.accountType = frontendConfig.accountType; broker.config.baseAmount = frontendConfig.baseAmount; broker.config.maxGale = frontendConfig.maxGale;
        }

        let accType = broker.config ? broker.config.accountType : 'demo';
        let amount = broker.config ? parseFloat(broker.config.baseAmount).toFixed(2).replace('.', ',') : '5,00';
        let isDemo = accType === 'demo';

        const result = await dispararOrdemVellox(broker, isDemo, currentSymbol.toUpperCase(), direction, amount, currentGlobalPrice);

        if (result.success) {
            socket.emit('sniper_success', `Ordem ${direction} enviada com sucesso!`);
            if (result.balance) socket.emit('update_balance', { isDemo: isDemo, balance: result.balance });

            const manualSig = { 
                id: Date.now(), type: direction, symbol: currentSymbol.toUpperCase(), time: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }), 
                step: 0, status: '⚡ Sniper (Aguardando...)', entryPrice: currentGlobalPrice, isManual: true 
            };
            
            activeSignals.push(manualSig); signalHistory.unshift(manualSig);
            if (signalHistory.length > 20) signalHistory.pop();
            io.emit('new_signal_history', manualSig);
        } else { socket.emit('sniper_error', result.msg); }
    });

    socket.on('admin_create_user', async (data) => {
        try {
            const decodedToken = await admin.auth().verifyIdToken(data.token);
            const reqUid = decodedToken.uid; 
            let isAdmin = false;
            
            if (reqUid === 'admin_master') isAdmin = true;
            else { const snap = await db.collection('users').doc(reqUid).get(); if (snap.exists && snap.data().role === 'admin') isAdmin = true; }

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
    socket.on('change_timeframe', (newTf) => { currentTimeframe = newTf; startConnection(currentSymbol); });

    socket.on('add_new_strategy', async (newStrategy) => {
        try {
            if (!newStrategy || !newStrategy.id) { socket.emit('script_injection_result', { success: false, msg: 'O JSON precisa de um "id" válido.' }); return; }
            const exists = strategiesDB.find(s => s.id === newStrategy.id);
            if (exists) { socket.emit('script_injection_result', { success: false, msg: 'Já existe um script com este ID!' }); return; }

            await db.collection('scripts').doc(newStrategy.id).set(newStrategy); 
            strategiesDB.push(newStrategy); io.emit('available_strategies', strategiesDB.map(s => ({ id: s.id, name: s.name }))); 
            socket.emit('script_injection_result', { success: true, msg: 'Script gravado!' });
        } catch (e) { socket.emit('script_injection_result', { success: false, msg: 'Erro: ' + e.message }); }
    });

    socket.on('disconnect', () => { if (activeBrokers[socket.id]) delete activeBrokers[socket.id]; });
});

loadStrategiesFromDB();
loadAvailableCoins();

server.listen(3000, () => { console.log('🚀 Motor JS Invest operando na porta 3000!'); });