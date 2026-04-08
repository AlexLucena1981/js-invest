const axios = require('axios');
const WebSocket = require('ws');
const { evaluateStrategy } = require('../utils/indicators');
const { dispararOrdemVellox } = require('./velloxApi');

let io;
let state; 

function initEngine(_io, _state) {
    io = _io;
    state = _state;

    // 🧹 O LIXEIRO DE MOTORES: Agora também mata Zumbis esquecidos em background
    setInterval(() => {
        for (let key in state.activeEngines) {
            let eng = state.activeEngines[key];
            if (key !== state.currentEngineKey && eng.activeSignals.length === 0) {
                console.log(`♻️ Limpando motor em background: ${key}`);
                if (eng.ws) { eng.ws.removeAllListeners(); eng.ws.on('error', () => {}); eng.ws.terminate(); eng.ws = null; }
                if (eng.otcInterval) { clearInterval(eng.otcInterval); eng.otcInterval = null; }
                delete state.activeEngines[key];
            }
        }
    }, 5000);
}

function getEngine(sym, tf, stratId) {
    let key = `${sym.toLowerCase()}_${tf}_${stratId}`;
    if (!state.activeEngines[key]) {
        state.activeEngines[key] = {
            key: key, 
            symbol: sym, 
            timeframe: tf,
            strategyId: stratId,
            ws: null, 
            otcInterval: null,
            closePrices: [], 
            activeSignals: [],
            signalHistory: [], 
            scoreboard: { win1: 0, winG1: 0, winG2: 0, loss: 0 }, 
            currentGlobalPrice: 0, 
            lastClosedCandleTime: 0, 
            lastResolvedCandleTime: 0,
            lastTickTime: Date.now(), // 🎯 O CORAÇÃO DO MOTOR (Para detectar Zumbis)
            connectionId: 0
        };
    }
    return state.activeEngines[key];
}

function updateStatus(msg) {
    state.currentEngineStatus = msg;
    io.emit('status', { msg });
}

function updateBrokerProfits(step, isWin, isManual = false) {
    Object.values(state.activeBrokers).forEach(broker => {
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
            io.to(broker.socketId).emit('auto_trade_status', { active: broker.autoTradeActive, msg: broker.autoTradeActive ? "Robô Operando..." : "Robô Pausado.", profit: broker.sessionProfit });
        }
    });
}

function processHistoricalCandle(eng, k_time, k_o, k_c, currentStrategy) {
    eng.activeSignals = eng.activeSignals.filter(sig => {
        const isGreen = k_c > k_o; const isRed = k_c < k_o;
        const won = (sig.type === 'CALL' && isGreen) || (sig.type === 'PUT' && isRed);

        if (won) {
            if (sig.step === 0) { sig.status = 'WIN 1ª 🎯'; eng.scoreboard.win1++; }
            else if (sig.step === 1) { sig.status = 'WIN G1 🎯'; eng.scoreboard.winG1++; }
            else if (sig.step === 2) { sig.status = 'WIN G2 🎯'; eng.scoreboard.winG2++; }
            return false;
        } else {
            sig.step++;
            if (sig.step > 2) { sig.status = 'LOSS 🔴'; eng.scoreboard.loss++; return false; }
            else { sig.status = `Gale ${sig.step}...`; sig.entryPrice = k_c; return true; }
        }
    });

    eng.closePrices.push(k_c);
    if (eng.closePrices.length > 150) eng.closePrices.shift();

    if (eng.activeSignals.length === 0) {
        const newSigType = evaluateStrategy(eng.closePrices, currentStrategy);
        if (newSigType) {
            const newSig = {
                id: k_time, type: newSigType, symbol: eng.symbol.toUpperCase(), timeframe: eng.timeframe,
                time: new Date(k_time).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
                step: 0, status: 'Aguardando...', entryPrice: k_o, isManual: false
            };
            eng.activeSignals.push(newSig); 
            eng.signalHistory.unshift(newSig);
            if (eng.signalHistory.length > 20) eng.signalHistory.pop();
        }
    }
}

async function handleCandleClose(eng, closedPrice, candleStartTime) {
    if (candleStartTime === eng.lastClosedCandleTime) return;
    eng.lastClosedCandleTime = candleStartTime;
    
    eng.closePrices.push(closedPrice);
    if (eng.closePrices.length > 150) eng.closePrices.shift();

    let signalResolvedThisCandle = false;

    eng.activeSignals = eng.activeSignals.filter(sig => {
        const won = (sig.type === 'CALL' && closedPrice > sig.entryPrice) || (sig.type === 'PUT' && closedPrice < sig.entryPrice);
        const prefix = sig.isManual ? '⚡ Sniper: ' : '';

        let currentMaxGale = 2;
        const bKeys = Object.keys(state.activeBrokers);
        if(bKeys.length > 0 && state.activeBrokers[bKeys[0]].config) { currentMaxGale = parseInt(state.activeBrokers[bKeys[0]].config.maxGale); }

        if (won) {
            if (sig.step === 0) { sig.status = prefix + 'WIN 1ª 🎯'; if (!sig.isManual) eng.scoreboard.win1++; }
            else if (sig.step === 1) { sig.status = prefix + 'WIN G1 🎯'; if (!sig.isManual) eng.scoreboard.winG1++; }
            else if (sig.step === 2) { sig.status = prefix + 'WIN G2 🎯'; if (!sig.isManual) eng.scoreboard.winG2++; }
            
            updateBrokerProfits(sig.step, true, sig.isManual);
            io.emit('signal_result', sig); 
            if (eng.key === state.currentEngineKey) io.emit('scoreboard', eng.scoreboard); 
            signalResolvedThisCandle = true; return false; 
        } else {
            updateBrokerProfits(sig.step, false, sig.isManual); 
            sig.step++; 
            
            if (sig.step > currentMaxGale) {
                sig.status = prefix + 'LOSS 🔴'; if (!sig.isManual) eng.scoreboard.loss++; 
                io.emit('signal_result', sig); 
                if (eng.key === state.currentEngineKey) io.emit('scoreboard', eng.scoreboard); 
                signalResolvedThisCandle = true; return false; 
            } else {
                sig.status = prefix + `Gale ${sig.step}...`; sig.entryPrice = eng.currentGlobalPrice || closedPrice; io.emit('signal_result', sig);
                
                Object.values(state.activeBrokers).forEach(async (broker) => {
                    if (!sig.isManual && !broker.autoTradeActive) return;
                    if (sig.step > broker.config.maxGale) return; 
                    let valorGale = broker.config.baseAmount * Math.pow(2, sig.step); let isDemo = broker.config.accountType === 'demo';
                    const result = await dispararOrdemVellox(broker, isDemo, eng.symbol, sig.type, valorGale.toFixed(2).replace('.', ','), eng.currentGlobalPrice || closedPrice, eng.timeframe);
                    if (result.success && result.balance) io.to(broker.socketId).emit('update_balance', { isDemo: isDemo, balance: result.balance });
                });
                return true; 
            }
        }
    });

    if (signalResolvedThisCandle) eng.lastResolvedCandleTime = candleStartTime;

    if (eng.activeSignals.length === 0 && candleStartTime !== eng.lastResolvedCandleTime && eng.key === state.currentEngineKey) {
        const currentStrategy = state.strategiesDB.find(s => s.id === state.currentStrategyId);
        const newSignalType = evaluateStrategy(eng.closePrices, currentStrategy);
        
        if (newSignalType) {
            const newSig = { id: Date.now(), type: newSignalType, symbol: eng.symbol.toUpperCase(), timeframe: eng.timeframe, time: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }), step: 0, status: 'Aguardando Vela...', entryPrice: eng.currentGlobalPrice || closedPrice, isManual: false };
            eng.activeSignals.push(newSig); eng.signalHistory.unshift(newSig); if (eng.signalHistory.length > 20) eng.signalHistory.pop();
            
            io.emit('new_signal_history', newSig); io.emit('signal', { type: newSignalType, time: newSig.time }); 
            
            Object.values(state.activeBrokers).forEach(async (broker) => {
                if (!broker.autoTradeActive) return;
                let valorInicial = parseFloat(broker.config.baseAmount).toFixed(2).replace('.', ','); let isDemo = broker.config.accountType === 'demo';
                const result = await dispararOrdemVellox(broker, isDemo, eng.symbol, newSignalType, valorInicial, eng.currentGlobalPrice || closedPrice, eng.timeframe);
                if (result.success && result.balance) io.to(broker.socketId).emit('update_balance', { isDemo: isDemo, balance: result.balance });
            });
        }
    }
}

function handleCandleTick(eng, currentPrice, isCandleClosed, candleStartTime) {
    eng.currentGlobalPrice = currentPrice;
    eng.lastTickTime = Date.now(); // 🎯 BATE O CORAÇÃO DO MOTOR
    
    if (eng.key === state.currentEngineKey) {
        const tfMinutes = parseInt(eng.timeframe.replace('m', '')); const now = new Date();
        const secondsLeft = (tfMinutes * 60) - ((now.getMinutes() % tfMinutes) * 60 + now.getSeconds());
        let currentActive = eng.activeSignals.length > 0 ? eng.activeSignals[0] : null;
        io.emit('price_update', { price: currentPrice, secondsLeft: secondsLeft, activeSignal: currentActive });

        if (eng.closePrices.length > 50 && !isCandleClosed && candleStartTime !== eng.lastResolvedCandleTime) {
            if (eng.activeSignals.length === 0) {
                let tempPrices = [...eng.closePrices, currentPrice]; if (tempPrices.length > 150) tempPrices.shift();
                const currentStrategy = state.strategiesDB.find(s => s.id === state.currentStrategyId);
                const tempSignal = evaluateStrategy(tempPrices, currentStrategy);
                if (tempSignal === 'CALL') io.emit('pre_alert', { call: true, put: false });
                else if (tempSignal === 'PUT') io.emit('pre_alert', { call: false, put: true });
                else io.emit('pre_alert', { call: false, put: false }); 
            } else { io.emit('pre_alert', { call: false, put: false }); }
        }
    }
    if (isCandleClosed) handleCandleClose(eng, currentPrice, candleStartTime);
}

async function startConnection(symbol, tf) {
    let eng = getEngine(symbol, tf, state.currentStrategyId);
    
    // ⚡ DESFIBRILADOR (ANTI-ZUMBI): Se o motor está há mais de 2 minutos sem piscar, ele morreu!
    const isStale = eng.lastTickTime > 0 && (Date.now() - eng.lastTickTime > 120000);

    if (isStale && eng.closePrices.length > 0) {
        console.log(`🧟 Motor Zumbi detectado em ${eng.key} (Sem pulso há 2 min). Destruindo e recarregando...`);
        if (eng.ws) { eng.ws.removeAllListeners(); eng.ws.on('error', () => {}); eng.ws.terminate(); eng.ws = null; }
        if (eng.otcInterval) { clearInterval(eng.otcInterval); eng.otcInterval = null; }
        eng.closePrices = []; // Força recarregar histórico
    }

    // Se não é Zumbi e já tem dados, só devolve a tela!
    if (!isStale && (eng.ws || eng.otcInterval) && eng.closePrices.length > 0) {
        if (eng.key === state.currentEngineKey) {
            io.emit('price_update', { price: eng.currentGlobalPrice, secondsLeft: 0, activeSignal: eng.activeSignals.length > 0 ? eng.activeSignals[0] : null });
            io.emit('history_dump', eng.signalHistory);
            io.emit('scoreboard', eng.scoreboard);
        }
        return; 
    }

    eng.connectionId++; const myConnectionId = eng.connectionId;
    if (eng.ws) { eng.ws.removeAllListeners(); eng.ws.on('error', () => {}); if (eng.ws.readyState === WebSocket.CONNECTING || eng.ws.readyState === WebSocket.OPEN) { eng.ws.terminate(); } eng.ws = null; }
    if (eng.otcInterval) { clearInterval(eng.otcInterval); eng.otcInterval = null; }
    
    eng.closePrices = []; eng.activeSignals = []; eng.currentGlobalPrice = 0; 
    eng.signalHistory = []; eng.scoreboard = { win1: 0, winG1: 0, winG2: 0, loss: 0 };
    eng.lastTickTime = Date.now(); // Inicia o coração

    if (eng.key === state.currentEngineKey) {
        io.emit('price_update', { price: 0, secondsLeft: 0, activeSignal: null });
        io.emit('scoreboard', eng.scoreboard); io.emit('history_dump', eng.signalHistory); io.emit('pre_alert', { call: false, put: false });
        io.emit('engine_state', { symbol: state.currentSymbol, timeframe: state.currentTimeframe, strategy: state.currentStrategyId });
    }
    
    const tfMinutes = parseInt(tf.replace('m', ''));
    const currentStrategy = state.strategiesDB.find(s => s.id === state.currentStrategyId);
    if (!currentStrategy) return;

    const cryptoBinance = ['btcusdt', 'ethusdt', 'ltcusdt', 'adausdt', 'bnbusdt', 'dogeusdt', 'solusdt', 'xrpusdt'];
    const useBinance = cryptoBinance.includes(symbol.toLowerCase());

    if (!useBinance) { 
        if (eng.key === state.currentEngineKey) updateStatus(`Carregando histórico de 500 velas...`);
        try {
            const resolution = tfMinutes.toString();
            const to = Math.floor(Date.now() / 1000); 
            const from = to - (500 * tfMinutes * 60); 
            
            const otcHeaders = { 'accept': '*/*', 'Cookie': state.globalDynamicCookie, 'X-Requested-With': 'XMLHttpRequest', 'referer': 'https://velloxbroker.com/traderoom', 'user-agent': 'Mozilla/5.0' };
            const response = await axios.get(`https://velloxbroker.com/publicapi/tradingview/udf-history?symbol=${symbol.toUpperCase()}&resolution=${resolution}&from=${from}&to=${to}&countback=500&site=velloxbroker.com`, { headers: otcHeaders });

            if (myConnectionId !== eng.connectionId) return;

            if (response.data && response.data.s === 'ok') {
                const opens = response.data.o; const closes = response.data.c; const times = response.data.t;
                for (let i = 0; i < closes.length - 1; i++) { processHistoricalCandle(eng, times[i] * 1000, opens[i], closes[i], currentStrategy); }
                eng.lastClosedCandleTime = times[times.length - 2]; 
                if (eng.key === state.currentEngineKey) { updateStatus(`Operando...`); io.emit('scoreboard', eng.scoreboard); io.emit('history_dump', eng.signalHistory); }
            } 

            eng.otcInterval = setInterval(async () => {
                if (myConnectionId !== eng.connectionId) return;
                try {
                    const pollTo = Math.floor(Date.now() / 1000); const pollFrom = pollTo - (5 * tfMinutes * 60); 
                    const pollRes = await axios.get(`https://velloxbroker.com/publicapi/tradingview/udf-history?symbol=${symbol.toUpperCase()}&resolution=${resolution}&from=${pollFrom}&to=${pollTo}&countback=3&site=velloxbroker.com`, { headers: otcHeaders });
                    if (pollRes.data && pollRes.data.s === 'ok') {
                        const times = pollRes.data.t; const closes = pollRes.data.c; const latestTime = times[times.length - 1]; const latestClose = closes[closes.length - 1];
                        if (eng.lastClosedCandleTime > 0 && latestTime > eng.lastClosedCandleTime) {
                            const closedTime = times[times.length - 2]; const closedPrice = closes[closes.length - 2];
                            if (closedTime === eng.lastClosedCandleTime) { handleCandleClose(eng, closedPrice, closedTime); } else { eng.lastClosedCandleTime = latestTime; }
                        }
                        if (eng.lastClosedCandleTime === 0) eng.lastClosedCandleTime = latestTime; handleCandleTick(eng, latestClose, false, latestTime);
                    }
                } catch (e) {} 
            }, 1500);

        } catch (error) { if (myConnectionId === eng.connectionId) setTimeout(() => startConnection(symbol, tf), 5000); }

    } else {
        if (eng.key === state.currentEngineKey) updateStatus(`Carregando histórico Binance (500 velas)...`);
        try {
            const response = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${tf}&limit=500`);
            if (myConnectionId !== eng.connectionId) return; 

            const klines = response.data;
            for (let i = 0; i < klines.length - 1; i++) { processHistoricalCandle(eng, klines[i][0], parseFloat(klines[i][1]), parseFloat(klines[i][4]), currentStrategy); }
            
            if (eng.key === state.currentEngineKey) { updateStatus(`Operando...`); io.emit('scoreboard', eng.scoreboard); io.emit('history_dump', eng.signalHistory); }
            
            eng.ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${tf}`);
            eng.ws.on('message', (data) => { if (myConnectionId !== eng.connectionId) return; try { const kline = JSON.parse(data).k; handleCandleTick(eng, parseFloat(kline.c), kline.x, kline.t); } catch (e) { } });
            eng.ws.on('error', () => { if (myConnectionId === eng.connectionId) setTimeout(() => startConnection(symbol, tf), 5000); });
            eng.ws.on('close', () => { if (myConnectionId === eng.connectionId) setTimeout(() => startConnection(symbol, tf), 5000); });
        } catch (error) { if (myConnectionId === eng.connectionId) setTimeout(() => startConnection(symbol, tf), 5000); }
    }
}

module.exports = { initEngine, startConnection, getEngine };