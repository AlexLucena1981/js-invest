// 🎨 UI & VISUAL CONTROLLERS (Gráficos, Painéis e Alertas)

window.liveChart = null; // Gráfico Global

function initChart() {
    const ctx = document.getElementById('liveChart').getContext('2d');
    window.liveChart = new Chart(ctx, {
        type: 'line', 
        data: { labels: [], datasets: [ { label: 'Preço Atual', data: [], borderColor: '#58a6ff', borderWidth: 2, pointRadius: 0, tension: 0.1 }, { label: 'Linha de Entrada', data: [], borderColor: '#8b949e', borderWidth: 1, borderDash: [5, 5], pointRadius: 0 } ] },
        options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { position: 'right', grid: { color: '#30363d' }, ticks: { color: '#8b949e', font: {size: 10} } } } }
    });
}

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

function mostrarPopupBloqueioFreemium() {
    if (document.getElementById('premiumBlockModal')) return;

    const modal = document.createElement('div');
    modal.id = 'premiumBlockModal';
    modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:99999; display:flex; justify-content:center; align-items:center; backdrop-filter: blur(8px); animation: fadeIn 0.3s ease-out;';
    
    modal.innerHTML = `
        <div style="background:#0d1117; border:2px solid #f85149; border-radius:15px; width:90%; max-width:400px; padding:30px; text-align:center; color:#c9d1d9; box-shadow: 0 0 40px rgba(248, 81, 73, 0.4); position:relative;">
            <div style="font-size:50px; margin-bottom:10px; text-shadow: 0 0 15px rgba(248, 81, 73, 0.8);">🔒</div>
            <h2 style="color:#f85149; margin-bottom:15px; font-weight:900; letter-spacing:1px;">AUTO-TRADE BLOQUEADO</h2>
            <p style="font-size:15px; margin-bottom:20px; line-height:1.6; color:#8b949e;">A ferramenta de <b style="color:#c9d1d9;">Robô de Alta Frequência</b> é um recurso exclusivo para contas com um saldo mínimo de R$100.</p>
            <div style="background:#161b22; padding:15px; border-radius:8px; border:1px solid #30363d; margin-bottom:25px;">
                <span style="color:#8b949e; font-size:12px; display:block; margin-bottom:5px;">STATUS DA SUA CONTA</span>
                <span style="color:#d29922; font-size:16px; font-weight:bold;">⚠️ MODO FREE (Apenas Sinais)</span>
                <div style="margin-top:10px; font-size:12px; color:#58a6ff;">A sua banca real não atingiu o saldo mínimo de R$ 100,00. Deposite o valor exigido para libertar a automação!</div>
            </div>
            <button onclick="document.getElementById('premiumBlockModal').remove()" style="background: linear-gradient(180deg, #f85149 0%, #da3633 100%); color:white; border:none; padding:12px 25px; border-radius:8px; font-weight:bold; cursor:pointer; width:100%; font-size:16px; transition:0.2s; box-shadow: 0 4px 15px rgba(248, 81, 73, 0.4);">ENTENDI</button>
        </div>
    `;
    document.body.appendChild(modal);
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
        if (isPremium) { statusBot.innerText = "🚀 MODO PLUS ATIVO: Operações Liberadas!"; statusBot.style.color = "#3fb950"; } 
        else { statusBot.innerText = "🔒 MODO FREE: Radar Ativo (Requer banca R$ 100+)"; statusBot.style.color = "#d29922"; }
    }
}

function setupFifoPanel() {
    const style = document.createElement('style');
    style.innerHTML = `@keyframes slideInRight { from { opacity: 0; transform: translateX(50px); } to { opacity: 1; transform: translateX(0); } }`;
    document.head.appendChild(style);

    const fifoPanel = document.createElement('div');
    fifoPanel.id = 'fifoPanel';
    fifoPanel.style.cssText = 'position:fixed; bottom:20px; right:20px; width:320px; background:#0d1117; border:1px solid #30363d; border-radius:10px; z-index:8900; box-shadow:0 10px 30px rgba(0,0,0,0.8); display:flex; flex-direction:column; overflow:hidden; font-family: monospace;';
    fifoPanel.innerHTML = `
        <div style="background: linear-gradient(180deg, #161b22 0%, #0d1117 100%); padding:12px; font-weight:bold; color:#58a6ff; text-align:center; border-bottom:1px solid #30363d; font-size:14px; text-transform:uppercase; letter-spacing: 1px; display: flex; justify-content: space-between; align-items: center;">
            <span>🚦 OPERAÇÕES ATIVAS</span><span style="font-size:10px; color:#8b949e; background:#21262d; padding:2px 6px; border-radius:4px;">AO VIVO</span>
        </div>
        <div id="fifoList" style="display:flex; flex-direction:column; gap:0; max-height: 350px; overflow-y: auto;">
            <div style="padding:30px; text-align:center; color:#8b949e; font-size:12px;" id="fifoEmpty">Radar varrendo o mercado...<br>Nenhuma operação em andamento.</div>
        </div>
    `;
    document.body.appendChild(fifoPanel);
}

function manageFifoAlert(data) {
    const list = document.getElementById('fifoList');
    const emptyMsg = document.getElementById('fifoEmpty');
    if (emptyMsg) emptyMsg.style.display = 'none';

    if (!data.isRadar) { const existingRadar = document.getElementById('fifo-radar-' + data.symbol); if (existingRadar) existingRadar.remove(); }

    let item = document.getElementById('fifo-' + data.id);
    const isCall = data.type.toUpperCase() === 'CALL';
    const colorDir = isCall ? '#3fb950' : '#f85149';
    const dirText = isCall ? '🟢 CALL' : '🔴 PUT';

    let jogadaColor = '#c9d1d9';
    if (data.stepText.includes('Gale 1')) jogadaColor = '#d29922'; 
    if (data.stepText.includes('Gale 2')) jogadaColor = '#f85149'; 
    if (data.stepText.includes('Radar')) jogadaColor = '#58a6ff';
    if (data.stepText.includes('WIN')) jogadaColor = '#3fb950';
    if (data.stepText.includes('LOSS')) jogadaColor = '#f85149';

    if (!item) {
        item = document.createElement('div');
        item.id = 'fifo-' + data.id;
        item.style.cssText = `display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid #21262d; font-size:12px; animation: slideInRight 0.3s ease-out; background: rgba(22, 27, 34, 0.5); transition: opacity 0.5s ease-out;`;
        list.prepend(item);
    }

    item.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:3px; width:30%;"><span style="color:#8b949e; font-size: 10px;">${data.time}</span><b style="color:#fff; font-size: 12px;">${data.symbol}</b></div>
        <div style="width:35%; font-weight:bold; color:${colorDir}; text-align:center; font-size: 12px;">${dirText}</div>
        <div style="width:35%; text-align:right; font-weight:bold; color:${jogadaColor}; font-size: 11px; text-shadow: ${data.isEnd ? '0 0 10px '+jogadaColor : 'none'};">${data.stepText}</div>
    `;

    if (list.children.length > 8 && !data.isEnd) { const last = list.lastElementChild; if (last && last.id !== 'fifoEmpty' && last !== item) last.remove(); }
    if (data.isRadar) { setTimeout(() => { if (document.getElementById('fifo-' + data.id)) { document.getElementById('fifo-' + data.id).style.opacity = '0'; setTimeout(() => { document.getElementById('fifo-' + data.id)?.remove(); checkFifoEmpty(); }, 500); } }, 40000); }
    if (data.isEnd) { setTimeout(() => { if (document.getElementById('fifo-' + data.id)) { document.getElementById('fifo-' + data.id).style.opacity = '0'; setTimeout(() => { document.getElementById('fifo-' + data.id)?.remove(); checkFifoEmpty(); }, 500); } }, 5000); }
}

function checkFifoEmpty() {
    const list = document.getElementById('fifoList');
    const emptyMsg = document.getElementById('fifoEmpty');
    let hasItems = Array.from(list.children).some(child => child.id !== 'fifoEmpty');
    if (!hasItems && emptyMsg) emptyMsg.style.display = 'block';
}

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
                <div style="flex:1; background:#161b22; padding:15px; border-radius:8px; border:1px solid #30363d;"><h4 style="color:#8b949e; text-align:center; margin-top:0;">RANKING POR ATIVO</h4><div id="statAssets" style="font-size:14px; line-height:1.8;">Aguardando dados...</div></div>
                <div style="flex:1; background:#161b22; padding:15px; border-radius:8px; border:1px solid #30363d;"><h4 style="color:#8b949e; text-align:center; margin-top:0;">MAPA POR HORÁRIO</h4><div id="statHours" style="font-size:14px; line-height:1.8; display:flex; flex-wrap:wrap; gap:10px; justify-content:center;">Aguardando dados...</div></div>
            </div>
            <div style="text-align:center; margin-top:20px;"><button id="btnCloseStats" style="background:#21262d; color:#c9d1d9; border:1px solid #30363d; padding:10px 20px; border-radius:6px; cursor:pointer;">Fechar Painel</button></div>
        </div>
    `;
    document.body.appendChild(statsModal);
    
    // O evento de abrir o modal chama renderStats indiretamente através do app.js, ou podemos deixar o HTML pronto e o app.js controla.
    document.getElementById('btnCloseStats').addEventListener('click', () => { document.getElementById('statsModal').style.display = 'none'; });
}

function renderStats(statsData) {
    if (!statsData) return;
    document.getElementById('statTotal').innerText = statsData.total;
    let assetsHtml = ''; const assets = Object.entries(statsData.byAsset).sort((a,b) => b[1].count - a[1].count);
    if(assets.length === 0) assetsHtml = 'Nenhum sinal hoje.';
    assets.forEach(([sym, data]) => { let avgStr = '-- min'; if (data.intervals && data.intervals.length > 0) { const sum = data.intervals.reduce((a, b) => a + b, 0); avgStr = (sum / data.intervals.length).toFixed(1) + ' min'; } assetsHtml += `<div style="display:flex; justify-content:space-between; border-bottom:1px solid #21262d; padding:4px 0;"><b style="color:#ffffff;">${sym}</b> <span><b style="color:#3fb950;">${data.count}</b> (Média: ${avgStr})</span></div>`; });
    document.getElementById('statAssets').innerHTML = assetsHtml;

    let hoursHtml = ''; const hours = Object.entries(statsData.byHour).sort((a,b) => a[0].localeCompare(b[0]));
    if(hours.length === 0) hoursHtml = 'Nenhum horário registrado.';
    hours.forEach(([hr, count]) => { hoursHtml += `<div style="background:#21262d; padding:4px 8px; border-radius:4px; border:1px solid #30363d;">${hr}: <b style="color:#58a6ff;">${count}</b></div>`; });
    document.getElementById('statHours').innerHTML = hoursHtml;
}

function clearUIForLoading() {
    document.getElementById('priceValue').innerText = 'Sincronizando...'; document.getElementById('priceValue').style.color = '#8b949e'; document.getElementById('liveTradeCard').style.display = 'none';
    document.getElementById('historyTableBody').innerHTML = `<tr><td colspan="3" style="text-align:center; color:#8b949e; padding: 20px;">Carregando análise histórica...</td></tr>`;
    document.getElementById('scoreWin1').innerText = '-'; document.getElementById('scoreWinG1').innerText = '-'; document.getElementById('scoreWinG2').innerText = '-'; document.getElementById('scoreLoss').innerText = '-'; document.getElementById('totalAccuracy').innerText = '0.0%';
    const alertBox = document.getElementById('alertBox'); alertBox.innerHTML = "Analisando Mercado..."; alertBox.className = "alert-box";

    const fifoList = document.getElementById('fifoList'); 
    if(fifoList) { 
        Array.from(fifoList.children).forEach(child => { if (child.id && child.id.startsWith('fifo-sig-')) child.remove(); }); 
        checkFifoEmpty(); 
    }
}