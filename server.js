const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// 🎯 O CÉREBRO GLOBAL DEFINIDO AQUI (Evita qualquer erro de importação de ficheiros externos)
const globalStore = {
    state: {
        globalDynamicCookie: "locale=eyJpdiI6IkgvYk5XeTFiVUhoczRlQmM2RTZJMFE9PSIsInZhbHVlIjoiNktFOUs2T1lHTXhIN2JnSndzUG9leVczeWRmZ1RwMmJGc2tZQTVaaUh0RVJQSTNUOW9TMWFkSFR6SUxFeHVZZCIsIm1hYyI6ImJjMTFhOGUyNzY1NjA3ZDk3ZGJmMjdhZWU1MmI2NzVjNTg5YzIzYjM5ZWM3NDY5OWRjMTJhYmY1YWU0M2Y0Y2UiLCJ0YWciOiIifQ==; XSRF-TOKEN=eyJpdiI6IkJXTkh4d0NXZlFaQzhVZXpQZkZaa2c9PSIsInZhbHVlIjoidkU4cTBHbUVjZHhTeTkvUGh0YTNMZGpoZTRXV0xaU3hxeEdrTmk4TFVpYThWYnlkREFiVnFDNFNTVFJWVHFnTUFUdEZITzJzV3hOMUp3MzVYR0JwbTdHa2NrZ3JOSHM0R3MyVjVxbnFQZkdzTnpkb3pOS0hjWWU2QTlKdHExMGsiLCJtYWMiOiIzODZmM2MyM2IzMzc3ZjUxMWM4NDU0ZTA5YmMyNjZkZWEyMzdkOWFjMTA3OTdmYmFmNzgxZGNmZjI4ZmE1Yzg2IiwidGFnIjoiIn0=; laravel_session=eyJpdiI6Im8wQkZoRm1EaDYrcXhpSDFVRnZnN3c9PSIsInZhbHVlIjoic2JIb2tDMWhON0pBc3FoYjZpajhaTitweDdRQUs5TUVqamdNdXZBMytQTXFNaHNuSTYvTnpXUjJ4bzBhSEhseHZ0aWFRN0lkSWd1aTBJamZQMEs2YnJ4aFBZTmNxZGpzdkZ3b2VtL3JyS042eEZlWStzemxmNEpDVjlPN1FyemkiLCJtYWMiOiIwMmEwN2VlN2QyYzVjYmFkNGU0YzRlNzgxZTg2NzFiYjY3NmIwNjEyODE2MWU2Y2JlOWFlY2YzOGY1M2U1MzZhIiwidGFnIjoiIn0=",
        activeEngines: {}, 
        currentEngineStatus: "Aguardando inicialização...", 
        strategiesDB: [], 
        activeBrokers: {}, 
        availableCoins: {},
        radarStats: { total: 0, byAsset: {}, byHour: {} } 
    },
    tgConfigGlobal: {
        dias: '0-6', horaManha: '09:00', horaTarde: '15:00',
        rsiOver: 65, rsiUnder: 35, bbDev: 2,
        msgDespertar: "👨‍💻 *Atenção!* Iniciando análise do mercado...",
        msgWin: "✅ *WIN DE PRIMEIRA!* 🎯",
        msgLoss: "🔴 *LOSS!* O mercado não respeitou a análise.",
        msgPre: "⚠️ *PRÉ-ALERTA DE SINAL*\\n\\nPreparem o ativo: *{MOEDA}*\\nPossível Operação: *{DIRECAO}*",
        msgSinal: "⚡ *ALERTA DE TOQUE (OTC/M1)* ⚡\\n\\n💵 Moeda = {MOEDA}\\n⏰ Expiração = 1 Minuto\\n🛎 Entrada = {HORA_ENTRADA}\\n{DIRECAO}\\n\\nGale 1 - {HORA_GALE}\\n\\n👉🏼 Se necessário, fazer 1 Gale.\\n\\n➡️ [Clique aqui para abrir a Vellox](https://velloxbroker.com)"
    }
};

const { loadSystemData, loadAvailableCoins } = require('./services/systemBoot');
const setupSockets = require('./sockets/socketManager');
const { initEngine } = require('./services/engine');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.use(express.static('public'));

// 1. Inicia o Motor de Gráficos e Sockets (Entregando o Estado diretamente nas funções)
initEngine(io, globalStore.state);
setupSockets(io, globalStore.state, globalStore.tgConfigGlobal);

// 2. Carrega Configurações e Inicializa o Servidor
loadAvailableCoins(globalStore.state);

loadSystemData(io, globalStore.state, globalStore.tgConfigGlobal).then(() => {
    server.listen(3000, () => { 
        console.log('🚀 Terminal JS Invest operando com Arquitetura Refatorada & Segura!'); 
    });
});