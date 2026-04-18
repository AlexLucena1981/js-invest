const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const axios = require('axios');
const { evaluateStrategy } = require('../utils/indicators');

const TOKEN = '8627851942:AAFn2Ze3Nbjb6LbNu7Gk3eEAcpDuzzKGGkM';
const CHAT_ID = '-1003925714362';
const bot = new TelegramBot(TOKEN, { polling: false });

// 📚 O DICIONÁRIO DE NOMES AMIGÁVEIS (Aliases)
const dicionarioAtivos = {
    'EURUSDOTC': 'EUR/USD (OTC)', 'AUDJPYOTC': 'AUD/JPY (OTC)', 'EURJPYOTC': 'EUR/JPY (OTC)', 
    'EURAUDOTC': 'EUR/AUD (OTC)', 'AUDCHFOTC': 'AUD/CHF (OTC)', 'GBPJPYOTC': 'GBP/JPY (OTC)', 
    'CADCHFOTC': 'CAD/CHF (OTC)', 'EURNZDOTC': 'EUR/NZD (OTC)', 'GBPAUDOTC': 'GBP/AUD (OTC)', 
    'NZDJPYOTC': 'NZD/JPY (OTC)', 'GBPCHFOTC': 'GBP/CHF (OTC)', 'USDCHFOTC': 'USD/CHF (OTC)', 
    'EURCADOTC': 'EUR/CAD (OTC)', 'EURCHFOTC': 'EUR/CHF (OTC)', 'BTCUSDTOTC': 'Bitcoin (OTC)', 
    'ETHUSDTOTC': 'Ethereum (OTC)', 'LTCUSDTOTC': 'Litecoin (OTC)', 'ADAUSDTOTC': 'Cardano (OTC)', 
    'BNBUSDTOTC': 'Binance Coin (OTC)', 'SOLUSDTOTC': 'Solana (OTC)', 'DOGEUSDTOTC': 'Dogecoin (OTC)',
    'AAPLOTC': 'Apple (OTC)', 'NFLXOTC': 'Netflix (OTC)', 'METAOTC': 'Meta (OTC)', 'TSLAOTC': 'Tesla (OTC)', 
    'MSFTOTC': 'Microsoft (OTC)', 'PYPLOTC': 'PayPal (OTC)', 'AMZNOTC': 'Amazon (OTC)', 
    'NVDAOTC': 'NVIDIA (OTC)', 'SBUXOTC': 'Starbucks (OTC)', 'DISOTC': 'Disney (OTC)', 
    'MAOTC': 'Mastercard (OTC)', 'IBMOTC': 'IBM (OTC)', 'KOOTC': 'Coca-Cola (OTC)', 
    'FOTC': 'Ford (OTC)', 'SPOTOTC': 'Spotify (OTC)', 'NKEOTC': 'Nike (OTC)', 'INTCOTC': 'Intel (OTC)', 
    'VOTC': 'Visa (OTC)', 'XAUUSDOTC': 'Ouro (OTC)',
    // Mercado Real
    'BTCUSDT': 'Bitcoin', 'ETHUSDT': 'Ethereum', 'LTCUSDT': 'Litecoin', 'ADAUSDT': 'Cardano'
};

const ativosTestes = Object.keys(dicionarioAtivos); // O robô vai caçar todos os ativos do dicionário

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
    console.log("🤖 General Telegram: MODO STRESS TEST M1 (C/ Aliases Amigáveis) 🚀");
    configLocal = configFirebase;
    agendarSessoes(stateGlobais);
    iniciarMotorContinuo(stateGlobais);
}

function reloadTelegramConfig(novaConfig) {
    console.log("⚙️ Recarregando Textos e Configurações via Painel Admin...");
    configLocal = novaConfig;
    agendarSessoes(); 
}

function agendarSessoes() {
    activeCronJobs.forEach(job => job.stop());
    activeCronJobs = [];

    const dias = configLocal.dias || '0-6'; 

    const cronManhaStart = parseTimeToCron(configLocal.horaManha || '09:00', 0, dias);
    const cronTardeStart = parseTimeToCron(configLocal.horaTarde || '15:00', 0, dias);

    const job1 = cron.schedule(cronManhaStart, () => iniciarSessao("Manhã"), { timezone: "America/Sao_Paulo" });
    const job2 = cron.schedule(cronTardeStart, () => iniciarSessao("Tarde"), { timezone: "America/Sao_Paulo" });

    activeCronJobs.push(job1, job2);
}

function forcarSessaoTelegram(turno) {
    iniciarSessao(turno);
}

function iniciarSessao(turno) {
    estadoSessao = { ativa: true, permitirSinais: true, wins: estadoSessao.wins, losses: estadoSessao.losses, sinalRodando: null, ultimoSinalEnviado: null };
    let msg = configLocal.msgDespertar || `👨‍💻 *INÍCIO DE SESSÃO*`;
    bot.sendMessage(CHAT_ID, msg, { parse_mode: 'Markdown' });
}

function iniciarMotorContinuo(stateGlobais) {
    if (motorCacaId) clearInterval(motorCacaId);

    motorCacaId = setInterval(async () => {
        if (!estadoSessao.ativa) return;
        const agora = new Date(); 
        const min = agora.getMinutes(); 
        const sec = agora.getSeconds();

        if (estadoSessao.sinalRodando) {
            if (min === estadoSessao.sinalRodando.minutoVerificacao && sec >= 4 && sec <= 12) {
                await conferirResultado(stateGlobais);
            }
        } else if (estadoSessao.permitirSinais) {
            await cacarOportunidade(stateGlobais);
        }
    }, 5000); 
}

async function cacarOportunidade(state) {
    const minAtual = new Date().getMinutes();
    
    for (let sym of ativosTestes) {
        try {
            if (estadoSessao.ultimoSinalEnviado === `${sym}_${minAtual}`) continue;

            const assertividade = await calcularAssertividadeM1(sym, state);
            if (assertividade < 85) continue; 

            const velas = await puxarVelasM1(sym, state);
            if (!velas || velas.length < 150) continue;

            const closes = velas.map(k => parseFloat(k[4]));
            const strategy = state.strategiesDB.find(s => s.name.toLowerCase().includes('live')) || state.strategiesDB[0];
            
            const sinal = evaluateStrategy(closes, strategy);

            if (sinal) {
                estadoSessao.ultimoSinalEnviado = `${sym}_${minAtual}`;
                atirarSinalNoToque(sym, sinal);
                break; 
            }
        } catch (e) {}
    }
}

// 🎯 TRADUTOR DE VARIÁVEIS MÁGICAS
function formatarMensagem(template, dados) {
    if (!template) return "";
    return template
        .replace(/{MOEDA}/g, dados.moeda || "")
        .replace(/{DIRECAO}/g, dados.direcao || "")
        .replace(/{HORA_ENTRADA}/g, dados.horaEntrada || "")
        .replace(/{HORA_GALE}/g, dados.horaGale || "")
        .replace(/\\n/g, "\n"); 
}

function atirarSinalNoToque(sym, tipo) {
    const agora = new Date();
    const dataEntrada = new Date(agora);
    dataEntrada.setMinutes(dataEntrada.getMinutes() + 1);
    dataEntrada.setSeconds(0);
    
    const dataGale = new Date(dataEntrada);
    dataGale.setMinutes(dataEntrada.getMinutes() + 1); 

    const horaEntrada = dataEntrada.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    const horaGale = dataGale.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

    const acao = tipo === 'CALL' ? '🟩 Comprar' : '🟥 Vender';
    
    // 🎯 BUSCA O NOME AMIGÁVEL DO DICIONÁRIO (Alias)
    const nomeAmigavel = dicionarioAtivos[sym] || sym;

    const templateOriginal = configLocal.msgSinal || "⚡ *ALERTA DE TOQUE (OTC/M1)* ⚡\\n\\n💵 Moeda = {MOEDA}\\n⏰ Expiração = 1 Minuto\\n🛎 Entrada = {HORA_ENTRADA}\\n{DIRECAO}\\n\\nGale 1 - {HORA_GALE}\\n\\n👉🏼 Se necessário, fazer 1 Gale.\\n\\n➡️ [Clique aqui para abrir a Vellox](https://velloxbroker.com)";

    const msg = formatarMensagem(templateOriginal, {
        moeda: nomeAmigavel, // Passa o nome bonito (ex: Tesla (OTC))
        direcao: acao,
        horaEntrada: horaEntrada,
        horaGale: horaGale
    });
    
    bot.sendMessage(CHAT_ID, msg, { parse_mode: 'Markdown', disable_web_page_preview: true });

    estadoSessao.sinalRodando = { 
        symbol: sym, type: tipo, step: 0, 
        minutoEntrada: dataEntrada.getMinutes(),
        minutoVerificacao: (dataEntrada.getMinutes() + 1) % 60
    };
}

function enviarPreAlerta(symbol, tipo) {
    const acao = tipo === 'CALL' ? '🟩 Comprar' : '🟥 Vender';
    const nomeAmigavel = dicionarioAtivos[symbol] || symbol;
    const templateOriginal = configLocal.msgPre || "⚠️ *PRÉ-ALERTA DE SINAL*\\n\\nPreparem o ativo: *{MOEDA}*\\nPossível Operação: *{DIRECAO}*";
    const msg = formatarMensagem(templateOriginal, { moeda: nomeAmigavel, direcao: acao });
    bot.sendMessage(CHAT_ID, msg, { parse_mode: 'Markdown' });
}

async function conferirResultado(state) {
    const operacao = estadoSessao.sinalRodando;
    const agora = new Date();
    
    const velas = await puxarVelasM1(operacao.symbol, state);
    if (!velas) return;

    const ultimaVelaFechada = velas[velas.length - 2];
    const open = parseFloat(ultimaVelaFechada[1]);
    const close = parseFloat(ultimaVelaFechada[4]);

    const isGreen = close > open;
    const isRed = close < open;
    const won = (operacao.type === 'CALL' && isGreen) || (operacao.type === 'PUT' && isRed);

    const nomeAmigavel = dicionarioAtivos[operacao.symbol] || operacao.symbol;

    if (won) {
        let msgWin = operacao.step === 0 ? (configLocal.msgWin || "✅ *WIN DE PRIMEIRA!* 🎯") : "✅ *WIN NO GALE 1!* 🎯";
        bot.sendMessage(CHAT_ID, `${msgWin}\nAtivo: ${nomeAmigavel}`, { parse_mode: 'Markdown' });
        estadoSessao.wins++; estadoSessao.sinalRodando = null; anunciarPlacar(); 
    } else {
        operacao.step++;
        if (operacao.step > 1) {
            let msgLoss = configLocal.msgLoss || `🔴 *LOSS!* O mercado não respeitou a análise.`;
            bot.sendMessage(CHAT_ID, `${msgLoss}\nAtivo: ${nomeAmigavel}`, { parse_mode: 'Markdown' });
            estadoSessao.losses++; estadoSessao.sinalRodando = null; anunciarPlacar(); 
        } else {
            bot.sendMessage(CHAT_ID, `🔄 *ENTRAR NO GALE ${operacao.step}* em ${nomeAmigavel}!\nMesma direção.`, { parse_mode: 'Markdown' });
            operacao.minutoVerificacao = (agora.getMinutes() + 1) % 60;
        }
    }
}

function anunciarPlacar() {
    bot.sendMessage(CHAT_ID, `📊 *Placar AO VIVO (Teste M1):* ${estadoSessao.wins} Win x ${estadoSessao.losses} Loss\nO radar continua operando...`, { parse_mode: 'Markdown' });
}

async function puxarVelasM1(symbol, state) {
    try {
        const symUpper = symbol.toUpperCase();
        const isCrypto = ['BTCUSDT', 'ETHUSDT', 'LTCUSDT', 'ADAUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'].includes(symUpper);
        
        if (isCrypto) {
            const res = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${symUpper}&interval=1m&limit=150`);
            if (!res.data) return null;
            return res.data; 
        } else {
            if(!state.globalDynamicCookie) return null;
            
            const to = Math.floor(Date.now() / 1000); 
            const from = to - (150 * 60); 
            const otcHeaders = { 'accept': '*/*', 'Cookie': state.globalDynamicCookie, 'X-Requested-With': 'XMLHttpRequest', 'referer': 'https://velloxbroker.com/traderoom', 'user-agent': 'Mozilla/5.0' };
            
            const baseName = symUpper.replace('OTC', '').replace('-', '').replace('_', ''); 
            const variacoes = [
                `${baseName}OTC`,       
                `${baseName}-OTC`,      
                `${baseName}_otc`,      
                `${baseName}_OTC`,      
                `${baseName.substring(0,3)}/${baseName.substring(3)} (OTC)` 
            ];

            let klines = null;

            for (let variante of variacoes) {
                try {
                    let res = await axios.get(`https://velloxbroker.com/publicapi/tradingview/udf-history?symbol=${variante}&resolution=1&from=${from}&to=${to}&countback=150&site=velloxbroker.com`, { headers: otcHeaders });
                    
                    if (res.data && res.data.s === 'ok' && res.data.c && res.data.c.length > 0) {
                        klines = [];
                        for(let i=0; i<res.data.c.length; i++){
                            klines.push([res.data.t[i]*1000, res.data.o[i], res.data.h ? res.data.h[i] : res.data.o[i], res.data.l ? res.data.l[i] : res.data.c[i], res.data.c[i]]);
                        }
                        break; 
                    }
                } catch(e) {}
            }

            return klines;
        }
    } catch (e) { 
        return null; 
    }
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