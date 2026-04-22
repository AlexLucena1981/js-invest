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
window.pixInterval = null; 
window.lastPaymentId = null;

window.appPricing = { month1: 49.90, month3: 119.90, month6: 199.90, month12: 399.90 };

socket.on('pricing_update', (prices) => {
    if (prices) {
        window.appPricing = prices;
        if (document.getElementById('price1')) document.getElementById('price1').value = prices.month1;
        if (document.getElementById('price3')) document.getElementById('price3').value = prices.month3;
        if (document.getElementById('price6')) document.getElementById('price6').value = prices.month6;
        if (document.getElementById('price12')) document.getElementById('price12').value = prices.month12;
    }
});

window.switchAdminTab = function(tabName) {
    const tabs = ['Users', 'Pix', 'Pricing', 'Telegram', 'Radar', 'Report', 'Strategies'];
    tabs.forEach(t => {
        const tabEl = document.getElementById(`adminTab${t}`);
        if(tabEl) tabEl.style.display = 'none';
        const btn = document.getElementById(`btnTab${t}`);
        if(btn) { btn.style.color = '#8b949e'; btn.style.borderBottomColor = 'transparent'; }
    });

    let activeColor = '#58a6ff'; 
    if(tabName === 'pix') activeColor = '#3fb950'; 
    if(tabName === 'pricing') activeColor = '#d29922'; 
    if(tabName === 'telegram') activeColor = '#2ea043'; 
    if(tabName === 'radar') activeColor = '#388bfd'; 
    if(tabName === 'report') activeColor = '#8957e5'; 
    if(tabName === 'strategies') activeColor = '#d29922'; 

    const activeTabName = tabName.charAt(0).toUpperCase() + tabName.slice(1);
    const targetTab = document.getElementById(`adminTab${activeTabName}`);
    if(targetTab) targetTab.style.display = 'block';
    
    const activeBtn = document.getElementById(`btnTab${activeTabName}`);
    if(activeBtn) { activeBtn.style.color = activeColor; activeBtn.style.borderBottomColor = activeColor; }

    if(tabName === 'radar' && typeof renderStats === 'function') {
        if(window.radarGlobalStats) renderStats(window.radarGlobalStats);
    }
    
    if(tabName === 'report') {
        auth.currentUser.getIdToken().then(token => socket.emit('admin_get_report', token));
    }
    
    if(tabName === 'strategies') {
        auth.currentUser.getIdToken().then(token => socket.emit('admin_get_strategies', token));
        const defaultStratJSON = {
            "id": "nova_estrat", "name": "Nome da Estratégia", "isComplex": false,
            "indicators": { "rsi": { "type": "RSI", "period": 14 }, "bb": { "type": "BB", "period": 20, "stdDev": 2 } },
            "conditions": { "call": "current.price <= current.bb.lower && current.rsi <= 35", "put": "current.price >= current.bb.upper && current.rsi >= 65" }
        };
        if(document.getElementById('newStratJson')) document.getElementById('newStratJson').value = JSON.stringify(defaultStratJSON, null, 4);
    }
};

window.addEventListener('DOMContentLoaded', () => {
    initChart(); 
    
    const amtInput = document.getElementById('riskAmount');
    if (amtInput) {
        amtInput.type = 'text'; amtInput.value = '1% da Banca'; amtInput.setAttribute('readonly', 'true');
        const label = amtInput.parentElement.querySelector('label'); if (label) label.innerText = 'ENTRADA (1%)';
        const amtCol = amtInput.parentElement; const contaCol = document.getElementById('riskAccount').parentElement;
        if (amtCol.classList.contains('col-4')) { amtCol.classList.remove('col-4'); amtCol.classList.add('col-6'); }
        if (contaCol && contaCol.classList.contains('col-4')) { contaCol.classList.remove('col-4'); contaCol.classList.add('col-6'); }
    }

    const riskGale = document.getElementById('riskGale'); if (riskGale && riskGale.parentElement) { riskGale.parentElement.style.display = 'none'; }
    const btnAddScript = document.getElementById('btnOpenModal'); if (btnAddScript) { btnAddScript.style.display = 'none'; }
    ['riskAccount', 'riskWin', 'riskLoss'].forEach(id => { const el = document.getElementById(id); if(el) el.addEventListener('change', saveRiskConfig); });

    togglePremiumUI(false, new Date());

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
    if (typeof renderStats === 'function') renderStats(window.radarGlobalStats);
});

socket.on('hybrid_login_result', (res) => {
    document.getElementById('btnLogin').innerText = "Acessar Sistema";
    if (res.success) {
        localStorage.setItem('jsInvestBrokerToken', res.brokerToken); localStorage.setItem('jsInvestUserRole', res.role); localStorage.setItem('jsInvestUid', res.uid);
        auth.signInWithCustomToken(res.firebaseToken).then(() => {
            document.getElementById('loginScreen').style.display = 'none'; document.getElementById('valReal').innerText = `R$ ${res.balance.real}`; document.getElementById('valDemo').innerText = res.balance.demo; document.getElementById('manualTradePanel').style.display = 'flex'; 
            togglePremiumUI(res.isPremium, res.expiresAt);
            if (!res.isPremium) { mostrarPainelAssinatura(res.expiresAt); }
            if (res.role === 'admin') { 
                document.getElementById('btnAdminPanel').style.display = 'inline-block';
                setupTelegramAdminUI(auth, socket); 
                auth.currentUser.getIdToken().then(token => socket.emit('admin_get_tg_config', token)); 
            }
        }).catch(err => { alert("Erro de Autenticação Firebase: " + err.message); });
    } else { 
        const errorDiv = document.getElementById('loginError'); errorDiv.innerText = res.msg || "Erro na autenticação. Verifique suas credenciais."; errorDiv.style.display = 'block';
        const btnAff = document.getElementById('btnAffiliate'); if (btnAff) btnAff.style.display = 'block';
    }
});

socket.on('auto_reconnect_result', (res) => {
    if(res.success) {
        document.getElementById('loginScreen').style.display = 'none'; document.getElementById('valReal').innerText = `R$ ${res.balance.real}`; document.getElementById('valDemo').innerText = res.balance.demo; document.getElementById('manualTradePanel').style.display = 'flex'; 
        togglePremiumUI(res.isPremium, res.expiresAt);
        if (!res.isPremium) { mostrarPainelAssinatura(res.expiresAt); }
        if (res.role === 'admin') { 
            document.getElementById('btnAdminPanel').style.display = 'inline-block';
            setupTelegramAdminUI(auth, socket); 
            auth.currentUser.getIdToken().then(token => socket.emit('admin_get_tg_config', token)); 
        }
    } else { 
        localStorage.removeItem('jsInvestBrokerToken'); localStorage.removeItem('jsInvestUserRole'); localStorage.removeItem('jsInvestUid'); 
        document.getElementById('btnLogin').innerText = "Acessar Sistema"; 
        alert(res.msg || "Sessão expirada.");
    }
});

window.gerarCheckout = async (valor, meses) => {
    const uid = localStorage.getItem('jsInvestUid');
    const email = auth.currentUser ? auth.currentUser.email : "user@jsinvest";

    document.getElementById('pixArea').style.display = 'block';
    document.getElementById('pixArea').innerHTML = "<p style='color:#000; text-align:center;'>Aguarde... Gerando Cobrança PIX.</p>";

    try {
        const response = await fetch('/create_payment', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ valor, meses, uid, email })
        });
        const data = await response.json();

        if (data.pix_code) {
            window.lastPaymentId = data.paymentId;
            document.getElementById('pixArea').innerHTML = `
                <p style="color:#000; font-weight:bold; margin-bottom:10px;">Pague o PIX para liberar agora:</p>
                ${data.qrcode_base64 ? `<div style="background:#fff; padding:10px; display:inline-block; margin-bottom:10px;"><img src="${data.qrcode_base64}" style="width:180px;"></div>` : ''}
                <input type="text" id="pixCopyPaste" value="${data.pix_code}" readonly style="width:100%; padding:10px; font-size:10px; background:#f0f0f0; border:1px solid #ccc; border-radius:4px; color:#000;">
                <button onclick="copyPix()" style="background:#000; color:#fff; width:100%; border:none; padding:12px; margin-top:10px; border-radius:5px; cursor:pointer; font-weight:bold;">COPIAR CÓDIGO PIX</button>
                <button onclick="verificarPix('${data.paymentId}')" id="btnVerifyPix" style="background:#3fb950; color:#fff; width:100%; border:none; padding:12px; margin-top:10px; border-radius:5px; cursor:pointer; font-weight:bold;">🔄 JÁ PAGUEI (VERIFICAR)</button>
            `;
            if(window.pixInterval) clearInterval(window.pixInterval);
            window.pixInterval = setInterval(() => { window.verificarPix(data.paymentId, true) }, 10000);
        }
    } catch (e) { alert("Erro ao gerar pagamento."); }
};

window.copyPix = () => {
    const input = document.getElementById('pixCopyPaste'); input.select(); input.setSelectionRange(0, 99999); navigator.clipboard.writeText(input.value);
    alert("✅ Código PIX Copiado! Pague no app do seu banco e o acesso será liberado.");
};

window.verificarPix = async (paymentId, isAuto = false) => {
    if(!isAuto) { const btn = document.getElementById('btnVerifyPix'); if(btn) btn.innerText = "Consultando o Banco..."; }
    try {
        const res = await fetch(`/verify_payment/${paymentId}`); const data = await res.json();
        if (!data.approved && !isAuto) {
            const btn = document.getElementById('btnVerifyPix');
            if(btn) { btn.innerText = "Ainda não aprovado. Tentar de novo"; setTimeout(()=> { btn.innerText = "🔄 JÁ PAGUEI (VERIFICAR)" }, 2000); }
        }
    } catch(e) {}
};

socket.on('payment_approved', (data) => {
    if(window.pixInterval) clearInterval(window.pixInterval);
    alert("✅ PAGAMENTO APROVADO! O seu acesso foi liberado com sucesso.");
    const modal = document.getElementById('premiumBlockModal'); if (modal) modal.style.display = 'none'; togglePremiumUI(true, data.expiresAt);
});

socket.on('admin_tg_config_data', (config) => { window.tempTgConfig = config; });

socket.on('admin_users_list', (res) => {
    const tbody = document.getElementById('usersListBody'); if(!tbody) return; tbody.innerHTML = '';
    if (res.success) {
        if (res.users.length === 0) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px; color:#8b949e;">Vazio.</td></tr>';
        else { 
            res.users.forEach(u => { 
                let statusHtml = '';
                if (u.role === 'admin') { statusHtml = '<span style="color:#58a6ff; font-weight:bold;">🟢 ADMIN</span>'; } 
                else if (u.subscriptionEndDate) {
                    const exp = new Date(u.subscriptionEndDate); const now = new Date(); const diffDays = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
                    if (diffDays < 0) { statusHtml = `<span style="color:#f85149; font-weight:bold;">🔴 Expirada (${exp.toLocaleDateString()})</span>`; } 
                    else if (diffDays <= 5) { statusHtml = `<span style="color:#d29922; font-weight:bold;">🟡 Expira em ${diffDays} dias</span>`; } 
                    else { statusHtml = `<span style="color:#3fb950; font-weight:bold;">🟢 Válida (${exp.toLocaleDateString()})</span>`; }
                } else { statusHtml = '<span style="color:#8b949e;">Sem Data</span>'; }

                const tr = document.createElement('tr'); 
                tr.innerHTML = `<td style="padding: 10px; border-bottom: 1px solid #21262d; font-size:11px; color:#8b949e;">${u.document || u.id}</td><td style="padding: 10px; border-bottom: 1px solid #21262d; font-weight:bold; color:#c9d1d9;">${u.name || '---'}</td><td style="padding: 10px; border-bottom: 1px solid #21262d; font-size:11px; color:#8b949e;">${u.email}</td><td style="padding: 10px; border-bottom: 1px solid #21262d;">${statusHtml}</td>`; 
                tbody.appendChild(tr); 
            }); 
        }
    }
});

socket.on('admin_payments_list', (res) => {
    const tbody = document.getElementById('paymentsListBody'); if(!tbody) return; tbody.innerHTML = '';
    if (res.success) {
        if (res.payments.length === 0) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 20px; color:#8b949e;">Nenhum PIX gerado ainda.</td></tr>';
        else {
            res.payments.forEach(p => {
                const dateStr = p.createdAt ? new Date(p.createdAt).toLocaleString('pt-BR') : '---';
                const statusColor = p.status === 'approved' ? '#3fb950' : '#d29922'; const statusText = p.status === 'approved' ? 'PAGO' : 'PENDENTE';
                const tr = document.createElement('tr');
                tr.innerHTML = `<td style="padding: 10px; border-bottom: 1px solid #21262d; font-size:11px; color:#8b949e;">${dateStr}</td><td style="padding: 10px; border-bottom: 1px solid #21262d; font-size:11px; color:#8b949e;">${p.email || p.uid}</td><td style="padding: 10px; border-bottom: 1px solid #21262d; color:#58a6ff; font-weight:bold;">R$ ${parseFloat(p.valor).toFixed(2).replace('.', ',')}</td><td style="padding: 10px; border-bottom: 1px solid #21262d; color:#8b949e; font-size:11px;">${p.meses} Mês(es)</td><td style="padding: 10px; border-bottom: 1px solid #21262d; color:${statusColor}; font-weight:bold; font-size:11px;">${statusText}</td>`;
                tbody.appendChild(tr);
            });
        }
    }
});

socket.on('user_creation_result', (res) => { alert(res.msg); if(document.getElementById('btnCreateUser')) document.getElementById('btnCreateUser').innerText = 'Cadastrar'; if(res.success) { if(document.getElementById('newUserEmail')) document.getElementById('newUserEmail').value = ''; if(document.getElementById('newUserPassword')) document.getElementById('newUserPassword').value = ''; auth.currentUser.getIdToken().then(token => socket.emit('admin_get_users', token)); } });

socket.on('auto_trade_status', (res) => {
    isBotActive = res.active; const btn = document.getElementById('btnToggleBot'); const status = document.getElementById('statusBot');
    if(isBotActive) { btn.className = "btn-toggle-bot bot-on"; btn.innerText = "PARAR AUTO-TRADE"; status.innerText = res.msg; status.style.color = "#58a6ff"; } 
    else { btn.className = "btn-toggle-bot bot-off"; btn.innerText = "ATIVAR AUTO-TRADE"; status.innerText = res.msg; if(res.msg.includes("META")) status.style.color = "#e3b341"; else if(res.msg.includes("STOP")) status.style.color = "#f85149"; else status.style.color = "#8b949e"; }
    if (res.profit !== undefined) { const pVal = document.getElementById('profitVal'); if(pVal) { pVal.innerText = `R$ ${res.profit.toFixed(2).replace('.', ',')}`; pVal.style.color = res.profit >= 0 ? "#3fb950" : "#f85149"; } }
});

socket.on('update_balance', (data) => { const el = document.getElementById(data.isDemo ? 'valDemo' : 'valReal'); el.innerText = `R$ ${data.balance}`; el.style.color = data.isDemo ? '#3fb950' : '#58a6ff'; setTimeout(() => { el.style.color = data.isDemo ? '#d29922' : '#3fb950'; }, 1000); });
socket.on('win_balance_update', (data) => { const el = document.getElementById(data.isDemo ? 'valDemo' : 'valReal'); let currentVal = parseFloat(el.innerText.replace('R$ ', '').replace(/\\./g, '').replace(',', '.')); if (!isNaN(currentVal)) { el.innerText = `R$ ${(currentVal + data.prize).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; el.style.color = '#3fb950'; el.style.textShadow = '0 0 15px rgba(63, 185, 80, 0.8)'; setTimeout(() => { el.style.color = data.isDemo ? '#d29922' : '#3fb950'; el.style.textShadow = 'none'; }, 2000); } });

// 🎯 VISUALIZADOR DE ERROS DA CORRETORA: Se a Vellox recusar a ordem, avisa na tela!
socket.on('sniper_error', (msg) => { alert("❌ ALERTA AUTO-TRADE:\n" + msg); });
socket.on('sniper_success', (msg) => { console.log("✅ " + msg); });

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
    const historyTableBody = document.getElementById('historyTableBody'); const telaMoeda = document.getElementById('coinSelector').value.toUpperCase(); historyTableBody.innerHTML = ''; 
    let adicionados = 0;
    historyArr.forEach(sig => {
        if (sig.symbol.toUpperCase() !== telaMoeda) return; adicionados++;
        const tr = document.createElement('tr'); tr.id = `sig-${sig.id}`; const isCall = sig.type === 'CALL'; let colorClass = 'text-warning'; if (sig.status.includes('WIN')) colorClass = 'text-green'; else if (sig.status.includes('LOSS')) colorClass = 'text-red'; 
        tr.innerHTML = `<td class="text-muted">${sig.time}</td><td class="${isCall ? 'text-green' : 'text-red'}"><span style="font-size:10px; color:#8b949e; display:block;">${sig.symbol || 'BTCUSDT'}</span>${isCall ? '🟢 CALL' : '🔴 PUT'}</td><td id="res-${sig.id}" class="${colorClass}">${sig.status}</td>`; historyTableBody.appendChild(tr); 
        if (!sig.status.includes('WIN') && !sig.status.includes('LOSS')) { let stepText = ''; if (sig.status.includes('Gale 1')) stepText = 'Gale 1'; else if (sig.status.includes('Gale 2')) stepText = 'Gale 2'; else stepText = sig.isManual ? 'Sniper (1ª)' : 'Auto (1ª)'; manageFifoAlert({ id: 'sig-' + sig.id, symbol: sig.symbol, time: sig.time, type: sig.type, stepText: stepText, isEnd: false, isRadar: false }); }
    });
    if (adicionados === 0) { historyTableBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#8b949e; padding: 25px 10px; font-size:12px;">Nenhum sinal encontrado.</td></tr>`; }
});

socket.on('scoreboard', (data) => {
    document.getElementById('scoreWin1').innerText = data.win1; document.getElementById('scoreWinG1').innerText = data.winG1; document.getElementById('scoreWinG2').innerText = data.winG2; document.getElementById('scoreLoss').innerText = data.loss;
    const total = data.win1 + data.winG1 + data.winG2 + data.loss;
    if (total > 0) { const wins = data.win1 + data.winG1 + data.winG2; document.getElementById('totalAccuracy').innerText = ((wins / total) * 100).toFixed(1) + '%'; document.getElementById('pctWin1').innerText = ((data.win1 / total) * 100).toFixed(1) + '%'; document.getElementById('pctWinG1').innerText = ((data.winG1 / total) * 100).toFixed(1) + '%'; document.getElementById('pctWinG2').innerText = ((data.winG2 / total) * 100).toFixed(1) + '%'; document.getElementById('pctLoss').innerText = ((data.loss / total) * 100).toFixed(1) + '%'; }
});

socket.on('new_signal_history', (sig) => {
    const historyTableBody = document.getElementById('historyTableBody'); const telaMoeda = document.getElementById('coinSelector').value.toUpperCase();
    manageFifoAlert({ id: 'sig-' + sig.id, symbol: sig.symbol, time: sig.time, type: sig.type, stepText: sig.isManual ? 'Sniper (1ª)' : 'Auto (1ª)', isEnd: false, isRadar: false });
    if (sig.symbol.toUpperCase() !== telaMoeda) return; 
    const tr = document.createElement('tr'); tr.id = `sig-${sig.id}`; let colorClass = 'text-warning'; 
    tr.innerHTML = `<td class="text-muted">${sig.time}</td><td class="${sig.type === 'CALL' ? 'text-green' : 'text-red'}"><span style="font-size:10px; color:#8b949e; display:block;">${sig.symbol || 'BTCUSDT'}</span>${sig.type === 'CALL' ? '🟢 CALL' : '🔴 PUT'}</td><td id="res-${sig.id}" class="${colorClass}">${sig.status}</td>`; historyTableBody.prepend(tr); 
});

socket.on('signal_result', (sig) => {
    let stepText = ''; let isEnd = false;
    if (sig.status.includes('Gale 1')) stepText = 'Gale 1'; else if (sig.status.includes('Gale 2')) stepText = 'Gale 2'; else if (sig.status.includes('WIN') || sig.status.includes('LOSS')) { stepText = sig.status.includes('WIN') ? 'WIN 🎯' : 'LOSS 🔴'; isEnd = true; } else { stepText = sig.status; }
    manageFifoAlert({ id: 'sig-' + sig.id, symbol: sig.symbol, time: sig.time, type: sig.type, stepText: stepText, isEnd: isEnd, isRadar: false });
    const resTd = document.getElementById(`res-${sig.id}`);
    if (resTd) { resTd.innerText = sig.status; if (sig.status.includes('WIN')) resTd.className = 'text-green'; else if (sig.status.includes('LOSS')) resTd.className = 'text-red'; else resTd.className = 'text-warning'; }
});

// 🎯 LISTAGEM DE ESTRATÉGIAS RESTAURADA
socket.on('admin_strategies_list', (res) => {
    const listDiv = document.getElementById('adminStratList'); if (!listDiv) return;
    if (res.success) {
        window.adminStrats = res.strategies; let html = '';
        res.strategies.forEach(s => {
            let desc = "Estratégia institucional JS Invest.";
            if (s.conditions && s.conditions.call) desc = s.conditions.call.substring(0, 45) + "...";
            html += `<div style="background:#0d1117; border:1px solid #30363d; padding:10px; border-radius:6px; margin-bottom:8px; display:flex; flex-direction:column; gap:5px;"><div style="display:flex; justify-content:space-between; align-items:center;"><b style="color:#58a6ff; font-size:12px;">[ ${s.id} ] - ${s.name}</b><div><button onclick="viewStrat('${s.id}')" style="background:#1f6feb; border:none; color:white; padding:4px 8px; border-radius:4px; font-size:10px; cursor:pointer;">Ver JSON</button> <button onclick="deleteStrat('${s.id}')" style="background:#da3633; border:none; color:white; padding:4px 8px; border-radius:4px; font-size:10px; cursor:pointer;">🗑 Excluir</button></div></div><span style="color:#8b949e; font-size:10px;">${desc}</span></div>`;
        });
        listDiv.innerHTML = html || '<div style="text-align:center; color:#8b949e;">Nenhuma estratégia ativa.</div>';
    }
});

window.viewStrat = (id) => { const s = window.adminStrats.find(x => x.id === id); if (s) alert(JSON.stringify(s, null, 2)); }; window.deleteStrat = (id) => { if (confirm('🚨 Tem a certeza que deseja excluir esta estratégia permanentemente?')) { auth.currentUser.getIdToken().then(token => socket.emit('admin_delete_strategy', { token, id })); } };

// 🎯 RELATÓRIO MOMENTÂNEO DO ROBÔ RESTAURADO
socket.on('admin_report_data', (res) => {
    const container = document.getElementById('rankingListContainer'); if (!container) return;
    if (!res.success || res.historico.length === 0) { container.innerHTML = '<div style="text-align:center; padding:20px; color:#8b949e;">Nenhum sinal registado hoje no banco de dados.</div>'; return; }
    let html = `<h4 style="color:#8b949e; text-align:center;">🏆 RANKING DE ASSERTIVIDADE DE HOJE</h4>`;
    res.ranking.forEach(([ativo, score], index) => { let winColor = score.w > score.l ? '#3fb950' : '#d29922'; html += `<div style="display:flex; justify-content:space-between; align-items:center; background:#0d1117; border:1px solid #30363d; padding:10px 15px; margin-bottom:8px; border-radius:6px;"><span style="color:#c9d1d9; font-weight:bold;">${index + 1}º ${ativo}</span><div><span style="color:${winColor}; font-weight:bold; margin-right:15px;">✅ ${score.w}</span><span style="color:#f85149; font-weight:bold;">🔴 ${score.l}</span></div></div>`; });
    container.innerHTML = html;
});

function getInstitutionalRiskConfig() {
    const isDemo = document.getElementById('riskAccount').value === 'demo'; 
    const uid = localStorage.getItem('jsInvestUid');
    
    const realBalStr = document.getElementById('valReal').innerText; 
    const realBalNum = parseFloat(realBalStr.replace('R$ ', '').replace(/\./g, '').replace(',', '.'));
    
    const demoBalStr = document.getElementById('valDemo').innerText; 
    const demoBalNum = parseFloat(demoBalStr.replace('R$ ', '').replace(/\./g, '').replace(',', '.'));
    
    const targetBalance = isDemo ? demoBalNum : realBalNum;
    
    // 🎯 AQUI ESTÁ A CORREÇÃO DE MILHÕES! Evita o NaN da Banca Demo!
    let calculatedAmount = targetBalance * 0.01; 
    if (isNaN(calculatedAmount) || calculatedAmount < 5) calculatedAmount = 5; 
    if (uid === 'admin_master') calculatedAmount = 5; 
    
    return { 
        accountType: isDemo ? 'demo' : 'real', 
        baseAmount: calculatedAmount, 
        payout: 85, 
        maxGale: parseInt(document.getElementById('riskGale').value) || 2, 
        stopWin: parseFloat(document.getElementById('riskWin').value), 
        stopLoss: parseFloat(document.getElementById('riskLoss').value) 
    };
}

document.getElementById('btnLogin').addEventListener('click', () => { const btn = document.getElementById('btnLogin'); btn.innerText = "Autenticando..."; document.getElementById('loginError').style.display = 'none'; socket.emit('hybrid_login', { brokerUser: document.getElementById('brokerLoginInput').value, brokerPass: document.getElementById('brokerPassInput').value }); });
document.getElementById('btnLogout').addEventListener('click', () => { localStorage.removeItem('jsInvestBrokerToken'); localStorage.removeItem('jsInvestUserRole'); localStorage.removeItem('jsInvestUid'); auth.signOut().then(() => { window.location.reload(); }); });
document.getElementById('btnToggleBot').addEventListener('click', () => { const config = getInstitutionalRiskConfig(); if (!config) return; isBotActive = !isBotActive; saveRiskConfig(); config.active = isBotActive; socket.emit('setup_auto_trade', config); });
document.getElementById('btnManualCall').addEventListener('click', () => { const config = getInstitutionalRiskConfig(); if (!config) return; saveRiskConfig(); socket.emit('manual_trade', { direction: 'CALL', config: config, symbol: document.getElementById('coinSelector').value, timeframe: document.getElementById('timeframeSelector').value }); });
document.getElementById('btnManualPut').addEventListener('click', () => { const config = getInstitutionalRiskConfig(); if (!config) return; saveRiskConfig(); socket.emit('manual_trade', { direction: 'PUT', config: config, symbol: document.getElementById('coinSelector').value, timeframe: document.getElementById('timeframeSelector').value }); });
document.getElementById('coinSelector').addEventListener('change', (e) => { clearUIForLoading(); socket.emit('change_coin', e.target.value); });
document.getElementById('strategySelector').addEventListener('change', (e) => { clearUIForLoading(); socket.emit('change_strategy', e.target.value); });
document.getElementById('timeframeSelector').addEventListener('change', (e) => { clearUIForLoading(); socket.emit('change_timeframe', e.target.value); });

if(document.getElementById('btnAdminPanel')) { 
    document.getElementById('btnAdminPanel').addEventListener('click', () => { 
        document.getElementById('adminModal').style.display = 'flex'; 
        auth.currentUser.getIdToken().then(token => {
            socket.emit('admin_get_users', token); 
            socket.emit('admin_get_payments', token);
        }); 
        
        if (window.appPricing) {
            if(document.getElementById('price1')) document.getElementById('price1').value = window.appPricing.month1;
            if(document.getElementById('price3')) document.getElementById('price3').value = window.appPricing.month3;
            if(document.getElementById('price6')) document.getElementById('price6').value = window.appPricing.month6;
            if(document.getElementById('price12')) document.getElementById('price12').value = window.appPricing.month12;
        }
        
        if (window.tempTgConfig) { 
            if(document.getElementById('tgRsiOver')) document.getElementById('tgRsiOver').value = window.tempTgConfig.rsiOver || '65'; 
            if(document.getElementById('tgRsiUnder')) document.getElementById('tgRsiUnder').value = window.tempTgConfig.rsiUnder || '35'; 
            if(document.getElementById('tgBbDev')) document.getElementById('tgBbDev').value = window.tempTgConfig.bbDev || '2'; 
            if(document.getElementById('tgHoraManha')) document.getElementById('tgHoraManha').value = window.tempTgConfig.horaManha || '09:30'; 
            if(document.getElementById('tgHoraTarde')) document.getElementById('tgHoraTarde').value = window.tempTgConfig.horaTarde || '15:30'; 
            if(document.getElementById('tgDias')) document.getElementById('tgDias').value = window.tempTgConfig.dias || '1-5'; 
            if(document.getElementById('tgMaxSinais')) document.getElementById('tgMaxSinais').value = window.tempTgConfig.maxSinais || '2'; 
            
            // Stickers Separados
            if(document.getElementById('tgStkStartManha')) document.getElementById('tgStkStartManha').value = window.tempTgConfig.stkStartManha || window.tempTgConfig.stkStart || ''; 
            if(document.getElementById('tgStkEndManha')) document.getElementById('tgStkEndManha').value = window.tempTgConfig.stkEndManha || window.tempTgConfig.stkEnd || ''; 
            if(document.getElementById('tgStkStartTarde')) document.getElementById('tgStkStartTarde').value = window.tempTgConfig.stkStartTarde || window.tempTgConfig.stkStart || ''; 
            if(document.getElementById('tgStkEndTarde')) document.getElementById('tgStkEndTarde').value = window.tempTgConfig.stkEndTarde || window.tempTgConfig.stkEnd || ''; 
            
            if(document.getElementById('tgStkWin')) document.getElementById('tgStkWin').value = window.tempTgConfig.stkWin || ''; 
            if(document.getElementById('tgStkLoss')) document.getElementById('tgStkLoss').value = window.tempTgConfig.stkLoss || ''; 
            
            const msgDefault = "⚡ *ALERTA DE TOQUE (M1)* ⚡\n\n💵 Moeda = {MOEDA}\n⏰ Expiração = 1 Minuto\n🛎 Entrada = {HORA_ENTRADA}\n{DIRECAO}\n\n👉🏼 Se necessário, fazer 1 Gale."; 
            if(document.getElementById('tgMsgSinal')) document.getElementById('tgMsgSinal').value = window.tempTgConfig.msgSinal || msgDefault; 
        } 
    }); 
}

setInterval(() => { const tfSelect = document.getElementById('timeframeSelector'); const tfMinutes = tfSelect ? parseInt(tfSelect.value.replace('m', '')) : 1; const now = new Date(); const sec = (tfMinutes * 60) - ((now.getMinutes() % tfMinutes) * 60 + now.getSeconds()); let displayTime = ''; if (sec >= 60) { const m = Math.floor(sec / 60); const s = sec % 60; displayTime = `${m < 10 ? '0'+m : m}:${s < 10 ? '0'+s : s}`; } else { displayTime = sec < 10 ? '0' + sec : sec; } document.getElementById('timerCircle').innerText = displayTime; const liveCard = document.getElementById('liveTradeCard'); if (liveCard && liveCard.style.display !== 'none') { document.getElementById('liveTime').innerText = displayTime + (sec < 60 ? 's' : ''); } }, 1000);