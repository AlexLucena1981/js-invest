const firebaseConfig = { 
    apiKey: "AIzaSyCBlpeZG_ITiXaKYTdq378gRcLJ9wVNqqI", 
    authDomain: "js-invest-40d0b.firebaseapp.com", 
    projectId: "js-invest-40d0b" 
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth(); 

const socket = io({ transports: ['websocket'], upgrade: false });

let currentEntryPrice = 0; 
let radarGlobalStats = null; 
let isBotActive = false; 

const ctx = document.getElementById('liveChart').getContext('2d');
const liveChart = new Chart(ctx, {
    type: 'line', 
    data: { labels: [], datasets: [ { label: 'Preço Atual', data: [], borderColor: '#58a6ff', borderWidth: 2, pointRadius: 0, tension: 0.1 }, { label: 'Linha de Entrada', data: [], borderColor: '#8b949e', borderWidth: 1, borderDash: [5, 5], pointRadius: 0 } ] },
    options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { position: 'right', grid: { color: '#30363d' }, ticks: { color: '#8b949e', font: {size: 10} } } } }
});

function saveRiskConfig() {
    const config = {
        accountType: document.getElementById('riskAccount').value,
        baseAmount: document.getElementById('riskAmount').value,
        payout: document.getElementById('riskPayout') ? document.getElementById('riskPayout').value : 85,
        maxGale: document.getElementById('riskGale').value,
        stopWin: document.getElementById('riskWin').value,
        stopLoss: document.getElementById('riskLoss').value
    };
    localStorage.setItem('jsInvestConfig', JSON.stringify(config));
}

function togglePremiumUI(isPremium) {
    const elsToToggle = ['riskAccount', 'riskAmount', 'riskPayout', 'riskGale', 'riskWin', 'riskLoss', 'btnToggleBot', 'btnManualCall', 'btnManualPut'];
    
    elsToToggle.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.style.display = isPremium ? '' : 'none'; 
            if(el.parentElement && el.parentElement.tagName === 'DIV' && el.parentElement.id !== 'manualTradePanel') {
                el.parentElement.style.display = isPremium ? '' : 'none';
            }
        }
    });

    const statusBot = document.getElementById('statusBot');
    if (statusBot) {
        if (isPremium) {
            statusBot.innerText = "🚀 MODO PLUS ATIVO: Operações Liberadas!";
            statusBot.style.color = "#3fb950";
        } else {
            statusBot.innerText = "🔒 MODO FREE: Radar Ativo (Requer banca R$ 100+)";
            statusBot.style.color = "#d29922";
        }
    }
}

// 🎯 CRIAÇÃO DO PAINEL FIFO (Fila de Alertas Inteligente)
function setupFifoPanel() {
    const style = document.createElement('style');
    style.innerHTML = `@keyframes slideInRight { from { opacity: 0; transform: translateX(50px); } to { opacity: 1; transform: translateX(0); } }`;
    document.head.appendChild(style);

    const fifoPanel = document.createElement('div');
    fifoPanel.id = 'fifoPanel';
    fifoPanel.style.cssText = 'position:fixed; bottom:20px; right:20px; width:320px; background:#0d1117; border:1px solid #30363d; border-radius:10px; z-index:8900; box-shadow:0 10px 30px rgba(0,0,0,0.8); display:flex; flex-direction:column; overflow:hidden; font-family: monospace;';
    fifoPanel.innerHTML = `
        <div style="background: linear-gradient(180deg, #161b22 0%, #0d1117 100%); padding:12px; font-weight:bold; color:#58a6ff; text-align:center; border-bottom:1px solid #30363d; font-size:14px; text-transform:uppercase; letter-spacing: 1px; display: flex; justify-content: space-between; align-items: center;">
            <span>🚦 OPERAÇÕES ATIVAS</span>
            <span style="font-size:10px; color:#8b949e; background:#21262d; padding:2px 6px; border-radius:4px;">AO VIVO</span>
        </div>
        <div id="fifoList" style="display:flex; flex-direction:column; gap:0; max-height: 350px; overflow-y: auto;">
            <div style="padding:30px; text-align:center; color:#8b949e; font-size:12px;" id="fifoEmpty">Radar varrendo o mercado...<br>Nenhuma operação em andamento.</div>
        </div>
    `;
    document.body.appendChild(fifoPanel);
}

// 🎯 GESTOR INTELIGENTE DA FILA (Atualiza e Auto-Limpa)
function manageFifoAlert(data) {
    const list = document.getElementById('fifoList');
    const emptyMsg = document.getElementById('fifoEmpty');
    if (emptyMsg) emptyMsg.style.display = 'none';

    // Se entrar um sinal real, remove o alerta de Radar daquela moeda para não duplicar
    if (!data.isRadar) {
        const existingRadar = document.getElementById('fifo-radar-' + data.symbol);
        if (existingRadar) existingRadar.remove();
    }

    let item = document.getElementById('fifo-' + data.id);
    
    const isCall = data.type.toUpperCase() === 'CALL';
    const colorDir = isCall ? '#3fb950' : '#f85149';
    const dirText = isCall ? '🟢 CALL' : '🔴 PUT';

    // Inteligência de Cores
    let jogadaColor = '#c9d1d9';
    if (data.stepText.includes('Gale 1')) jogadaColor = '#d29922'; 
    if (data.stepText.includes('Gale 2')) jogadaColor = '#f85149'; 
    if (data.stepText.includes('Radar')) jogadaColor = '#58a6ff';
    if (data.stepText.includes('WIN')) jogadaColor = '#3fb950';
    if (data.stepText.includes('LOSS')) jogadaColor = '#f85149';

    // Se não existe, cria! Se existe, só atualiza para não poluir
    if (!item) {
        item = document.createElement('div');
        item.id = 'fifo-' + data.id;
        item.style.cssText = `display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid #21262d; font-size:12px; animation: slideInRight 0.3s ease-out; background: rgba(22, 27, 34, 0.5); transition: opacity 0.5s ease-out;`;
        list.prepend(item);
    }

    item.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:3px; width:30%;">
            <span style="color:#8b949e; font-size: 10px;">${data.time}</span>
            <b style="color:#fff; font-size: 12px;">${data.symbol}</b>
        </div>
        <div style="width:35%; font-weight:bold; color:${colorDir}; text-align:center; font-size: 12px;">
            ${dirText}
        </div>
        <div style="width:35%; text-align:right; font-weight:bold; color:${jogadaColor}; font-size: 11px; text-shadow: ${data.isEnd ? '0 0 10px '+jogadaColor : 'none'};">
            ${data.stepText}
        </div>
    `;

    // Mantém a tela limpa: empurra para fora os muito velhos
    if (list.children.length > 8 && !data.isEnd) {
        const last = list.lastElementChild;
        if (last && last.id !== 'fifoEmpty' && last !== item) last.remove();
    }

    // 🧹 Auto-Limpeza do Radar (40 segundos)
    if (data.isRadar) {
        setTimeout(() => {
            if (document.getElementById('fifo-' + data.id)) {
                document.getElementById('fifo-' + data.id).style.opacity = '0';
                setTimeout(() => { document.getElementById('fifo-' + data.id)?.remove(); checkFifoEmpty(); }, 500);
            }
        }, 40000);
    }

    // 🧹 Auto-Limpeza de Sinais Finalizados (Win ou Loss saem em 5 segundos)
    if (data.isEnd) {
        setTimeout(() => {
            if (document.getElementById('fifo-' + data.id)) {
                document.getElementById('fifo-' + data.id).style.opacity = '0';
                setTimeout(() => { document.getElementById('fifo-' + data.id)?.remove(); checkFifoEmpty(); }, 500);
            }
        }, 5000);
    }
}

function checkFifoEmpty() {
    const list = document.getElementById('fifoList');
    const emptyMsg = document.getElementById('fifoEmpty');
    let hasItems = Array.from(list.children).some(child => child.id !== 'fifoEmpty');
    if (!hasItems && emptyMsg) emptyMsg.style.display = 'block';
}

function setupTelegramAdminUI() {
    const adminModalContent = document.querySelector('#adminModal > div');
    if (!adminModalContent || document.getElementById('tgAdminPanel')) return;

    const tgPanel = document.createElement('div');
    tgPanel.id = 'tgAdminPanel';
    tgPanel.style.cssText = 'margin-top: 20px; border-top: 1px solid #30363d; padding-top: 20px;';
    tgPanel.innerHTML = `
        <h3 style="color:#58a6ff; text-align:center; margin-bottom: 15px;">🤖 CENTRO DE COMANDO: TELEGRAM</h3>
        <div style="display:flex; gap:10px; margin-bottom:15px;">
            <div style="flex:1;">
                <label style="font-size:12px; color:#8b949e;">Início Manhã (Ex: 09:00)</label>
                <input type="time" id="tgHoraManha" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d;">
            </div>
            <div style="flex:1;">
                <label style="font-size:12px; color:#8b949e;">Início Tarde (Ex: 15:00)</label>
                <input type="time" id="tgHoraTarde" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d;">
            </div>
            <div style="flex:1;">
                <label style="font-size:12px; color:#8b949e;">Dias (ex: 1-5 Seg/Sex)</label>
                <input type="text" id="tgDias" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d;" placeholder="1-5">
            </div>
        </div>
        <div style="margin-bottom:10px;">
            <label style="font-size:12px; color:#8b949e;">Msg: Despertar do Robô</label>
            <input type="text" id="tgMsgDespertar" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d;">
        </div>
        <div style="margin-bottom:10px;">
            <label style="font-size:12px; color:#8b949e;">Msg: Win de Primeira</label>
            <input type="text" id="tgMsgWin" class="form-control" style="background:#0d1117; color:#3fb950; border:1px solid #30363d;">
        </div>
        <div style="margin-bottom:15px;">
            <label style="font-size:12px; color:#8b949e;">Msg: Loss Final</label>
            <input type="text" id="tgMsgLoss" class="form-control" style="background:#0d1117; color:#f85149; border:1px solid #30363d;">
        </div>
        <div style="display:flex; justify-content:space-between; gap:10px;">
            <button id="btnSalvarTg" style="flex:1; background:#2ea043; color:white; border:none; padding:10px; border-radius:6px; font-weight:bold; cursor:pointer;">💾 Salvar Configuração</button>
            <button id="btnForcarTgManha" style="flex:1; background:#f85149; color:white; border:none; padding:10px; border-radius:6px; font-weight:bold; cursor:pointer;">🔥 Iniciar Sessão AGORA!</button>
        </div>
    `;
    adminModalContent.appendChild(tgPanel);

    document.getElementById('btnSalvarTg').addEventListener('click', () => {
        const config = {
            horaManha: document.getElementById('tgHoraManha').value,
            horaTarde: document.getElementById('tgHoraTarde').value,
            dias: document.getElementById('tgDias').value,
            msgDespertar: document.getElementById('tgMsgDespertar').value,
            msgWin: document.getElementById('tgMsgWin').value,
            msgLoss: document.getElementById('tgMsgLoss').value
        };
        auth.currentUser.getIdToken().then(token => socket.emit('admin_save_tg_config', { token, config }));
    });

    document.getElementById('btnForcarTgManha').addEventListener('click', () => {
        auth.currentUser.getIdToken().then(token => socket.emit('admin_force_tg', { token, turno: 'Forçada Manualmente' }));
    });
}

window.addEventListener('DOMContentLoaded', () => {
    
    const amtInput = document.getElementById('riskAmount');
    if (amtInput && !document.getElementById('riskPayout')) {
        const amtCol = amtInput.parentElement;
        const contaCol = document.getElementById('riskAccount').parentElement;
        if (amtCol.classList.contains('col-6')) { amtCol.classList.remove('col-6'); amtCol.classList.add('col-4'); }
        if (contaCol && contaCol.classList.contains('col-6')) { contaCol.classList.remove('col-6'); contaCol.classList.add('col-4'); }
        
        const payoutWrapper = document.createElement('div');
        payoutWrapper.className = amtCol.className;
        payoutWrapper.innerHTML = `
            <label class="form-label text-muted" style="font-size: 10px; font-weight: bold; margin-bottom: 2px;">PAYOUT (%)</label>
            <input type="number" id="riskPayout" class="form-control" style="background-color: #0d1117; color: #c9d1d9; border: 1px solid #30363d;" value="85">
        `;
        amtCol.insertAdjacentElement('afterend', payoutWrapper);
    }

    ['riskAccount', 'riskAmount', 'riskPayout', 'riskGale', 'riskWin', 'riskLoss'].forEach(id => { 
        const el = document.getElementById(id);
        if(el) el.addEventListener('change', saveRiskConfig); 
    });

    togglePremiumUI(false);

    const savedConfig = JSON.parse(localStorage.getItem('jsInvestConfig'));
    if (savedConfig) {
        if(document.getElementById('riskAccount')) document.getElementById('riskAccount').value = savedConfig.accountType || 'demo'; 
        if(document.getElementById('riskAmount')) document.getElementById('riskAmount').value = savedConfig.baseAmount || 5;
        if(document.getElementById('riskPayout')) document.getElementById('riskPayout').value = savedConfig.payout || 85;
        if(document.getElementById('riskGale')) document.getElementById('riskGale').value = savedConfig.maxGale || 2; 
        if(document.getElementById('riskWin')) document.getElementById('riskWin').value = savedConfig.stopWin || 50; 
        if(document.getElementById('riskLoss')) document.getElementById('riskLoss').value = savedConfig.stopLoss || 50;
    }

    setupStatsUI();
    setupFifoPanel(); // 🎯 INICIA O NOVO PAINEL DE FILA AQUI

    const radarDiv = document.createElement('div'); radarDiv.id = 'radarToast';
    radarDiv.style.cssText = 'display:none; position:fixed; top:80px; right:20px; background:#161b22; border:2px solid #58a6ff; padding:20px; border-radius:10px; z-index:9999; box-shadow: 0 0 25px rgba(88, 166, 255, 0.4); transition: all 0.3s ease; text-align:center; min-width:250px;';
    radarDiv.innerHTML = `<div style="font-size:24px; margin-bottom:10px;">🚨 <b style="color:#c9d1d9;">RADAR DETECTOU!</b> 🚨</div><div id="radarMsg" style="font-size:18px; color:#8b949e; font-weight:bold;">Aguardando...</div>`;
    document.body.appendChild(radarDiv);

    const savedBrokerToken = localStorage.getItem('jsInvestBrokerToken'); const savedRole = localStorage.getItem('jsInvestUserRole'); const savedUid = localStorage.getItem('jsInvestUid');
    if (savedBrokerToken && savedUid) { document.getElementById('btnLogin').innerText = "Acessando Painel..."; socket.emit('auto_reconnect', { token: savedBrokerToken, role: savedRole, uid: savedUid }); }
});

function setupStatsUI() {
    const statsBtn = document.createElement('button');
    statsBtn.id = 'btnOpenStats'; statsBtn.innerHTML = '📊 ESTATÍSTICAS RADAR';
    statsBtn.style.cssText = 'position:fixed; bottom:20px; left:20px; background:#1f6feb; color:white; border:none; padding:12px 20px; border-radius:8px; font-weight:bold; cursor:pointer; z-index:9000; box-shadow:0 4px 15px rgba(31,111,235,0.4); transition:0.3s;';
    statsBtn.onmouseover = () => statsBtn.style.background = '#388bfd'; statsBtn.onmouseout = () => statsBtn.style.background = '#1f6feb';
    document.body.appendChild(statsBtn);

    const statsModal = document.createElement('div');
    statsModal.id = 'statsModal';
    statsModal.style.cssText = 'display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:9999; justify-content:center; align-items:center;';
    statsModal.innerHTML = `
        <div style="background:#0d1117; border:1px solid #30363d; border-radius:12px; width:90%; max-width:600px; padding:20px; color:#c9d1d9; max-height:90vh; overflow-y:auto;">
            <h2 style="color:#58a6ff; text-align:center; border-bottom:1px solid #30363d; padding-bottom:10px;">📊 INTELIGÊNCIA DO RADAR</h2>
            <div style="text-align:center; padding:15px; font-size:20px;">TOTAL DE OPORTUNIDADES GERADAS: <b id="statTotal" style="color:#3fb950; font-size:28px;">0</b></div>
            <div style="display:flex; gap:20px; margin-top:20px;">
                <div style="flex:1; background:#161b22; padding:15px; border-radius:8px; border:1px solid #30363d;">
                    <h4 style="color:#8b949e; text-align:center; margin-top:0;">RANKING POR ATIVO</h4>
                    <div id="statAssets" style="font-size:14px; line-height:1.8;">Aguardando dados...</div>
                </div>
                <div style="flex:1; background:#161b22; padding:15px; border-radius:8px; border:1px solid #30363d;">
                    <h4 style="color:#8b949e; text-align:center; margin-top:0;">MAPA POR HORÁRIO</h4>
                    <div id="statHours" style="font-size:14px; line-height:1.8; display:flex; flex-wrap:wrap; gap:10px; justify-content:center;">Aguardando dados...</div>
                </div>
            </div>
            <div style="text-align:center; margin-top:20px;"><button id="btnCloseStats" style="background:#21262d; color:#c9d1d9; border:1px solid #30363d; padding:10px 20px; border-radius:6px; cursor:pointer;">Fechar Painel</button></div>
        </div>
    `;
    document.body.appendChild(statsModal);
    document.getElementById('btnOpenStats').addEventListener('click', () => { renderStats(); document.getElementById('statsModal').style.display = 'flex'; });
    document.getElementById('btnCloseStats').addEventListener('click', () => { document.getElementById('statsModal').style.display = 'none'; });
}

function renderStats() {
    if (!radarGlobalStats) return;
    document.getElementById('statTotal').innerText = radarGlobalStats.total;
    
    let assetsHtml = ''; const assets = Object.entries(radarGlobalStats.byAsset).sort((a,b) => b[1].count - a[1].count);
    if(assets.length === 0) assetsHtml = 'Nenhum sinal hoje.';
    assets.forEach(([sym, data]) => {
        let avgStr = '-- min';
        if (data.intervals && data.intervals.length > 0) { const sum = data.intervals.reduce((a, b) => a + b, 0); avgStr = (sum / data.intervals.length).toFixed(1) + ' min'; }
        assetsHtml += `<div style="display:flex; justify-content:space-between; border-bottom:1px solid #21262d; padding:4px 0;"><b style="color:#ffffff;">${sym}</b> <span><b style="color:#3fb950;">${data.count}</b> (Média: ${avgStr})</span></div>`;
    });
    document.getElementById('statAssets').innerHTML = assetsHtml;

    let hoursHtml = ''; const hours = Object.entries(radarGlobalStats.byHour).sort((a,b) => a[0].localeCompare(b[0]));
    if(hours.length === 0) hoursHtml = 'Nenhum horário registrado.';
    hours.forEach(([hr, count]) => { hoursHtml += `<div style="background:#21262d; padding:4px 8px; border-radius:4px; border:1px solid #30363d;">${hr}: <b style="color:#58a6ff;">${count}</b></div>`; });
    document.getElementById('statHours').innerHTML = hoursHtml;
}

// 🎯 INTEGRAÇÃO DO RADAR COM A NOVA FILA
socket.on('radar_alert', (data) => {
    const agora = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    // Manda para a Fila Inteligente
    manageFifoAlert({
        id: 'radar-' + data.symbol,
        symbol: data.symbol,
        time: agora,
        type: data.type,
        stepText: 'Radar (Análise)',
        isEnd: false,
        isRadar: true
    });

    const toast = document.getElementById('radarToast'); const msg = document.getElementById('radarMsg');
    let color = data.type === 'CALL' ? '#3fb950' : '#f85149';
    toast.style.borderColor = color; toast.style.boxShadow = `0 0 35px ${color}`;
    msg.innerHTML = `Oportunidade de <span style="color:${color}; font-size:22px;">${data.type}</span><br>no ativo <b style="color:#ffffff; font-size:24px;">${data.symbol}</b>`;
    toast.style.display = 'block'; setTimeout(() => { toast.style.display = 'none'; }, 10000); 
});

socket.on('radar_stats_update', (stats) => {
    radarGlobalStats = stats; 
    if (document.getElementById('statsModal').style.display === 'flex') renderStats(); 
});

document.getElementById('btnLogin').addEventListener('click', () => {
    const btn = document.getElementById('btnLogin'); btn.innerText = "Autenticando..."; document.getElementById('loginError').style.display = 'none';
    socket.emit('hybrid_login', { brokerUser: document.getElementById('brokerLoginInput').value, brokerPass: document.getElementById('brokerPassInput').value });
});

socket.on('hybrid_login_result', (res) => {
    document.getElementById('btnLogin').innerText = "Acessar Sistema";
    if (res.success) {
        localStorage.setItem('jsInvestBrokerToken', res.brokerToken); localStorage.setItem('jsInvestUserRole', res.role); localStorage.setItem('jsInvestUid', res.uid);
        auth.signInWithCustomToken(res.firebaseToken).then(() => {
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('valReal').innerText = `R$ ${res.balance.real}`; document.getElementById('valDemo').innerText = res.balance.demo; 
            document.getElementById('manualTradePanel').style.display = 'flex'; 
            
            togglePremiumUI(res.isPremium);

            if (res.role === 'admin') { 
                document.getElementById('btnAdminPanel').style.display = 'inline-block'; 
                document.getElementById('btnOpenModal').style.display = 'inline-block'; 
                setupTelegramAdminUI(); 
                auth.currentUser.getIdToken().then(token => socket.emit('admin_get_tg_config', token));
            }
        }).catch(err => { document.getElementById('loginError').innerText = "Erro: " + err.message; document.getElementById('loginError').style.display = 'block'; });
    } else { 
        alert("Conta não encontrada ou credenciais inválidas!\\nVocê será redirecionado para o cadastro oficial da corretora.");
        window.location.href = "https://velloxbroker.com/register?aff=SEU_CODIGO_AQUI"; 
    }
});

socket.on('admin_tg_config_data', (config) => {
    if(document.getElementById('tgHoraManha')) {
        document.getElementById('tgHoraManha').value = config.horaManha || '09:00';
        document.getElementById('tgHoraTarde').value = config.horaTarde || '15:00';
        document.getElementById('tgDias').value = config.dias || '1-5';
        document.getElementById('tgMsgDespertar').value = config.msgDespertar || '';
        document.getElementById('tgMsgWin').value = config.msgWin || '';
        document.getElementById('tgMsgLoss').value = config.msgLoss || '';
    }
});

socket.on('auto_reconnect_result', (res) => {
    if(res.success) {
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('valReal').innerText = `R$ ${res.balance.real}`; document.getElementById('valDemo').innerText = res.balance.demo; 
        document.getElementById('manualTradePanel').style.display = 'flex'; 
        
        togglePremiumUI(res.isPremium);

        if (res.role === 'admin') { 
            document.getElementById('btnAdminPanel').style.display = 'inline-block'; 
            document.getElementById('btnOpenModal').style.display = 'inline-block'; 
            setupTelegramAdminUI(); 
            auth.currentUser.getIdToken().then(token => socket.emit('admin_get_tg_config', token));
        }
    } else {
        localStorage.removeItem('jsInvestBrokerToken'); localStorage.removeItem('jsInvestUserRole'); localStorage.removeItem('jsInvestUid'); document.getElementById('btnLogin').innerText = "Acessar Sistema";
    }
});

document.getElementById('btnLogout').addEventListener('click', () => { 
    localStorage.removeItem('jsInvestBrokerToken'); localStorage.removeItem('jsInvestUserRole'); localStorage.removeItem('jsInvestUid'); auth.signOut().then(() => { window.location.reload(); }); 
});

document.getElementById('btnToggleBot').addEventListener('click', () => {
    isBotActive = !isBotActive; saveRiskConfig(); 
    
    const config = { 
        active: isBotActive, 
        accountType: document.getElementById('riskAccount').value, 
        baseAmount: parseFloat(document.getElementById('riskAmount').value), 
        payout: parseFloat(document.getElementById('riskPayout') ? document.getElementById('riskPayout').value : 85),
        maxGale: parseInt(document.getElementById('riskGale').value), 
        stopWin: parseFloat(document.getElementById('riskWin').value), 
        stopLoss: parseFloat(document.getElementById('riskLoss').value) 
    };
    socket.emit('setup_auto_trade', config);
});

socket.on('auto_trade_status', (res) => {
    isBotActive = res.active;
    const btn = document.getElementById('btnToggleBot'); const status = document.getElementById('statusBot');
    
    if(isBotActive) { 
        btn.className = "btn-toggle-bot bot-on"; btn.innerText = "PARAR AUTO-TRADE"; status.innerText = res.msg; status.style.color = "#58a6ff"; 
    } else { 
        btn.className = "btn-toggle-bot bot-off"; btn.innerText = "ATIVAR AUTO-TRADE"; status.innerText = res.msg; 
        if(res.msg.includes("META")) status.style.color = "#e3b341"; 
        else if(res.msg.includes("STOP")) status.style.color = "#f85149"; 
        else status.style.color = "#8b949e";
    }

    if (res.profit !== undefined) { 
        const pVal = document.getElementById('profitVal'); 
        if(pVal) {
            pVal.innerText = `R$ ${res.profit.toFixed(2).replace('.', ',')}`; 
            pVal.style.color = res.profit >= 0 ? "#3fb950" : "#f85149"; 
        } else {
            const lucroBox = document.querySelector('div:contains("Lucro da Sessão:")');
            if (lucroBox) {
                lucroBox.innerHTML = `Lucro da Sessão: <b style="color:${res.profit >= 0 ? '#3fb950' : '#f85149'}">R$ ${res.profit.toFixed(2).replace('.', ',')}</b>`;
            }
        }
    }
});

document.getElementById('btnManualCall').addEventListener('click', () => { 
    saveRiskConfig(); 
    const config = { accountType: document.getElementById('riskAccount').value, baseAmount: parseFloat(document.getElementById('riskAmount').value), payout: parseFloat(document.getElementById('riskPayout') ? document.getElementById('riskPayout').value : 85), maxGale: parseInt(document.getElementById('riskGale').value) };
    socket.emit('manual_trade', { direction: 'CALL', config: config, symbol: document.getElementById('coinSelector').value, timeframe: document.getElementById('timeframeSelector').value }); 
});

document.getElementById('btnManualPut').addEventListener('click', () => { 
    saveRiskConfig(); 
    const config = { accountType: document.getElementById('riskAccount').value, baseAmount: parseFloat(document.getElementById('riskAmount').value), payout: parseFloat(document.getElementById('riskPayout') ? document.getElementById('riskPayout').value : 85), maxGale: parseInt(document.getElementById('riskGale').value) };
    socket.emit('manual_trade', { direction: 'PUT', config: config, symbol: document.getElementById('coinSelector').value, timeframe: document.getElementById('timeframeSelector').value }); 
});

socket.on('update_balance', (data) => {
    const el = document.getElementById(data.isDemo ? 'valDemo' : 'valReal'); 
    el.innerText = `R$ ${data.balance}`; el.style.color = data.isDemo ? '#3fb950' : '#58a6ff'; setTimeout(() => { el.style.color = data.isDemo ? '#d29922' : '#3fb950'; }, 1000);
});

socket.on('win_balance_update', (data) => {
    const el = document.getElementById(data.isDemo ? 'valDemo' : 'valReal');
    let currentVal = parseFloat(el.innerText.replace('R$ ', '').replace(/\\./g, '').replace(',', '.'));
    if (!isNaN(currentVal)) {
        el.innerText = `R$ ${(currentVal + data.prize).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        el.style.color = '#3fb950'; el.style.textShadow = '0 0 15px rgba(63, 185, 80, 0.8)'; setTimeout(() => { el.style.color = data.isDemo ? '#d29922' : '#3fb950'; el.style.textShadow = 'none'; }, 2000);
    }
});

socket.on('sniper_success', (msg) => { console.log("✅ " + msg); });
socket.on('sniper_error', (msg) => { alert("❌ Erro: " + msg); });

socket.on('available_strategies', (strats) => {
    const sel = document.getElementById('strategySelector'); sel.innerHTML = '';
    strats.forEach(s => { const opt = document.createElement('option'); opt.value = s.id; opt.innerText = s.name; sel.appendChild(opt); });
});

socket.on('available_coins', (groupedCoins) => {
    const selectBox = document.getElementById('coinSelector'); if(!selectBox) return; selectBox.innerHTML = ''; 
    for (const [categoryName, symbolsArray] of Object.entries(groupedCoins)) {
        let optgroup = document.createElement('optgroup'); optgroup.label = categoryName; 
        symbolsArray.forEach(sym => { let option = document.createElement('option'); option.value = sym; option.textContent = sym.toUpperCase(); optgroup.appendChild(option); });
        selectBox.appendChild(optgroup);
    }
});

socket.on('engine_state', (state) => {
    const coinSel = document.getElementById('coinSelector'); const tfSel = document.getElementById('timeframeSelector'); const stratSel = document.getElementById('strategySelector');
    if (coinSel && state.symbol) { for (let i = 0; i < coinSel.options.length; i++) { if (coinSel.options[i].value.toLowerCase() === state.symbol.toLowerCase()) { coinSel.selectedIndex = i; break; } } }
    if (tfSel && state.timeframe) tfSel.value = state.timeframe; if (stratSel && state.strategy) stratSel.value = state.strategy;
});

function clearUIForLoading() {
    document.getElementById('priceValue').innerText = 'Sincronizando...'; document.getElementById('priceValue').style.color = '#8b949e'; document.getElementById('liveTradeCard').style.display = 'none';
    document.getElementById('historyTableBody').innerHTML = `<tr><td colspan="3" style="text-align:center; color:#8b949e; padding: 20px;">Carregando análise histórica...</td></tr>`;
    document.getElementById('scoreWin1').innerText = '-'; document.getElementById('scoreWinG1').innerText = '-'; document.getElementById('scoreWinG2').innerText = '-'; document.getElementById('scoreLoss').innerText = '-'; document.getElementById('totalAccuracy').innerText = '0.0%';
    const alertBox = document.getElementById('alertBox'); alertBox.innerHTML = "Analisando Mercado..."; alertBox.className = "alert-box";
}

document.getElementById('coinSelector').addEventListener('change', (e) => { clearUIForLoading(); socket.emit('change_coin', e.target.value); });
document.getElementById('strategySelector').addEventListener('change', (e) => { clearUIForLoading(); socket.emit('change_strategy', e.target.value); });
document.getElementById('timeframeSelector').addEventListener('change', (e) => { clearUIForLoading(); socket.emit('change_timeframe', e.target.value); });

socket.on('price_update', (data) => {
    if (data.price === 0) return; 
    document.getElementById('priceValue').innerText = '$ ' + data.price.toFixed(2); document.getElementById('priceValue').style.color = '#c9d1d9'; 
    const liveCard = document.getElementById('liveTradeCard');
    
    if (data.activeSignal) {
        if (liveCard.style.display === 'none') { liveCard.style.display = 'block'; liveChart.data.labels = []; liveChart.data.datasets[0].data = []; liveChart.data.datasets[1].data = []; currentEntryPrice = data.activeSignal.entryPrice; }
        const isCall = data.activeSignal.type === 'CALL';
        document.getElementById('liveDir').innerText = isCall ? '🟢 CALL' : '🔴 PUT'; document.getElementById('liveDir').style.color = isCall ? '#3fb950' : '#f85149';
        document.getElementById('liveEntry').innerText = currentEntryPrice.toFixed(2); document.getElementById('liveCurrent').innerText = data.price.toFixed(2);
        
        let isWin = (isCall && data.price > currentEntryPrice) || (!isCall && data.price < currentEntryPrice); let isTie = data.price === currentEntryPrice;
        const statusEl = document.getElementById('liveStatus');
        if (isTie) { statusEl.innerText = 'EMPATANDO'; statusEl.style.color = '#d29922'; } else if (isWin) { statusEl.innerText = 'WIN 🎯'; statusEl.style.color = '#3fb950'; } else { statusEl.innerText = 'LOSS 🔴'; statusEl.style.color = '#f85149'; }
        
        liveChart.data.labels.push(''); liveChart.data.datasets[0].data.push(data.price); liveChart.data.datasets[1].data.push(currentEntryPrice); liveChart.data.datasets[0].borderColor = isTie ? '#d29922' : (isWin ? '#3fb950' : '#f85149');
        if (liveChart.data.labels.length > 60) { liveChart.data.labels.shift(); liveChart.data.datasets[0].data.shift(); liveChart.data.datasets[1].data.shift(); }
        liveChart.update();
    } else { liveCard.style.display = 'none'; }
});

socket.on('pre_alert', (data) => {
    const alertBox = document.getElementById('alertBox');
    if(data.call || data.put) { alertBox.innerHTML = `⚠️ PREPARAR: ${data.call ? "COMPRA" : "VENDA"}`; alertBox.className = "alert-box alert-pre"; } 
    else { alertBox.innerHTML = "Analisando Mercado..."; alertBox.className = "alert-box"; }
});

socket.on('signal', (data) => {
    const alertBox = document.getElementById('alertBox'); 
    alertBox.innerHTML = data.type === 'CALL' ? '🟢 ENTRAR: COMPRA!' : '🔴 ENTRAR: VENDA!'; alertBox.className = "alert-box alert-go"; 
    setTimeout(() => { alertBox.className = "alert-box"; }, 4000); 
});

const historyTableBody = document.getElementById('historyTableBody');

socket.on('history_dump', (historyArr) => {
    const telaMoeda = document.getElementById('coinSelector').value.toUpperCase();
    historyTableBody.innerHTML = ''; 
    historyArr.forEach(sig => {
        if (sig.symbol.toUpperCase() !== telaMoeda) return; 
        const tr = document.createElement('tr'); tr.id = `sig-${sig.id}`; const isCall = sig.type === 'CALL';
        let colorClass = 'text-warning'; if (sig.status.includes('WIN')) colorClass = 'text-green'; else if (sig.status.includes('LOSS')) colorClass = 'text-red'; 
        tr.innerHTML = `<td class="text-muted">${sig.time}</td><td class="${isCall ? 'text-green' : 'text-red'}"><span style="font-size:10px; color:#8b949e; display:block;">${sig.symbol || 'BTCUSDT'}</span>${isCall ? '🟢 CALL' : '🔴 PUT'}</td><td id="res-${sig.id}" class="${colorClass}">${sig.status}</td>`;
        historyTableBody.appendChild(tr); 
    });
});

socket.on('scoreboard', (data) => {
    document.getElementById('scoreWin1').innerText = data.win1; document.getElementById('scoreWinG1').innerText = data.winG1; document.getElementById('scoreWinG2').innerText = data.winG2; document.getElementById('scoreLoss').innerText = data.loss;
    const total = data.win1 + data.winG1 + data.winG2 + data.loss;
    if (total > 0) {
        const wins = data.win1 + data.winG1 + data.winG2;
        document.getElementById('totalAccuracy').innerText = ((wins / total) * 100).toFixed(1) + '%';
        document.getElementById('pctWin1').innerText = ((data.win1 / total) * 100).toFixed(1) + '%'; document.getElementById('pctWinG1').innerText = ((data.winG1 / total) * 100).toFixed(1) + '%'; document.getElementById('pctWinG2').innerText = ((data.winG2 / total) * 100).toFixed(1) + '%'; document.getElementById('pctLoss').innerText = ((data.loss / total) * 100).toFixed(1) + '%';
    }
});

// 🎯 INTEGRAÇÃO DOS SINAIS E GALES NA NOVA FILA FIFO
socket.on('new_signal_history', (sig) => {
    const telaMoeda = document.getElementById('coinSelector').value.toUpperCase();
    
    // Alimenta a Fila Inteligente (Mesmo que o sinal não seja da moeda da tela principal)
    manageFifoAlert({
        id: 'sig-' + sig.id,
        symbol: sig.symbol,
        time: sig.time,
        type: sig.type,
        stepText: sig.isManual ? 'Sniper (1ª)' : 'Auto (1ª)',
        isEnd: false,
        isRadar: false
    });

    if (sig.symbol.toUpperCase() !== telaMoeda) return; 
    const tr = document.createElement('tr'); tr.id = `sig-${sig.id}`;
    let colorClass = 'text-warning'; 
    tr.innerHTML = `<td class="text-muted">${sig.time}</td><td class="${sig.type === 'CALL' ? 'text-green' : 'text-red'}"><span style="font-size:10px; color:#8b949e; display:block;">${sig.symbol || 'BTCUSDT'}</span>${sig.type === 'CALL' ? '🟢 CALL' : '🔴 PUT'}</td><td id="res-${sig.id}" class="${colorClass}">${sig.status}</td>`;
    historyTableBody.prepend(tr); 
});

socket.on('signal_result', (sig) => {
    // 🎯 Inteligência da Fila: Atualiza a linha existente e decide se apaga
    let stepText = '';
    let isEnd = false;
    
    if (sig.status.includes('Gale 1')) stepText = 'Gale 1';
    else if (sig.status.includes('Gale 2')) stepText = 'Gale 2';
    else if (sig.status.includes('WIN') || sig.status.includes('LOSS')) {
        stepText = sig.status.includes('WIN') ? 'WIN 🎯' : 'LOSS 🔴';
        isEnd = true;
    } else {
        stepText = sig.status; // Fallback
    }

    manageFifoAlert({
        id: 'sig-' + sig.id,
        symbol: sig.symbol,
        time: sig.time, 
        type: sig.type,
        stepText: stepText,
        isEnd: isEnd,
        isRadar: false
    });

    const resTd = document.getElementById(`res-${sig.id}`);
    if (resTd) { resTd.innerText = sig.status; if (sig.status.includes('WIN')) resTd.className = 'text-green'; else if (sig.status.includes('LOSS')) resTd.className = 'text-red'; else resTd.className = 'text-warning'; }
});

const scriptModal = document.getElementById('adminModal');
if(document.getElementById('btnAdminPanel')) document.getElementById('btnAdminPanel').addEventListener('click', () => { scriptModal.style.display = 'flex'; auth.currentUser.getIdToken().then(token => socket.emit('admin_get_users', token)); });
if(document.getElementById('btnCancelAdmin')) document.getElementById('btnCancelAdmin').addEventListener('click', () => { scriptModal.style.display = 'none'; });

const stratModal = document.getElementById('scriptModal');
if(document.getElementById('btnOpenModal')) document.getElementById('btnOpenModal').addEventListener('click', () => { stratModal.style.display = 'flex'; });
if(document.getElementById('btnCancelScript')) document.getElementById('btnCancelScript').addEventListener('click', () => { stratModal.style.display = 'none'; });

if(document.getElementById('btnSaveScript')) {
    document.getElementById('btnSaveScript').addEventListener('click', () => {
        try { const newStrategyJSON = JSON.parse(document.getElementById('jsonInput').value); document.getElementById('btnSaveScript').innerText = 'Gravando...'; socket.emit('add_new_strategy', newStrategyJSON); } 
        catch (error) { alert("❌ Erro: Formato JSON inválido!"); document.getElementById('btnSaveScript').innerText = 'Salvar & Injetar'; }
    });
}

socket.on('script_injection_result', (res) => {
    if(document.getElementById('btnSaveScript')) document.getElementById('btnSaveScript').innerText = 'Salvar & Injetar'; 
    if (res.success) { alert("✅ " + res.msg); if(stratModal) stratModal.style.display = 'none'; setTimeout(() => { document.getElementById('strategySelector').value = res.id; socket.emit('change_strategy', res.id); }, 500); } 
    else { alert("❌ Erro:\n" + res.msg); }
});

socket.on('admin_users_list', (res) => {
    const tbody = document.getElementById('usersListBody'); tbody.innerHTML = '';
    if (res.success) {
        if (res.users.length === 0) tbody.innerHTML = '<tr><td colspan="2" style="text-align:center;">Vazio.</td></tr>';
        else { res.users.forEach(u => { const tr = document.createElement('tr'); tr.innerHTML = `<td style="padding: 10px; border-bottom: 1px solid #21262d;">${u.email}</td><td style="padding: 10px; border-bottom: 1px solid #21262d; color: ${u.role.includes('admin') ? '#58a6ff' : '#8b949e'};">${u.role.toUpperCase()}</td>`; tbody.appendChild(tr); }); }
    }
});

if(document.getElementById('btnCreateUser')) {
    document.getElementById('btnCreateUser').addEventListener('click', () => {
        const newEmail = document.getElementById('newUserEmail').value; const newPassword = document.getElementById('newUserPassword').value; const newRole = document.getElementById('newUserRole').value;
        document.getElementById('btnCreateUser').innerText = '...'; auth.currentUser.getIdToken().then(token => socket.emit('admin_create_user', { token, newEmail, newPassword, newRole }));
    });
}

socket.on('user_creation_result', (res) => {
    alert(res.msg); if(document.getElementById('btnCreateUser')) document.getElementById('btnCreateUser').innerText = 'Cadastrar';
    if(res.success) { if(document.getElementById('newUserEmail')) document.getElementById('newUserEmail').value = ''; if(document.getElementById('newUserPassword')) document.getElementById('newUserPassword').value = ''; auth.currentUser.getIdToken().then(token => socket.emit('admin_get_users', token)); }
});

if(document.getElementById('btnInjectCookie')) {
    document.getElementById('btnInjectCookie').addEventListener('click', () => {
        const cookieVal = document.getElementById('adminCookieInput').value;
        if(cookieVal.length > 20) { socket.emit('inject_cookie', cookieVal); document.getElementById('adminCookieInput').value = ''; document.getElementById('btnInjectCookie').innerText = 'Injetado! ✅'; setTimeout(() => { document.getElementById('btnInjectCookie').innerText = 'Injetar'; }, 3000); } 
        else { alert('❌ Cookie inválido!'); }
    });
}

setInterval(() => {
    const tfSelect = document.getElementById('timeframeSelector'); const tfMinutes = tfSelect ? parseInt(tfSelect.value.replace('m', '')) : 1; const now = new Date();
    const sec = (tfMinutes * 60) - ((now.getMinutes() % tfMinutes) * 60 + now.getSeconds());
    let displayTime = '';
    if (sec >= 60) { const m = Math.floor(sec / 60); const s = sec % 60; displayTime = `${m < 10 ? '0'+m : m}:${s < 10 ? '0'+s : s}`; } 
    else { displayTime = sec < 10 ? '0' + sec : sec; }
    document.getElementById('timerCircle').innerText = displayTime;
    const liveCard = document.getElementById('liveTradeCard'); if (liveCard && liveCard.style.display !== 'none') { document.getElementById('liveTime').innerText = displayTime + (sec < 60 ? 's' : ''); }
}, 1000);