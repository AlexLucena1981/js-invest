const axios = require('axios');

async function dispararOrdemVellox(broker, isDemo, symbol, direction, amount, currentPrice, tfStr) {
    let accountId = isDemo ? broker.demoAccountId : broker.realAccountId; 
    const expirationValue = tfStr.replace('m', ''); 

    // 🎯 BLINDAGEM 1: Garante que o valor viaja no padrão americano (ponto em vez de vírgula)
    const cleanAmount = String(amount).replace(',', '.');

    const executeTrade = async (accId) => {
        const tradeData = new URLSearchParams();
        tradeData.append('transaction_account_id', accId); 
        tradeData.append('expiration', expirationValue); 
        tradeData.append('amount', cleanAmount); 
        tradeData.append('direction', direction === 'CALL' ? '1' : '0'); 
        tradeData.append('symbol', symbol.toUpperCase()); 
        
        // 🎯 BLINDAGEM 2 (A GRANDE CIRURGIA): 
        // OMITIMOS a linha "tradeData.append('symbol_price', ...)"
        // Ao não exigir um preço fixo da Binance, a Vellox executa a ordem a mercado
        // com a taxa atual dela, acabando para sempre com o "Erro ao validar o preço".

        return await axios.put(`https://velloxbroker.com/api/public/applications/transaction`, tradeData, {
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Bearer ${broker.token}` }
        });
    };

    try {
        const response = await executeTrade(accountId);
        let novoSaldo = response.data.user_credit || (response.data.data ? response.data.data.user_credit : null);
        return { success: true, balance: novoSaldo };
    } catch (error) {
        let errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
        
        // Se der erro de conta não encontrada, tentamos o ID alternativo de Conta Demo da Vellox
        if (isDemo && errorMsg.includes("Conta de operação não encontrada")) {
            broker.demoAccountId = (broker.demoAccountId === '8') ? '15' : '8';
            accountId = broker.demoAccountId;
            try {
                const retryResponse = await executeTrade(accountId);
                let novoSaldo = retryResponse.data.user_credit || (retryResponse.data.data ? retryResponse.data.data.user_credit : null);
                return { success: true, balance: novoSaldo };
            } catch (retryError) { errorMsg = retryError.response ? JSON.stringify(retryError.response.data) : retryError.message; }
        }
        
        return { success: false, msg: errorMsg };
    }
}

async function getVelloxBalance(token) {
    try {
        const response = await axios.get(`https://velloxbroker.com/api/public/users/balance`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const resData = response.data;
        let balance = resData.credit || resData.user_credit;
        if (!balance && resData.data) {
            balance = resData.data.credit || resData.data.user_credit;
        }
        
        if (balance !== undefined && balance !== null) {
            let cleanBal = String(balance).trim().replace(/R\$\s?/g, '');
            
            if (cleanBal.includes(',') && cleanBal.includes('.')) {
                if (cleanBal.indexOf(',') > cleanBal.indexOf('.')) {
                    cleanBal = cleanBal.replace(/\./g, '').replace(',', '.'); 
                } else {
                    cleanBal = cleanBal.replace(/,/g, ''); 
                }
            } else if (cleanBal.includes(',')) {
                cleanBal = cleanBal.replace(',', '.'); 
            }
            
            let parsed = parseFloat(cleanBal);
            if (!isNaN(parsed)) {
                return parsed.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            }
        }
        
        return "0,00";
    } catch (error) {
        console.error("❌ Erro na API de Saldo:", error.message);
        return "0,00";
    }
}

module.exports = { dispararOrdemVellox, getVelloxBalance };