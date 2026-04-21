const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const axios = require('axios');
const { db, admin } = require('../config/firebase'); 
const { evaluateStrategy } = require('../utils/indicators');

const TOKEN = '8627851942:AAFn2Ze3Nbjb6LbNu7Gk3eEAcpDuzzKGGkM';
const CHAT_ID = '-1003925714362';
const bot = new TelegramBot(TOKEN, { polling: false });

const dicionarioAtivos = {
    // 🟠 Criptomoedas (Binance)
    'BTCUSDT': 'Bitcoin', 'ETHUSDT': 'Ethereum', 'LTCUSDT': 'Litecoin', 
    'ADAUSDT': 'Cardano', 'BNBUSDT': 'Binance Coin', 'SOLUSDT': 'Solana', 
    'DOGEUSDT': 'Dogecoin', 'XRPUSDT': 'Ripple',
    
    // 🔵 Forex (Vellox)
    'EURUSD': 'EUR/USD', 'GBPUSD': 'GBP/USD', 'USDJPY': 'USD/JPY', 
    'AUDUSD': 'AUD/USD', 'USDCAD': 'USD/CAD',
    
    // 🟣 Ações (Vellox)
    'AAPL': 'Apple', 'TSLA': 'Tesla', 'MSFT': 'Microsoft', 
    'AMZN': 'Amazon', 'META': 'Meta', 'GOOGL': 'Google', 'NFLX': 'Netflix',
    
    // 🟡 Commodities (Vellox)
    'XAUUSD': 'Ouro', 'XAGUSD': 'Prata', 'USOIL': 'Petróleo',

    // 🔴 Mercado OTC
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
    'VOTC': 'Visa (OTC)', 'XAUUSDOTC': 'Ouro (OTC)'
};

// 🔥 FILTRO SNIPER: Se tem 'OTC' no nome, o robô ignora sumariamente!
const ativosTestes = Object.keys(dicionarioAtivos).filter(sym => !sym.includes('OTC')); 

// 🎯 lastGaleMsgId atua como lixeiro para manter o chat limpo
let estadoSessao = { ativa: false, permitirSinais: false, wins: 0, losses: 0, sinalRodando: null, ultimoSinalEnviado: null, lastGaleMsgId: null };
let activeCronJobs = [];
let configLocal = {};
let motorCacaId = null;
let isProcessing = false; 
const activeOtcSuffixes = {};

let ultimaMensagemSessao = 0; 

function getAgoraSP() {
    return new Date(new Date().toLocaleString("en-US", {timeZone: "America/Sao_Paulo"}));
}

function getSPDateString() {
    const d = getAgoraSP();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseTimeToCron(timeStr, addMinutes, dias) {
    let [h, m] = (timeStr || "00:00").split(':').map(Number);
    let totalMin = (h * 60) + m + addMinutes;
    let finalH = Math.floor(totalMin / 60) % 24;
    let finalM = totalMin % 60;
    return `${finalM} ${finalH} * * ${dias}`;
}

async function enviarSticker(stickerId) {
    if (!stickerId) return null;
    try {
        const msg = await bot.sendSticker(CHAT_ID, stickerId);
        return msg.message_id;
    } catch (e) {
        console.error("Erro ao enviar sticker (ID inválido?):", e.message);
        return null;
    }
}

async function salvarResultadoNoFirebase(dados) {
    try {
        const dataDoc = getSPDateString(); 
        
        await db.collection('historico_sinais').add({
            ativo: dados.ativo,
            direcao: dados.direcao,
            horaEntrada: dados.horaEntrada,
            horaGale: dados.horaGale || 'N/A',
            resultado: dados.resultado, 
            galeUsado: dados.galeUsado, 
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            dataRef: dataDoc
        });
        
        console.log(`✅ [DB FIREBASE] Sinal de ${dados.ativo} (${dados.resultado}) gravado em ${dataDoc}!`);
    } catch (e) { console.error("Erro ao salvar histórico:", e); }
}

async function enviarRelatorioDiario() {
    try {
        const dataDoc = getSPDateString();
        const snapshot = await db.collection('historico_sinais').where('dataRef', '==', dataDoc).get();
        
        if (snapshot.empty) return;

        let total = 0, wins = 0, losses = 0;
        let ranking = {};

        let sinaisHoje = [];
        snapshot.forEach(doc => sinaisHoje.push(doc.data()));
        sinaisHoje.sort((a, b) => b.timestamp - a.timestamp);
        
        const metaSinais = parseInt(configLocal.maxSinais) || 2;
        const sinaisDestaSessao = sinaisHoje.slice(0, metaSinais);

        sinaisDestaSessao.forEach(d => {
            total++;
            if (d.resultado === 'WIN') wins++; else losses++;
            if (!ranking[d.ativo]) ranking[d.ativo] = { w: 0, l: 0 };
            if (d.resultado === 'WIN') ranking[d.ativo].w++; else ranking[d.ativo].l++;
        });

        const assertividade = total > 0 ? ((wins / total) * 100).toFixed(1) : 0;
        const agora = getAgoraSP();
        
        let msg = `🏁 *RELATÓRIO DE SESSÃO* 🏁\n`;
        msg += `📅 Data: ${agora.toLocaleDateString('pt-BR')}\n\n`;
        msg += `✅ Total Wins: *${wins}*\n`;
        msg += `🔴 Total Loss: *${losses}*\n`;
        msg += `🎯 Assertividade: *${assertividade}%*\n\n`;
        msg += `🏆 *RESUMO DOS ATIVOS:* \n`;

        const sortedRanking = Object.entries(ranking).sort((a, b) => b[1].w - a[1].w);
        sortedRanking.forEach(([ativo, score]) => {
            msg += `• ${ativo}: ${score.w}W - ${score.l}L\n`;
        });

        msg += `\n🚀 *Missão cumprida! Sniper recarregando...*`;
        
        bot.sendMessage(CHAT_ID, msg, { parse_mode: 'Markdown' });
    } catch (e) { console.error("Erro relatório:", e); }
}

async function initTelegramBot(stateGlobais, configFirebase) {
    console.log("🤖 Telegram: MODO STICKERS ATIVADO (Gale 1 Limpo) 🚀");
    configLocal = configFirebase;
    agendarSessoes(stateGlobais);
    iniciarMotorContinuo(stateGlobais);
}

function reloadTelegramConfig(novaConfig) {
    configLocal = novaConfig;
    agendarSessoes(); 
}

function agendarSessoes() {
    activeCronJobs.forEach(job => job.stop());
    activeCronJobs = [];

    const dias = configLocal.dias || '1-5'; 
    const cronManhaStart = parseTimeToCron(configLocal.horaManha || '09:30', 0, dias);
    const cronTardeStart = parseTimeToCron(configLocal.horaTarde || '15:30', 0, dias);

    activeCronJobs.push(cron.schedule(cronManhaStart, () => iniciarSessao("Manhã"), { timezone: "America/Sao_Paulo" }));
    activeCronJobs.push(cron.schedule(cronTardeStart, () => iniciarSessao("Tarde"), { timezone: "America/Sao_Paulo" }));
}

function forcarSessaoTelegram(turno) {
    iniciarSessao(turno);
}

async function iniciarSessao(turno) {
    const agoraMs = Date.now();
    if (agoraMs - ultimaMensagemSessao < 10000) return; 
    ultimaMensagemSessao = agoraMs;

    estadoSessao.ativa = true;
    estadoSessao.permitirSinais = true;
    estadoSessao.wins = 0;
    estadoSessao.losses = 0;
    estadoSessao.sinalRodando = null;
    estadoSessao.lastGaleMsgId = null;

    if (configLocal.stkStart) {
        await enviarSticker(configLocal.stkStart);
    } else {
        bot.sendMessage(CHAT_ID, `👨‍💻 *INÍCIO DE SESSÃO: MERCADO ABERTO*`, { parse_mode: 'Markdown' });
    }
}

function iniciarMotorContinuo(stateGlobais) {
    if (motorCacaId) clearInterval(motorCacaId);

    motorCacaId = setInterval(async () => {
        if (!estadoSessao.ativa || isProcessing) return; 
        isProcessing = true;

        try {
            const agora = getAgoraSP(); 
            const min = agora.getMinutes(); 
            const sec = agora.getSeconds();

            if (estadoSessao.sinalRodando) {
                const op = estadoSessao.sinalRodando;
                
                if (min === op.minutoVerificacao && sec >= 4 && sec <= 45) {
                    if (!op.verificando) {
                        op.verificando = true;
                        await conferirResultado(stateGlobais);
                    }
                }
                
                const minsPassados = (min - op.minutoVerificacao + 60) % 60;
                if (minsPassados >= 2 && minsPassados < 50) {
                    bot.sendMessage(CHAT_ID, `⚠️ *Aviso:* A corretora atrasou os dados finais de ${op.nomeAmigavel}. Cancelando análise.`, { parse_mode: 'Markdown' });
                    estadoSessao.sinalRodando = null;
                    verificarFimDeSessao(); 
                }
                
            } else if (estadoSessao.permitirSinais) {
                await cacarOportunidade(stateGlobais);
            }
        } catch (e) {
            console.error("Erro no motor contínuo:", e);
        } finally {
            isProcessing = false; 
        }
    }, 3000); 
}

async function cacarOportunidade(state) {
    if (!state.strategiesDB || state.strategiesDB.length === 0) return;

    const agora = getAgoraSP();
    const minAtual = agora.getMinutes();
    const strategy = state.strategiesDB.find(s => s && s.name && s.name.toLowerCase().includes('live')) || state.strategiesDB[0];
    if (!strategy) return; 
    
    for (let sym of ativosTestes) {
        if (estadoSessao.sinalRodando) break; 

        try {
            if (estadoSessao.ultimoSinalEnviado === `${sym}_${minAtual}`) continue;

            const velas = await puxarVelasM1(sym, state);
            if (!velas || velas.length < 400) {
                await sleep(200); 
                continue;
            }
            
            const closes = velas.map(k => parseFloat(k[4]));
            const sinal = evaluateStrategy(closes, strategy);

            if (sinal) {
                estadoSessao.ultimoSinalEnviado = `${sym}_${minAtual}`;
                const nomeAmigavel = dicionarioAtivos[sym] || sym;
                
                const minEntrada = (minAtual + 1) % 60;
                const minVerificacao = (minAtual + 2) % 60;

                const horas = atirarSinalDefinitivo(sym, sinal, nomeAmigavel, minEntrada);
                
                estadoSessao.sinalRodando = { 
                    symbol: sym, 
                    type: sinal, 
                    step: 0, 
                    minutoEntrada: minEntrada,
                    minutoVerificacao: minVerificacao,
                    nomeAmigavel: nomeAmigavel,
                    horaEntradaStr: horas.horaEntrada,
                    horaGaleStr: horas.horaGale,
                    verificando: false
                };
                break; 
            }
            await sleep(200); 
        } catch (e) {}
    }
}

function formatarMensagem(template, dados) {
    if (!template) return "";
    return template
        .replace(/{MOEDA}/g, dados.moeda || "")
        .replace(/{DIRECAO}/g, dados.direcao || "")
        .replace(/{HORA_ENTRADA}/g, dados.horaEntrada || "")
        .replace(/{HORA_GALE}/g, dados.horaGale || "")
        .replace(/\\n/g, "\n"); 
}

function atirarSinalDefinitivo(sym, tipo, nomeAmigavel, minutoEntrada) {
    const agora = getAgoraSP();
    let hora = agora.getHours();
    
    if (agora.getMinutes() === 59 && minutoEntrada === 0) hora = (hora + 1) % 24;

    let minGale = (minutoEntrada + 1) % 60;
    let hrGale = hora;
    if (minutoEntrada === 59) hrGale = (hora + 1) % 24;

    const strHora = hora.toString().padStart(2, '0');
    const strMin = minutoEntrada.toString().padStart(2, '0');
    const strGaleHr = hrGale.toString().padStart(2, '0');
    const strGaleMin = minGale.toString().padStart(2, '0');

    const horaEntrada = `${strHora}:${strMin}`;
    const horaGale = `${strGaleHr}:${strGaleMin}`;

    const acao = tipo === 'CALL' ? '🟩 Comprar' : '🟥 Vender';
    
    const templateOriginal = configLocal.msgSinal || "⚡ *ALERTA DE TOQUE (M1)* ⚡\n\n💵 Moeda = {MOEDA}\n⏰ Expiração = 1 Minuto\n🛎 Entrada = {HORA_ENTRADA}\n{DIRECAO}\n\nGale 1 - {HORA_GALE}\n\n👉🏼 Se necessário, fazer 1 Gale.\n\n➡️ [Clique aqui para abrir a Vellox](https://velloxbroker.com)";

    const msg = formatarMensagem(templateOriginal, { moeda: nomeAmigavel, direcao: acao, horaEntrada: horaEntrada, horaGale: horaGale });
    bot.sendMessage(CHAT_ID, msg, { parse_mode: 'Markdown', disable_web_page_preview: true });

    return { horaEntrada, horaGale };
}

async function verificarFimDeSessao() {
    const totalSinais = estadoSessao.wins + estadoSessao.losses;
    const metaSinais = parseInt(configLocal.maxSinais) || 2;
    
    if (totalSinais >= metaSinais) {
        estadoSessao.ativa = false;
        estadoSessao.permitirSinais = false;
        
        if (configLocal.stkEnd) {
            await enviarSticker(configLocal.stkEnd);
        } else {
            bot.sendMessage(CHAT_ID, `🔒 *META ATINGIDA!* Encerrando sessão...`, { parse_mode: 'Markdown' });
        }
        
        setTimeout(() => {
            enviarRelatorioDiario();
        }, 3000);
    }
}

async function conferirResultado(state) {
    const operacao = estadoSessao.sinalRodando;
    const agora = getAgoraSP();
    
    const velas = await puxarVelasM1(operacao.symbol, state);
    
    if (!velas || velas.length < 2) {
        operacao.verificando = false; 
        return; 
    }

    const ultimaVelaFechada = velas[velas.length - 2];
    const open = parseFloat(ultimaVelaFechada[1]);
    const close = parseFloat(ultimaVelaFechada[4]);

    const isGreen = close > open;
    const isRed = close < open;
    const won = (operacao.type === 'CALL' && isGreen) || (operacao.type === 'PUT' && isRed);

    if (won) {
        // 🔥 Limpa a mensagem TEXTO do Gale 1 (se existir)
        if (estadoSessao.lastGaleMsgId) {
            try { await bot.deleteMessage(CHAT_ID, estadoSessao.lastGaleMsgId); } catch(e) {}
            estadoSessao.lastGaleMsgId = null;
        }

        if (configLocal.stkWin) {
            await enviarSticker(configLocal.stkWin);
        } else {
            bot.sendMessage(CHAT_ID, `✅ *WIN!* 🎯`, { parse_mode: 'Markdown' });
        }
        
        await salvarResultadoNoFirebase({
            ativo: operacao.nomeAmigavel, direcao: operacao.type, resultado: 'WIN', galeUsado: operacao.step, 
            horaEntrada: operacao.horaEntradaStr, horaGale: operacao.horaGaleStr
        });

        estadoSessao.wins++; estadoSessao.sinalRodando = null; 
        verificarFimDeSessao(); 
    } else {
        operacao.step++;
        if (operacao.step > 1) { // LOSS
            // 🔥 Limpa a mensagem TEXTO do Gale 1
            if (estadoSessao.lastGaleMsgId) {
                try { await bot.deleteMessage(CHAT_ID, estadoSessao.lastGaleMsgId); } catch(e) {}
                estadoSessao.lastGaleMsgId = null;
            }

            if (configLocal.stkLoss) {
                await enviarSticker(configLocal.stkLoss);
            } else {
                bot.sendMessage(CHAT_ID, `🔴 *LOSS!*`, { parse_mode: 'Markdown' });
            }
            
            await salvarResultadoNoFirebase({
                ativo: operacao.nomeAmigavel, direcao: operacao.type, resultado: 'LOSS', galeUsado: 1, 
                horaEntrada: operacao.horaEntradaStr, horaGale: operacao.horaGaleStr
            });

            estadoSessao.losses++; estadoSessao.sinalRodando = null; 
            verificarFimDeSessao(); 
        } else { // GALE 1 (Apenas TEXTO, mas o ID é salvo para deleção posterior!)
            
            const msgSent = await bot.sendMessage(CHAT_ID, `🔄 *ENTRAR NO GALE ${operacao.step}* em ${operacao.nomeAmigavel}!\nMesma direção.`, { parse_mode: 'Markdown' });
            estadoSessao.lastGaleMsgId = msgSent.message_id;
            
            operacao.minutoVerificacao = (agora.getMinutes() + 1) % 60;
            operacao.verificando = false; 
        }
    }
}

async function puxarVelasM1(symbol, state) {
    try {
        const symUpper = symbol.toUpperCase();
        const isCrypto = ['BTCUSDT', 'ETHUSDT', 'LTCUSDT', 'ADAUSDT', 'BNBUSDT', 'SOLUSDT', 'DOGEUSDT', 'XRPUSDT'].includes(symUpper);
        
        if (isCrypto) {
            const res = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${symUpper}&interval=1m&limit=500`);
            if (!res.data) return null;
            return res.data; 
        } else {
            if(!state.globalDynamicCookie) return null;
            
            const to = Math.floor(Date.now() / 1000); 
            const from = to - (500 * 60); 
            const otcHeaders = { 'accept': '*/*', 'Cookie': state.globalDynamicCookie, 'X-Requested-With': 'XMLHttpRequest', 'referer': 'https://velloxbroker.com/traderoom', 'user-agent': 'Mozilla/5.0' };
            
            if (activeOtcSuffixes[symUpper]) {
                try {
                    let res = await axios.get(`https://velloxbroker.com/publicapi/tradingview/udf-history?symbol=${activeOtcSuffixes[symUpper]}&resolution=1&from=${from}&to=${to}&countback=500&site=velloxbroker.com`, { headers: otcHeaders });
                    if (res.data && res.data.s === 'ok') {
                        let klines = [];
                        for(let i=0; i<res.data.c.length; i++){
                            klines.push([res.data.t[i]*1000, res.data.o[i], res.data.h ? res.data.h[i] : res.data.o[i], res.data.l ? res.data.l[i] : res.data.c[i], res.data.c[i]]);
                        }
                        return klines;
                    }
                } catch(e) { delete activeOtcSuffixes[symUpper]; } 
            }

            const baseName = symUpper.replace('OTC', '').replace('-', '').replace('_', ''); 
            
            const variacoes = [
                symUpper, 
                baseName,
                `${baseName}OTC`, `${baseName}-OTC`, `${baseName}_otc`, `${baseName}_OTC`, `${baseName.substring(0,3)}/${baseName.substring(3)} (OTC)` 
            ];

            for (let variante of variacoes) {
                try {
                    let res = await axios.get(`https://velloxbroker.com/publicapi/tradingview/udf-history?symbol=${variante}&resolution=1&from=${from}&to=${to}&countback=500&site=velloxbroker.com`, { headers: otcHeaders });
                    
                    if (res.data && res.data.s === 'ok' && res.data.c && res.data.c.length > 0) {
                        activeOtcSuffixes[symUpper] = variante; 
                        let klines = [];
                        for(let i=0; i<res.data.c.length; i++){
                            klines.push([res.data.t[i]*1000, res.data.o[i], res.data.h ? res.data.h[i] : res.data.o[i], res.data.l ? res.data.l[i] : res.data.c[i], res.data.c[i]]);
                        }
                        return klines; 
                    }
                } catch(e) {}
                await sleep(150); 
            }
            return null;
        }
    } catch (e) { return null; }
}

module.exports = { initTelegramBot, reloadTelegramConfig, forcarSessaoTelegram };