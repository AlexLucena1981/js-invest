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

let estadoSessao = {
    ativa: false,          // Fica true às 09h e 15h
    permitirSinais: false, // Fica true às 09h25 e 15h25
    wins: 0,
    losses: 0,
    preAlerta: null,       // Guarda o sinal que está quase a confirmar
    sinalRodando: null     // Guarda a operação ativa (para ver os Gales)
};

async function initTelegramBot(stateGlobais) {
    console.log("🤖 General do Telegram a postos para o mercado real!");

    // 💥 GATILHO DE TESTE MANUAL (Avisa que o servidor ligou)
    bot.sendMessage(CHAT_ID, "🚀 *SISTEMA ONLINE:* O General do JS Invest acaba de assumir o comando da sala! Preparem-se para os lucros.", { parse_mode: 'Markdown' })
        .then(() => console.log("✅ Mensagem de teste Telegram enviada!"))
        .catch(err => console.error("❌ ERRO TELEGRAM:", err.message));

    // ⏰ DESPERTADOR DA MANHÃ
    cron.schedule('0 9 * * 1-5', () => { iniciarSessao("Manhã"); }, { timezone: "America/Sao_Paulo" });
    cron.schedule('25 9 * * 1-5', () => { estadoSessao.permitirSinais = true; }, { timezone: "America/Sao_Paulo" });

    // ⏰ DESPERTADOR DA TARDE
    cron.schedule('0 15 * * 1-5', () => { iniciarSessao("Tarde"); }, { timezone: "America/Sao_Paulo" });
    cron.schedule('25 15 * * 1-5', () => { estadoSessao.permitirSinais = true; }, { timezone: "America/Sao_Paulo" });

    // ⏰ MOTOR DE CAÇA E VERIFICAÇÃO (Roda a cada 10 segundos)
    setInterval(async () => {
        if (!estadoSessao.ativa) return;

        const agora = new Date();
        const min = agora.getMinutes();
        const sec = agora.getSeconds();

        // 1️⃣ VERIFICAR RESULTADOS DA OPERAÇÃO ATIVA (Aos 10 seg após a vela fechar)
        if (estadoSessao.sinalRodando && min % 5 === 0 && sec >= 10 && sec <= 20) {
            await conferirResultado(stateGlobais);
        }

        // 2️⃣ CONFIRMAR ENTRADA DO PRÉ-ALERTA (Aos 10 seg após a vela fechar)
        if (estadoSessao.permitirSinais && !estadoSessao.sinalRodando && estadoSessao.preAlerta && min % 5 === 0 && sec >= 10 && sec <= 20) {
            await confirmarEEnviarSinal(stateGlobais);
        }

        // 3️⃣ CAÇAR OPORTUNIDADES (Aos 45 seg do minuto 4, 9, 14... = 15 seg antes da vela fechar)
        if (estadoSessao.permitirSinais && !estadoSessao.sinalRodando && !estadoSessao.preAlerta && min % 5 === 4 && sec >= 45 && sec <= 55) {
            await cacarOportunidade(stateGlobais);
        }

    }, 10000); 
}

function iniciarSessao(turno) {
    estadoSessao = { ativa: true, permitirSinais: false, wins: 0, losses: 0, preAlerta: null, sinalRodando: null };
    bot.sendMessage(CHAT_ID, `👨‍💻 *O robô despertou!* (Sessão da ${turno})\n\nIniciando leitura dos gráficos de M5 e cálculo de assertividade (>95%).\nOs sinais começarão às ${turno === 'Manhã' ? '09:30' : '15:30'}.`, { parse_mode: 'Markdown' });
}

async function cacarOportunidade(state) {
    for (let sym of ativosMercadoReal) {
        try {
            // 1. FILTRO DE ELITE: Assertividade > 95% nas últimas 150 velas
            const assertividade = await calcularAssertividadeM5(sym, state);
            if (assertividade < 95) continue; 

            // 2. LÊ O GATILHO AGORA
            const closes = await puxarFechamentosM5(sym, state);
            if (!closes || closes.length < 150) continue;

            const strategy = state.strategiesDB.find(s => s.name.toLowerCase().includes('live')) || state.strategiesDB[0];
            const sinal = evaluateStrategy(closes, strategy);

            if (sinal) {
                estadoSessao.preAlerta = { symbol: sym, type: sinal };
                enviarPreAlerta(sym, sinal, assertividade);
                break; // Achou um, para de procurar para não confundir o grupo
            }
        } catch (e) {}
    }
}

async function confirmarEEnviarSinal(state) {
    const sym = estadoSessao.preAlerta.symbol;
    const closes = await puxarFechamentosM5(sym, state);
    if (!closes) { estadoSessao.preAlerta = null; return; }

    const strategy = state.strategiesDB.find(s => s.name.toLowerCase().includes('live')) || state.strategiesDB[0];
    const sinalConfirmado = evaluateStrategy(closes, strategy);

    if (sinalConfirmado && sinalConfirmado === estadoSessao.preAlerta.type) {
        // Sinal Validado! Envia pro grupo
        dispararSinal(sym, sinalConfirmado);
        estadoSessao.sinalRodando = { symbol: sym, type: sinalConfirmado, step: 0, entryPrice: closes[closes.length - 1] };
    } else {
        bot.sendMessage(CHAT_ID, `⚠️ *SINAL ABORTADO!*\n\nO mercado recuou no último segundo em ${sym}. Protegendo o capital. Aguardem a próxima oportunidade!`, { parse_mode: 'Markdown' });
    }
    estadoSessao.preAlerta = null; 
}

async function conferirResultado(state) {
    const operacao = estadoSessao.sinalRodando;
    const closes = await puxarFechamentosM5(operacao.symbol, state);
    if (!closes) return;

    const precoFechamento = closes[closes.length - 1]; // Preço que a vela acabou de fechar
    const isGreen = precoFechamento > operacao.entryPrice;
    const isRed = precoFechamento < operacao.entryPrice;
    const won = (operacao.type === 'CALL' && isGreen) || (operacao.type === 'PUT' && isRed);

    if (won) {
        let msgWin = operacao.step === 0 ? "✅ *WIN DE PRIMEIRA!* 🎯" : (operacao.step === 1 ? "✅ *WIN NO GALE 1!* 🎯" : "✅ *WIN NO GALE 2!* 🎯");
        bot.sendMessage(CHAT_ID, `${msgWin}\nAtivo: ${operacao.symbol}`, { parse_mode: 'Markdown' });
        estadoSessao.wins++;
        estadoSessao.sinalRodando = null;
        verificarMeta();
    } else {
        operacao.step++;
        if (operacao.step > 2) {
            bot.sendMessage(CHAT_ID, `🔴 *LOSS!* O mercado não respeitou a análise em ${operacao.symbol}.`, { parse_mode: 'Markdown' });
            estadoSessao.losses++;
            estadoSessao.sinalRodando = null;
            verificarMeta();
        } else {
            bot.sendMessage(CHAT_ID, `🔄 *PREPARAR GALE ${operacao.step}* em ${operacao.symbol}!\nMesma direção: ${operacao.type}`, { parse_mode: 'Markdown' });
            operacao.entryPrice = precoFechamento; // Atualiza o preço de entrada para o Gale
        }
    }
}

function verificarMeta() {
    let encerrar = false;
    let msgFinal = "";

    if (estadoSessao.wins === 2 && estadoSessao.losses === 0) { encerrar = true; msgFinal = "🏆 *META BATIDA! (2x0)*\nDia perfeito. Fechamos a sessão!"; }
    else if (estadoSessao.wins === 3 && estadoSessao.losses === 1) { encerrar = true; msgFinal = "🏆 *META BATIDA NA RAÇA! (3x1)*\nRecuperação concluída. Sessão encerrada!"; }
    else if (estadoSessao.losses === 2) { encerrar = true; msgFinal = "🛑 *STOP LOSS ATINGIDO (2 Loss)*\nPreservando o capital. Voltamos na próxima sessão."; }

    if (encerrar) {
        estadoSessao.ativa = false;
        bot.sendMessage(CHAT_ID, msgFinal, { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(CHAT_ID, `📊 *Placar Parcial:* ${estadoSessao.wins} Win x ${estadoSessao.losses} Loss\nO Radar continua a buscar a meta...`, { parse_mode: 'Markdown' });
    }
}

// ==========================================
// FUNÇÕES DE DADOS (HÍBRIDO BINANCE/VELLOX)
// ==========================================
async function puxarFechamentosM5(symbol, state) {
    try {
        const isCrypto = ['BTCUSDT', 'ETHUSDT', 'LTCUSDT', 'ADAUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'].includes(symbol.toUpperCase());
        if (isCrypto) {
            const res = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=5m&limit=151`);
            if (!res.data) return null;
            return res.data.slice(0, -1).map(k => parseFloat(k[4]));
        } else {
            if(!state.globalDynamicCookie) return null;
            const to = Math.floor(Date.now() / 1000); 
            const from = to - (151 * 5 * 60); 
            const otcHeaders = { 'accept': '*/*', 'Cookie': state.globalDynamicCookie, 'X-Requested-With': 'XMLHttpRequest', 'referer': 'https://velloxbroker.com/traderoom', 'user-agent': 'Mozilla/5.0' };
            const res = await axios.get(`https://velloxbroker.com/publicapi/tradingview/udf-history?symbol=${symbol.toUpperCase()}&resolution=5&from=${from}&to=${to}&countback=151&site=velloxbroker.com`, { headers: otcHeaders });
            if (res.data && res.data.s === 'ok') return res.data.c.slice(0, -1);
            return null;
        }
    } catch (e) { return null; }
}

async function calcularAssertividadeM5(symbol, state) {
    try {
        let closesArr = [];
        let opensArr = [];
        const isCrypto = ['BTCUSDT', 'ETHUSDT', 'LTCUSDT', 'ADAUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'].includes(symbol.toUpperCase());
        
        if (isCrypto) {
            const res = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=5m&limit=300`);
            if (!res.data) return 0;
            closesArr = res.data.map(k => parseFloat(k[4]));
            opensArr = res.data.map(k => parseFloat(k[1]));
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
            const histCloses = closesArr.slice(0, i);
            const sig = evaluateStrategy(histCloses, strategy);
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

function enviarPreAlerta(symbol, tipo, taxa) {
    const msg = `⚠️ *PRÉ-ALERTA DE ELITE (M5)*\n\n📊 *Assertividade do Ativo:* ${taxa.toFixed(1)}%\n\nFiquem de olho no ativo: *${symbol}*\nPossível Operação: *${tipo === 'CALL' ? '🟢 COMPRA' : '🔴 VENDA'}*\n\nPreparem-se para entrar no fechamento desta vela!`;
    bot.sendMessage(CHAT_ID, msg, { parse_mode: 'Markdown' });
}

function dispararSinal(symbol, tipo) {
    const msg = `🚀 *SINAL CONFIRMADO! ENTROU!*\n\nAtivo: *${symbol}*\nDireção: *${tipo === 'CALL' ? '🟢 COMPRA' : '🔴 VENDA'}*\nTempo: *5 Minutos (M5)*\n\n🎯 Protejam o capital, façam no máximo até Gale 2 se necessário.`;
    bot.sendMessage(CHAT_ID, msg, { parse_mode: 'Markdown' });
}

module.exports = { initTelegramBot };