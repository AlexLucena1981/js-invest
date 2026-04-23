const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const axios = require('axios');
const { db, admin } = require('../config/firebase'); 
const { evaluateStrategy } = require('../utils/indicators');
const { dispararOrdemVellox } = require('./velloxApi'); 

const TOKEN = '8627851942:AAFn2Ze3Nbjb6LbNu7Gk3eEAcpDuzzKGGkM';
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

// 🎯 AQUI ESTÁ A GRANDE MÁGICA: O Robô agora tem duas mentes independentes!
let salasAtivas = {
    'FREE': { ativa: false, wins: 0, losses: 0, turno: 'Manhã', lastGaleMsgId: null },
    'VIP': { ativa: false, wins: 0, losses: 0, turno: 'Tarde', lastGaleMsgId: null }
};

let operacaoRodando = null; 
let ultimoSinalEnviado = null; 
let ultimaMensagemSessao = { 'FREE': 0, 'VIP': 0 };

let activeCronJobs = [];
let configLocal = {};
let motorCacaId = null;
let isProcessing = false; 
let ioGlobal = null; 

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

// 🎯 Roteador de mensagens por sala
function getChatId(sala) {
    if (sala === 'VIP') return configLocal.chatIdVip || '-1003925714362';
    return configLocal.chatIdFree || '-1003925714362';
}

async function enviarSticker(sala, stickerId) {
    if (!stickerId) return null;
    try { 
        const msg = await bot.sendSticker(getChatId(sala), stickerId); 
        return msg.message_id; 
    } catch (e) { return null; }
}

async function salvarResultadoNoFirebase(dados) {
    try {
        const dataDoc = getSPDateString(); 
        await db.collection('historico_sinais').add({ ativo: dados.ativo, direcao: dados.direcao, horaEntrada: dados.horaEntrada, horaGale: dados.horaGale || 'N/A', resultado: dados.resultado, galeUsado: dados.galeUsado, timestamp: admin.firestore.FieldValue.serverTimestamp(), dataRef: dataDoc });
    } catch (e) {}
}

async function enviarRelatorioDiario(sala) {
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
        let msg = `🏁 *RELATÓRIO DA SESSÃO ${sala}* 🏁\n📅 Data: ${getAgoraSP().toLocaleDateString('pt-BR')}\n\n✅ Total Wins: *${wins}*\n🔴 Total Loss: *${losses}*\n🎯 Assertividade: *${assertividade}%*\n\n🏆 *RESUMO DOS ATIVOS:* \n`;
        const sortedRanking = Object.entries(ranking).sort((a, b) => b[1].w - a[1].w);
        sortedRanking.forEach(([ativo, score]) => { msg += `• ${ativo}: ${score.w}W - ${score.l}L\n`; });
        msg += `\n🚀 *Missão cumprida! Sniper recarregando...*`;
        
        bot.sendMessage(getChatId(sala), msg, { parse_mode: 'Markdown' });
    } catch (e) {}
}

async function initTelegramBot(io, stateGlobais, configFirebase) {
    ioGlobal = io;
    console.log("🤖 Motor Global Sniper Multi-Sala (FREE e VIP) ATIVADO");
    configLocal = configFirebase;
    agendarSessoes(stateGlobais);
    iniciarMotorContinuo(stateGlobais);
}

function reloadTelegramConfig(novaConfig) { configLocal = novaConfig; agendarSessoes(); }

function agendarSessoes() {
    activeCronJobs.forEach(job => job.stop()); activeCronJobs = [];
    const dias = configLocal.dias || '1-5'; 
    
    const cronFreeManha = parseTimeToCron(configLocal.horaFreeManha || '09:30', 0, dias);
    const cronFreeTarde = parseTimeToCron(configLocal.horaFreeTarde || '15:30', 0, dias);
    const cronVipTarde = parseTimeToCron(configLocal.horaVipTarde || '13:30', 0, dias);
    const cronVipNoite = parseTimeToCron(configLocal.horaVipNoite || '19:30', 0, dias);

    activeCronJobs.push(cron.schedule(cronFreeManha, () => iniciarSessao('FREE', 'Manhã'), { timezone: "America/Sao_Paulo" }));
    activeCronJobs.push(cron.schedule(cronFreeTarde, () => iniciarSessao('FREE', 'Tarde'), { timezone: "America/Sao_Paulo" }));
    activeCronJobs.push(cron.schedule(cronVipTarde, () => iniciarSessao('VIP', 'Tarde'), { timezone: "America/Sao_Paulo" }));
    activeCronJobs.push(cron.schedule(cronVipNoite, () => iniciarSessao('VIP', 'Noite'), { timezone: "America/Sao_Paulo" }));
}

function forcarSessaoTelegram(sala) {
    const horaAtual = getAgoraSP().getHours();
    let turnoSelecionado = 'Manhã';
    
    if (sala === 'FREE') {
        turnoSelecionado = horaAtual >= 12 ? 'Tarde' : 'Manhã';
    } else {
        turnoSelecionado = horaAtual >= 17 ? 'Noite' : 'Tarde';
    }
    
    iniciarSessao(sala, turnoSelecionado);
}

async function iniciarSessao(sala, turno) {
    const agoraMs = Date.now();
    if (agoraMs - ultimaMensagemSessao[sala] < 10000) return; 
    ultimaMensagemSessao[sala] = agoraMs;
    
    salasAtivas[sala] = { ativa: true, wins: 0, losses: 0, turno: turno, lastGaleMsgId: null };
    
    let stkStart;
    if (turno === "Manhã") stkStart = configLocal.stkStartManha;
    else if (turno === "Tarde") stkStart = configLocal.stkStartTarde;
    else if (turno === "Noite") stkStart = configLocal.stkStartNoite;
    
    if (!stkStart) stkStart = configLocal.stkStart; 

    if (stkStart) await enviarSticker(sala, stkStart);
    else bot.sendMessage(getChatId(sala), `👨‍💻 *INÍCIO DE SESSÃO ${sala} (${turno}): MERCADO ABERTO*`, { parse_mode: 'Markdown' });
}

function iniciarMotorContinuo(stateGlobais) {
    if (motorCacaId) clearInterval(motorCacaId);
    motorCacaId = setInterval(async () => {
        if (isProcessing) return; 
        
        const hasActiveAutoTrade = Object.values(stateGlobais.activeBrokers).some(b => b.autoTradeActive && b.isPremium);
        const isAnySalaActive = salasAtivas['FREE'].ativa || salasAtivas['VIP'].ativa;

        // Só dorme se absolutamente ninguém precisar do bot (nem as salas, nem os alunos)
        if (!isAnySalaActive && !hasActiveAutoTrade && !operacaoRodando) return; 

        isProcessing = true;
        try {
            const agora = getAgoraSP(); const min = agora.getMinutes(); const sec = agora.getSeconds();
            if (operacaoRodando) {
                const op = operacaoRodando;
                if (min === op.minutoVerificacao && sec >= 4 && sec <= 45) {
                    if (!op.verificando) { op.verificando = true; await conferirResultado(stateGlobais); }
                }
                const minsPassados = (min - op.minutoVerificacao + 60) % 60;
                if (minsPassados >= 2 && minsPassados < 50) { 
                    operacaoRodando = null; 
                    if(salasAtivas['FREE'].ativa) verificarFimDeSessao('FREE'); 
                    if(salasAtivas['VIP'].ativa) verificarFimDeSessao('VIP'); 
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
        if (operacaoRodando) break; 
        try {
            if (ultimoSinalEnviado === `${sym}_${minAtual}`) continue;

            const velas = await puxarVelasM1(sym, state);
            if (!velas || velas.length < 400) { await sleep(200); continue; }
            
            const closes = velas.map(k => parseFloat(k[4]));
            const currentPrice = closes[closes.length - 1]; 
            const sinal = evaluateStrategy(closes, strategy);

            if (sinal) {
                ultimoSinalEnviado = `${sym}_${minAtual}`;
                const nomeAmigavel = dicionarioAtivos[sym] || sym;
                const minEntrada = (minAtual + 1) % 60;
                const minVerificacao = (minAtual + 2) % 60;

                const horas = calcularHorarios(minEntrada);
                
                // Pega as salas que estão vivas no momento e dispara para elas!
                const salasAlvo = Object.keys(salasAtivas).filter(s => salasAtivas[s].ativa);
                
                for (let sala of salasAlvo) {
                    atirarSinalTelegram(sala, sym, sinal, nomeAmigavel, horas);
                }
                
                operacaoRodando = { 
                    symbol: sym, type: sinal, step: 0, minutoEntrada: minEntrada, minutoVerificacao: minVerificacao,
                    nomeAmigavel: nomeAmigavel, horaEntradaStr: horas.horaEntrada, horaGaleStr: horas.horaGale, verificando: false,
                    lastEntryPrice: currentPrice,
                    salasAlvo: salasAlvo
                };
                
                Object.values(state.activeBrokers).forEach(async (broker) => {
                    if (!broker.autoTradeActive || !broker.isPremium) return;
                    let isDemo = broker.config.accountType === 'demo';
                    let amount = parseFloat(broker.config.baseAmount).toFixed(2).replace('.', ',');
                    
                    const result = await dispararOrdemVellox(broker, isDemo, sym, sinal, amount, currentPrice, '1m');
                    if (result.success && result.balance && ioGlobal) {
                        ioGlobal.to(broker.socketId).emit('update_balance', { isDemo, balance: result.balance });
                    } else if (ioGlobal) {
                        ioGlobal.to(broker.socketId).emit('sniper_error', `Falha no Auto-Trade: ${result.msg}`);
                    }
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

function atirarSinalTelegram(sala, sym, tipo, nomeAmigavel, horas) {
    const acao = tipo === 'CALL' ? '🟩 Comprar' : '🟥 Vender';
    const templateOriginal = configLocal.msgSinal || "⚡ *ALERTA DE TOQUE (M1)* ⚡\n\n💵 Moeda = {MOEDA}\n⏰ Expiração = 1 Minuto\n🛎 Entrada = {HORA_ENTRADA}\n{DIRECAO}\n\nGale 1 - {HORA_GALE}\n\n👉🏼 Se necessário, fazer 1 Gale.";
    
    const msg = formatarMensagem(templateOriginal, { moeda: nomeAmigavel, direcao: acao, horaEntrada: horas.horaEntrada, horaGale: horas.horaGale });
    bot.sendMessage(getChatId(sala), msg, { parse_mode: 'Markdown', disable_web_page_preview: true });
}

async function verificarFimDeSessao(sala) {
    if (!salasAtivas[sala].ativa) return; 

    const totalSinais = salasAtivas[sala].wins + salasAtivas[sala].losses;
    const metaSinais = parseInt(configLocal.maxSinais) || 2;
    
    if (totalSinais >= metaSinais) {
        salasAtivas[sala].ativa = false;
        
        let stkEnd;
        if (salasAtivas[sala].turno === "Manhã") stkEnd = configLocal.stkEndManha;
        else if (salasAtivas[sala].turno === "Tarde") stkEnd = configLocal.stkEndTarde;
        else if (salasAtivas[sala].turno === "Noite") stkEnd = configLocal.stkEndNoite;
        
        if (!stkEnd) stkEnd = configLocal.stkEnd;

        if (stkEnd) await enviarSticker(sala, stkEnd); 
        else bot.sendMessage(getChatId(sala), `🔒 *META ATINGIDA!* Encerrando sessão ${sala}...`, { parse_mode: 'Markdown' });
        
        setTimeout(() => { enviarRelatorioDiario(sala); }, 3000);
    }
}

async function conferirResultado(stateGlobais) {
    const operacao = operacaoRodando; const agora = getAgoraSP();
    const velas = await puxarVelasM1(operacao.symbol, stateGlobais);
    
    if (!velas || velas.length < 2) { operacao.verificando = false; return; }

    const ultimaVelaFechada = velas[velas.length - 2];
    const openPrice = parseFloat(ultimaVelaFechada[1]); 
    const closePrice = parseFloat(ultimaVelaFechada[4]); 

    const isGreen = closePrice > openPrice;
    const isRed = closePrice < openPrice;
    const won = (operacao.type === 'CALL' && isGreen) || (operacao.type === 'PUT' && isRed);

    if (won) {
        if (operacao.step <= 1) {
            for (let sala of operacao.salasAlvo) {
                if (salasAtivas[sala].lastGaleMsgId) { try { await bot.deleteMessage(getChatId(sala), salasAtivas[sala].lastGaleMsgId); } catch(e) {} salasAtivas[sala].lastGaleMsgId = null; }
                
                if (salasAtivas[sala].ativa) {
                    if (configLocal.stkWin) await enviarSticker(sala, configLocal.stkWin); 
                    else bot.sendMessage(getChatId(sala), `✅ *WIN!* 🎯`, { parse_mode: 'Markdown' });
                    salasAtivas[sala].wins++; 
                    verificarFimDeSessao(sala);
                }
            }
            
            await salvarResultadoNoFirebase({ 
                ativo: operacao.nomeAmigavel, direcao: operacao.type, resultado: 'WIN', 
                galeUsado: operacao.step, horaEntrada: operacao.horaEntradaStr, horaGale: operacao.horaGaleStr 
            });
        }

        Object.values(stateGlobais.activeBrokers).forEach(broker => {
            if (!broker.autoTradeActive || !broker.isPremium) return;
            if (operacao.step > broker.config.maxGale) return; 

            let amountBet = broker.config.baseAmount * Math.pow(2, operacao.step);
            let payoutPerc = (broker.config.payout || 85) / 100;
            let lucroLiquido = (amountBet * payoutPerc);
            broker.sessionProfit += lucroLiquido;
            if (ioGlobal) ioGlobal.to(broker.socketId).emit('win_balance_update', { isDemo: broker.config.accountType === 'demo', prize: (amountBet + lucroLiquido) });
            verificarStopAutoTrade(broker);
        });

        operacaoRodando = null; 
    } else {
        operacao.step++;
        
        Object.values(stateGlobais.activeBrokers).forEach(broker => {
            if (!broker.autoTradeActive || !broker.isPremium) return;
            if (operacao.step - 1 > broker.config.maxGale) return; 
            
            let amountBet = broker.config.baseAmount * Math.pow(2, operacao.step - 1);
            broker.sessionProfit -= amountBet;
            verificarStopAutoTrade(broker);
        });

        if (operacao.step === 2) {
            for (let sala of operacao.salasAlvo) {
                if (salasAtivas[sala].lastGaleMsgId) { try { await bot.deleteMessage(getChatId(sala), salasAtivas[sala].lastGaleMsgId); } catch(e) {} salasAtivas[sala].lastGaleMsgId = null; }
                
                if (salasAtivas[sala].ativa) {
                    if (configLocal.stkLoss) await enviarSticker(sala, configLocal.stkLoss); 
                    else bot.sendMessage(getChatId(sala), `🔴 *LOSS!*`, { parse_mode: 'Markdown' });
                    salasAtivas[sala].losses++; 
                    verificarFimDeSessao(sala);
                }
            }
            
            await salvarResultadoNoFirebase({ 
                ativo: operacao.nomeAmigavel, direcao: operacao.type, resultado: 'LOSS', 
                galeUsado: 1, horaEntrada: operacao.horaEntradaStr, horaGale: operacao.horaGaleStr 
            });
        }

        if (operacao.step > 2) { 
            operacaoRodando = null; 
        } else { 
            if (operacao.step === 1) {
                for (let sala of operacao.salasAlvo) {
                    if (salasAtivas[sala].ativa) {
                        const msgSent = await bot.sendMessage(getChatId(sala), `🔄 *ENTRAR NO GALE ${operacao.step}* em ${operacao.nomeAmigavel}!\nMesma direção.`, { parse_mode: 'Markdown' });
                        salasAtivas[sala].lastGaleMsgId = msgSent.message_id;
                    }
                }
            }

            Object.values(stateGlobais.activeBrokers).forEach(async broker => {
                if (!broker.autoTradeActive || !broker.isPremium) return;
                if (operacao.step > broker.config.maxGale) return; 
                
                let valorGale = broker.config.baseAmount * Math.pow(2, operacao.step);
                let isDemo = broker.config.accountType === 'demo';
                const result = await dispararOrdemVellox(broker, isDemo, operacao.symbol, operacao.type, valorGale.toFixed(2).replace('.', ','), closePrice, '1m');
                if (result.success && result.balance && ioGlobal) {
                    ioGlobal.to(broker.socketId).emit('update_balance', { isDemo, balance: result.balance });
                } else if (ioGlobal) {
                    ioGlobal.to(broker.socketId).emit('sniper_error', `Falha no Auto-Trade: ${result.msg}`);
                }
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