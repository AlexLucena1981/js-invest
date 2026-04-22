const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const axios = require('axios');
const { db, admin } = require('../config/firebase'); 
const { evaluateStrategy } = require('../utils/indicators');
const { dispararOrdemVellox } = require('./velloxApi'); 

const TOKEN = '8627851942:AAFn2Ze3Nbjb6LbNu7Gk3eEAcpDuzzKGGkM';
const CHAT_ID = '-1003925714362';
const bot = new TelegramBot(TOKEN, { polling: false });

const dicionarioAtivos = {
    'BTCUSDT': 'Bitcoin', 'ETHUSDT': 'Ethereum', 'LTCUSDT': 'Litecoin', 
    'ADAUSDT': 'Cardano', 'BNBUSDT': 'Binance Coin', 'SOLUSDT': 'Solana', 
    'DOGEUSDT': 'Dogecoin', 'XRPUSDT': 'Ripple',
    'EURUSD': 'EUR/USD', 'GBPUSD': 'GBP/USD', 'USDJPY': 'USD/JPY', 
    'AUDUSD': 'AUD/USD', 'USDCAD': 'USD/CAD',
    'AAPL': 'Apple', 'TSLA': 'Tesla', 'MSFT': 'Microsoft', 
    'AMZN': 'Amazon', 'META': 'Meta', 'GOOGL': 'Google', 'NFLX': 'Netflix',
    'XAUUSD': 'Ouro', 'XAGUSD': 'Prata', 'USOIL': 'Petróleo'
};

const ativosTestes = Object.keys(dicionarioAtivos); 

let estadoSessao = { ativa: false, permitirSinais: false, wins: 0, losses: 0, sinalRodando: null, ultimoSinalEnviado: null, lastGaleMsgId: null, turnoAtual: 'Manhã' };
let activeCronJobs = [];
let configLocal = {};
let motorCacaId = null;
let isProcessing = false; 
let ioGlobal = null; 
let ultimaMensagemSessao = 0; 

function getAgoraSP() { return new Date(new Date().toLocaleString("en-US", {timeZone: "America/Sao_Paulo"})); }
function getSPDateString() {
    const d = getAgoraSP();
    const yyyy = d.getFullYear(); const mm = String(d.getMonth() + 1).padStart(2, '0'); const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseTimeToCron(timeStr, addMinutes, dias) {
    let [h, m] = (timeStr || "00:00").split(':').map(Number);
    let totalMin = (h * 60) + m + addMinutes;
    let finalH = Math.floor(totalMin / 60) % 24; let finalM = totalMin % 60;
    return `${finalM} ${finalH} * * ${dias}`;
}

async function enviarSticker(stickerId) {
    if (!stickerId) return null;
    try { const msg = await bot.sendSticker(CHAT_ID, stickerId); return msg.message_id; } catch (e) { return null; }
}

async function salvarResultadoNoFirebase(dados) {
    try {
        const dataDoc = getSPDateString(); 
        await db.collection('historico_sinais').add({ ativo: dados.ativo, direcao: dados.direcao, horaEntrada: dados.horaEntrada, horaGale: dados.horaGale || 'N/A', resultado: dados.resultado, galeUsado: dados.galeUsado, timestamp: admin.firestore.FieldValue.serverTimestamp(), dataRef: dataDoc });
    } catch (e) {}
}

async function enviarRelatorioDiario() {
    try {
        const dataDoc = getSPDateString();
        const snapshot = await db.collection('historico_sinais').where('dataRef', '==', dataDoc).get();
        if (snapshot.empty) return;

        let total = 0, wins = 0, losses = 0; let ranking = {}; let sinaisHoje = [];
        snapshot.forEach(doc => sinaisHoje.push(doc.data()));
        sinaisHoje.sort((a, b) => b.timestamp - a.timestamp);
        
        const metaSinais = parseInt(configLocal.maxSinais) || 2;
        const sinaisDestaSessao = sinaisHoje.slice(0, metaSinais);

        sinaisDestaSessao.forEach(d => {
            total++; if (d.resultado === 'WIN') wins++; else losses++;
            if (!ranking[d.ativo]) ranking[d.ativo] = { w: 0, l: 0 };
            if (d.resultado === 'WIN') ranking[d.ativo].w++; else ranking[d.ativo].l++;
        });

        const assertividade = total > 0 ? ((wins / total) * 100).toFixed(1) : 0;
        let msg = `🏁 *RELATÓRIO DE SESSÃO* 🏁\n📅 Data: ${getAgoraSP().toLocaleDateString('pt-BR')}\n\n✅ Total Wins: *${wins}*\n🔴 Total Loss: *${losses}*\n🎯 Assertividade: *${assertividade}%*\n\n🏆 *RESUMO DOS ATIVOS:* \n`;
        const sortedRanking = Object.entries(ranking).sort((a, b) => b[1].w - a[1].w);
        sortedRanking.forEach(([ativo, score]) => { msg += `• ${ativo}: ${score.w}W - ${score.l}L\n`; });
        msg += `\n🚀 *Missão cumprida! Sniper recarregando...*`;
        bot.sendMessage(CHAT_ID, msg, { parse_mode: 'Markdown' });
    } catch (e) {}
}

async function initTelegramBot(io, stateGlobais, configFirebase) {
    ioGlobal = io;
    console.log("🤖 Motor Global Sniper (Telegram & Auto-Trade) ATIVADO");
    configLocal = configFirebase;
    agendarSessoes(stateGlobais);
    iniciarMotorContinuo(stateGlobais);
}

function reloadTelegramConfig(novaConfig) { configLocal = novaConfig; agendarSessoes(); }

function agendarSessoes() {
    activeCronJobs.forEach(job => job.stop()); activeCronJobs = [];
    const dias = configLocal.dias || '1-5'; 
    const cronManhaStart = parseTimeToCron(configLocal.horaManha || '09:30', 0, dias);
    const cronTardeStart = parseTimeToCron(configLocal.horaTarde || '15:30', 0, dias);
    activeCronJobs.push(cron.schedule(cronManhaStart, () => iniciarSessao("Manhã"), { timezone: "America/Sao_Paulo" }));
    activeCronJobs.push(cron.schedule(cronTardeStart, () => iniciarSessao("Tarde"), { timezone: "America/Sao_Paulo" }));
}

function forcarSessaoTelegram(turno) { iniciarSessao(turno); }

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
    estadoSessao.turnoAtual = turno;
    
    let stkStart = turno === "Manhã" ? configLocal.stkStartManha : configLocal.stkStartTarde;
    if (!stkStart) stkStart = configLocal.stkStart; 

    if (stkStart) await enviarSticker(stkStart);
    else bot.sendMessage(CHAT_ID, `👨‍💻 *INÍCIO DE SESSÃO GLOBAL (${turno}): MERCADO ABERTO*`, { parse_mode: 'Markdown' });
}

function iniciarMotorContinuo(stateGlobais) {
    if (motorCacaId) clearInterval(motorCacaId);
    motorCacaId = setInterval(async () => {
        if (isProcessing) return; 
        
        // 🎯 A DUPLA IGNIÇÃO: O motor acorda se o Telegram estiver no horário OU se algum aluno tiver o Auto-Trade ligado!
        const hasActiveAutoTrade = Object.values(stateGlobais.activeBrokers).some(b => b.autoTradeActive && b.isPremium);
        if (!estadoSessao.ativa && !hasActiveAutoTrade && !estadoSessao.sinalRodando) return; // Se ninguém precisa dele, dorme.

        isProcessing = true;
        try {
            const agora = getAgoraSP(); const min = agora.getMinutes(); const sec = agora.getSeconds();
            if (estadoSessao.sinalRodando) {
                const op = estadoSessao.sinalRodando;
                if (min === op.minutoVerificacao && sec >= 4 && sec <= 45) {
                    if (!op.verificando) { op.verificando = true; await conferirResultado(stateGlobais); }
                }
                const minsPassados = (min - op.minutoVerificacao + 60) % 60;
                if (minsPassados >= 2 && minsPassados < 50) { 
                    estadoSessao.sinalRodando = null; 
                    if(estadoSessao.ativa) verificarFimDeSessao(); 
                }
            } else { await cacarOportunidade(stateGlobais); }
        } catch (e) {} finally { isProcessing = false; }
    }, 3000); 
}

function verificarStopAutoTrade(broker) {
    let stopReason = null;
    if (broker.sessionProfit <= -broker.config.stopLoss) stopReason = `🛑 STOP LOSS ATINGIDO!`;
    if (broker.sessionProfit >= broker.config.stopWin) stopReason = `🏆 META BATIDA!`;

    if (stopReason) {
        broker.autoTradeActive = false;
        if (ioGlobal) ioGlobal.to(broker.socketId).emit('auto_trade_status', { active: false, msg: stopReason, profit: broker.sessionProfit });
    } else {
        if (ioGlobal) ioGlobal.to(broker.socketId).emit('auto_trade_status', { active: true, msg: "Robô Armado...", profit: broker.sessionProfit });
    }
}

async function cacarOportunidade(state) {
    if (!state.strategiesDB || state.strategiesDB.length === 0) return;

    const agora = getAgoraSP(); const minAtual = agora.getMinutes();
    const strategy = state.strategiesDB.find(s => s && s.name && s.name.toLowerCase().includes('live')) || state.strategiesDB[0];
    if (!strategy) return; 
    
    for (let sym of ativosTestes) {
        if (estadoSessao.sinalRodando) break; 
        try {
            if (estadoSessao.ultimoSinalEnviado === `${sym}_${minAtual}`) continue;

            const velas = await puxarVelasM1(sym, state);
            if (!velas || velas.length < 400) { await sleep(200); continue; }
            
            const closes = velas.map(k => parseFloat(k[4]));
            const currentPrice = closes[closes.length - 1]; 
            const sinal = evaluateStrategy(closes, strategy);

            if (sinal) {
                estadoSessao.ultimoSinalEnviado = `${sym}_${minAtual}`;
                const nomeAmigavel = dicionarioAtivos[sym] || sym;
                const minEntrada = (minAtual + 1) % 60;
                const minVerificacao = (minAtual + 2) % 60;

                const horas = calcularHorarios(minEntrada);
                
                // 🎯 O DISPARO INDEPENDENTE: Só envia pro Telegram se a sessão estiver ativa
                if (estadoSessao.ativa && estadoSessao.permitirSinais) {
                    atirarSinalTelegram(sym, sinal, nomeAmigavel, horas);
                }
                
                estadoSessao.sinalRodando = { 
                    symbol: sym, type: sinal, step: 0, minutoEntrada: minEntrada, minutoVerificacao: minVerificacao,
                    nomeAmigavel: nomeAmigavel, horaEntradaStr: horas.horaEntrada, horaGaleStr: horas.horaGale, verificando: false,
                    lastEntryPrice: currentPrice 
                };
                
                // 🚀 O AUTO-TRADE ACONTECE SEMPRE QUE HOUVER ALGUÉM ARMADO
                Object.values(state.activeBrokers).forEach(async (broker) => {
                    if (!broker.autoTradeActive || !broker.isPremium) return;
                    let isDemo = broker.config.accountType === 'demo';
                    let amount = parseFloat(broker.config.baseAmount).toFixed(2).replace('.', ',');
                    
                    const result = await dispararOrdemVellox(broker, isDemo, sym, sinal, amount, currentPrice, '1m');
                    if (result.success && result.balance && ioGlobal) ioGlobal.to(broker.socketId).emit('update_balance', { isDemo, balance: result.balance });
                });

                break; 
            }
            await sleep(200); 
        } catch (e) {}
    }
}

function calcularHorarios(minutoEntrada) {
    const agora = getAgoraSP(); let hora = agora.getHours();
    if (agora.getMinutes() === 59 && minutoEntrada === 0) hora = (hora + 1) % 24;
    let minGale = (minutoEntrada + 1) % 60; let hrGale = hora; if (minutoEntrada === 59) hrGale = (hora + 1) % 24;
    const horaEntrada = `${hora.toString().padStart(2, '0')}:${minutoEntrada.toString().padStart(2, '0')}`;
    const horaGale = `${hrGale.toString().padStart(2, '0')}:${minGale.toString().padStart(2, '0')}`;
    return { horaEntrada, horaGale };
}

function formatarMensagem(template, dados) {
    if (!template) return "";
    return template.replace(/{MOEDA}/g, dados.moeda || "").replace(/{DIRECAO}/g, dados.direcao || "").replace(/{HORA_ENTRADA}/g, dados.horaEntrada || "").replace(/{HORA_GALE}/g, dados.horaGale || "").replace(/\\n/g, "\n"); 
}

function atirarSinalTelegram(sym, tipo, nomeAmigavel, horas) {
    const acao = tipo === 'CALL' ? '🟩 Comprar' : '🟥 Vender';
    const templateOriginal = configLocal.msgSinal || "⚡ *ALERTA DE TOQUE (M1)* ⚡\n\n💵 Moeda = {MOEDA}\n⏰ Expiração = 1 Minuto\n🛎 Entrada = {HORA_ENTRADA}\n{DIRECAO}\n\nGale 1 - {HORA_GALE}\n\n👉🏼 Se necessário, fazer 1 Gale.";
    
    const msg = formatarMensagem(templateOriginal, { moeda: nomeAmigavel, direcao: acao, horaEntrada: horas.horaEntrada, horaGale: horas.horaGale });
    bot.sendMessage(CHAT_ID, msg, { parse_mode: 'Markdown', disable_web_page_preview: true });
}

async function verificarFimDeSessao() {
    if (!estadoSessao.ativa) return; 

    const totalSinais = estadoSessao.wins + estadoSessao.losses;
    const metaSinais = parseInt(configLocal.maxSinais) || 2;
    
    if (totalSinais >= metaSinais) {
        estadoSessao.ativa = false; estadoSessao.permitirSinais = false;
        
        let stkEnd = estadoSessao.turnoAtual === "Manhã" ? configLocal.stkEndManha : configLocal.stkEndTarde;
        if (!stkEnd) stkEnd = configLocal.stkEnd;

        if (stkEnd) await enviarSticker(stkEnd); 
        else bot.sendMessage(CHAT_ID, `🔒 *META ATINGIDA!* Encerrando sessão...`, { parse_mode: 'Markdown' });
        
        setTimeout(() => { enviarRelatorioDiario(); }, 3000);
    }
}

async function conferirResultado(stateGlobais) {
    const operacao = estadoSessao.sinalRodando; const agora = getAgoraSP();
    const velas = await puxarVelasM1(operacao.symbol, stateGlobais);
    
    if (!velas || velas.length < 2) { operacao.verificando = false; return; }

    const ultimaVelaFechada = velas[velas.length - 2];
    const closePrice = parseFloat(ultimaVelaFechada[4]);

    const isGreen = closePrice > operacao.lastEntryPrice;
    const isRed = closePrice < operacao.lastEntryPrice;
    const won = (operacao.type === 'CALL' && isGreen) || (operacao.type === 'PUT' && isRed);

    if (won) {
        // 🎯 SÓ ENVIA MENSAGEM SE A SESSÃO DO TELEGRAM ESTIVER LIGADA
        if (estadoSessao.ativa && estadoSessao.permitirSinais) {
            if (estadoSessao.lastGaleMsgId) { try { await bot.deleteMessage(CHAT_ID, estadoSessao.lastGaleMsgId); } catch(e) {} estadoSessao.lastGaleMsgId = null; }
            if (configLocal.stkWin) await enviarSticker(configLocal.stkWin); else bot.sendMessage(CHAT_ID, `✅ *WIN!* 🎯`, { parse_mode: 'Markdown' });
            estadoSessao.wins++; 
            verificarFimDeSessao();
        }
        
        // 🎯 SEMPRE SALVA NO HISTÓRICO PARA O PAINEL ADMIN
        await salvarResultadoNoFirebase({ ativo: operacao.nomeAmigavel, direcao: operacao.type, resultado: 'WIN', galeUsado: operacao.step, horaEntrada: operacao.horaEntradaStr, horaGale: operacao.horaGaleStr });

        // 💰 PAGA OS ALUNOS DO AUTO-TRADE
        Object.values(stateGlobais.activeBrokers).forEach(broker => {
            if (!broker.autoTradeActive || !broker.isPremium) return;
            let amountBet = broker.config.baseAmount * Math.pow(2, operacao.step);
            let payoutPerc = (broker.config.payout || 85) / 100;
            let lucroLiquido = (amountBet * payoutPerc);
            broker.sessionProfit += lucroLiquido;
            if (ioGlobal) ioGlobal.to(broker.socketId).emit('win_balance_update', { isDemo: broker.config.accountType === 'demo', prize: (amountBet + lucroLiquido) });
            verificarStopAutoTrade(broker);
        });

        estadoSessao.sinalRodando = null; 
    } else {
        operacao.step++;
        if (operacao.step > 2) { 
            if (estadoSessao.ativa && estadoSessao.permitirSinais) {
                if (estadoSessao.lastGaleMsgId) { try { await bot.deleteMessage(CHAT_ID, estadoSessao.lastGaleMsgId); } catch(e) {} estadoSessao.lastGaleMsgId = null; }
                if (configLocal.stkLoss) await enviarSticker(configLocal.stkLoss); else bot.sendMessage(CHAT_ID, `🔴 *LOSS!*`, { parse_mode: 'Markdown' });
                estadoSessao.losses++; 
                verificarFimDeSessao(); 
            }
            
            await salvarResultadoNoFirebase({ ativo: operacao.nomeAmigavel, direcao: operacao.type, resultado: 'LOSS', galeUsado: 1, horaEntrada: operacao.horaEntradaStr, horaGale: operacao.horaGaleStr });

            Object.values(stateGlobais.activeBrokers).forEach(broker => {
                if (!broker.autoTradeActive || !broker.isPremium) return;
                let amountBet = broker.config.baseAmount * Math.pow(2, operacao.step - 1);
                broker.sessionProfit -= amountBet;
                verificarStopAutoTrade(broker);
            });

            estadoSessao.sinalRodando = null; 
        } else { 
            if (estadoSessao.ativa && estadoSessao.permitirSinais) {
                const msgSent = await bot.sendMessage(CHAT_ID, `🔄 *ENTRAR NO GALE ${operacao.step}* em ${operacao.nomeAmigavel}!\nMesma direção.`, { parse_mode: 'Markdown' });
                estadoSessao.lastGaleMsgId = msgSent.message_id;
            }
            
            Object.values(stateGlobais.activeBrokers).forEach(async broker => {
                if (!broker.autoTradeActive || !broker.isPremium) return;
                
                let amountBetAnterior = broker.config.baseAmount * Math.pow(2, operacao.step - 1);
                broker.sessionProfit -= amountBetAnterior; 

                if (operacao.step > broker.config.maxGale) { verificarStopAutoTrade(broker); return; } 
                
                let valorGale = broker.config.baseAmount * Math.pow(2, operacao.step);
                let isDemo = broker.config.accountType === 'demo';
                const result = await dispararOrdemVellox(broker, isDemo, operacao.symbol, operacao.type, valorGale.toFixed(2).replace('.', ','), closePrice, '1m');
                if (result.success && result.balance && ioGlobal) ioGlobal.to(broker.socketId).emit('update_balance', { isDemo, balance: result.balance });
            });

            operacao.lastEntryPrice = closePrice; 
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
            if (!res.data) return null; return res.data; 
        } else {
            if(!state.globalDynamicCookie) return null;
            const to = Math.floor(Date.now() / 1000); const from = to - (500 * 60); 
            const otcHeaders = { 'accept': '*/*', 'Cookie': state.globalDynamicCookie, 'X-Requested-With': 'XMLHttpRequest', 'referer': 'https://velloxbroker.com/traderoom', 'user-agent': 'Mozilla/5.0' };
            const baseName = symUpper.replace('OTC', '').replace('-', '').replace('_', ''); 
            const variacoes = [ symUpper, baseName ];
            for (let variante of variacoes) {
                try {
                    let res = await axios.get(`https://velloxbroker.com/publicapi/tradingview/udf-history?symbol=${variante}&resolution=1&from=${from}&to=${to}&countback=500&site=velloxbroker.com`, { headers: otcHeaders });
                    if (res.data && res.data.s === 'ok' && res.data.c && res.data.c.length > 0) {
                        let klines = [];
                        for(let i=0; i<res.data.c.length; i++){ klines.push([res.data.t[i]*1000, res.data.o[i], res.data.h ? res.data.h[i] : res.data.o[i], res.data.l ? res.data.l[i] : res.data.c[i], res.data.c[i]]); }
                        return klines; 
                    }
                } catch(e) {} await sleep(150); 
            }
            return null;
        }
    } catch (e) { return null; }
}

module.exports = { initTelegramBot, reloadTelegramConfig, forcarSessaoTelegram };