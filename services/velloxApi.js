const axios = require('axios');

/**
 * Módulo isolado para disparar ordens na Vellox Broker.
 * Se a API da corretora mudar amanhã, só mexemos neste arquivo!
 */
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

        // Tratamento especial: Se a conta Demo 8 falhar, tenta a 15 silenciosamente
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

module.exports = {
    dispararOrdemVellox
};