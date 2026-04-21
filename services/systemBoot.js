const { db } = require('../config/firebase');
const { initTelegramBot } = require('./telegramBot');
const { scanRadarHistory } = require('./engine');

async function loadSystemData(io, state, tgConfigGlobal) {
    try {
        const snapshot = await db.collection('scripts').get();
        state.strategiesDB = [];
        snapshot.forEach(doc => { state.strategiesDB.push(doc.data()); });

        const tgDoc = await db.collection('settings').doc('telegram').get();
        if (tgDoc.exists) {
            const data = tgDoc.data();
            Object.assign(tgConfigGlobal, data); 
        }
        
        state.strategiesDB.forEach(s => {
            s.rsiOverbought = parseFloat(tgConfigGlobal.rsiOver) || 65;
            s.rsiOversold = parseFloat(tgConfigGlobal.rsiUnder) || 35;
            s.bbStdDev = parseFloat(tgConfigGlobal.bbDev) || 2;
        });

        if (state.strategiesDB.length > 0) {
            scanRadarHistory(); 
        } else {
            state.currentEngineStatus = "Aguardando injeção de scripts...";
            io.emit('status', { msg: state.currentEngineStatus });
        }
        
        initTelegramBot(state, tgConfigGlobal);

    } catch (error) { console.error("Erro Firebase:", error); }
}

function loadAvailableCoins(state) {
    state.availableCoins = {
        "🟠 Criptomoedas (Binance)": ['btcusdt', 'ethusdt', 'ltcusdt', 'adausdt', 'bnbusdt', 'dogeusdt', 'solusdt', 'xrpusdt'],
        "🔵 Forex (Vellox)": ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD'],
        "🟣 Ações (Vellox)": ['AAPL', 'TSLA', 'MSFT', 'AMZN', 'META', 'GOOGL', 'NFLX'],
        "🟡 Commodities": ['XAUUSD', 'XAGUSD', 'USOIL']
    };
}

module.exports = { loadSystemData, loadAvailableCoins };