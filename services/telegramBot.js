const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const axios = require('axios');
const { evaluateStrategy } = require('../utils/indicators');

const TOKEN = '8627851942:AAFn2Ze3Nbjb6LbNu7Gk3eEAcpDuzzKGGkM';
const CHAT_ID = '-1003925714362';
const bot = new TelegramBot(TOKEN, { polling: false });

const ativosMercadoReal = [
    'BTCUSDT', 'ETHUSDT', 'LTCUSDT', 'ADAUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
    'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD'
];

let estadoSessao = { ativa: false, permitirSinais: false, wins: 0, losses: 0, preAlerta: null, sinalRodando: null };
let activeCronJobs = [];
let configLocal = {};
let motorCacaId = null;

// Converte "09:00" e "25" min de avanço para a sintaxe do Cron
function parseTimeToCron(timeStr, addMinutes, dias) {
    let [h, m] = timeStr.split(':').map(Number);
    m += addMinutes;
    if (m >= 60) { m -= 60; h += 1; }
    if (h >= 24) h -= 24;
    return `${m} ${h} * * ${dias}`;
}

async function initTelegramBot(stateGlobais, configFirebase) {
    console.log("🤖 General do Telegram Inicializado!");
    configLocal = configFirebase;
    agendarSessoes(stateGlobais);
    iniciarMotorContinuo(stateGlobais);
}

function reloadTelegramConfig(novaConfig) {
    console.log("⚙️ Recarregando configurações do Telegram via Painel Admin...");
    configLocal = novaConfig;
    agendarSessoes(); 
}

function agendarSessoes(stateGlobais) {
    // Destrói alarmes antigos
    activeCronJobs.forEach(job => job.stop());
    activeCronJobs = [];

    const dias = configLocal.dias || '1-5';

    // Alarmes Manhã
    const cronManhaStart = parseTimeToCron(configLocal.horaManha, 0, dias);
    const cronManhaSinal = parseTimeToCron(configLocal.horaManha, 25, dias);
    
    // Alarmes Tarde
    const cronTardeStart = parseTimeToCron(configLocal.horaTarde, 0, dias);
    const cronTardeSinal = parseTimeToCron(configLocal.horaTarde, 25, dias);

    const job1 = cron.schedule(cronManhaStart, () => iniciarSessao("Manhã"), { timezone: "America/Sao_Paulo" });
    const job2 = cron.schedule(cronManhaSinal, () => { estadoSessao.permitirSinais = true; }, { timezone: "America/Sao_Paulo" });
    
    const job3 = cron.schedule(cronTardeStart, () => iniciarSessao("Tarde"), { timezone: "America/Sao_Paulo" });
    const job4 = cron.schedule(cronTardeSinal, () => { estadoSessao.permitirSinais = true; }, { timezone: "America/Sao_Paulo" });

    activeCronJobs.push(job1, job2, job3, job4);
    console.log(`⏰ Relógios reprogramados para ${configLocal.horaManha} e ${configLocal.horaTarde} (Dias: ${dias})`);
}

// 🔥 BOTÃO DE PÂNICO DO ADMIN (Inicia na hora!)
function forcarSessaoTelegram(turno) {
    iniciarSessao(turno);
    estadoSessao.permitirSinais = true; // Libera tiro imediato
}

function iniciarSessao(turno) {
    estadoSessao = { ativa: true, permitirSinais: false, wins: 0, losses: 0, preAlerta: null, sinalRodando: null };
    let msg = configLocal.msgDespertar || `👨‍💻 *Atenção!* Iniciando análise do mercado para a sessão...`;
    bot.sendMessage(CHAT_ID, msg, { parse_mode: 'Markdown' });
}

function iniciarMotorContinuo(stateGlobais) {
    if (motorCacaId) clearInterval(motorCacaId);

    motorCacaId = setInterval(async () => {
        if (!estadoSessao.ativa) return;
        const agora = new Date(); const min = agora.getMinutes(); const sec = agora.getSeconds();

        if (estadoSessao.sinalRodando && min % 5 === 0 && sec >= 10 && sec <= 20) {
            await conferirResultado(stateGlobais);
        }
        if (estadoSessao.permitirSinais && !estadoSessao.sinalRodando && estadoSessao.preAlerta && min % 5 === 0 && sec >= 10 && sec <= 20) {
            await atirarSinal(stateGlobais);
        }
        if (estadoSessao.permitirSinais && !estadoSessao.sinalRodando && !estadoSessao.preAlerta && min % 5 === 4 && sec >= 45 && sec <= 55) {
            await cacarOportunidade(stateGlobais);
        }
    }, 10000); 
}

async function cacarOportunidade(state) {
    for (let sym of ativosMercadoReal) {
        try {
            const assertividade = await calcularAssertividadeM5(sym, state);
            if (assertividade < 90) continue; 

            const closes = await puxarFechamentosM5(sym, state);
            if (!closes || closes.length < 150) continue;

            const strategy = state.strategiesDB.find(s => s.name.toLowerCase().includes('live')) || state.strategiesDB[0];
            const sinal = evaluateStrategy(closes, strategy);

            if (sinal) {
                estadoSessao.preAlerta = { symbol: sym, type: sinal };
                enviarPreAlerta(sym, sinal);
                break; 
            }
        } catch (e) {}
    }
}

async function atirarSinal(state) {
    const sym = estadoSessao.preAlerta.symbol;
    const tipo = estadoSessao.preAlerta.type;
    const closes = await puxarFechamentosM5(sym, state);
    const precoEntrada = closes ? closes[closes.length - 1] : 0;

    dispararSinalTelegram(sym, tipo);
    estadoSessao.sinalRodando = { symbol: sym, type: tipo, step: 0, entryPrice: precoEntrada };
    estadoSessao.preAlerta = null; 
}

async function conferirResultado(state) {
    const operacao = estadoSessao.sinalRodando;
    const closes = await puxarFechamentosM5(operacao.symbol, state);
    if (!closes) return;

    const precoFechamento = closes[closes.length - 1]; 
    const isGreen = precoFechamento > operacao.entryPrice;
    const isRed = precoFechamento < operacao.entryPrice;
    const won = (operacao.type === 'CALL' && isGreen) || (operacao.type === 'PUT' && isRed);

    if (won) {
        let msgWin = operacao.step === 0 ? (configLocal.msgWin || "✅ *WIN DE PRIMEIRA!* 🎯") : "✅ *WIN NO GALE 1!* 🎯";
        bot.sendMessage(CHAT_ID, `${msgWin}\nAtivo: ${operacao.symbol}`, { parse_mode: 'Markdown' });
        estadoSessao.wins++; estadoSessao.sinalRodando = null; verificarMeta();
    } else {
        operacao.step++;
        if (operacao.step > 1) {
            let msgLoss = configLocal.msgLoss || `🔴 *LOSS!* O mercado não respeitou a análise.`;
            bot.sendMessage(CHAT_ID, msgLoss, { parse_mode: 'Markdown' });
            estadoSessao.losses++; estadoSessao.sinalRodando = null; verificarMeta();
        } else {
            bot.sendMessage(CHAT_ID, `🔄 *ENTRAR NO GALE ${operacao.step}!*`, { parse_mode: 'Markdown' });
            operacao.entryPrice = precoFechamento; 
        }
    }
}

function verificarMeta() {
    let encerrar = false; let msgFinal = "";
    if (estadoSessao.wins === 2 && estadoSessao.losses === 0) { encerrar = true; msgFinal = "🏆 *META BATIDA! (2x0)*"; }
    else if (estadoSessao.wins === 3 && estadoSessao.losses === 1) { encerrar = true; msgFinal = "🏆 *META BATIDA NA RAÇA! (3x1)*"; }
    else if (estadoSessao.losses === 2) { encerrar = true; msgFinal = "🛑 *STOP LOSS ATINGIDO (2 Loss)*"; }

    if (encerrar) {
        estadoSessao.ativa = false;
        bot.sendMessage(CHAT_ID, msgFinal, { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(CHAT_ID, `📊 *Placar Parcial:* ${estadoSessao.wins} Win x ${estadoSessao.losses} Loss`, { parse_mode: 'Markdown' });
    }
}

function enviarPreAlerta(symbol, tipo) {
    const acao = tipo === 'CALL' ? '🟩 Comprar' : '🟥 Vender';
    bot.sendMessage(CHAT_ID, `⚠️ *PRÉ-ALERTA DE SINAL*\n\nPreparem o ativo: *${symbol}*\nPossível Operação: *${acao}*`, { parse_mode: 'Markdown' });
}

function dispararSinalTelegram(symbol, tipo) {
    const agora = new Date();
    const minEntrada = Math.floor(agora.getMinutes() / 5) * 5;
    const dataEntrada = new Date(agora); dataEntrada.setMinutes(minEntrada);
    const dataGale = new Date(dataEntrada); dataGale.setMinutes(dataEntrada.getMinutes() + 5); 
    const horaEntrada = dataEntrada.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    const horaGale = dataGale.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    const acao = tipo === 'CALL' ? '🟩 Comprar' : '🟥 Vender';

    const msg = `💵 Moeda = ${symbol}\n⏰ Expiração = 5 Minutos\n🛎 Entrada = ${horaEntrada}\n${acao}\n\nGale 1 - ${horaGale}\n\n👉🏼 Se necessário, fazer 1 Gale.\n\n➡️ [Clique aqui para abrir a Vellox](https://velloxbroker.com)`;
    bot.sendMessage(CHAT_ID, msg, { parse_mode: 'Markdown', disable_web_page_preview: true });
}

async function puxarFechamentosM5(symbol, state) {
    try {
        const isCrypto = ['BTCUSDT', 'ETHUSDT', 'LTCUSDT', 'ADAUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'].includes(symbol.toUpperCase());
        if (isCrypto) {
            const res = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=5m&limit=151`);
            if (!res.data) return null; return res.data.slice(0, -1).map(k => parseFloat(k[4]));
        } else {
            if(!state.globalDynamicCookie) return null;
            const to = Math.floor(Date.now() / 1000); const from = to - (151 * 5 * 60); 
            const otcHeaders = { 'accept': '*/*', 'Cookie': state.globalDynamicCookie, 'X-Requested-With': 'XMLHttpRequest', 'referer': 'https://velloxbroker.com/traderoom', 'user-agent': 'Mozilla/5.0' };
            const res = await axios.get(`https://velloxbroker.com/publicapi/tradingview/udf-history?symbol=${symbol.toUpperCase()}&resolution=5&from=${from}&to=${to}&countback=151&site=velloxbroker.com`, { headers: otcHeaders });
            if (res.data && res.data.s === 'ok') return res.data.c.slice(0, -1); return null;
        }
    } catch (e) { return null; }
}

async function calcularAssertividadeM5(symbol, state) {
    try {
        let closesArr = []; let opensArr = [];
        const isCrypto = ['BTCUSDT', 'ETHUSDT', 'LTCUSDT', 'ADAUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'].includes(symbol.toUpperCase());
        if (isCrypto) {
            const res = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=5m&limit=300`);
            if (!res.data) return 0;
            closesArr = res.data.map(k => parseFloat(k[4])); opensArr = res.data.map(k => parseFloat(k[1]));
        } else {
            if(!state.globalDynamicCookie) return 0;
            const to = Math.floor(Date.now() / 1000); const from = to - (300 * 5 * 60); 
            const otcHeaders = { 'accept': '*/*', 'Cookie': state.globalDynamicCookie, 'X-Requested-With': 'XMLHttpRequest', 'referer': 'https://velloxbroker.com/traderoom', 'user-agent': 'Mozilla/5.0' };
            const res = await axios.get(`https://velloxbroker.com/publicapi/tradingview/udf-history?symbol=${symbol.toUpperCase()}&resolution=5&from=${from}&to=${to}&countback=300&site=velloxbroker.com`, { headers: otcHeaders });
            if (res.data && res.data.s === 'ok') { closesArr = res.data.c; opensArr = res.data.o; } else return 0;
        }
        let wins = 0; let totalSinais = 0;
        const strategy = state.strategiesDB.find(s => s.name.toLowerCase().includes('live')) || state.strategiesDB[0];
        for (let i = 100; i < closesArr.length - 3; i++) {
            const histCloses = closesArr.slice(0, i); const sig = evaluateStrategy(histCloses, strategy);
            if (sig) {
                totalSinais++;
                const win0 = (sig === 'CALL' && closesArr[i] > opensArr[i]) || (sig === 'PUT' && closesArr[i] < opensArr[i]);
                const win1 = (sig === 'CALL' && closesArr[i+1] > opensArr[i+1]) || (sig === 'PUT' && closesArr[i+1] < opensArr[i+1]);
                const win2 = (sig === 'CALL' && closesArr[i+2] > opensArr[i+2]) || (sig === 'PUT' && closesArr[i+2] < opensArr[i+2]);
                if (win0 || win1 || win2) wins++;
            }
        }
        return totalSinais > 0 ? (wins / totalSinais) * 100 : 0;
    } catch (e) { return 0; }
}

module.exports = { initTelegramBot, reloadTelegramConfig, forcarSessaoTelegram };