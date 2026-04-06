const firebaseConfig = { apiKey: "AIzaSyCBlpeZG_ITiXaKYTdq378gRcLJ9wVNqqI", authDomain: "js-invest-40d0b.firebaseapp.com", projectId: "js-invest-40d0b" };
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth(); 
const socket = io();

let isBotActive = false;
let currentEntryPrice = 0; 

const ctx = document.getElementById('liveChart').getContext('2d');
const liveChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: [], 
        datasets: [
            { label: 'Preço Atual', data: [], borderColor: '#58a6ff', borderWidth: 2, pointRadius: 0, tension: 0.1 },
            { label: 'Linha de Entrada', data: [], borderColor: '#8b949e', borderWidth: 1, borderDash: [5, 5], pointRadius: 0 }
        ]
    },
    options: {
        responsive: true, maintainAspectRatio: false, animation: false, 
        plugins: { legend: { display: false } },
        scales: { x: { display: false }, y: { position: 'right', grid: { color: '#30363d' }, ticks: { color: '#8b949e', font: {size: 10} } } }
    }
});

document.getElementById('btnLogin').addEventListener('click', () => {
    const btn = document.getElementById('btnLogin');
    btn.innerText = "Autenticando Corretora...";
    
    document.getElementById('loginError').style.display = 'none';
    document.getElementById('btnAffiliate').style.display = 'none';

    socket.emit('hybrid_login', {
        brokerUser: document.getElementById('brokerLoginInput').value,
        brokerPass: document.getElementById('brokerPassInput').value
    });
});

socket.on('hybrid_login_result', (res) => {
    const btn = document.getElementById('btnLogin');
    btn.innerText = "Acessar Sistema";

    if (res.success) {
        auth.signInWithCustomToken(res.firebaseToken).then(() => {
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('valReal').innerText = `R$ ${res.balance.real}`;
            document.getElementById('valDemo').innerText = res.balance.demo;
            
            document.getElementById('manualTradePanel').style.display = 'flex';

            if (res.role === 'admin') {
                document.getElementById('btnAdminPanel').style.display = 'inline-block';
                document.getElementById('btnOpenModal').style.display = 'inline-block';
            }
        }).catch(err => {
            document.getElementById('loginError').innerText = "Erro Interno: " + err.message;
            document.getElementById('loginError').style.display = 'block';
        });
    } else {
        document.getElementById('loginError').innerText = res.msg;
        document.getElementById('loginError').style.display = 'block';
        
        if (res.reason === 'broker') {
            document.getElementById('btnAffiliate').style.display = 'block';
            alert("Conta não encontrada! Será redirecionado para criar a sua conta gratuitamente.");
            window.open('https://joaosilva.top/corretora-vellox', '_blank');
        }
    }
});

document.getElementById('btnLogout').addEventListener('click', () => {
    auth.signOut().then(() => { window.location.reload(); });
});

socket.on('available_strategies', (strats) => {
    const sel = document.getElementById('strategySelector'); sel.innerHTML = '';
    strats.forEach(s => { const opt = document.createElement('option'); opt.value = s.id; opt.innerText = s.name; sel.appendChild(opt); });
});

socket.on('available_coins', (groupedCoins) => {
    const selectBox = document.getElementById('coinSelector'); 
    
    if(!selectBox) return; 
    selectBox.innerHTML = ''; 
    
    for (const [categoryName, symbolsArray] of Object.entries(groupedCoins)) {
        let optgroup = document.createElement('optgroup');
        optgroup.label = categoryName; 
        
        symbolsArray.forEach(sym => {
            let option = document.createElement('option');
            option.value = sym;
            option.textContent = sym.toUpperCase();
            optgroup.appendChild(option);
        });
        
        selectBox.appendChild(optgroup);
    }
});

// ==========================================
// 🧹 LIMPANDO A TELA AO TROCAR DE CONFIGURAÇÃO
// ==========================================
function clearUIForLoading(message) {
    document.getElementById('priceValue').innerText = 'Sincronizando...';
    document.getElementById('priceValue').style.color = '#8b949e';
    document.getElementById('liveTradeCard').style.display = 'none';
    document.getElementById('historyTableBody').innerHTML = `<tr><td colspan="3" style="text-align:center; color:#8b949e; padding: 20px;">${message}</td></tr>`;
    
    document.getElementById('scoreWin1').innerText = '-';
    document.getElementById('scoreWinG1').innerText = '-';
    document.getElementById('scoreWinG2').innerText = '-';
    document.getElementById('scoreLoss').innerText = '-';
    document.getElementById('totalAccuracy').innerText = '0.0%';
    
    const alertBox = document.getElementById('alertBox');
    alertBox.innerHTML = "Analisando Mercado...";
    alertBox.className = "alert-box";
}

document.getElementById('coinSelector').addEventListener('change', (e) => {
    clearUIForLoading("Baixando novo ativo...");
    socket.emit('change_coin', e.target.value);
});

document.getElementById('strategySelector').addEventListener('change', (e) => {
    clearUIForLoading("Recalculando estratégia...");
    socket.emit('change_strategy', e.target.value);
});

document.getElementById('timeframeSelector').addEventListener('change', (e) => {
    clearUIForLoading("Ajustando tempo de vela...");
    socket.emit('change_timeframe', e.target.value);
});

// 🎯 RECEÇÃO DO PREÇO (LIVRE DO RELÓGIO)
socket.on('price_update', (data) => {
    if (data.price === 0) return; // 🛡️ Ignora preços zerados durante o loading
    
    document.getElementById('priceValue').innerText = '$ ' + data.price.toFixed(2);
    document.getElementById('priceValue').style.color = '#c9d1d9'; // Volta à cor branca
    
    const liveCard = document.getElementById('liveTradeCard');
    
    if (data.activeSignal) {
        if (liveCard.style.display === 'none') {
            liveCard.style.display = 'block';
            liveChart.data.labels = [];
            liveChart.data.datasets[0].data = [];
            liveChart.data.datasets[1].data = [];
            currentEntryPrice = data.activeSignal.entryPrice;
        }

        const isCall = data.activeSignal.type === 'CALL';
        document.getElementById('liveDir').innerText = isCall ? '🟢 CALL' : '🔴 PUT';
        document.getElementById('liveDir').style.color = isCall ? '#3fb950' : '#f85149';
        
        document.getElementById('liveEntry').innerText = currentEntryPrice.toFixed(2);
        document.getElementById('liveCurrent').innerText = data.price.toFixed(2);

        let isWin = (isCall && data.price > currentEntryPrice) || (!isCall && data.price < currentEntryPrice);
        let isTie = data.price === currentEntryPrice;
        
        const statusEl = document.getElementById('liveStatus');
        if (isTie) { statusEl.innerText = 'EMPATANDO'; statusEl.style.color = '#d29922'; } 
        else if (isWin) { statusEl.innerText = 'WIN 🎯'; statusEl.style.color = '#3fb950'; } 
        else { statusEl.innerText = 'LOSS 🔴'; statusEl.style.color = '#f85149'; }

        liveChart.data.labels.push('');
        liveChart.data.datasets[0].data.push(data.price);
        liveChart.data.datasets[1].data.push(currentEntryPrice); 
        liveChart.data.datasets[0].borderColor = isTie ? '#d29922' : (isWin ? '#3fb950' : '#f85149');

        if (liveChart.data.labels.length > 60) {
            liveChart.data.labels.shift();
            liveChart.data.datasets[0].data.shift();
            liveChart.data.datasets[1].data.shift();
        }
        liveChart.update();
    } else {
        liveCard.style.display = 'none'; 
    }
});

socket.on('pre_alert', (data) => {
    const alertBox = document.getElementById('alertBox');
    if(data.call || data.put) {
        alertBox.innerHTML = `⚠️ PREPARAR: ${data.call ? "COMPRA" : "VENDA"}`;
        alertBox.className = "alert-box alert-pre";
    } else {
        alertBox.innerHTML = "Analisando Mercado...";
        alertBox.className = "alert-box";
    }
});

socket.on('signal', (data) => {
    const alertBox = document.getElementById('alertBox');
    alertBox.innerHTML = data.type === 'CALL' ? '🟢 ENTRAR: COMPRA!' : '🔴 ENTRAR: VENDA!';
    alertBox.className = "alert-box alert-go";
    setTimeout(() => { alertBox.className = "alert-box"; }, 4000); 
});

document.getElementById('btnToggleBot').addEventListener('click', () => {
    isBotActive = !isBotActive;
    const config = {
        active: isBotActive, accountType: document.getElementById('riskAccount').value,
        baseAmount: parseFloat(document.getElementById('riskAmount').value), maxGale: parseInt(document.getElementById('riskGale').value),
        stopWin: parseFloat(document.getElementById('riskWin').value), stopLoss: parseFloat(document.getElementById('riskLoss').value)
    };
    socket.emit('setup_auto_trade', config);
});

socket.on('auto_trade_status', (res) => {
    isBotActive = res.active;
    const btn = document.getElementById('btnToggleBot'); const status = document.getElementById('statusBot');
    if(isBotActive) { btn.className = "btn-toggle-bot bot-on"; btn.innerText = "PARAR AUTO-TRADE"; status.innerText = res.msg; status.style.color = "#58a6ff"; } 
    else { btn.className = "btn-toggle-bot bot-off"; btn.innerText = "ATIVAR AUTO-TRADE"; status.innerText = res.msg; status.style.color = res.msg.includes("STOP") ? "#f85149" : "#8b949e"; }
    if (res.profit !== undefined) {
        const pVal = document.getElementById('profitVal'); pVal.innerText = `R$ ${res.profit.toFixed(2)}`; pVal.style.color = res.profit >= 0 ? "#3fb950" : "#f85149";
    }
});

socket.on('update_balance', (data) => {
    const el = document.getElementById(data.isDemo ? 'valDemo' : 'valReal');
    el.innerText = `R$ ${data.balance}`;
    el.style.color = data.isDemo ? '#3fb950' : '#58a6ff'; 
    setTimeout(() => { el.style.color = data.isDemo ? '#d29922' : '#3fb950'; }, 1000);
});

socket.on('win_balance_update', (data) => {
    const elId = data.isDemo ? 'valDemo' : 'valReal';
    const el = document.getElementById(elId);
    let currentText = el.innerText.replace('R$ ', '').replace(/\./g, '').replace(',', '.');
    let currentVal = parseFloat(currentText);
    
    if (!isNaN(currentVal)) {
        let newVal = currentVal + data.prize;
        el.innerText = `R$ ${newVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        el.style.color = '#3fb950'; 
        el.style.textShadow = '0 0 15px rgba(63, 185, 80, 0.8)';
        setTimeout(() => { el.style.color = data.isDemo ? '#d29922' : '#3fb950'; el.style.textShadow = 'none'; }, 2000);
    }
});

socket.on('sniper_success', (msg) => { alert("✅ " + msg); });
socket.on('sniper_error', (msg) => { alert("❌ Erro: " + msg); });

document.getElementById('btnManualCall').addEventListener('click', () => { 
    if(confirm("Confirma COMPRA manual?")) { 
        const config = { accountType: document.getElementById('riskAccount').value, baseAmount: parseFloat(document.getElementById('riskAmount').value), maxGale: parseInt(document.getElementById('riskGale').value) };
        socket.emit('manual_trade', { direction: 'CALL', config: config }); 
    } 
});

document.getElementById('btnManualPut').addEventListener('click', () => { 
    if(confirm("Confirma VENDA manual?")) { 
        const config = { accountType: document.getElementById('riskAccount').value, baseAmount: parseFloat(document.getElementById('riskAmount').value), maxGale: parseInt(document.getElementById('riskGale').value) };
        socket.emit('manual_trade', { direction: 'PUT', config: config }); 
    } 
});

const historyTableBody = document.getElementById('historyTableBody');

socket.on('history_dump', (historyArr) => {
    historyTableBody.innerHTML = ''; 
    historyArr.forEach(sig => {
        const tr = document.createElement('tr'); tr.id = `sig-${sig.id}`;
        const isCall = sig.type === 'CALL';
        let colorClass = 'text-warning';
        if (sig.status.includes('WIN')) colorClass = 'text-green';
        else if (sig.status.includes('LOSS')) colorClass = 'text-red';
        else if (sig.status.includes('Sniper') || sig.status.includes('Manual')) colorClass = 'text-warning';
        
        tr.innerHTML = `<td class="text-muted">${sig.time}</td>
            <td class="${isCall ? 'text-green' : 'text-red'}"><span style="font-size:10px; color:#8b949e; display:block;">${sig.symbol || 'BTCUSDT'}</span>${isCall ? '🟢 CALL' : '🔴 PUT'}</td>
            <td id="res-${sig.id}" class="${colorClass}">${sig.status}</td>`;
        historyTableBody.appendChild(tr); 
    });
});

socket.on('scoreboard', (data) => {
    document.getElementById('scoreWin1').innerText = data.win1; document.getElementById('scoreWinG1').innerText = data.winG1;
    document.getElementById('scoreWinG2').innerText = data.winG2; document.getElementById('scoreLoss').innerText = data.loss;
    const total = data.win1 + data.winG1 + data.winG2 + data.loss;
    if (total > 0) {
        const wins = data.win1 + data.winG1 + data.winG2;
        document.getElementById('totalAccuracy').innerText = ((wins / total) * 100).toFixed(1) + '%';
        document.getElementById('pctWin1').innerText = ((data.win1 / total) * 100).toFixed(1) + '%';
        document.getElementById('pctWinG1').innerText = ((data.winG1 / total) * 100).toFixed(1) + '%';
        document.getElementById('pctWinG2').innerText = ((data.winG2 / total) * 100).toFixed(1) + '%';
        document.getElementById('pctLoss').innerText = ((data.loss / total) * 100).toFixed(1) + '%';
    }
});

socket.on('new_signal_history', (sig) => {
    const tr = document.createElement('tr'); tr.id = `sig-${sig.id}`;
    let colorClass = 'text-warning';
    if (sig.status.includes('Sniper') || sig.status.includes('Manual')) colorClass = 'text-warning';
    
    tr.innerHTML = `<td class="text-muted">${sig.time}</td>
        <td class="${sig.type === 'CALL' ? 'text-green' : 'text-red'}"><span style="font-size:10px; color:#8b949e; display:block;">${sig.symbol || 'BTCUSDT'}</span>${sig.type === 'CALL' ? '🟢 CALL' : '🔴 PUT'}</td>
        <td id="res-${sig.id}" class="${colorClass}">${sig.status}</td>`;
    historyTableBody.prepend(tr); 
});

socket.on('signal_result', (sig) => {
    const resTd = document.getElementById(`res-${sig.id}`);
    if (resTd) {
        resTd.innerText = sig.status;
        if (sig.status.includes('WIN')) resTd.className = 'text-green';
        else if (sig.status.includes('LOSS')) resTd.className = 'text-red';
        else resTd.className = 'text-warning';
    }
});

const scriptModal = document.getElementById('scriptModal');
if(document.getElementById('btnOpenModal')) {
    document.getElementById('btnOpenModal').addEventListener('click', () => { scriptModal.style.display = 'flex'; });
}
if(document.getElementById('btnCancelScript')) {
    document.getElementById('btnCancelScript').addEventListener('click', () => { scriptModal.style.display = 'none'; });
}
if(document.getElementById('btnSaveScript')) {
    document.getElementById('btnSaveScript').addEventListener('click', () => {
        try {
            const newStrategyJSON = JSON.parse(document.getElementById('jsonInput').value);
            document.getElementById('btnSaveScript').innerText = 'Gravando...'; 
            socket.emit('add_new_strategy', newStrategyJSON);
        } catch (error) { 
            alert("❌ Erro: Formato JSON inválido!"); 
            document.getElementById('btnSaveScript').innerText = 'Salvar & Injetar';
        }
    });
}

socket.on('script_injection_result', (res) => {
    document.getElementById('btnSaveScript').innerText = 'Salvar & Injetar'; 
    if (res.success) {
        alert("✅ " + res.msg); scriptModal.style.display = 'none';
        setTimeout(() => { document.getElementById('strategySelector').value = res.id; socket.emit('change_strategy', res.id); }, 500); 
    } else { alert("❌ Erro na Injeção:\n" + res.msg); }
});

const adminModal = document.getElementById('adminModal');
if(document.getElementById('btnAdminPanel')){
    document.getElementById('btnAdminPanel').addEventListener('click', () => { adminModal.style.display = 'flex'; auth.currentUser.getIdToken().then(token => socket.emit('admin_get_users', token)); });
}
if(document.getElementById('btnCancelAdmin')){
    document.getElementById('btnCancelAdmin').addEventListener('click', () => { adminModal.style.display = 'none'; });
}

socket.on('admin_users_list', (res) => {
    const tbody = document.getElementById('usersListBody'); tbody.innerHTML = '';
    if (res.success) {
        if (res.users.length === 0) tbody.innerHTML = '<tr><td colspan="2" style="text-align:center;">Vazio.</td></tr>';
        else {
            res.users.forEach(u => {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td style="padding: 10px; border-bottom: 1px solid #21262d;">${u.email}</td>
                                <td style="padding: 10px; border-bottom: 1px solid #21262d; color: ${u.role.includes('admin') ? '#58a6ff' : '#8b949e'};">${u.role.toUpperCase()}</td>`;
                tbody.appendChild(tr);
            });
        }
    }
});

if(document.getElementById('btnCreateUser')){
    document.getElementById('btnCreateUser').addEventListener('click', () => {
        const newEmail = document.getElementById('newUserEmail').value; const newPassword = document.getElementById('newUserPassword').value; const newRole = document.getElementById('newUserRole').value;
        document.getElementById('btnCreateUser').innerText = '...';
        auth.currentUser.getIdToken().then(token => socket.emit('admin_create_user', { token, newEmail, newPassword, newRole }));
    });
}

// 🎯 O BOTÃO QUE RENOVA A SESSÃO AUTOMATICAMENTE
if(document.getElementById('btnInjectCookie')) {
    document.getElementById('btnInjectCookie').addEventListener('click', () => {
        const cookieVal = document.getElementById('adminCookieInput').value;
        
        if(cookieVal.length > 20) {
            socket.emit('inject_cookie', cookieVal);
            document.getElementById('adminCookieInput').value = ''; 
            document.getElementById('btnInjectCookie').innerText = 'Injetado! ✅';
            
            setTimeout(() => { document.getElementById('btnInjectCookie').innerText = 'Injetar'; }, 3000);
        } else {
            alert('❌ O Cookie parece estar inválido ou é muito curto!');
        }
    });
}

socket.on('user_creation_result', (res) => {
    alert(res.msg); document.getElementById('btnCreateUser').innerText = 'Cadastrar';
    if(res.success) { document.getElementById('newUserEmail').value = ''; document.getElementById('newUserPassword').value = ''; auth.currentUser.getIdToken().then(token => socket.emit('admin_get_users', token)); }
});

// ==========================================
// ⏱️ RELÓGIO SUÍÇO MULTI-TIMEFRAME
// ==========================================
setInterval(() => {
    const tfSelect = document.getElementById('timeframeSelector');
    const tfMinutes = tfSelect ? parseInt(tfSelect.value.replace('m', '')) : 1;
    const now = new Date();
    
    const sec = (tfMinutes * 60) - ((now.getMinutes() % tfMinutes) * 60 + now.getSeconds());
    
    let displayTime = '';
    if (sec >= 60) {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        displayTime = `${m < 10 ? '0'+m : m}:${s < 10 ? '0'+s : s}`;
    } else {
        displayTime = sec < 10 ? '0' + sec : sec;
    }
    
    document.getElementById('timerCircle').innerText = displayTime;
    
    const liveCard = document.getElementById('liveTradeCard');
    if (liveCard && liveCard.style.display !== 'none') {
        document.getElementById('liveTime').innerText = displayTime + (sec < 60 ? 's' : '');
    }
}, 1000);