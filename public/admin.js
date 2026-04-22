// ⚙️ ADMIN PANEL CONTROLLER

function setupTelegramAdminUI(auth, socket) {
    const adminPanelContent = document.getElementById('adminPanelContent');
    if (!adminPanelContent || document.getElementById('tgAdminPanel')) return;

    adminPanelContent.innerHTML = `
        <h2 style="color: #58a6ff; font-family: 'Orbitron'; text-align: center; margin-bottom: 20px; margin-top:0;">🛡️ PAINEL DE COMANDO</h2>
        
        <div style="display: flex; gap: 5px; border-bottom: 1px solid #30363d; margin-bottom: 15px; overflow-x: auto; padding-bottom: 5px;">
            <button id="btnTabUsers" onclick="switchAdminTab('users')" style="flex: 1; background: transparent; color: #58a6ff; border: none; border-bottom: 2px solid #58a6ff; padding: 10px; cursor: pointer; font-weight: bold; font-size: 11px; transition: all 0.2s; white-space: nowrap;">👥 ALUNOS</button>
            <button id="btnTabPix" onclick="switchAdminTab('pix')" style="flex: 1; background: transparent; color: #8b949e; border: none; border-bottom: 2px solid transparent; padding: 10px; cursor: pointer; font-weight: bold; font-size: 11px; transition: all 0.2s; white-space: nowrap;">💸 PIX</button>
            <button id="btnTabPricing" onclick="switchAdminTab('pricing')" style="flex: 1; background: transparent; color: #8b949e; border: none; border-bottom: 2px solid transparent; padding: 10px; cursor: pointer; font-weight: bold; font-size: 11px; transition: all 0.2s; white-space: nowrap;">💰 PREÇOS</button>
            <button id="btnTabTelegram" onclick="switchAdminTab('telegram')" style="flex: 1; background: transparent; color: #8b949e; border: none; border-bottom: 2px solid transparent; padding: 10px; cursor: pointer; font-weight: bold; font-size: 11px; transition: all 0.2s; white-space: nowrap;">🤖 ROBÔ TG</button>
            <button id="btnTabRadar" onclick="switchAdminTab('radar')" style="flex: 1; background: transparent; color: #8b949e; border: none; border-bottom: 2px solid transparent; padding: 10px; cursor: pointer; font-weight: bold; font-size: 11px; transition: all 0.2s; white-space: nowrap;">📡 RADAR</button>
            <button id="btnTabReport" onclick="switchAdminTab('report')" style="flex: 1; background: transparent; color: #8b949e; border: none; border-bottom: 2px solid transparent; padding: 10px; cursor: pointer; font-weight: bold; font-size: 11px; transition: all 0.2s; white-space: nowrap;">📊 HISTÓRICO</button>
            <button id="btnTabStrategies" onclick="switchAdminTab('strategies')" style="flex: 1; background: transparent; color: #8b949e; border: none; border-bottom: 2px solid transparent; padding: 10px; cursor: pointer; font-weight: bold; font-size: 11px; transition: all 0.2s; white-space: nowrap;">📈 STRATS</button>
        </div>

        <div id="adminTabUsers" style="display: block;">
            <div style="text-align: left; margin-bottom: 15px; background: #0d1117; padding: 15px; border-radius: 8px; border: 1px solid #30363d;">
                <p style="color: #8b949e; font-size: 12px; margin-bottom: 10px; font-weight: bold;">➕ Cadastrar Novo Assinante Manual:</p>
                <div style="display: flex; gap: 10px;">
                    <input type="text" id="newUserEmail" placeholder="Login da Corretora" style="margin-bottom: 0; flex: 2;" />
                    <input type="password" id="newUserPassword" placeholder="Senha App" style="margin-bottom: 0; flex: 1;" />
                </div>
                <div style="display: flex; gap: 10px; margin-top: 10px;">
                    <select id="newUserRole" style="margin-bottom: 0; flex: 2;">
                        <option value="aluno">Acesso: ALUNO</option>
                        <option value="admin">Acesso: ADMIN (Vitalício)</option>
                    </select>
                    <button class="btn btn-save" style="flex: 1;" id="btnCreateUser">Cadastrar</button>
                </div>
            </div>

            <div style="text-align: left; background: #0d1117; padding: 15px; border-radius: 8px; border: 1px solid #30363d; margin-bottom: 15px;">
                <p style="color: #8b949e; font-size: 12px; margin-bottom: 10px; font-weight: bold;">🍪 Injetar Sessão VIP (Radar OTC):</p>
                <div style="display: flex; gap: 10px;">
                    <input type="text" id="adminCookieInput" placeholder="Cole o Cookie aqui..." style="margin-bottom: 0; font-size: 11px; flex: 3;" />
                    <button class="btn btn-save" style="flex: 1;" id="btnInjectCookie">Injetar</button>
                </div>
            </div>

            <div style="max-height: 200px; overflow-y: auto; background: #0d1117; border-radius: 8px; border: 1px solid #30363d;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 11px;">
                    <thead style="position: sticky; top: 0; background: #161b22; z-index: 1;">
                        <tr><th style="padding:10px; border-bottom:1px solid #30363d; color:#8b949e;">ID / CPF</th><th style="padding:10px; border-bottom:1px solid #30363d; color:#8b949e;">Nome</th><th style="padding:10px; border-bottom:1px solid #30363d; color:#8b949e;">E-mail</th><th style="padding:10px; border-bottom:1px solid #30363d; color:#8b949e;">Status</th></tr>
                    </thead>
                    <tbody id="usersListBody"><tr><td colspan=\"4\" style=\"text-align:center; padding: 20px; color:#8b949e;\">Carregando...</td></tr></tbody>
                </table>
            </div>
        </div>

        <div id="adminTabPix" style="display: none;">
            <div style="max-height: 400px; overflow-y: auto; background: #0d1117; border-radius: 8px; border: 1px solid #30363d;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 11px;">
                    <thead style="position: sticky; top: 0; background: #161b22; z-index: 1;">
                        <tr><th style="padding:10px; border-bottom:1px solid #30363d; color:#8b949e;">Data/Hora</th><th style="padding:10px; border-bottom:1px solid #30363d; color:#8b949e;">Cliente</th><th style="padding:10px; border-bottom:1px solid #30363d; color:#8b949e;">Valor</th><th style="padding:10px; border-bottom:1px solid #30363d; color:#8b949e;">Plano</th><th style="padding:10px; border-bottom:1px solid #30363d; color:#8b949e;">Status</th></tr>
                    </thead>
                    <tbody id="paymentsListBody"><tr><td colspan=\"5\" style=\"text-align:center; padding: 20px; color:#8b949e;\">Carregando...</td></tr></tbody>
                </table>
            </div>
        </div>

        <div id="adminTabPricing" style="display: none;">
            <div style="text-align: left; background: #0d1117; padding: 20px; border-radius: 8px; border: 1px solid #30363d;">
                <p style="color: #8b949e; font-size: 13px; margin-bottom: 15px;">Configure os valores das assinaturas (em Reais):</p>
                <div style="display: flex; gap: 15px; margin-bottom: 15px;">
                    <div style="flex: 1;"><label style="color:#c9d1d9; font-size:11px; display:block; margin-bottom:5px;">Plano 1 Mês (R$)</label><input type="number" id="price1" step="0.01" style="width: 100%; box-sizing:border-box;" /></div>
                    <div style="flex: 1;"><label style="color:#c9d1d9; font-size:11px; display:block; margin-bottom:5px;">Plano 3 Meses (R$)</label><input type="number" id="price3" step="0.01" style="width: 100%; box-sizing:border-box;" /></div>
                </div>
                <div style="display: flex; gap: 15px; margin-bottom: 20px;">
                    <div style="flex: 1;"><label style="color:#c9d1d9; font-size:11px; display:block; margin-bottom:5px;">Plano 6 Meses (R$)</label><input type="number" id="price6" step="0.01" style="width: 100%; box-sizing:border-box;" /></div>
                    <div style="flex: 1;"><label style="color:#c9d1d9; font-size:11px; display:block; margin-bottom:5px;">Plano 1 Ano (R$)</label><input type="number" id="price12" step="0.01" style="width: 100%; box-sizing:border-box;" /></div>
                </div>
                <button class="btn btn-save" style="width: 100%; padding: 12px; font-weight: bold;" id="btnSavePricing">Atualizar Preços no Sistema</button>
            </div>
        </div>

        <div id="adminTabTelegram" style="display: none;">
            <div id="tgAdminPanel">
                <div style="display:flex; gap:10px; margin-bottom:10px; background:#161b22; padding:10px; border-radius:8px; border:1px solid #30363d;">
                    <div style="flex:1;"><label style="font-size:10px; color:#8b949e;">RSI Sobrecompra</label><input type="number" id="tgRsiOver" class="form-control" style="background:#0d1117; color:#f85149; border:1px solid #30363d; font-weight:bold; font-size:12px;"></div>
                    <div style="flex:1;"><label style="font-size:10px; color:#8b949e;">RSI Sobrevenda</label><input type="number" id="tgRsiUnder" class="form-control" style="background:#0d1117; color:#3fb950; border:1px solid #30363d; font-weight:bold; font-size:12px;"></div>
                    <div style="flex:1;"><label style="font-size:10px; color:#8b949e;">Bollinger (Desvio)</label><input type="text" id="tgBbDev" class="form-control" style="background:#0d1117; color:#58a6ff; border:1px solid #30363d; font-weight:bold; font-size:12px;"></div>
                </div>
                
                <div style="display:flex; gap:10px; margin-bottom:10px;">
                    <div style="flex:1;"><label style="font-size:10px; color:#8b949e;">Hora Manhã</label><input type="time" id="tgHoraManha" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d; font-size:11px;"></div>
                    <div style="flex:1;"><label style="font-size:10px; color:#8b949e;">Hora Tarde</label><input type="time" id="tgHoraTarde" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d; font-size:11px;"></div>
                    <div style="flex:1;"><label style="font-size:10px; color:#8b949e;">Dias (0=Dom)</label><input type="text" id="tgDias" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d; font-size:11px;" placeholder="1-5"></div>
                    <div style="flex:1;"><label style="font-size:10px; color:#8b949e;">Meta (Stop)</label><input type="number" id="tgMaxSinais" class="form-control" style="background:#0d1117; color:#58a6ff; border:1px solid #30363d; font-weight:bold; font-size:11px;"></div>
                </div>
                
                <div style="display:flex; gap:10px; margin-bottom:10px;">
                    <div style="flex:1;"><label style="font-size:10px; color:#8b949e;">Sticker Manhã: INÍCIO</label><input type="text" id="tgStkStartManha" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d; font-size:10px;"></div>
                    <div style="flex:1;"><label style="font-size:10px; color:#8b949e;">Sticker Manhã: FIM</label><input type="text" id="tgStkEndManha" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d; font-size:10px;"></div>
                </div>
                <div style="display:flex; gap:10px; margin-bottom:10px;">
                    <div style="flex:1;"><label style="font-size:10px; color:#8b949e;">Sticker Tarde: INÍCIO</label><input type="text" id="tgStkStartTarde" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d; font-size:10px;"></div>
                    <div style="flex:1;"><label style="font-size:10px; color:#8b949e;">Sticker Tarde: FIM</label><input type="text" id="tgStkEndTarde" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d; font-size:10px;"></div>
                </div>
                
                <div style="display:flex; gap:10px; margin-bottom:10px;">
                    <div style="flex:1;"><label style="font-size:10px; color:#8b949e;">Sticker Global: WIN</label><input type="text" id="tgStkWin" class="form-control" style="background:#0d1117; color:#3fb950; border:1px solid #30363d; font-size:10px;"></div>
                    <div style="flex:1;"><label style="font-size:10px; color:#8b949e;">Sticker Global: LOSS</label><input type="text" id="tgStkLoss" class="form-control" style="background:#0d1117; color:#f85149; border:1px solid #30363d; font-size:10px;"></div>
                </div>

                <div style="margin-bottom:10px;">
                    <label style="font-size:11px; color:#8b949e; font-weight:bold;">Template da Mensagem do Sinal:</label>
                    <textarea id="tgMsgSinal" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d; height: 100px; font-family: monospace; font-size: 11px; white-space: pre-wrap; margin-top:5px;"></textarea>
                </div>
                
                <div style="display:flex; justify-content:space-between; gap:10px; margin-top:15px;">
                    <button id="btnSalvarTg" style="flex:1; background:#2ea043; color:white; border:none; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer;">💾 Salvar Robô</button>
                    <button id="btnForcarTgManha" style="flex:1; background:#da3633; color:white; border:none; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer;">🔥 Forçar Sessão</button>
                </div>
            </div>
        </div>

        <div id="adminTabRadar" style="display: none;">
            <div id="radarStatsAdminPanel">
                <div style="text-align:center; padding:10px; font-size:14px; margin-bottom:10px;">TOTAL OPORTUNIDADES (HOJE): <b id="statTotal" style="color:#3fb950; font-size:18px;">0</b></div>
                <div style="display:flex; flex-direction:column; gap:10px;">
                    <div style="background:#161b22; padding:10px; border-radius:8px; border:1px solid #30363d; max-height: 150px; overflow-y: auto;">
                        <h4 style="color:#8b949e; text-align:center; margin-top:0; margin-bottom: 5px; position: sticky; top: 0; background: #161b22; padding-bottom: 5px; font-size:11px;">RANKING POR ATIVO</h4>
                        <div id="statAssets" style="font-size:11px; line-height:1.8; padding-right: 5px;">Aguardando Radar...</div>
                    </div>
                    <div style="background:#161b22; padding:10px; border-radius:8px; border:1px solid #30363d; max-height: 120px; overflow-y: auto;">
                        <h4 style="color:#8b949e; text-align:center; margin-top:0; margin-bottom: 5px; position: sticky; top: 0; background: #161b22; padding-bottom: 5px; font-size:11px;">MAPA POR HORÁRIO</h4>
                        <div id="statHours" style="font-size:11px; line-height:1.8; display:flex; flex-wrap:wrap; gap:5px; justify-content:center; padding-right: 5px;">Aguardando Radar...</div>
                    </div>
                </div>
            </div>
        </div>

        <div id="adminTabReport" style="display: none;">
            <div style="background:#161b22; padding:15px; border-radius:8px; border:1px solid #30363d; text-align:center;">
                <p style="color:#8b949e; margin:0; font-size:12px;">Módulo de Auditoria e Histórico.</p>
                <p style="font-size:11px; color:#3fb950;">Sinais sendo gravados no Firebase na sessão de hoje.</p>
            </div>
            <div id="rankingListContainer" style="margin-top:15px; max-height:250px; overflow-y:auto; padding-right:5px;"></div>
        </div>

        <div id="adminTabStrategies" style="display: none;">
            <div style="background:#161b22; padding:15px; border-radius:8px; border:1px solid #30363d; margin-bottom:15px;">
                <label style="font-size:11px; color:#8b949e;">Inserir Nova Estratégia (Editor JSON)</label>
                <textarea id="newStratJson" class="form-control" style="background:#0d1117; color:#c9d1d9; border:1px solid #30363d; height: 120px; font-family: monospace; font-size: 11px; margin-top:5px; margin-bottom:10px;"></textarea>
                <button id="btnSaveNewStrat" style="background:#2ea043; color:white; border:none; padding:10px; border-radius:6px; font-weight:bold; cursor:pointer; width:100%;">💾 Adicionar à Base</button>
            </div>
            <div style="background:#161b22; padding:15px; border-radius:8px; border:1px solid #30363d;">
                <h4 style="color:#8b949e; text-align:center; margin-top:0; font-size:12px;">ESTRATÉGIAS ATIVAS NO MOTOR</h4>
                <div id="adminStratList" style="max-height: 150px; overflow-y: auto; padding-right:5px;"></div>
            </div>
        </div>

        <div class="modal-buttons" style="justify-content: center; margin-top: 20px;">
            <button class="btn btn-cancel" style="width: 100%; font-weight: bold;" id="btnCancelAdmin">FECHAR PAINEL</button>
        </div>
    `;

    document.getElementById('btnCancelAdmin').addEventListener('click', () => { document.getElementById('adminModal').style.display = 'none'; });

    if(document.getElementById('btnCreateUser')) { 
        document.getElementById('btnCreateUser').addEventListener('click', () => { 
            const newEmail = document.getElementById('newUserEmail').value; 
            const newPassword = document.getElementById('newUserPassword').value; 
            const newRole = document.getElementById('newUserRole').value; 
            document.getElementById('btnCreateUser').innerText = '...'; 
            auth.currentUser.getIdToken().then(token => socket.emit('admin_create_user', { token, newEmail, newPassword, newRole })); 
        }); 
    }

    if(document.getElementById('btnInjectCookie')) { 
        document.getElementById('btnInjectCookie').addEventListener('click', () => { 
            const cookieVal = document.getElementById('adminCookieInput').value; 
            if(cookieVal.length > 20) { 
                socket.emit('inject_cookie', cookieVal); 
                document.getElementById('adminCookieInput').value = ''; 
                document.getElementById('btnInjectCookie').innerText = 'Injetado! ✅'; 
                setTimeout(() => { document.getElementById('btnInjectCookie').innerText = 'Injetar'; }, 3000); 
            } else { alert('❌ Cookie inválido!'); } 
        }); 
    }

    if(document.getElementById('btnSavePricing')) {
        document.getElementById('btnSavePricing').onclick = () => {
            const pricing = {
                month1: parseFloat(document.getElementById('price1').value),
                month3: parseFloat(document.getElementById('price3').value),
                month6: parseFloat(document.getElementById('price6').value),
                month12: parseFloat(document.getElementById('price12').value)
            };
            auth.currentUser.getIdToken().then(token => socket.emit('admin_save_pricing', { token, pricing }));
        };
    }

    if(document.getElementById('btnSalvarTg')) {
        document.getElementById('btnSalvarTg').addEventListener('click', () => {
            const config = {
                rsiOver: document.getElementById('tgRsiOver').value, 
                rsiUnder: document.getElementById('tgRsiUnder').value, 
                bbDev: document.getElementById('tgBbDev').value.replace(',', '.'),
                horaManha: document.getElementById('tgHoraManha').value, 
                horaTarde: document.getElementById('tgHoraTarde').value, 
                dias: document.getElementById('tgDias').value,
                maxSinais: document.getElementById('tgMaxSinais').value,
                stkStartManha: document.getElementById('tgStkStartManha').value, 
                stkEndManha: document.getElementById('tgStkEndManha').value, 
                stkStartTarde: document.getElementById('tgStkStartTarde').value, 
                stkEndTarde: document.getElementById('tgStkEndTarde').value, 
                stkWin: document.getElementById('tgStkWin').value, 
                stkLoss: document.getElementById('tgStkLoss').value,
                msgSinal: document.getElementById('tgMsgSinal').value
            };
            auth.currentUser.getIdToken().then(token => socket.emit('admin_save_tg_config', { token, config }));
        });
    }

    if(document.getElementById('btnForcarTgManha')) {
        document.getElementById('btnForcarTgManha').addEventListener('click', () => { auth.currentUser.getIdToken().then(token => socket.emit('admin_force_tg', { token, turno: 'Forçada Manualmente' })); });
    }

    if(document.getElementById('btnSaveNewStrat')) {
        document.getElementById('btnSaveNewStrat').addEventListener('click', () => {
            try {
                const newStrategyJSON = JSON.parse(document.getElementById('newStratJson').value);
                document.getElementById('btnSaveNewStrat').innerText = 'Gravando...';
                socket.emit('add_new_strategy', newStrategyJSON); 
                setTimeout(() => { 
                    document.getElementById('btnSaveNewStrat').innerText = '💾 Adicionar à Base';
                    auth.currentUser.getIdToken().then(token => socket.emit('admin_get_strategies', token));
                }, 1000);
            } catch (error) {
                alert("❌ Erro: Formato JSON inválido!");
                document.getElementById('btnSaveNewStrat').innerText = '💾 Adicionar à Base';
            }
        });
    }
}