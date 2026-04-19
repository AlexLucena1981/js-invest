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
        <div style="margin-bottom:10px;"><label style="font-size:12px; color:#8b949e;">Template: Pré-Alerta</label><textarea id="tgMsgPre" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d; height: 60px; font-family: monospace; font-size: 11px;"></textarea></div>
        <div style="margin-bottom:15px;"><label style="font-size:12px; color:#8b949e;">Template: Sinal Oficial</label><textarea id="tgMsgSinal" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d; height: 100px; font-family: monospace; font-size: 11px;"></textarea></div>
        <div style="display:flex; gap:10px; margin-bottom:10px;">
            <div style="flex:1;"><label style="font-size:12px; color:#8b949e;">Msg: Despertar</label><input type="text" id="tgMsgDespertar" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d; font-size:11px;"></div>
            <div style="flex:1;"><label style="font-size:12px; color:#8b949e;">Msg: Win</label><input type="text" id="tgMsgWin" class="form-control" style="background:#0d1117; color:#3fb950; border:1px solid #30363d; font-size:11px;"></div>
        </div>
        <div style="margin-bottom:20px;"><label style="font-size:12px; color:#8b949e;">Msg: Loss Final</label><input type="text" id="tgMsgLoss" class="form-control" style="background:#0d1117; color:#f85149; border:1px solid #30363d; font-size:11px;"></div>
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

    adminModalContent.appendChild(tabNav);
    adminModalContent.appendChild(systemPanel);
    adminModalContent.appendChild(tgPanel);
    adminModalContent.appendChild(reportPanel);

    const closeContainer = document.createElement('div');
    closeContainer.style.textAlign = 'center'; closeContainer.style.marginTop = '20px'; closeContainer.style.paddingTop = '15px'; closeContainer.style.borderTop = '1px solid #30363d';
    closeContainer.innerHTML = `<button id="btnUniversalClose" style="background:#21262d; color:#c9d1d9; border:1px solid #30363d; padding:10px 30px; border-radius:8px; font-weight:bold; cursor:pointer; width:100%; transition:0.2s;">FECHAR PAINEL ADMIN</button>`;
    adminModalContent.appendChild(closeContainer);

    document.getElementById('tabSystem').addEventListener('click', () => {
        document.getElementById('systemAdminPanel').style.display = 'block'; document.getElementById('tgAdminPanel').style.display = 'none'; document.getElementById('reportAdminPanel').style.display = 'none';
        document.getElementById('tabSystem').style.background = '#1f6feb'; document.getElementById('tabSystem').style.color = 'white'; document.getElementById('tabSystem').style.border = 'none';
        document.getElementById('tabTelegram').style.background = '#21262d'; document.getElementById('tabTelegram').style.color = '#8b949e'; document.getElementById('tabTelegram').style.border = '1px solid #30363d';
        document.getElementById('tabReport').style.background = '#21262d'; document.getElementById('tabReport').style.color = '#8b949e'; document.getElementById('tabReport').style.border = '1px solid #30363d';
    });

    document.getElementById('tabTelegram').addEventListener('click', () => {
        document.getElementById('systemAdminPanel').style.display = 'none'; document.getElementById('tgAdminPanel').style.display = 'block'; document.getElementById('reportAdminPanel').style.display = 'none';
        document.getElementById('tabTelegram').style.background = '#2ea043'; document.getElementById('tabTelegram').style.color = 'white'; document.getElementById('tabTelegram').style.border = 'none';
        document.getElementById('tabSystem').style.background = '#21262d'; document.getElementById('tabSystem').style.color = '#8b949e'; document.getElementById('tabSystem').style.border = '1px solid #30363d';
        document.getElementById('tabReport').style.background = '#21262d'; document.getElementById('tabReport').style.color = '#8b949e'; document.getElementById('tabReport').style.border = '1px solid #30363d';
    });

    document.getElementById('tabReport').addEventListener('click', () => {
        document.getElementById('systemAdminPanel').style.display = 'none'; document.getElementById('tgAdminPanel').style.display = 'none'; document.getElementById('reportAdminPanel').style.display = 'block';
        document.getElementById('tabReport').style.background = '#8957e5'; document.getElementById('tabReport').style.color = 'white'; document.getElementById('tabReport').style.border = 'none';
        document.getElementById('tabSystem').style.background = '#21262d'; document.getElementById('tabSystem').style.color = '#8b949e'; document.getElementById('tabSystem').style.border = '1px solid #30363d';
        document.getElementById('tabTelegram').style.background = '#21262d'; document.getElementById('tabTelegram').style.color = '#8b949e'; document.getElementById('tabTelegram').style.border = '1px solid #30363d';
        auth.currentUser.getIdToken().then(token => socket.emit('admin_get_report', token));
    });

    document.getElementById('btnUniversalClose').addEventListener('click', () => { document.getElementById('adminModal').style.display = 'none'; });

    document.getElementById('btnSalvarTg').addEventListener('click', () => {
        const config = {
            rsiOver: document.getElementById('tgRsiOver').value, rsiUnder: document.getElementById('tgRsiUnder').value, bbDev: document.getElementById('tgBbDev').value.replace(',', '.'),
            horaManha: document.getElementById('tgHoraManha').value, horaTarde: document.getElementById('tgHoraTarde').value, dias: document.getElementById('tgDias').value,
            msgPre: document.getElementById('tgMsgPre').value, msgSinal: document.getElementById('tgMsgSinal').value, msgDespertar: document.getElementById('tgMsgDespertar').value, msgWin: document.getElementById('tgMsgWin').value, msgLoss: document.getElementById('tgMsgLoss').value
        };
        auth.currentUser.getIdToken().then(token => socket.emit('admin_save_tg_config', { token, config }));
    });

    document.getElementById('btnForcarTgManha').addEventListener('click', () => { auth.currentUser.getIdToken().then(token => socket.emit('admin_force_tg', { token, turno: 'Forçada Manualmente' })); });
}