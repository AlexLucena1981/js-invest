const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const axios = require('axios');
const { evaluateStrategy } = require('../utils/indicators');

// ⚙️ CONFIGURAÇÕES
const TOKEN = '8627851942:AAFn2Ze3Nbjb6LbNu7Gk3eEAcpDuzzKGGkM';
const CHAT_ID = '-1003925714362';
const bot = new TelegramBot(TOKEN, { polling: false });

const ativosMercadoReal = [
    'BTCUSDT', 'ETHUSDT', 'LTCUSDT', 'ADAUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
    'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD'
];

let estadoSessao = { ativa: false, permitirSinais: false, wins: 0, losses: 0, sinalRodando: null, ultimoSinalEnviado: null };
let activeCronJobs = [];
let configLocal = {};
let motorCacaId = null;

function parseTimeToCron(timeStr, addMinutes, dias) {
    let [h, m] = timeStr.split(':').map(Number);
    m += addMinutes;
    if (m >= 60) { m -= 60; h += 1; }
    if (h >= 24) h -= 24;
    return `${m} ${h} * * ${dias}`;
}

async function initTelegramBot(stateGlobais, configFirebase) {
    console.log("🤖 General do Telegram M1 Inicializado! (SNIPER MODE)");
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
    activeCronJobs.forEach(job => job.stop());
    activeCronJobs = [];

    const dias = configLocal.dias || '1-5';

    const cronManhaStart = parseTimeToCron(configLocal.horaManha, 0, dias);
    const cronTardeStart = parseTimeToCron(configLocal.horaTarde, 0, dias);

    const job1 = cron.schedule(cronManhaStart, () => iniciarSessao("Manhã"), { timezone: "America/Sao_Paulo" });
    const job2 = cron.schedule(cronTardeStart, () => iniciarSessao("Tarde"), { timezone: "America/Sao_Paulo" });

    activeCronJobs.push(job1, job2);
    console.log(`⏰ Relógios reprogramados para ${configLocal.horaManha} e ${configLocal.horaTarde} (Dias: ${dias})`);
}

function forcarSessaoTelegram(turno) {
    iniciarSessao(turno);
}

function iniciarSessao(turno) {
    estadoSessao = { ativa: true, permitirSinais: true, wins: 0, losses: 0, sinalRodando: null, ultimoSinalEnviado: null };
    let msg = configLocal.msgDespertar || `👨‍💻 *Atenção!* Iniciando análise do mercado para a sessão...`;
    bot.sendMessage(CHAT_ID, msg, { parse_mode: 'Markdown' });
}

// 🎯 MOTOR CONTÍNUO: RODA A CADA 5 SEGUNDOS PARA LER O "TOQUE"
function iniciarMotorContinuo(stateGlobais) {
    if (motorCacaId) clearInterval(motorCacaId);

    motorCacaId = setInterval(async () => {
        if (!estadoSessao.ativa) return;
        const agora = new Date(); 
        const min = agora.getMinutes(); 
        const sec = agora.getSeconds();

        if (estadoSessao.sinalRodando) {
            // O Robô espera o minuto exato do fechamento para conferir (espera uns 4 a 10 seg após a vela virar para garantir os dados da API)
            if (min === estadoSessao.sinalRodando.minutoVerificacao && sec >= 4 && sec <= 12) {
                await conferirResultado(stateGlobais);
            }
        } else if (estadoSessao.permitirSinais) {
            // Caça ativa: Varre o mercado O TEMPO TODO em busca do toque!
            await cacarOportunidade(stateGlobais);
        }
    }, 5000); 
}

async function cacarOportunidade(state) {
    const minAtual = new Date().getMinutes();
    
    for (let sym of ativosMercadoReal) {
        try {
            // Se já mandou sinal neste minuto, salta
            if (estadoSessao.ultimoSinalEnviado === `${sym}_${minAtual}`) continue;

            const assertividade = await calcularAssertividadeM1(sym, state);
            if (assertividade < 90) continue; 

            const velas = await puxarVelasM1(sym, state);
            if (!velas || velas.length < 150) continue;

            // 🎯 LÓGICA DE SNIPER (M1): Passamos a vela viva!
            const closes = velas.map(k => parseFloat(k[4]));
            const strategy = state.strategiesDB.find(s => s.name.toLowerCase().includes('live')) || state.strategiesDB[0];
            
            // Avalia o último tick (o toque na banda)
            const sinal = evaluateStrategy(closes, strategy);

            if (sinal) {
                estadoSessao.ultimoSinalEnviado = `${sym}_${minAtual}`;
                atirarSinalNoToque(sym, sinal);
                break; 
            }
        } catch (e) {}
    }
}

// 🚀 DISPARO IMEDIATO "ALERTA DE TOQUE"
function atirarSinalNoToque(sym, tipo) {
    const agora = new Date();
    
    // A entrada será sempre na virada do próximo minuto
    const dataEntrada = new Date(agora);
    dataEntrada.setMinutes(dataEntrada.getMinutes() + 1);
    dataEntrada.setSeconds(0);
    
    const dataGale = new Date(dataEntrada);
    dataGale.setMinutes(dataEntrada.getMinutes() + 1); 

    const horaEntrada = dataEntrada.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    const horaGale = dataGale.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

    const acao = tipo === 'CALL' ? '🟩 Comprar' : '🟥 Vender';

    const msg = `⚡ *ALERTA DE TOQUE (M1)* ⚡\n\n💵 Moeda = ${sym}\n⏰ Expiração = 1 Minuto\n🛎 Entrada = ${horaEntrada}\n${acao}\n\nGale 1 - ${horaGale}\n\n👉🏼 Se necessário, fazer 1 Gale.\n\n➡️ [Clique aqui para abrir a Vellox](https://velloxbroker.com)`;
    
    bot.sendMessage(CHAT_ID, msg, { parse_mode: 'Markdown', disable_web_page_preview: true });

    estadoSessao.sinalRodando = { 
        symbol: sym, 
        type: tipo, 
        step: 0, 
        minutoEntrada: dataEntrada.getMinutes(),
        minutoVerificacao: (dataEntrada.getMinutes() + 1) % 60
    };
}

async function conferirResultado(state) {
    const operacao = estadoSessao.sinalRodando;
    const agora = new Date();
    
    // Puxamos os dados da API
    const velas = await puxarVelasM1(operacao.symbol, state);
    if (!velas) return;

    // A última vela finalizada é a penúltima do array (a última está a nascer agora)
    const ultimaVelaFechada = velas[velas.length - 2];
    
    const open = parseFloat(ultimaVelaFechada[1]);
    const close = parseFloat(ultimaVelaFechada[4]);

    const isGreen = close > open;
    const isRed = close < open;
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
            bot.sendMessage(CHAT_ID, `🔄 *ENTRAR NO GALE ${operacao.step}* em ${operacao.symbol}!\nMesma direção.`, { parse_mode: 'Markdown' });
            // Agenda para verificar no próximo minuto
            operacao.minutoVerificacao = (agora.getMinutes() + 1) % 60;
        }
    }
}

function verificarMeta() {
    let encerrar = false; let msgFinal = "";
    if (estadoSessao.wins === 2 && estadoSessao.losses === 0) { encerrar = true; msgFinal = "🏆 *META BATIDA! (2x0)*\nFechamos a sessão!"; }
    else if (estadoSessao.wins === 3 && estadoSessao.losses === 1) { encerrar = true; msgFinal = "🏆 *META BATIDA NA RAÇA! (3x1)*\nSessão encerrada!"; }
    else if (estadoSessao.losses === 2) { encerrar = true; msgFinal = "🛑 *STOP LOSS ATINGIDO (2 Loss)*\nPreservando o capital."; }

    if (encerrar) {
        estadoSessao.ativa = false;
        bot.sendMessage(CHAT_ID, msgFinal, { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(CHAT_ID, `📊 *Placar Parcial:* ${estadoSessao.wins} Win x ${estadoSessao.losses} Loss`, { parse_mode: 'Markdown' });
    }
}

// ==========================================
// FUNÇÕES DE DADOS PARA M1 (VELAS COMPLETAS)
// ==========================================
async function puxarVelasM1(symbol, state) {
    try {
        const isCrypto = ['BTCUSDT', 'ETHUSDT', 'LTCUSDT', 'ADAUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'].includes(symbol.toUpperCase());
        if (isCrypto) {
            const res = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=150`);
            if (!res.data) return null;
            return res.data; 
        } else {
            if(!state.globalDynamicCookie) return null;
            const to = Math.floor(Date.now() / 1000); const from = to - (150 * 60); 
            const otcHeaders = { 'accept': '*/*', 'Cookie': state.globalDynamicCookie, 'X-Requested-With': 'XMLHttpRequest', 'referer': 'https://velloxbroker.com/traderoom', 'user-agent': 'Mozilla/5.0' };
            const res = await axios.get(`https://velloxbroker.com/publicapi/tradingview/udf-history?symbol=${symbol.toUpperCase()}&resolution=1&from=${from}&to=${to}&countback=150&site=velloxbroker.com`, { headers: otcHeaders });
            if (res.data && res.data.s === 'ok') {
                let klines = [];
                for(let i=0; i<res.data.c.length; i++){
                    // Fake Kline: [Time, Open, High, Low, Close]
                    klines.push([res.data.t[i]*1000, res.data.o[i], 0, 0, res.data.c[i]]);
                }
                return klines;
            }
            return null;
        }
    } catch (e) { return null; }
}

async function calcularAssertividadeM1(symbol, state) {
    try {
        const velas = await puxarVelasM1(symbol, state);
        if (!velas || velas.length < 150) return 0;

        let wins = 0; let totalSinais = 0;
        const strategy = state.strategiesDB.find(s => s.name.toLowerCase().includes('live')) || state.strategiesDB[0];
        
        for (let i = 100; i < velas.length - 3; i++) {
            const histCloses = velas.slice(0, i).map(k => parseFloat(k[4])); 
            const sig = evaluateStrategy(histCloses, strategy);
            
            if (sig) {
                totalSinais++;
                const o0 = parseFloat(velas[i][1]); const c0 = parseFloat(velas[i][4]);
                const o1 = parseFloat(velas[i+1][1]); const c1 = parseFloat(velas[i+1][4]);
                const o2 = parseFloat(velas[i+2][1]); const c2 = parseFloat(velas[i+2][4]);

                const win0 = (sig === 'CALL' && c0 > o0) || (sig === 'PUT' && c0 < o0);
                const win1 = (sig === 'CALL' && c1 > o1) || (sig === 'PUT' && c1 < o1);
                const win2 = (sig === 'CALL' && c2 > o2) || (sig === 'PUT' && c2 < o2);
                
                if (win0 || win1 || win2) wins++;
            }
        }
        return totalSinais > 0 ? (wins / totalSinais) * 100 : 0;
    } catch (e) { return 0; }
}

module.exports = { initTelegramBot, reloadTelegramConfig, forcarSessaoTelegram };