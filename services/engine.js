const axios = require('axios');
const WebSocket = require('ws');
const { evaluateStrategy } = require('../utils/indicators');
const { dispararOrdemVellox } = require('./velloxApi');

let io;
let state; 

const radarLastCandleProcessed = {}; 

const radarCoins = [
    'BTCUSDT', 'ETHUSDT', 'LTCUSDT', 'ADAUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 
    'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD',                            
    'EURUSDOTC', 'GBPUSDOTC', 'USDJPYOTC', 'BTCUSDTOTC',                         
    'AAPL', 'XAUUSD'                                                             
];

const cryptoBinance = ['BTCUSDT', 'ETHUSDT', 'LTCUSDT', 'ADAUSDT', 'BNBUSDT', 'DOGEUSDT', 'SOLUSDT', 'XRPUSDT'];

function initEngine(_io, _state) {
    io = _io;
    state = _state;

    setInterval(async () => {
        const now = Date.now();
        for (let key in state.activeEngines) {
            let eng = state.activeEngines[key];
            if (eng.lastTickTime > 0 && (now - eng.lastTickTime > 120000)) {
                if (eng.activeSignals.length > 0) eng.activeSignals = [];
            }
            if (key !== state.currentEngineKey && eng.activeSignals.length === 0) {
                if (eng.ws) { eng.ws.removeAllListeners(); eng.ws.on('error', () => {}); eng.ws.terminate(); eng.ws = null; }
                if (eng.otcInterval) { clearInterval(eng.otcInterval); eng.otcInterval = null; }
                delete state.activeEngines[key];
            }
        }

        try {
            let radarStrat = state.strategiesDB.find(s => s.name && s.name.toLowerCase().includes('live'));
            if (!radarStrat && state.strategiesDB.length > 0) radarStrat = state.strategiesDB.find(s => s.id === state.currentStrategyId);
            
            if (radarStrat) {
                const tf = state.currentTimeframe || '1m';
                const tfMinutes = parseInt(tf.replace('m', ''));
                
                for (let sym of radarCoins) {
                    try {
                        let closes = [];
                        let lastClosedCandleTime = 0;
                        const isCrypto = cryptoBinance.includes(sym.toUpperCase());

                        if (isCrypto) {
                            const res = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${tf}&limit=151`);
                            if (!res.data) continue;
                            const klines = res.data;
                            lastClosedCandleTime = klines[klines.length - 2][0]; 
                            closes = klines.slice(0, -1).map(k => parseFloat(k[4])); 
                        } else {
                            if(!state.globalDynamicCookie) continue; 
                            const resolution = tfMinutes.toString();
                            const to = Math.floor(Date.now() / 1000); 
                            const from = to - (151 * tfMinutes * 60); 
                            const otcHeaders = { 'accept': '*/*', 'Cookie': state.globalDynamicCookie, 'X-Requested-With': 'XMLHttpRequest', 'referer': 'https://velloxbroker.com/traderoom', 'user-agent': 'Mozilla/5.0' };
                            
                            const res = await axios.get(`https://velloxbroker.com/publicapi/tradingview/udf-history?symbol=${sym.toUpperCase()}&resolution=${resolution}&from=${from}&to=${to}&countback=151&site=velloxbroker.com`, { headers: otcHeaders });
                            
                            if (res.data && res.data.s === 'ok') {
                                const timesArr = res.data.t;
                                const closesArr = res.data.c;
                                lastClosedCandleTime = timesArr[timesArr.length - 2] * 1000;
                                closes = closesArr.slice(0, -1);
                            } else {
                                continue; 
                            }
                        }

                        if (radarLastCandleProcessed[sym] === lastClosedCandleTime) continue;
                        if (closes.length > 150) closes = closes.slice(closes.length - 150); 
                        
                        const signal = evaluateStrategy(closes, radarStrat);
                        if (signal) {
                            radarLastCandleProcessed[sym] = lastClosedCandleTime;

                            const curDate = new Date();
                            const hourStr = curDate.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }) + 'h';
                            
                            state.radarStats.total++;
                            state.radarStats.byHour[hourStr] = (state.radarStats.byHour[hourStr] || 0) + 1;
                            
                            if (!state.radarStats.byAsset[sym]) { state.radarStats.byAsset[sym] = { count: 0, intervals: [], lastTime: null }; }
                            
                            const assetData = state.radarStats.byAsset[sym];
                            assetData.count++;
                            
                            if (assetData.lastTime) {
                                const diffMin = (curDate.getTime() - assetData.lastTime) / 60000;
                                assetData.intervals.push(diffMin);
                                if(assetData.intervals.length > 50) assetData.intervals.shift(); 
                            }
                            assetData.lastTime = curDate.getTime();

                            io.emit('radar_alert', { symbol: sym, type: signal });
                            io.emit('radar_stats_update', state.radarStats);
                        }
                    } catch(e) {} 
                }
            }
        } catch(err) {}
    }, 20000); 
}

async function scanRadarHistory() {
    try {
        state.radarStats = { total: 0, byAsset: {}, byHour: {} };
        for (let key in radarLastCandleProcessed) delete radarLastCandleProcessed[key];

        let radarStrat = state.strategiesDB.find(s => s.name && s.name.toLowerCase().includes('live'));
        if (!radarStrat && state.strategiesDB.length > 0) radarStrat = state.strategiesDB.find(s => s.id === state.currentStrategyId);
        if (!radarStrat) return;

        const tf = state.currentTimeframe || '1m';
        const tfMinutes = parseInt(tf.replace('m', ''));

        for (let sym of radarCoins) {
            try {
                const isCrypto = cryptoBinance.includes(sym.toUpperCase());
                let timesArr = []; let closesArr = [];

                if (isCrypto) {
                    const res = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${tf}&limit=500`);
                    if (!res.data) continue;
                    timesArr = res.data.map(k => k[0]); closesArr = res.data.map(k => parseFloat(k[4]));
                } else {
                    if(!state.globalDynamicCookie) continue;
                    const resolution = tfMinutes.toString();
                    const to = Math.floor(Date.now() / 1000); const from = to - (500 * tfMinutes * 60); 
                    const otcHeaders = { 'accept': '*/*', 'Cookie': state.globalDynamicCookie, 'X-Requested-With': 'XMLHttpRequest', 'referer': 'https://velloxbroker.com/traderoom', 'user-agent': 'Mozilla/5.0' };
                    const res = await axios.get(`https://velloxbroker.com/publicapi/tradingview/udf-history?symbol=${sym.toUpperCase()}&resolution=${resolution}&from=${from}&to=${to}&countback=500&site=velloxbroker.com`, { headers: otcHeaders });
                    if (res.data && res.data.s === 'ok') { timesArr = res.data.t.map(t => t * 1000); closesArr = res.data.c; } else { continue; }
                }
                
                let tempCloses = [];
                for (let i = 0; i < closesArr.length - 1; i++) { 
                    const closedTime = timesArr[i];
                    tempCloses.push(closesArr[i]);
                    
                    if (tempCloses.length > 150) tempCloses.shift();

                    if (tempCloses.length === 150) {
                        const signal = evaluateStrategy(tempCloses, radarStrat);
                        if (signal) {
                            radarLastCandleProcessed[sym] = closedTime;

                            const curDate = new Date(closedTime);
                            const hourStr = curDate.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }) + 'h';
                            
                            state.radarStats.total++;
                            state.radarStats.byHour[hourStr] = (state.radarStats.byHour[hourStr] || 0) + 1;
                            
                            if (!state.radarStats.byAsset[sym]) { state.radarStats.byAsset[sym] = { count: 0, intervals: [], lastTime: null }; }
                            
                            const assetData = state.radarStats.byAsset[sym];
                            assetData.count++;
                            
                            if (assetData.lastTime) {
                                const diffMin = (curDate.getTime() - assetData.lastTime) / 60000;
                                assetData.intervals.push(diffMin);
                                if(assetData.intervals.length > 50) assetData.intervals.shift(); 
                            }
                            assetData.lastTime = curDate.getTime();
                        }
                    }
                }
            } catch(e) {}
        }
        io.emit('radar_stats_update', state.radarStats);
    } catch(err) {}
}

function getEngine(sym, tf, stratId) {
    let key = `${sym.toLowerCase()}_${tf}_${stratId}`;
    if (!state.activeEngines[key]) {
        state.activeEngines[key] = {
            key: key, symbol: sym, timeframe: tf, strategyId: stratId,
            ws: null, otcInterval: null, closePrices: [], activeSignals: [], signalHistory: [], 
            scoreboard: { win1: 0, winG1: 0, winG2: 0, loss: 0 }, 
            currentGlobalPrice: 0, lastClosedCandleTime: 0, lastResolvedCandleTime: 0, lastTickTime: Date.now(), connectionId: 0
        };
    }
    return state.activeEngines[key];
}

function updateStatus(msg) {
    state.currentEngineStatus = msg;
    io.emit('status', { msg });
}

// 🎯 MATEMÁTICA C/ EXIGÊNCIA DE "BILHETE DE EMBARQUE"
function updateBrokerProfits(step, isWin, sig) {
    Object.values(state.activeBrokers).forEach(broker => {
        if (sig.isManual) {
            if (sig.brokerUid !== broker.uid) return;
        } else {
            // BARREIRA DE INTRUSO: O passageiro só recebe o prémio/perda se embarcou neste exato passo!
            if (!sig.firedBrokers || !sig.firedBrokers[step] || !sig.firedBrokers[step].includes(broker.uid)) return; 
        }
        
        let amountBet = broker.config.baseAmount * Math.pow(2, step);
        let payoutPerc = (broker.config.payout || 85) / 100;
        
        if (isWin) {
            let lucroLiquido = (amountBet * payoutPerc); 
            broker.sessionProfit += lucroLiquido;
            io.to(broker.socketId).emit('win_balance_update', { isDemo: broker.config.accountType === 'demo', prize: (amountBet + lucroLiquido) });
        } else { 
            broker.sessionProfit -= amountBet; 
        }

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
                step: 0, status: 'Aguardando...', entryPrice: k_o, isManual: false,
                firedBrokers: {} // Backtest não dispara
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
    const MAX_GALE_GLOBAL = 2; 

    eng.activeSignals = eng.activeSignals.filter(sig => {
        const won = (sig.type === 'CALL' && closedPrice > sig.entryPrice) || (sig.type === 'PUT' && closedPrice < sig.entryPrice);
        const prefix = sig.isManual ? '⚡ Sniper: ' : '';

        if (won) {
            if (sig.step === 0) { sig.status = prefix + 'WIN 1ª 🎯'; if(!sig.isManual) eng.scoreboard.win1++; }
            else if (sig.step === 1) { sig.status = prefix + 'WIN G1 🎯'; if(!sig.isManual) eng.scoreboard.winG1++; }
            else if (sig.step === 2) { sig.status = prefix + 'WIN G2 🎯'; if(!sig.isManual) eng.scoreboard.winG2++; }
            
            updateBrokerProfits(sig.step, true, sig); // Cobra o bilhete
            io.emit('signal_result', sig); 
            if (eng.key === state.currentEngineKey) io.emit('scoreboard', eng.scoreboard); 
            signalResolvedThisCandle = true; return false; 
        } else {
            updateBrokerProfits(sig.step, false, sig); // Cobra o bilhete da perda
            sig.step++; 
            if (sig.step > MAX_GALE_GLOBAL) {
                sig.status = prefix + 'LOSS 🔴'; if(!sig.isManual) eng.scoreboard.loss++; 
                io.emit('signal_result', sig); 
                if (eng.key === state.currentEngineKey) io.emit('scoreboard', eng.scoreboard); 
                signalResolvedThisCandle = true; return false; 
            } else {
                sig.status = prefix + `Gale ${sig.step}...`; sig.entryPrice = eng.currentGlobalPrice || closedPrice; 
                io.emit('signal_result', sig);
                
                // 🎫 PREPARA O BILHETE DO GALE
                if (!sig.firedBrokers) sig.firedBrokers = {};
                sig.firedBrokers[sig.step] = [];

                Object.values(state.activeBrokers).forEach(async (broker) => {
                    if (sig.isManual) {
                        if (sig.brokerUid !== broker.uid) return; 
                    } else {
                        if (!broker.autoTradeActive || !broker.isPremium) return;
                        // 🛑 SE NÃO ESTAVA NO PASSO 0, NÃO PODE ENTRAR DE PENETRA NO GALE!
                        if (!sig.firedBrokers[0] || !sig.firedBrokers[0].includes(broker.uid)) return;
                    }
                    
                    if (sig.step > broker.config.maxGale) return; 
                    
                    if (!sig.isManual) sig.firedBrokers[sig.step].push(broker.uid); // Dá o bilhete do Gale
                    
                    let valorGale = broker.config.baseAmount * Math.pow(2, sig.step); 
                    let isDemo = broker.config.accountType === 'demo';
                    
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
            const newSig = { 
                id: Date.now(), type: newSignalType, symbol: eng.symbol.toUpperCase(), timeframe: eng.timeframe, 
                time: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }), 
                step: 0, status: 'Aguardando Vela...', entryPrice: eng.currentGlobalPrice || closedPrice, isManual: false,
                firedBrokers: { 0: [] } // 🎫 ABERTURA DA BILHETEIRA
            };
            eng.activeSignals.push(newSig); eng.signalHistory.unshift(newSig); if (eng.signalHistory.length > 20) eng.signalHistory.pop();
            io.emit('new_signal_history', newSig); io.emit('signal', { type: newSignalType, time: newSig.time }); 
            
            Object.values(state.activeBrokers).forEach(async (broker) => {
                if (!broker.autoTradeActive || !broker.isPremium) return;
                
                newSig.firedBrokers[0].push(broker.uid); // 🎫 O Robô ligou a tempo? Toma o bilhete!
                
                let valorInicial = parseFloat(broker.config.baseAmount).toFixed(2).replace('.', ','); 
                let isDemo = broker.config.accountType === 'demo';
                
                const result = await dispararOrdemVellox(broker, isDemo, eng.symbol, newSignalType, valorInicial, eng.currentGlobalPrice || closedPrice, eng.timeframe);
                if (result.success && result.balance) io.to(broker.socketId).emit('update_balance', { isDemo: isDemo, balance: result.balance });
            });
        }
    }
}

function handleCandleTick(eng, currentPrice, isCandleClosed, candleStartTime) {
    eng.currentGlobalPrice = currentPrice;
    eng.lastTickTime = Date.now(); 
    
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
    
    const isStale = eng.lastTickTime > 0 && (Date.now() - eng.lastTickTime > 120000);

    if (isStale && eng.closePrices.length > 0) {
        if (eng.ws) { eng.ws.removeAllListeners(); eng.ws.on('error', () => {}); eng.ws.terminate(); eng.ws = null; }
        if (eng.otcInterval) { clearInterval(eng.otcInterval); eng.otcInterval = null; }
        eng.closePrices = []; 
    }

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
    eng.lastTickTime = Date.now(); 

    if (eng.key === state.currentEngineKey) {
        io.emit('price_update', { price: 0, secondsLeft: 0, activeSignal: null });
        io.emit('scoreboard', eng.scoreboard); io.emit('history_dump', eng.signalHistory); io.emit('pre_alert', { call: false, put: false });
        io.emit('engine_state', { symbol: state.currentSymbol, timeframe: state.currentTimeframe, strategy: state.currentStrategyId });
    }
    
    const tfMinutes = parseInt(tf.replace('m', ''));
    const currentStrategy = state.strategiesDB.find(s => s.id === state.currentStrategyId);
    if (!currentStrategy) return;

    const useBinance = cryptoBinance.includes(symbol.toUpperCase());

    if (!useBinance) { 
        if (eng.key === state.currentEngineKey) updateStatus(`Carregando análise (500 velas)...`);
        try {
            const resolution = tfMinutes.toString();
            const to = Math.floor(Date.now() / 1000); const from = to - (500 * tfMinutes * 60); 
            const otcHeaders = { 'accept': '*/*', 'Cookie': state.globalDynamicCookie, 'X-Requested-With': 'XMLHttpRequest', 'referer': 'https://velloxbroker.com/traderoom', 'user-agent': 'Mozilla/5.0' };
            const response = await axios.get(`https://velloxbroker.com/publicapi/tradingview/udf-history?symbol=${symbol.toUpperCase()}&resolution=${resolution}&from=${from}&to=${to}&countback=500&site=velloxbroker.com`, { headers: otcHeaders });

            if (myConnectionId !== eng.connectionId) return;

            if (response.data && response.data.s === 'ok') {
                const opens = response.data.o; const closes = response.data.c; const times = response.data.t;
                for (let i = 0; i < closes.length - 1; i++) { processHistoricalCandle(eng, times[i] * 1000, opens[i], closes[i], currentStrategy); }
                eng.lastClosedCandleTime = times[times.length - 2]; 
                if (eng.key === state.currentEngineKey) { updateStatus(`Analisando Mercado Vivo...`); io.emit('scoreboard', eng.scoreboard); io.emit('history_dump', eng.signalHistory); }
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
        if (eng.key === state.currentEngineKey) updateStatus(`Carregando análise Binance (500 velas)...`);
        try {
            const response = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${tf}&limit=500`);
            if (myConnectionId !== eng.connectionId) return; 

            const klines = response.data;
            for (let i = 0; i < klines.length - 1; i++) { processHistoricalCandle(eng, klines[i][0], parseFloat(klines[i][1]), parseFloat(klines[i][4]), currentStrategy); }
            
            if (eng.key === state.currentEngineKey) { updateStatus(`Analisando Mercado Binance...`); io.emit('scoreboard', eng.scoreboard); io.emit('history_dump', eng.signalHistory); }
            
            eng.ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${tf}`);
            eng.ws.on('message', (data) => { if (myConnectionId !== eng.connectionId) return; try { const kline = JSON.parse(data).k; handleCandleTick(eng, parseFloat(kline.c), kline.x, kline.t); } catch (e) { } });
            eng.ws.on('error', () => { if (myConnectionId === eng.connectionId) setTimeout(() => startConnection(symbol, tf), 5000); });
            eng.ws.on('close', () => { if (myConnectionId === eng.connectionId) setTimeout(() => startConnection(symbol, tf), 5000); });
        } catch (error) { if (myConnectionId === eng.connectionId) setTimeout(() => startConnection(symbol, tf), 5000); }
    }
}

module.exports = { initEngine, startConnection, getEngine, scanRadarHistory };