function calculateSMA(data, period) {
    if (data.length < period) return null;
    const sum = data.slice(-period).reduce((a, b) => a + b, 0);
    return sum / period;
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

    // Lógica especial para estratégias complexas manuais
    if (strategyConfig.isComplex && strategyConfig.id === 'rei_das_binarias') {
        let buf1 = [];
        for (let i = 10; i >= 0; i--) {
            let slice = prices.slice(0, prices.length - i);
            let sma1 = calculateSMA(slice, 1); 
            let sma34 = calculateSMA(slice, 34);
            if (sma1 === null || sma34 === null) return null;
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

    // Lógica para as estratégias criadas dinamicamente no painel
    let current = { price: prices[prices.length - 1] }; 
    let prev = { price: prices[prices.length - 2] };
    
    if (strategyConfig.indicators) {
        for (const [key, config] of Object.entries(strategyConfig.indicators)) {
            const type = config.type ? config.type.toUpperCase() : '';
            if (type === 'SMA') {
                current[key] = calculateSMA(prices, config.period); 
                prev[key] = calculateSMA(prices.slice(0, -1), config.period);
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

module.exports = {
    calculateSMA,
    calculateWMA,
    calculateRSI,
    calculateBollingerBands,
    evaluateStrategy
};