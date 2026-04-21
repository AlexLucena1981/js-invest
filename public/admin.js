// ⚙️ ADMIN PANEL CONTROLLER (Abas, Formulários e Injeção no Servidor)

function setupTelegramAdminUI(auth, socket) {
    const adminModalContent = document.querySelector('#adminModal > div');
    if (!adminModalContent || document.getElementById('tgAdminPanel')) return;

    const oldCloseBtn = document.getElementById('btnCancelAdmin');
    if (oldCloseBtn) {
        const parent = oldCloseBtn.parentElement;
        if (parent && parent.tagName === 'DIV' && parent.children.length === 1) { parent.remove(); } else { oldCloseBtn.remove(); }
    }

    const systemPanel = document.createElement('div');
    systemPanel.id = 'systemAdminPanel';
    while (adminModalContent.firstChild) { systemPanel.appendChild(adminModalContent.firstChild); }

    const tabNav = document.createElement('div');
    tabNav.style.cssText = 'display:flex; gap:5px; margin-bottom:20px; border-bottom:1px solid #30363d; padding-bottom:15px; overflow-x:auto;';
    tabNav.innerHTML = `
        <button id="tabSystem" style="flex:1; background:#1f6feb; color:white; border:none; padding:10px; border-radius:6px; font-weight:bold; cursor:pointer; font-size:12px;">👥 Usuários</button>
        <button id="tabTelegram" style="flex:1; background:#21262d; color:#8b949e; border:1px solid #30363d; padding:10px; border-radius:6px; font-weight:bold; cursor:pointer; font-size:12px;">🤖 Robô TG</button>
        <button id="tabReport" style="flex:1; background:#21262d; color:#8b949e; border:1px solid #30363d; padding:10px; border-radius:6px; font-weight:bold; cursor:pointer; font-size:12px;">📊 Histórico</button>
        <button id="tabStrategies" style="flex:1; background:#21262d; color:#8b949e; border:1px solid #30363d; padding:10px; border-radius:6px; font-weight:bold; cursor:pointer; font-size:12px;">📈 Estratégias</button>
        <button id="tabRadarStats" style="flex:1; background:#21262d; color:#8b949e; border:1px solid #30363d; padding:10px; border-radius:6px; font-weight:bold; cursor:pointer; font-size:12px;">📡 Radar</button>
    `;

    const tgPanel = document.createElement('div');
    tgPanel.id = 'tgAdminPanel';
    tgPanel.style.display = 'none';
    tgPanel.innerHTML = `
        <h3 style="color:#58a6ff; text-align:center; margin-bottom: 15px; margin-top:0;">⚙️ CONFIGURAÇÃO DO ROBÔ</h3>
        
        <div style="display:flex; gap:10px; margin-bottom:15px; background:#161b22; padding:15px; border-radius:8px; border:1px solid #30363d;">
            <div style="flex:1;"><label style="font-size:11px; color:#8b949e;">RSI Sobrecompra</label><input type="number" id="tgRsiOver" class="form-control" style="background:#0d1117; color:#f85149; border:1px solid #30363d; font-weight:bold; font-size:14px;"></div>
            <div style="flex:1;"><label style="font-size:11px; color:#8b949e;">RSI Sobrevenda</label><input type="number" id="tgRsiUnder" class="form-control" style="background:#0d1117; color:#3fb950; border:1px solid #30363d; font-weight:bold; font-size:14px;"></div>
            <div style="flex:1;"><label style="font-size:11px; color:#8b949e;">Bollinger</label><input type="text" id="tgBbDev" class="form-control" style="background:#0d1117; color:#58a6ff; border:1px solid #30363d; font-weight:bold; font-size:14px;"></div>
        </div>

        <div style="display:flex; gap:10px; margin-bottom:15px;">
            <div style="flex:1;"><label style="font-size:12px; color:#8b949e;">Início Manhã</label><input type="time" id="tgHoraManha" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d;"></div>
            <div style="flex:1;"><label style="font-size:12px; color:#8b949e;">Início Tarde</label><input type="time" id="tgHoraTarde" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d;"></div>
            <div style="flex:1;"><label style="font-size:12px; color:#8b949e;">Dias</label><input type="text" id="tgDias" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d;"></div>
        </div>

        <div style="margin-bottom:15px; background:#161b22; padding:10px; border-radius:8px; border:1px solid #30363d;">
             <label style="font-size:11px; color:#8b949e; display:block; margin-bottom:5px;">Qtd Sinais/Sessão (Meta de Stop)</label>
             <input type="number" id="tgMaxSinais" class="form-control" style="background:#0d1117; color:#58a6ff; border:1px solid #30363d; font-weight:bold; font-size:14px; width:100%;">
        </div>

        <div style="display:flex; gap:10px; margin-bottom:10px;">
            <div style="flex:1;"><label style="font-size:11px; color:#8b949e;">ID Sticker: Início</label><input type="text" id="tgStkStart" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d; font-size:12px;"></div>
            <div style="flex:1;"><label style="font-size:11px; color:#8b949e;">ID Sticker: Fim</label><input type="text" id="tgStkEnd" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d; font-size:12px;"></div>
        </div>

        <div style="display:flex; gap:10px; margin-bottom:15px;">
            <div style="flex:1;"><label style="font-size:11px; color:#8b949e;">ID Sticker: WIN</label><input type="text" id="tgStkWin" class="form-control" style="background:#0d1117; color:#3fb950; border:1px solid #30363d; font-size:12px;"></div>
            <div style="flex:1;"><label style="font-size:11px; color:#8b949e;">ID Sticker: LOSS</label><input type="text" id="tgStkLoss" class="form-control" style="background:#0d1117; color:#f85149; border:1px solid #30363d; font-size:12px;"></div>
        </div>

        <div style="margin-bottom:15px;"><label style="font-size:12px; color:#8b949e;">Template: Sinal Oficial</label><textarea id="tgMsgSinal" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d; height: 120px; font-family: monospace; font-size: 11px; white-space: pre-wrap;"></textarea></div>

        <div style="display:flex; justify-content:space-between; gap:10px; margin-bottom:15px;">
            <button id="btnSalvarTg" style="flex:1; background:#2ea043; color:white; border:none; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer; font-size:14px;">💾 Salvar</button>
            <button id="btnForcarTgManha" style="flex:1; background:#da3633; color:white; border:none; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer; font-size:14px;">🔥 Iniciar Sessão</button>
        </div>
    `;

    const reportPanel = document.createElement('div');
    reportPanel.id = 'reportAdminPanel';
    reportPanel.style.display = 'none';
    reportPanel.innerHTML = `
        <h3 style="color:#58a6ff; text-align:center; margin-top:0;">📊 PERFORMANCE DO BANCO</h3>
        <div style="background:#161b22; padding:15px; border-radius:8px; border:1px solid #30363d; text-align:center;">
            <p style="color:#8b949e; margin:0;">Módulo de Auditoria Ativo.</p>
            <p style="font-size:11px; color:#3fb950;">Os sinais estão sendo gravados no Firebase.</p>
        </div>
        <div id="rankingListContainer" style="margin-top:15px; max-height:45vh; overflow-y:auto; padding-right:5px;">
            <div style="text-align:center; padding:20px; color:#8b949e;">Aguardando dados...</div>
        </div>
    `;

    const stratPanel = document.createElement('div');
    stratPanel.id = 'stratAdminPanel';
    stratPanel.style.display = 'none';
    stratPanel.innerHTML = `
        <h3 style="color:#58a6ff; text-align:center; margin-top:0;">📈 GESTÃO DE ESTRATÉGIAS</h3>
        <div style="background:#161b22; padding:15px; border-radius:8px; border:1px solid #30363d; margin-bottom:15px;">
            <label style="font-size:11px; color:#8b949e;">Inserir Nova Estratégia (Formato JSON)</label>
            <textarea id="newStratJson" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d; height: 180px; font-family: monospace; font-size: 11px; margin-bottom:10px;"></textarea>
            <button id="btnSaveNewStrat" style="background:#2ea043; color:white; border:none; padding:10px; border-radius:6px; font-weight:bold; cursor:pointer; width:100%;">💾 Adicionar Estratégia</button>
        </div>
        <div style="background:#161b22; padding:15px; border-radius:8px; border:1px solid #30363d;">
            <h4 style="color:#8b949e; text-align:center; margin-top:0; font-size:12px;">ESTRATÉGIAS ATIVAS</h4>
            <div id="adminStratList" style="max-height: 250px; overflow-y: auto; padding-right:5px;">
                <div style="text-align:center; color:#8b949e;">Carregando...</div>
            </div>
        </div>
    `;

    // 🎯 NOVA ABA DE ESTATÍSTICAS DO RADAR
    const radarStatsPanel = document.createElement('div');
    radarStatsPanel.id = 'radarStatsAdminPanel';
    radarStatsPanel.style.display = 'none';
    radarStatsPanel.innerHTML = `
        <h3 style="color:#58a6ff; text-align:center; margin-top:0;">📊 INTELIGÊNCIA DO RADAR</h3>
        <div style="text-align:center; padding:15px; font-size:20px;">TOTAL DE OPORTUNIDADES GERADAS: <b id="statTotal" style="color:#3fb950; font-size:28px;">0</b></div>
        <div style="display:flex; flex-direction:column; gap:20px; margin-top:10px;">
            <div style="background:#161b22; padding:15px; border-radius:8px; border:1px solid #30363d;"><h4 style="color:#8b949e; text-align:center; margin-top:0;">RANKING POR ATIVO</h4><div id="statAssets" style="font-size:14px; line-height:1.8;">Aguardando dados...</div></div>
            <div style="background:#161b22; padding:15px; border-radius:8px; border:1px solid #30363d;"><h4 style="color:#8b949e; text-align:center; margin-top:0;">MAPA POR HORÁRIO</h4><div id="statHours" style="font-size:14px; line-height:1.8; display:flex; flex-wrap:wrap; gap:10px; justify-content:center;">Aguardando dados...</div></div>
        </div>
    `;

    adminModalContent.appendChild(tabNav);
    adminModalContent.appendChild(systemPanel);
    adminModalContent.appendChild(tgPanel);
    adminModalContent.appendChild(reportPanel);
    adminModalContent.appendChild(stratPanel);
    adminModalContent.appendChild(radarStatsPanel);

    const closeContainer = document.createElement('div');
    closeContainer.style.textAlign = 'center'; closeContainer.style.marginTop = '20px'; closeContainer.style.paddingTop = '15px'; closeContainer.style.borderTop = '1px solid #30363d';
    closeContainer.innerHTML = `<button id="btnUniversalClose" style="background:#21262d; color:#c9d1d9; border:1px solid #30363d; padding:10px 30px; border-radius:8px; font-weight:bold; cursor:pointer; width:100%; transition:0.2s;">FECHAR PAINEL ADMIN</button>`;
    adminModalContent.appendChild(closeContainer);

    function resetTabs() {
        ['systemAdminPanel', 'tgAdminPanel', 'reportAdminPanel', 'stratAdminPanel', 'radarStatsAdminPanel'].forEach(id => document.getElementById(id).style.display = 'none');
        ['tabSystem', 'tabTelegram', 'tabReport', 'tabStrategies', 'tabRadarStats'].forEach(id => {
            document.getElementById(id).style.background = '#21262d';
            document.getElementById(id).style.color = '#8b949e';
            document.getElementById(id).style.border = '1px solid #30363d';
        });
    }

    document.getElementById('tabSystem').addEventListener('click', () => {
        resetTabs(); document.getElementById('systemAdminPanel').style.display = 'block';
        document.getElementById('tabSystem').style.background = '#1f6feb'; document.getElementById('tabSystem').style.color = 'white'; document.getElementById('tabSystem').style.border = 'none';
    });

    document.getElementById('tabTelegram').addEventListener('click', () => {
        resetTabs(); document.getElementById('tgAdminPanel').style.display = 'block';
        document.getElementById('tabTelegram').style.background = '#2ea043'; document.getElementById('tabTelegram').style.color = 'white'; document.getElementById('tabTelegram').style.border = 'none';
    });

    document.getElementById('tabReport').addEventListener('click', () => {
        resetTabs(); document.getElementById('reportAdminPanel').style.display = 'block';
        document.getElementById('tabReport').style.background = '#8957e5'; document.getElementById('tabReport').style.color = 'white'; document.getElementById('tabReport').style.border = 'none';
        auth.currentUser.getIdToken().then(token => socket.emit('admin_get_report', token));
    });

    document.getElementById('tabStrategies').addEventListener('click', () => {
        resetTabs(); document.getElementById('stratAdminPanel').style.display = 'block';
        document.getElementById('tabStrategies').style.background = '#d29922'; document.getElementById('tabStrategies').style.color = 'white'; document.getElementById('tabStrategies').style.border = 'none';
        auth.currentUser.getIdToken().then(token => socket.emit('admin_get_strategies', token));
        
        const defaultStratJSON = {
            "id": "nova_estrat",
            "name": "Nome da Estratégia",
            "isComplex": false,
            "indicators": {
                "rsi": { "type": "RSI", "period": 14 },
                "bb": { "type": "BB", "period": 20, "stdDev": 2 }
            },
            "conditions": {
                "call": "current.price <= current.bb.lower && current.rsi <= 35",
                "put": "current.price >= current.bb.upper && current.rsi >= 65"
            }
        };
        document.getElementById('newStratJson').value = JSON.stringify(defaultStratJSON, null, 4);
    });

    // 🎯 NOVO CLIQUE: ABA RADAR
    document.getElementById('tabRadarStats').addEventListener('click', () => {
        resetTabs(); document.getElementById('radarStatsAdminPanel').style.display = 'block';
        document.getElementById('tabRadarStats').style.background = '#388bfd'; document.getElementById('tabRadarStats').style.color = 'white'; document.getElementById('tabRadarStats').style.border = 'none';
        if (typeof renderStats === 'function' && window.radarGlobalStats) {
            renderStats(window.radarGlobalStats);
        }
    });

    document.getElementById('btnSaveNewStrat').addEventListener('click', () => {
        try {
            const newStrategyJSON = JSON.parse(document.getElementById('newStratJson').value);
            document.getElementById('btnSaveNewStrat').innerText = 'Gravando...';
            socket.emit('add_new_strategy', newStrategyJSON); 
            setTimeout(() => { 
                document.getElementById('btnSaveNewStrat').innerText = '💾 Adicionar Estratégia';
                auth.currentUser.getIdToken().then(token => socket.emit('admin_get_strategies', token));
            }, 1000);
        } catch (error) {
            alert("❌ Erro: Formato JSON inválido!");
            document.getElementById('btnSaveNewStrat').innerText = '💾 Adicionar Estratégia';
        }
    });

    document.getElementById('btnUniversalClose').addEventListener('click', () => { document.getElementById('adminModal').style.display = 'none'; });

    document.getElementById('btnSalvarTg').addEventListener('click', () => {
        const config = {
            rsiOver: document.getElementById('tgRsiOver').value, rsiUnder: document.getElementById('tgRsiUnder').value, bbDev: document.getElementById('tgBbDev').value.replace(',', '.'),
            horaManha: document.getElementById('tgHoraManha').value, horaTarde: document.getElementById('tgHoraTarde').value, dias: document.getElementById('tgDias').value,
            maxSinais: document.getElementById('tgMaxSinais').value,
            stkStart: document.getElementById('tgStkStart').value, stkEnd: document.getElementById('tgStkEnd').value, stkWin: document.getElementById('tgStkWin').value, stkLoss: document.getElementById('tgStkLoss').value,
            msgSinal: document.getElementById('tgMsgSinal').value
        };
        auth.currentUser.getIdToken().then(token => socket.emit('admin_save_tg_config', { token, config }));
    });

    document.getElementById('btnForcarTgManha').addEventListener('click', () => { auth.currentUser.getIdToken().then(token => socket.emit('admin_force_tg', { token, turno: 'Forçada Manualmente' })); });
}