// 🎨 UI & VISUAL CONTROLLERS (Gráficos, Painéis e Alertas)

window.liveChart = null; 

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
        stopWin: document.getElementById('riskWin').value,
        stopLoss: document.getElementById('riskLoss').value
    };
    localStorage.setItem('jsInvestConfig', JSON.stringify(config));
}

// 🎯 SAAS: PAINEL DE ASSINATURA ATUALIZADO
function mostrarPainelAssinatura(dataExpiracao) {
    if (document.getElementById('premiumBlockModal')) return;

    const modal = document.createElement('div');
    modal.id = 'premiumBlockModal';
    modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); z-index:99999; display:flex; justify-content:center; align-items:center; backdrop-filter: blur(10px); animation: fadeIn 0.3s ease-out;';
    
    modal.innerHTML = `
        <div style="background:#0d1117; border:2px solid #58a6ff; border-radius:20px; width:95%; max-width:450px; padding:30px; text-align:center; color:#fff; box-shadow: 0 0 50px rgba(88, 166, 255, 0.2);">
            <div style="font-size:50px; margin-bottom:10px;">🔒</div>
            <h2 style="color:#58a6ff; margin-bottom:5px; font-weight:900;">ACESSO EXPIRADO</h2>
            <p style="color:#8b949e; font-size:14px; margin-bottom:20px;">O seu período de uso terminou em <br><b style="color:#f85149;">${new Date(dataExpiracao).toLocaleDateString()}</b></p>
            
            <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:15px;">
                <button onclick="gerarCheckout(1.00, 1)" style="background:#161b22; border:1px solid #30363d; color:#fff; padding:12px; border-radius:10px; cursor:pointer; font-weight:bold;"><b>1 MÊS</b> - R$ 1,00 (TESTE)</button>
                <button onclick="gerarCheckout(119.90, 3)" style="background:linear-gradient(90deg, #1f6feb, #58a6ff); border:none; color:#fff; padding:15px; border-radius:10px; cursor:pointer; font-weight:bold; transform:scale(1.05);">🚀 <b>3 MESES</b> - R$ 119,90</button>
                <button onclick="gerarCheckout(199.90, 6)" style="background:#161b22; border:1px solid #30363d; color:#fff; padding:12px; border-radius:10px; cursor:pointer; font-weight:bold;"><b>6 MESES</b> - R$ 199,90</button>
                <button onclick="gerarCheckout(399.90, 12)" style="background:#161b22; border:1px solid #30363d; color:#fff; padding:12px; border-radius:10px; cursor:pointer; font-weight:bold;"><b>1 ANO</b> - R$ 399,90</button>
            </div>

            <div id="pixArea" style="display:none; background:#fff; padding:15px; border-radius:10px; margin-top:15px; margin-bottom:15px;">
                <p style="color:#000; font-weight:bold; margin-bottom:10px;">Pague o PIX para liberar agora:</p>
                <div id="qrcodePlace" style="display:flex; justify-content:center; margin-bottom:10px;"></div>
                <input type="text" id="pixCopyPaste" readonly style="width:100%; padding:8px; font-size:10px; background:#f0f0f0; border:1px solid #ccc; border-radius:4px; color:#000;">
                <button onclick="copyPix()" style="background:#000; color:#fff; width:100%; border:none; padding:12px; margin-top:10px; border-radius:5px; cursor:pointer; font-weight:bold;">COPIAR CÓDIGO PIX</button>
            </div>
            
            <button onclick="liberarApenasDemo()" style="background:transparent; border:none; color:#8b949e; text-decoration:underline; font-size:12px; cursor:pointer; margin-top:10px;">Ignorar e acessar apenas Conta Demo</button>
        </div>
    `;
    document.body.appendChild(modal);
}

// 🎯 FECHA O MODAL MAS TRANCA NA DEMO
function liberarApenasDemo() {
    const modal = document.getElementById('premiumBlockModal');
    if (modal) modal.style.display = 'none';
    
    const accSelect = document.getElementById('riskAccount');
    if (accSelect) {
        accSelect.value = 'demo';
        accSelect.disabled = true; // Tranca o seletor visualmente
    }
    alert("⚠️ Acesso restrito à Conta Demo. Para operar na Conta Real com o Robô, renove sua assinatura.");
}

function togglePremiumUI(isPremium, expiresAt) {
    const statusBot = document.getElementById('statusBot');
    const accSelect = document.getElementById('riskAccount');
    
    if (statusBot) {
        if (isPremium) { 
            let exp = new Date(expiresAt);
            statusBot.innerText = `🚀 ACESSO LIBERADO (Expira em: ${exp.toLocaleDateString()})`; 
            statusBot.style.color = "#3fb950"; 
            if (accSelect) accSelect.disabled = false; // Destranca a conta Real
        } else { 
            statusBot.innerText = "🔒 ACESSO EXPIRADO (Apenas Conta Demo)"; 
            statusBot.style.color = "#d29922"; 
            if (accSelect) {
                accSelect.value = 'demo';
                accSelect.disabled = true; // Tranca na Demo se estiver expirado
            }
        }
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

function renderStats(statsData) {
    if (!statsData) return;
    const elTotal = document.getElementById('statTotal');
    if (elTotal) elTotal.innerText = statsData.total;
    
    let assetsHtml = ''; const assets = Object.entries(statsData.byAsset).sort((a,b) => b[1].count - a[1].count);
    if(assets.length === 0) assetsHtml = 'Nenhum sinal hoje.';
    assets.forEach(([sym, data]) => { let avgStr = '-- min'; if (data.intervals && data.intervals.length > 0) { const sum = data.intervals.reduce((a, b) => a + b, 0); avgStr = (sum / data.intervals.length).toFixed(1) + ' min'; } assetsHtml += `<div style="display:flex; justify-content:space-between; border-bottom:1px solid #21262d; padding:4px 0;"><b style="color:#ffffff;">${sym}</b> <span><b style="color:#3fb950;">${data.count}</b> (Média: ${avgStr})</span></div>`; });
    const elAssets = document.getElementById('statAssets');
    if (elAssets) elAssets.innerHTML = assetsHtml;

    let hoursHtml = ''; const hours = Object.entries(statsData.byHour).sort((a,b) => a[0].localeCompare(b[0]));
    if(hours.length === 0) hoursHtml = 'Nenhum horário registrado.';
    hours.forEach(([hr, count]) => { hoursHtml += `<div style="background:#21262d; padding:4px 8px; border-radius:4px; border:1px solid #30363d;">${hr}: <b style="color:#58a6ff;">${count}</b></div>`; });
    const elHours = document.getElementById('statHours');
    if (elHours) elHours.innerHTML = hoursHtml;
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