// 🧠 INDICATORS ENGINE - CÉREBRO MATEMÁTICO DO JS INVEST

function calculateSMA(data, period) {
    if (data.length < period) return null;
    const sum = data.slice(-period).reduce((a, b) => a + b, 0);
    return sum / period;
}

// 🎯 NOVA FÓRMULA: Média Móvel Exponencial (EMA)
function calculateEMA(data, period) {
    if (data.length < period) return null;
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period; 
    for (let i = period; i < data.length; i++) {
        ema = (data[i] - ema) * k + ema;
    }
    return ema;
}

function calculateWMA(data, period) {
    if (data.length < period) return null;
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

function calculateRSI(data, period) {
    if (data.length < period + 1) return null;
    let gains = 0, losses = 0;
    
    for (let i = 1; i <= period; i++) {
        let diff = data[i] - data[i - 1];
        if (diff > 0) gains += diff;
        else losses -= diff;
    }
    
    let avgGain = gains / period; 
    let avgLoss = losses / period;
    
    for (let i = period + 1; i < data.length; i++) {
        let diff = data[i] - data[i - 1];
        let gain = diff > 0 ? diff : 0; 
        let loss = diff < 0 ? -diff : 0;
        
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
    
    return { 
        upper: sma + (sd * stdDev), 
        lower: sma - (sd * stdDev), 
        middle: sma 
    };
}

function evaluateStrategy(prices, strategyConfig) {
    if (!prices || prices.length < 50) return null;

    // 1. BYPASS ESTRATÉGIA DAS LIVES (Configuração via Painel Admin)
    if (strategyConfig.name && strategyConfig.name.toLowerCase().includes('live')) {
        const rsiPeriod = 14; 
        const rsiOverbought = strategyConfig.rsiOverbought || 65; 
        const rsiOversold = strategyConfig.rsiOversold || 35;   
        const bbPeriod = 20; 
        const bbStdDev = strategyConfig.bbStdDev || 2;       

        const currentPrice = prices[prices.length - 1];
        const lastRSI = calculateRSI(prices, rsiPeriod);
        const lastBB = calculateBollingerBands(prices, bbPeriod, bbStdDev);

        if (lastRSI !== null && lastBB !== null) {
            if (currentPrice <= lastBB.lower && lastRSI <= rsiOversold) return 'CALL';
            if (currentPrice >= lastBB.upper && lastRSI >= rsiOverbought) return 'PUT';
        }
        return null; 
    }
    
    // 2. LÓGICA DINÂMICA VIA JSON
    let current = { price: prices[prices.length - 1] }; 
    let prev = { price: prices[prices.length - 2] };
    
    if (strategyConfig.indicators) {
        for (const [key, config] of Object.entries(strategyConfig.indicators)) {
            const type = config.type ? config.type.toUpperCase() : '';
            if (type === 'SMA') {
                current[key] = calculateSMA(prices, config.period); 
                prev[key] = calculateSMA(prices.slice(0, -1), config.period);
            } else if (type === 'EMA') { 
                current[key] = calculateEMA(prices, config.period); 
                prev[key] = calculateEMA(prices.slice(0, -1), config.period);
            } else if (type === 'RSI') { 
                current[key] = calculateRSI(prices, config.period); 
                prev[key] = calculateRSI(prices.slice(0, -1), config.period);
            } else if (type === 'BB') { 
                current[key] = calculateBollingerBands(prices, config.period, config.stdDev); 
                prev[key] = calculateBollingerBands(prices.slice(0, -1), config.period, config.stdDev);
            }
        }
    }
    
    if (Object.values(current).includes(null)) return null;

    try {
        const isCall = new Function('current', 'prev', `return ${strategyConfig.conditions.call};`)(current, prev);
        const isPut = new Function('current', 'prev', `return ${strategyConfig.conditions.put};`)(current, prev);
        
        if (isCall) return 'CALL'; 
        if (isPut) return 'PUT';
    } catch (e) { 
        if (!strategyConfig.errorLogged) {
            console.error(`⚠️ Erro na regra da estratégia [${strategyConfig.name}]: ${e.message}`);
            strategyConfig.errorLogged = true; 
        }
    }
    
    return null;
}

module.exports = { calculateSMA, calculateEMA, calculateWMA, calculateRSI, calculateBollingerBands, evaluateStrategy };