// 🧠 CORE LOGIC (Firebase, Sockets e Listeners Principais)

const firebaseConfig = { 
    apiKey: "AIzaSyCBlpeZG_ITiXaKYTdq378gRcLJ9wVNqqI", 
    authDomain: "js-invest-40d0b.firebaseapp.com", 
    projectId: "js-invest-40d0b" 
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth(); 
const socket = io({ transports: ['websocket'], upgrade: false });

let currentEntryPrice = 0; 
window.radarGlobalStats = null; 
let isBotActive = false; 

window.addEventListener('DOMContentLoaded', () => {
    initChart(); 
    
    const amtInput = document.getElementById('riskAmount');
    if (amtInput) {
        amtInput.type = 'text';
        amtInput.value = '1% da Banca';
        amtInput.setAttribute('readonly', 'true');
        const label = amtInput.parentElement.querySelector('label');
        if (label) label.innerText = 'ENTRADA (1%)';
        
        const amtCol = amtInput.parentElement;
        const contaCol = document.getElementById('riskAccount').parentElement;
        if (amtCol.classList.contains('col-4')) { amtCol.classList.remove('col-4'); amtCol.classList.add('col-6'); }
        if (contaCol && contaCol.classList.contains('col-4')) { contaCol.classList.remove('col-4'); contaCol.classList.add('col-6'); }
    }

    const riskGale = document.getElementById('riskGale');
    if (riskGale && riskGale.parentElement) {
        riskGale.parentElement.style.display = 'none';
    }

    const btnAddScript = document.getElementById('btnOpenModal');
    if (btnAddScript) {
        btnAddScript.style.display = 'none';
    }

    ['riskAccount', 'riskWin', 'riskLoss'].forEach(id => { const el = document.getElementById(id); if(el) el.addEventListener('change', saveRiskConfig); });

    togglePremiumUI(false);

    const savedConfig = JSON.parse(localStorage.getItem('jsInvestConfig'));
    if (savedConfig) {
        if(document.getElementById('riskAccount')) document.getElementById('riskAccount').value = savedConfig.accountType || 'demo'; 
        if(document.getElementById('riskWin')) document.getElementById('riskWin').value = savedConfig.stopWin || 50; 
        if(document.getElementById('riskLoss')) document.getElementById('riskLoss').value = savedConfig.stopLoss || 50;
    }

    setupFifoPanel(); 

    const radarDiv = document.createElement('div'); radarDiv.id = 'radarToast';
    radarDiv.style.cssText = 'display:none; position:fixed; top:80px; right:20px; background:#161b22; border:2px solid #58a6ff; padding:20px; border-radius:10px; z-index:9999; box-shadow: 0 0 25px rgba(88, 166, 255, 0.4); transition: all 0.3s ease; text-align:center; min-width:250px;';
    radarDiv.innerHTML = `<div style="font-size:24px; margin-bottom:10px;">🚨 <b style="color:#c9d1d9;">RADAR DETECTOU!</b> 🚨</div><div id="radarMsg" style="font-size:18px; color:#8b949e; font-weight:bold;">Aguardando...</div>`;
    document.body.appendChild(radarDiv);

    const savedBrokerToken = localStorage.getItem('jsInvestBrokerToken'); const savedRole = localStorage.getItem('jsInvestUserRole'); const savedUid = localStorage.getItem('jsInvestUid');
    if (savedBrokerToken && savedUid) { document.getElementById('btnLogin').innerText = "Acessando Painel..."; socket.emit('auto_reconnect', { token: savedBrokerToken, role: savedRole, uid: savedUid }); }
});

socket.on('radar_alert', (data) => {
    const agora = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    manageFifoAlert({ id: 'radar-' + data.symbol, symbol: data.symbol, time: agora, type: data.type, stepText: 'Radar (Análise)', isEnd: false, isRadar: true });
    const toast = document.getElementById('radarToast'); const msg = document.getElementById('radarMsg'); let color = data.type === 'CALL' ? '#3fb950' : '#f85149';
    toast.style.borderColor = color; toast.style.boxShadow = `0 0 35px ${color}`; msg.innerHTML = `Oportunidade de <span style="color:${color}; font-size:22px;">${data.type}</span><br>no ativo <b style="color:#ffffff; font-size:24px;">${data.symbol}</b>`;
    toast.style.display = 'block'; setTimeout(() => { toast.style.display = 'none'; }, 10000); 
});

socket.on('radar_stats_update', (stats) => { 
    window.radarGlobalStats = stats; 
    if (typeof renderStats === 'function') {
        renderStats(window.radarGlobalStats);
    }
});

socket.on('hybrid_login_result', (res) => {
    document.getElementById('btnLogin').innerText = "Acessar Sistema";
    if (res.success) {
        localStorage.setItem('jsInvestBrokerToken', res.brokerToken); localStorage.setItem('jsInvestUserRole', res.role); localStorage.setItem('jsInvestUid', res.uid);
        auth.signInWithCustomToken(res.firebaseToken).then(() => {
            document.getElementById('loginScreen').style.display = 'none'; document.getElementById('valReal').innerText = `R$ ${res.balance.real}`; document.getElementById('valDemo').innerText = res.balance.demo; document.getElementById('manualTradePanel').style.display = 'flex'; 
            togglePremiumUI(res.isPremium);
            if (!res.isPremium) { setTimeout(() => { mostrarPopupBloqueioFreemium(); }, 1500); }
            if (res.role === 'admin') { 
                document.getElementById('btnAdminPanel').style.display = 'inline-block';
                setupTelegramAdminUI(auth, socket); 
                auth.currentUser.getIdToken().then(token => socket.emit('admin_get_tg_config', token)); 
            }
        }).catch(err => { document.getElementById('loginError').innerText = "Erro: " + err.message; document.getElementById('loginError').style.display = 'block'; });
    } else { alert("Conta não encontrada ou credenciais inválidas!\\nVocê será redirecionado para o cadastro oficial da corretora."); window.location.href = "https://joaosilva.top/corretora-vellox"; }
});

socket.on('auto_reconnect_result', (res) => {
    if(res.success) {
        document.getElementById('loginScreen').style.display = 'none'; document.getElementById('valReal').innerText = `R$ ${res.balance.real}`; document.getElementById('valDemo').innerText = res.balance.demo; document.getElementById('manualTradePanel').style.display = 'flex'; 
        togglePremiumUI(res.isPremium);
        if (!res.isPremium) { setTimeout(() => { mostrarPopupBloqueioFreemium(); }, 1500); }
        if (res.role === 'admin') { 
            document.getElementById('btnAdminPanel').style.display = 'inline-block';
            setupTelegramAdminUI(auth, socket); 
            auth.currentUser.getIdToken().then(token => socket.emit('admin_get_tg_config', token)); 
        }
    } else { localStorage.removeItem('jsInvestBrokerToken'); localStorage.removeItem('jsInvestUserRole'); localStorage.removeItem('jsInvestUid'); document.getElementById('btnLogin').innerText = "Acessar Sistema"; }
});

socket.on('admin_tg_config_data', (config) => { window.tempTgConfig = config; });

socket.on('admin_strategies_list', (res) => {
    const listDiv = document.getElementById('adminStratList');
    if (!listDiv) return;
    if (res.success) {
        window.adminStrats = res.strategies;
        let html = '';
        res.strategies.forEach(s => {
            let desc = "Estratégia institucional JS Invest.";
            if (s.conditions && s.conditions.call) desc = s.conditions.call.substring(0, 45) + "...";
            if (s.name.includes('Live')) desc = "Gatilhos de Reversão/Retração (RSI + BB).";
            else if (s.indicators && s.indicators.ema) desc = "Filtro de Tendência MME + Gatilhos.";
            
            html += `
            <div style="background:#0d1117; border:1px solid #30363d; padding:10px; border-radius:6px; margin-bottom:8px; display:flex; flex-direction:column; gap:5px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <b style="color:#58a6ff; font-size:12px;">[ ${s.id} ] - ${s.name}</b>
                    <div>
                        <button onclick="viewStrat('${s.id}')" style="background:#1f6feb; border:none; color:white; padding:4px 8px; border-radius:4px; font-size:10px; cursor:pointer;">Ver JSON</button>
                        <button onclick="deleteStrat('${s.id}')" style="background:#da3633; border:none; color:white; padding:4px 8px; border-radius:4px; font-size:10px; cursor:pointer;">🗑 Excluir</button>
                    </div>
                </div>
                <span style="color:#8b949e; font-size:10px;">${desc}</span>
            </div>`;
        });
        listDiv.innerHTML = html || '<div style="text-align:center; color:#8b949e;">Nenhuma estratégia ativa.</div>';
    }
});

window.viewStrat = (id) => { const s = window.adminStrats.find(x => x.id === id); if (s) alert(JSON.stringify(s, null, 2)); };
window.deleteStrat = (id) => { if (confirm('🚨 Tem a certeza que deseja excluir esta estratégia permanentemente?')) { auth.currentUser.getIdToken().then(token => socket.emit('admin_delete_strategy', { token, id })); } };

socket.on('admin_report_data', (res) => {
    const container = document.getElementById('rankingListContainer');
    if (!container) return;
    if (!res.success || res.historico.length === 0) { container.innerHTML = '<div style="text-align:center; padding:20px; color:#8b949e;">Nenhum sinal registado hoje no banco de dados.</div>'; return; }
    let html = `<h4 style="color:#8b949e; text-align:center;">🏆 RANKING DE ASSERTIVIDADE DE HOJE</h4>`;
    res.ranking.forEach(([ativo, score], index) => {
        let winColor = score.w > score.l ? '#3fb950' : '#d29922';
        html += `<div style="display:flex; justify-content:space-between; align-items:center; background:#0d1117; border:1px solid #30363d; padding:10px 15px; margin-bottom:8px; border-radius:6px;"><span style="color:#c9d1d9; font-weight:bold;">${index + 1}º ${ativo}</span><div><span style="color:${winColor}; font-weight:bold; margin-right:15px;">✅ ${score.w}</span><span style="color:#f85149; font-weight:bold;">🔴 ${score.l}</span></div></div>`;
    });
    container.innerHTML = html;
});

socket.on('auto_trade_status', (res) => {
    isBotActive = res.active;
    const btn = document.getElementById('btnToggleBot'); const status = document.getElementById('statusBot');
    if(isBotActive) { btn.className = "btn-toggle-bot bot-on"; btn.innerText = "PARAR AUTO-TRADE"; status.innerText = res.msg; status.style.color = "#58a6ff"; } 
    else { btn.className = "btn-toggle-bot bot-off"; btn.innerText = "ATIVAR AUTO-TRADE"; status.innerText = res.msg; if(res.msg.includes("META")) status.style.color = "#e3b341"; else if(res.msg.includes("STOP")) status.style.color = "#f85149"; else status.style.color = "#8b949e"; }
    if (res.profit !== undefined) { const pVal = document.getElementById('profitVal'); if(pVal) { pVal.innerText = `R$ ${res.profit.toFixed(2).replace('.', ',')}`; pVal.style.color = res.profit >= 0 ? "#3fb950" : "#f85149"; } else { const lucroBox = document.querySelector('div:contains("Lucro da Sessão:")'); if (lucroBox) { lucroBox.innerHTML = `Lucro da Sessão: <b style="color:${res.profit >= 0 ? '#3fb950' : '#f85149'}">R$ ${res.profit.toFixed(2).replace('.', ',')}</b>`; } } }
});

socket.on('update_balance', (data) => { const el = document.getElementById(data.isDemo ? 'valDemo' : 'valReal'); el.innerText = `R$ ${data.balance}`; el.style.color = data.isDemo ? '#3fb950' : '#58a6ff'; setTimeout(() => { el.style.color = data.isDemo ? '#d29922' : '#3fb950'; }, 1000); });
socket.on('win_balance_update', (data) => { const el = document.getElementById(data.isDemo ? 'valDemo' : 'valReal'); let currentVal = parseFloat(el.innerText.replace('R$ ', '').replace(/\\./g, '').replace(',', '.')); if (!isNaN(currentVal)) { el.innerText = `R$ ${(currentVal + data.prize).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; el.style.color = '#3fb950'; el.style.textShadow = '0 0 15px rgba(63, 185, 80, 0.8)'; setTimeout(() => { el.style.color = data.isDemo ? '#d29922' : '#3fb950'; el.style.textShadow = 'none'; }, 2000); } });

socket.on('sniper_success', (msg) => { console.log("✅ " + msg); }); 
socket.on('sniper_error', (msg) => { alert("❌ Erro: " + msg); });

socket.on('available_strategies', (strats) => { const sel = document.getElementById('strategySelector'); sel.innerHTML = ''; strats.forEach(s => { const opt = document.createElement('option'); opt.value = s.id; opt.innerText = s.name; sel.appendChild(opt); }); });
socket.on('available_coins', (groupedCoins) => { const selectBox = document.getElementById('coinSelector'); if(!selectBox) return; selectBox.innerHTML = ''; for (const [categoryName, symbolsArray] of Object.entries(groupedCoins)) { let optgroup = document.createElement('optgroup'); optgroup.label = categoryName; symbolsArray.forEach(sym => { let option = document.createElement('option'); option.value = sym; option.textContent = sym.toUpperCase(); optgroup.appendChild(option); }); selectBox.appendChild(optgroup); } });
socket.on('engine_state', (state) => { const coinSel = document.getElementById('coinSelector'); const tfSel = document.getElementById('timeframeSelector'); const stratSel = document.getElementById('strategySelector'); if (coinSel && state.symbol) { for (let i = 0; i < coinSel.options.length; i++) { if (coinSel.options[i].value.toLowerCase() === state.symbol.toLowerCase()) { coinSel.selectedIndex = i; break; } } } if (tfSel && state.timeframe) tfSel.value = state.timeframe; if (stratSel && state.strategy) stratSel.value = state.strategy; });

socket.on('price_update', (data) => {
    if (data.price === 0 || !window.liveChart) return; 
    document.getElementById('priceValue').innerText = '$ ' + data.price.toFixed(2); document.getElementById('priceValue').style.color = '#c9d1d9'; const liveCard = document.getElementById('liveTradeCard');
    if (data.activeSignal) {
        if (liveCard.style.display === 'none') { liveCard.style.display = 'block'; window.liveChart.data.labels = []; window.liveChart.data.datasets[0].data = []; window.liveChart.data.datasets[1].data = []; currentEntryPrice = data.activeSignal.entryPrice; }
        const isCall = data.activeSignal.type === 'CALL'; document.getElementById('liveDir').innerText = isCall ? '🟢 CALL' : '🔴 PUT'; document.getElementById('liveDir').style.color = isCall ? '#3fb950' : '#f85149';
        document.getElementById('liveEntry').innerText = currentEntryPrice.toFixed(2); document.getElementById('liveCurrent').innerText = data.price.toFixed(2);
        let isWin = (isCall && data.price > currentEntryPrice) || (!isCall && data.price < currentEntryPrice); let isTie = data.price === currentEntryPrice;
        const statusEl = document.getElementById('liveStatus'); if (isTie) { statusEl.innerText = 'EMPATANDO'; statusEl.style.color = '#d29922'; } else if (isWin) { statusEl.innerText = 'WIN 🎯'; statusEl.style.color = '#3fb950'; } else { statusEl.innerText = 'LOSS 🔴'; statusEl.style.color = '#f85149'; }
        window.liveChart.data.labels.push(''); window.liveChart.data.datasets[0].data.push(data.price); window.liveChart.data.datasets[1].data.push(currentEntryPrice); window.liveChart.data.datasets[0].borderColor = isTie ? '#d29922' : (isWin ? '#3fb950' : '#f85149');
        if (window.liveChart.data.labels.length > 60) { window.liveChart.data.labels.shift(); window.liveChart.data.datasets[0].data.shift(); window.liveChart.data.datasets[1].data.shift(); } window.liveChart.update();
    } else { liveCard.style.display = 'none'; }
});

socket.on('pre_alert', (data) => { const alertBox = document.getElementById('alertBox'); if(data.call || data.put) { alertBox.innerHTML = `⚠️ PREPARAR: ${data.call ? "COMPRA" : "VENDA"}`; alertBox.className = "alert-box alert-pre"; } else { alertBox.innerHTML = "Analisando Mercado..."; alertBox.className = "alert-box"; } });
socket.on('signal', (data) => { const alertBox = document.getElementById('alertBox'); alertBox.innerHTML = data.type === 'CALL' ? '🟢 ENTRAR: COMPRA!' : '🔴 ENTRAR: VENDA!'; alertBox.className = "alert-box alert-go"; setTimeout(() => { alertBox.className = "alert-box"; }, 4000); });

socket.on('history_dump', (historyArr) => {
    const historyTableBody = document.getElementById('historyTableBody');
    const telaMoeda = document.getElementById('coinSelector').value.toUpperCase(); historyTableBody.innerHTML = ''; 
    historyArr.forEach(sig => {
        if (sig.symbol.toUpperCase() !== telaMoeda) return; 
        const tr = document.createElement('tr'); tr.id = `sig-${sig.id}`; const isCall = sig.type === 'CALL'; let colorClass = 'text-warning'; if (sig.status.includes('WIN')) colorClass = 'text-green'; else if (sig.status.includes('LOSS')) colorClass = 'text-red'; 
        tr.innerHTML = `<td class="text-muted">${sig.time}</td><td class="${isCall ? 'text-green' : 'text-red'}"><span style="font-size:10px; color:#8b949e; display:block;">${sig.symbol || 'BTCUSDT'}</span>${isCall ? '🟢 CALL' : '🔴 PUT'}</td><td id="res-${sig.id}" class="${colorClass}">${sig.status}</td>`;
        historyTableBody.appendChild(tr); 
        if (!sig.status.includes('WIN') && !sig.status.includes('LOSS')) { let stepText = ''; if (sig.status.includes('Gale 1')) stepText = 'Gale 1'; else if (sig.status.includes('Gale 2')) stepText = 'Gale 2'; else stepText = sig.isManual ? 'Sniper (1ª)' : 'Auto (1ª)'; manageFifoAlert({ id: 'sig-' + sig.id, symbol: sig.symbol, time: sig.time, type: sig.type, stepText: stepText, isEnd: false, isRadar: false }); }
    });
});

socket.on('scoreboard', (data) => {
    document.getElementById('scoreWin1').innerText = data.win1; document.getElementById('scoreWinG1').innerText = data.winG1; document.getElementById('scoreWinG2').innerText = data.winG2; document.getElementById('scoreLoss').innerText = data.loss;
    const total = data.win1 + data.winG1 + data.winG2 + data.loss;
    if (total > 0) { const wins = data.win1 + data.winG1 + data.winG2; document.getElementById('totalAccuracy').innerText = ((wins / total) * 100).toFixed(1) + '%'; document.getElementById('pctWin1').innerText = ((data.win1 / total) * 100).toFixed(1) + '%'; document.getElementById('pctWinG1').innerText = ((data.winG1 / total) * 100).toFixed(1) + '%'; document.getElementById('pctWinG2').innerText = ((data.winG2 / total) * 100).toFixed(1) + '%'; document.getElementById('pctLoss').innerText = ((data.loss / total) * 100).toFixed(1) + '%'; }
});

socket.on('new_signal_history', (sig) => {
    const historyTableBody = document.getElementById('historyTableBody');
    const telaMoeda = document.getElementById('coinSelector').value.toUpperCase();
    manageFifoAlert({ id: 'sig-' + sig.id, symbol: sig.symbol, time: sig.time, type: sig.type, stepText: sig.isManual ? 'Sniper (1ª)' : 'Auto (1ª)', isEnd: false, isRadar: false });
    if (sig.symbol.toUpperCase() !== telaMoeda) return; 
    const tr = document.createElement('tr'); tr.id = `sig-${sig.id}`; let colorClass = 'text-warning'; 
    tr.innerHTML = `<td class="text-muted">${sig.time}</td><td class="${sig.type === 'CALL' ? 'text-green' : 'text-red'}"><span style="font-size:10px; color:#8b949e; display:block;">${sig.symbol || 'BTCUSDT'}</span>${sig.type === 'CALL' ? '🟢 CALL' : '🔴 PUT'}</td><td id="res-${sig.id}" class="${colorClass}">${sig.status}</td>`;
    historyTableBody.prepend(tr); 
});

socket.on('signal_result', (sig) => {
    let stepText = ''; let isEnd = false;
    if (sig.status.includes('Gale 1')) stepText = 'Gale 1'; else if (sig.status.includes('Gale 2')) stepText = 'Gale 2'; else if (sig.status.includes('WIN') || sig.status.includes('LOSS')) { stepText = sig.status.includes('WIN') ? 'WIN 🎯' : 'LOSS 🔴'; isEnd = true; } else { stepText = sig.status; }
    manageFifoAlert({ id: 'sig-' + sig.id, symbol: sig.symbol, time: sig.time, type: sig.type, stepText: stepText, isEnd: isEnd, isRadar: false });
    const resTd = document.getElementById(`res-${sig.id}`);
    if (resTd) { resTd.innerText = sig.status; if (sig.status.includes('WIN')) resTd.className = 'text-green'; else if (sig.status.includes('LOSS')) resTd.className = 'text-red'; else resTd.className = 'text-warning'; }
});

socket.on('admin_users_list', (res) => {
    const tbody = document.getElementById('usersListBody'); tbody.innerHTML = '';
    if (res.success) {
        if (res.users.length === 0) tbody.innerHTML = '<tr><td colspan="2" style="text-align:center;">Vazio.</td></tr>';
        else { res.users.forEach(u => { const tr = document.createElement('tr'); tr.innerHTML = `<td style="padding: 10px; border-bottom: 1px solid #21262d;">${u.email}</td><td style="padding: 10px; border-bottom: 1px solid #21262d; color: ${u.role.includes('admin') ? '#58a6ff' : '#8b949e'};">${u.role.toUpperCase()}</td>`; tbody.appendChild(tr); }); }
    }
});

socket.on('user_creation_result', (res) => { alert(res.msg); if(document.getElementById('btnCreateUser')) document.getElementById('btnCreateUser').innerText = 'Cadastrar'; if(res.success) { if(document.getElementById('newUserEmail')) document.getElementById('newUserEmail').value = ''; if(document.getElementById('newUserPassword')) document.getElementById('newUserPassword').value = ''; auth.currentUser.getIdToken().then(token => socket.emit('admin_get_users', token)); } });

function getInstitutionalRiskConfig() {
    const isDemo = document.getElementById('riskAccount').value === 'demo';
    const uid = localStorage.getItem('jsInvestUid');
    
    const realBalStr = document.getElementById('valReal').innerText;
    const realBalNum = parseFloat(realBalStr.replace('R$ ', '').replace(/\./g, '').replace(',', '.'));
    
    if (!isDemo && uid !== 'admin_master' && realBalNum <= 0) {
        alert("⚠️ GESTÃO INSTITUCIONAL: SALDO INSUFICIENTE\n\nA sua entrada é fixada em 1% da banca. O seu saldo precisa ser maior que R$ 0,00 para operar na conta Real.\n\n👉 Use a Conta Demo;\n👉 Deposite saldo na corretora;\n👉 Ou use o modo FREE (apenas com Sinais).");
        return null; 
    }

    const demoBalStr = document.getElementById('valDemo').innerText;
    const demoBalNum = parseFloat(demoBalStr.replace('R$ ', '').replace(/\./g, '').replace(',', '.'));
    const targetBalance = isDemo ? demoBalNum : realBalNum;
    
    let calculatedAmount = targetBalance * 0.01;
    if (calculatedAmount < 5) calculatedAmount = 5; 
    if (uid === 'admin_master') calculatedAmount = 5; 
    
    return {
        accountType: isDemo ? 'demo' : 'real',
        baseAmount: calculatedAmount, 
        payout: 85, 
        maxGale: 2, 
        stopWin: parseFloat(document.getElementById('riskWin').value),
        stopLoss: parseFloat(document.getElementById('riskLoss').value)
    };
}

document.getElementById('btnLogin').addEventListener('click', () => {
    const btn = document.getElementById('btnLogin'); btn.innerText = "Autenticando..."; document.getElementById('loginError').style.display = 'none';
    socket.emit('hybrid_login', { brokerUser: document.getElementById('brokerLoginInput').value, brokerPass: document.getElementById('brokerPassInput').value });
});

document.getElementById('btnLogout').addEventListener('click', () => { localStorage.removeItem('jsInvestBrokerToken'); localStorage.removeItem('jsInvestUserRole'); localStorage.removeItem('jsInvestUid'); auth.signOut().then(() => { window.location.reload(); }); });

document.getElementById('btnToggleBot').addEventListener('click', () => {
    const config = getInstitutionalRiskConfig();
    if (!config) return; 

    isBotActive = !isBotActive; saveRiskConfig(); 
    config.active = isBotActive;
    socket.emit('setup_auto_trade', config);
});

document.getElementById('btnManualCall').addEventListener('click', () => { 
    const config = getInstitutionalRiskConfig();
    if (!config) return;
    saveRiskConfig(); 
    socket.emit('manual_trade', { direction: 'CALL', config: config, symbol: document.getElementById('coinSelector').value, timeframe: document.getElementById('timeframeSelector').value }); 
});

document.getElementById('btnManualPut').addEventListener('click', () => { 
    const config = getInstitutionalRiskConfig();
    if (!config) return;
    saveRiskConfig(); 
    socket.emit('manual_trade', { direction: 'PUT', config: config, symbol: document.getElementById('coinSelector').value, timeframe: document.getElementById('timeframeSelector').value }); 
});

document.getElementById('coinSelector').addEventListener('change', (e) => { clearUIForLoading(); socket.emit('change_coin', e.target.value); });
document.getElementById('strategySelector').addEventListener('change', (e) => { clearUIForLoading(); socket.emit('change_strategy', e.target.value); });
document.getElementById('timeframeSelector').addEventListener('change', (e) => { clearUIForLoading(); socket.emit('change_timeframe', e.target.value); });

const adminModal = document.getElementById('adminModal');
if(document.getElementById('btnAdminPanel')) { 
    document.getElementById('btnAdminPanel').addEventListener('click', () => { 
        adminModal.style.display = 'flex'; 
        auth.currentUser.getIdToken().then(token => socket.emit('admin_get_users', token)); 
        if (window.tempTgConfig) { 
            if(document.getElementById('tgRsiOver')) document.getElementById('tgRsiOver').value = window.tempTgConfig.rsiOver || '65'; 
            if(document.getElementById('tgRsiUnder')) document.getElementById('tgRsiUnder').value = window.tempTgConfig.rsiUnder || '35'; 
            if(document.getElementById('tgBbDev')) document.getElementById('tgBbDev').value = window.tempTgConfig.bbDev || '2'; 
            
            if(document.getElementById('tgHoraManha')) document.getElementById('tgHoraManha').value = window.tempTgConfig.horaManha || '09:30'; 
            if(document.getElementById('tgHoraTarde')) document.getElementById('tgHoraTarde').value = window.tempTgConfig.horaTarde || '15:30'; 
            
            if(document.getElementById('tgDias')) document.getElementById('tgDias').value = window.tempTgConfig.dias || '1-5'; 
            if(document.getElementById('tgMaxSinais')) document.getElementById('tgMaxSinais').value = window.tempTgConfig.maxSinais || '2'; 
            if(document.getElementById('tgStkStart')) document.getElementById('tgStkStart').value = window.tempTgConfig.stkStart || ''; 
            if(document.getElementById('tgStkEnd')) document.getElementById('tgStkEnd').value = window.tempTgConfig.stkEnd || ''; 
            if(document.getElementById('tgStkWin')) document.getElementById('tgStkWin').value = window.tempTgConfig.stkWin || ''; 
            if(document.getElementById('tgStkLoss')) document.getElementById('tgStkLoss').value = window.tempTgConfig.stkLoss || ''; 
            
            const msgDefault = "⚡ *ALERTA DE TOQUE (M1)* ⚡\n\n💵 Moeda = {MOEDA}\n⏰ Expiração = 1 Minuto\n🛎 Entrada = {HORA_ENTRADA}\n{DIRECAO}\n\n👉🏼 Se necessário, fazer 1 Gale.";
            if(document.getElementById('tgMsgSinal')) document.getElementById('tgMsgSinal').value = window.tempTgConfig.msgSinal || msgDefault; 
        } 
    }); 
}
if(document.getElementById('btnCreateUser')) { document.getElementById('btnCreateUser').addEventListener('click', () => { const newEmail = document.getElementById('newUserEmail').value; const newPassword = document.getElementById('newUserPassword').value; const newRole = document.getElementById('newUserRole').value; document.getElementById('btnCreateUser').innerText = '...'; auth.currentUser.getIdToken().then(token => socket.emit('admin_create_user', { token, newEmail, newPassword, newRole })); }); }
if(document.getElementById('btnInjectCookie')) { document.getElementById('btnInjectCookie').addEventListener('click', () => { const cookieVal = document.getElementById('adminCookieInput').value; if(cookieVal.length > 20) { socket.emit('inject_cookie', cookieVal); document.getElementById('adminCookieInput').value = ''; document.getElementById('btnInjectCookie').innerText = 'Injetado! ✅'; setTimeout(() => { document.getElementById('btnInjectCookie').innerText = 'Injetar'; }, 3000); } else { alert('❌ Cookie inválido!'); } }); }

setInterval(() => { const tfSelect = document.getElementById('timeframeSelector'); const tfMinutes = tfSelect ? parseInt(tfSelect.value.replace('m', '')) : 1; const now = new Date(); const sec = (tfMinutes * 60) - ((now.getMinutes() % tfMinutes) * 60 + now.getSeconds()); let displayTime = ''; if (sec >= 60) { const m = Math.floor(sec / 60); const s = sec % 60; displayTime = `${m < 10 ? '0'+m : m}:${s < 10 ? '0'+s : s}`; } else { displayTime = sec < 10 ? '0' + sec : sec; } document.getElementById('timerCircle').innerText = displayTime; const liveCard = document.getElementById('liveTradeCard'); if (liveCard && liveCard.style.display !== 'none') { document.getElementById('liveTime').innerText = displayTime + (sec < 60 ? 's' : ''); } }, 1000);