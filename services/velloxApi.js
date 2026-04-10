const axios = require('axios');

async function dispararOrdemVellox(broker, isDemo, symbol, direction, amount, currentPrice, tfStr) {
    let accountId = isDemo ? broker.demoAccountId : broker.realAccountId; 
    const expirationValue = tfStr.replace('m', ''); 

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
            // 🎯 FILTRO DE LIMPEZA PARA BANCAS ACIMA DE R$ 1.000,00
            let cleanBal = String(balance).trim().replace(/R\$\s?/g, '');
            
            if (cleanBal.includes(',') && cleanBal.includes('.')) {
                if (cleanBal.indexOf(',') > cleanBal.indexOf('.')) {
                    cleanBal = cleanBal.replace(/\./g, '').replace(',', '.'); // BR: 1.050,50 -> 1050.50
                } else {
                    cleanBal = cleanBal.replace(/,/g, ''); // US: 1,050.50 -> 1050.50
                }
            } else if (cleanBal.includes(',')) {
                cleanBal = cleanBal.replace(',', '.'); // BR: 1050,50 -> 1050.50
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