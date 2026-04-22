const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { db } = require('./config/firebase');
const axios = require('axios');

const MERCADO_PAGO_TOKEN = process.env.MP_ACCESS_TOKEN || "APP_USR-3528566099083615-032621-e83caa93fb1a10be74adc4d003e89766-3295623236"; 

const globalStore = {
    state: {
        globalDynamicCookie: "",
        activeEngines: {}, currentEngineStatus: "Aguardando inicialização...", strategiesDB: [], activeBrokers: {}, availableCoins: {},
        radarStats: { total: 0, byAsset: {}, byHour: {} } 
    },
    tgConfigGlobal: { dias: '0-6', horaManha: '09:00', horaTarde: '15:00', rsiOver: 65, rsiUnder: 35, bbDev: 2 }
};

const { loadSystemData, loadAvailableCoins } = require('./services/systemBoot');
const setupSockets = require('./sockets/socketManager');
const { initEngine } = require('./services/engine');

const app = express();
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.use(express.static('public'));

async function checkAndApprovePayment(paymentId) {
    try {
        const mpRes = await axios.get(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
            headers: { 'Authorization': `Bearer ${MERCADO_PAGO_TOKEN}` }
        });

        if (mpRes.data.status === 'approved') {
            const paymentDocRef = db.collection('payments').doc(paymentId.toString());
            const paymentDoc = await paymentDocRef.get();

            if (paymentDoc.exists && paymentDoc.data().status !== 'approved') {
                const data = paymentDoc.data();
                const uid = data.uid;
                const meses = data.meses;

                const userRef = db.collection('users').doc(uid);
                const userDoc = await userRef.get();
                let novaData = new Date();

                if (userDoc.exists && userDoc.data().subscriptionEndDate) {
                    let atual = userDoc.data().subscriptionEndDate.toDate();
                    novaData = atual > new Date() ? atual : new Date();
                }
                novaData.setMonth(novaData.getMonth() + meses);

                await userRef.update({ subscriptionEndDate: novaData, status: 'active' });
                await paymentDocRef.update({ status: 'approved', approvedAt: new Date() });
                
                const broker = globalStore.state.activeBrokers[uid];
                if (broker && broker.socketId) {
                    broker.isPremium = true;
                    io.to(broker.socketId).emit('payment_approved', { expiresAt: novaData.toISOString() });
                }
                return true;
            }
        }
    } catch (error) { console.error("Erro na verificação do pagamento:", error.message); }
    return false;
}

app.post('/create_payment', async (req, res) => {
    const { valor, meses, uid, email } = req.body;
    try {
        const idempotencyKey = Date.now().toString(); 
        const baseUrl = process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : `http://localhost:${process.env.PORT || 3000}`;
        const webhookOficial = `${baseUrl}/webhook/mercadopago`;

        const mpRes = await axios.post('https://api.mercadopago.com/v1/payments', {
            transaction_amount: Number(valor), description: `Acesso VIP JS Invest - ${meses} Meses`, payment_method_id: 'pix',
            payer: { email: email || 'contato@jsinvest.com' }, external_reference: uid, notification_url: webhookOficial
        }, { headers: { 'Authorization': `Bearer ${MERCADO_PAGO_TOKEN}`, 'X-Idempotency-Key': idempotencyKey } });

        const paymentData = mpRes.data;
        const paymentId = paymentData.id.toString();
        const pix_code = paymentData.point_of_interaction.transaction_data.qr_code;
        const qrcode_base64 = "data:image/png;base64," + paymentData.point_of_interaction.transaction_data.qr_code_base64;

        await db.collection('payments').doc(paymentId).set({ uid, valor, meses, email, status: 'pending', createdAt: new Date(), paymentId });
        res.json({ pix_code, qrcode_base64, paymentId });
    } catch (e) { res.status(500).json({ error: 'Falha ao gerar o código PIX' }); }
});

app.get('/verify_payment/:id', async (req, res) => {
    const approved = await checkAndApprovePayment(req.params.id);
    res.json({ approved });
});

app.post('/webhook/mercadopago', async (req, res) => {
    try {
        const paymentId = req.query.id || (req.body.data && req.body.data.id);
        if (paymentId) { await checkAndApprovePayment(paymentId); }
    } catch (error) {}
    res.sendStatus(200);
});

initEngine(io, globalStore.state);
setupSockets(io, globalStore.state, globalStore.tgConfigGlobal);
loadAvailableCoins(globalStore.state);

const PORT = process.env.PORT || 3000;
loadSystemData(io, globalStore.state, globalStore.tgConfigGlobal).then(() => {
    server.listen(PORT, () => { console.log(`🚀 JS Invest SaaS Operacional (Porta ${PORT})`); });
});