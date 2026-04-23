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
        <h3 style="color:#58a6ff; text-align:center; margin-bottom: 15px; margin-top:0;">⚙️ CONFIGURAÇÃO DO ROBÔ (FREE E VIP)</h3>
        
        <div style="display:flex; gap:10px; margin-bottom:10px; background:#161b22; padding:10px; border-radius:8px; border:1px solid #30363d;">
            <div style="flex:1;"><label style="font-size:11px; color:#8b949e;">RSI Sobrecompra</label><input type="number" id="tgRsiOver" class="form-control" style="background:#0d1117; color:#f85149; border:1px solid #30363d; font-weight:bold; font-size:12px;"></div>
            <div style="flex:1;"><label style="font-size:11px; color:#8b949e;">RSI Sobrevenda</label><input type="number" id="tgRsiUnder" class="form-control" style="background:#0d1117; color:#3fb950; border:1px solid #30363d; font-weight:bold; font-size:12px;"></div>
            <div style="flex:1;"><label style="font-size:11px; color:#8b949e;">Bollinger (Desvio)</label><input type="text" id="tgBbDev" class="form-control" style="background:#0d1117; color:#58a6ff; border:1px solid #30363d; font-weight:bold; font-size:12px;"></div>
        </div>

        <div style="display:flex; gap:10px; margin-bottom:10px;">
            <div style="flex:1;"><label style="font-size:11px; color:#58a6ff; font-weight:bold;">ID Grupo FREE</label><input type="text" id="tgChatIdFree" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #58a6ff;" placeholder="-100..."></div>
            <div style="flex:1;"><label style="font-size:11px; color:#d29922; font-weight:bold;">ID Grupo VIP</label><input type="text" id="tgChatIdVip" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #d29922;" placeholder="-100..."></div>
        </div>

        <div style="display:flex; gap:10px; margin-bottom:10px; border-left: 2px solid #58a6ff; padding-left: 10px;">
            <div style="flex:1;"><label style="font-size:11px; color:#8b949e;">Hora FREE Manhã</label><input type="time" id="tgHoraFreeManha" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d;"></div>
            <div style="flex:1;"><label style="font-size:11px; color:#8b949e;">Hora FREE Tarde</label><input type="time" id="tgHoraFreeTarde" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d;"></div>
        </div>
        
        <div style="display:flex; gap:10px; margin-bottom:10px; border-left: 2px solid #d29922; padding-left: 10px;">
            <div style="flex:1;"><label style="font-size:11px; color:#8b949e;">Hora VIP Tarde</label><input type="time" id="tgHoraVipTarde" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d;"></div>
            <div style="flex:1;"><label style="font-size:11px; color:#8b949e;">Hora VIP Noite</label><input type="time" id="tgHoraVipNoite" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d;"></div>
        </div>

        <div style="display:flex; gap:10px; margin-bottom:10px;">
             <div style="flex:1;"><label style="font-size:11px; color:#8b949e;">Dias de Operação</label><input type="text" id="tgDias" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d;" placeholder="1-5"></div>
             <div style="flex:1;"><label style="font-size:11px; color:#8b949e;">Meta Sinais (Stop)</label><input type="number" id="tgMaxSinais" class="form-control" style="background:#0d1117; color:#58a6ff; border:1px solid #30363d; font-weight:bold; font-size:12px;"></div>
        </div>

        <h4 style="color:#8b949e; margin-bottom:5px; font-size:12px;">⚙️ Stickers de Turno</h4>
        <div style="display:flex; gap:10px; margin-bottom:5px;">
            <div style="flex:1;"><input type="text" id="tgStkStartManha" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d; font-size:10px;" placeholder="Start Manhã"></div>
            <div style="flex:1;"><input type="text" id="tgStkEndManha" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d; font-size:10px;" placeholder="End Manhã"></div>
        </div>
        <div style="display:flex; gap:10px; margin-bottom:5px;">
            <div style="flex:1;"><input type="text" id="tgStkStartTarde" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d; font-size:10px;" placeholder="Start Tarde"></div>
            <div style="flex:1;"><input type="text" id="tgStkEndTarde" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d; font-size:10px;" placeholder="End Tarde"></div>
        </div>
        <div style="display:flex; gap:10px; margin-bottom:10px;">
            <div style="flex:1;"><input type="text" id="tgStkStartNoite" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d; font-size:10px;" placeholder="Start Noite"></div>
            <div style="flex:1;"><input type="text" id="tgStkEndNoite" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d; font-size:10px;" placeholder="End Noite"></div>
        </div>

        <div style="display:flex; gap:10px; margin-bottom:10px;">
            <div style="flex:1;"><label style="font-size:11px; color:#8b949e;">Global: WIN</label><input type="text" id="tgStkWin" class="form-control" style="background:#0d1117; color:#3fb950; border:1px solid #30363d; font-size:11px;"></div>
            <div style="flex:1;"><label style="font-size:11px; color:#8b949e;">Global: LOSS</label><input type="text" id="tgStkLoss" class="form-control" style="background:#0d1117; color:#f85149; border:1px solid #30363d; font-size:11px;"></div>
        </div>

        <div style="margin-bottom:15px;">
            <label style="font-size:11px; color:#8b949e; font-weight:bold;">Template: Sinal Oficial</label>
            <textarea id="tgMsgSinal" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d; height: 100px; font-family: monospace; font-size: 11px; white-space: pre-wrap; margin-top:5px;"></textarea>
        </div>

        <div style="display:flex; justify-content:space-between; gap:10px; margin-bottom:10px;">
            <button id="btnSalvarTg" style="flex:1; background:#2ea043; color:white; border:none; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer; font-size:12px;">💾 Salvar Config</button>
        </div>
        <div style="display:flex; justify-content:space-between; gap:10px; margin-bottom:15px;">
            <button id="btnForcarFree" style="flex:1; background:#58a6ff; color:white; border:none; padding:10px; border-radius:8px; font-weight:bold; cursor:pointer; font-size:12px;">🔥 FORÇAR FREE</button>
            <button id="btnForcarVip" style="flex:1; background:#d29922; color:white; border:none; padding:10px; border-radius:8px; font-weight:bold; cursor:pointer; font-size:12px;">🔥 FORÇAR VIP</button>
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

    const radarStatsPanel = document.createElement('div');
    radarStatsPanel.id = 'radarStatsAdminPanel';
    radarStatsPanel.style.display = 'none';
    radarStatsPanel.innerHTML = `
        <h3 style="color:#58a6ff; text-align:center; margin-top:0;">📊 INTELIGÊNCIA DO RADAR</h3>
        <div style="text-align:center; padding:10px; font-size:18px;">TOTAL DE OPORTUNIDADES: <b id="statTotal" style="color:#3fb950; font-size:24px;">0</b></div>
        <div style="display:flex; flex-direction:column; gap:15px; margin-top:10px;">
            <div style="background:#161b22; padding:15px; border-radius:8px; border:1px solid #30363d; max-height: 220px; overflow-y: auto;">
                <h4 style="color:#8b949e; text-align:center; margin-top:0; margin-bottom: 10px; position: sticky; top: 0; background: #161b22; padding-bottom: 5px;">RANKING POR ATIVO</h4>
                <div id="statAssets" style="font-size:14px; line-height:1.8; padding-right: 5px;">Aguardando dados...</div>
            </div>
            <div style="background:#161b22; padding:15px; border-radius:8px; border:1px solid #30363d; max-height: 180px; overflow-y: auto;">
                <h4 style="color:#8b949e; text-align:center; margin-top:0; margin-bottom: 10px; position: sticky; top: 0; background: #161b22; padding-bottom: 5px;">MAPA POR HORÁRIO</h4>
                <div id="statHours" style="font-size:14px; line-height:1.8; display:flex; flex-wrap:wrap; gap:10px; justify-content:center; padding-right: 5px;">Aguardando dados...</div>
            </div>
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
    });

    document.getElementById('tabRadarStats').addEventListener('click', () => {
        resetTabs(); document.getElementById('radarStatsAdminPanel').style.display = 'block';
        document.getElementById('tabRadarStats').style.background = '#388bfd'; document.getElementById('tabRadarStats').style.color = 'white'; document.getElementById('tabRadarStats').style.border = 'none';
        if (typeof renderStats === 'function' && window.radarGlobalStats) renderStats(window.radarGlobalStats);
    });

    document.getElementById('btnUniversalClose').addEventListener('click', () => { document.getElementById('adminModal').style.display = 'none'; });

    document.getElementById('btnSalvarTg').addEventListener('click', () => {
        const config = {
            rsiOver: document.getElementById('tgRsiOver').value, rsiUnder: document.getElementById('tgRsiUnder').value, bbDev: document.getElementById('tgBbDev').value.replace(',', '.'),
            chatIdFree: document.getElementById('tgChatIdFree').value, chatIdVip: document.getElementById('tgChatIdVip').value,
            horaFreeManha: document.getElementById('tgHoraFreeManha').value, horaFreeTarde: document.getElementById('tgHoraFreeTarde').value,
            horaVipTarde: document.getElementById('tgHoraVipTarde').value, horaVipNoite: document.getElementById('tgHoraVipNoite').value,
            dias: document.getElementById('tgDias').value, maxSinais: document.getElementById('tgMaxSinais').value,
            stkStartManha: document.getElementById('tgStkStartManha').value, stkEndManha: document.getElementById('tgStkEndManha').value,
            stkStartTarde: document.getElementById('tgStkStartTarde').value, stkEndTarde: document.getElementById('tgStkEndTarde').value,
            stkStartNoite: document.getElementById('tgStkStartNoite').value, stkEndNoite: document.getElementById('tgStkEndNoite').value,
            stkWin: document.getElementById('tgStkWin').value, stkLoss: document.getElementById('tgStkLoss').value,
            msgSinal: document.getElementById('tgMsgSinal').value
        };
        auth.currentUser.getIdToken().then(token => socket.emit('admin_save_tg_config', { token, config }));
    });

    document.getElementById('btnForcarFree').addEventListener('click', () => { auth.currentUser.getIdToken().then(token => socket.emit('admin_force_tg', { token, sala: 'FREE' })); });
    document.getElementById('btnForcarVip').addEventListener('click', () => { auth.currentUser.getIdToken().then(token => socket.emit('admin_force_tg', { token, sala: 'VIP' })); });
}