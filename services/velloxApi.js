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
            headers: { 
                'Accept': 'application/json', 
                'Content-Type': 'application/x-www-form-urlencoded', 
                'Authorization': `Bearer ${broker.token}` 
            }
        });
    };

    try {
        const response = await executeTrade(accountId);
        console.log(`[✅ DISPARO EXECUTADO] ${symbol} | R$ ${amount} | Direção: ${direction} | Conta: ${accountId}`);
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
            } catch (retryError) { 
                errorMsg = retryError.response ? JSON.stringify(retryError.response.data) : retryError.message; 
            }
        }
        console.error(`[❌ ERRO NO DISPARO]`, errorMsg);
        return { success: false, msg: errorMsg };
    }
}

// 🎯 A NOVA FUNÇÃO QUE VAI CAÇAR O SEU SALDO
async function getVelloxBalance(token) {
    try {
        const response = await axios.get(`https://velloxbroker.com/api/public/users/balance`, {
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });
        
        // 🕵️‍♂️ O RASTREADOR: Vai imprimir no Render exatamente o que a corretora responder
        console.log("💰 Resposta Bruta da Vellox (Saldo):", JSON.stringify(response.data));
        
        const resData = response.data;
        
        // Caça o saldo em todos os buracos possíveis do JSON da Vellox
        let balance = resData.user_credit || resData.credit || 
                      (resData.data ? resData.data.user_credit : null) || 
                      (resData.data ? resData.data.credit : null);
                      
        if (balance !== undefined && balance !== null) {
            // Garante que o valor venha formatado bonito (ex: 150,50)
            return parseFloat(balance).toFixed(2).replace('.', ',');
        }
        
        return "0,00";
    } catch (error) {
        console.error(`[❌ ERRO DE SALDO VELLOX]`, error.response ? JSON.stringify(error.response.data) : error.message);
        return "0,00";
    }
}

module.exports = {
    dispararOrdemVellox,
    getVelloxBalance
};