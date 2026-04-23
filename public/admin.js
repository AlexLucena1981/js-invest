// ⚙️ ADMIN PANEL CONTROLLER

function setupTelegramAdminUI(auth, socket) {
    const adminPanelContent = document.getElementById('adminPanelContent');
    if (!adminPanelContent) return;
    
    // Evita duplicar o painel caso o admin clique várias vezes
    if (adminPanelContent.getAttribute('data-loaded') === 'true') return; 

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
                    <tbody id="usersListBody"><tr><td colspan="4" style="text-align:center; padding: 20px; color:#8b949e;">Carregando...</td></tr></tbody>
                </table>
            </div>
        </div>

        <div id="adminTabPix" style="display: none;">
            <div style="max-height: 400px; overflow-y: auto; background: #0d1117; border-radius: 8px; border: 1px solid #30363d;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 11px;">
                    <thead style="position: sticky; top: 0; background: #161b22; z-index: 1;">
                        <tr><th style="padding:10px; border-bottom:1px solid #30363d; color:#8b949e;">Data/Hora</th><th style="padding:10px; border-bottom:1px solid #30363d; color:#8b949e;">Cliente</th><th style="padding:10px; border-bottom:1px solid #30363d; color:#8b949e;">Valor</th><th style="padding:10px; border-bottom:1px solid #30363d; color:#8b949e;">Plano</th><th style="padding:10px; border-bottom:1px solid #30363d; color:#8b949e;">Status</th></tr>
                    </thead>
                    <tbody id="paymentsListBody"><tr><td colspan="5" style="text-align:center; padding: 20px; color:#8b949e;">Carregando...</td></tr></tbody>
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
            <div style="display:flex; gap:10px; margin-bottom:10px; background:#161b22; padding:10px; border-radius:8px; border:1px solid #30363d;">
                <div style="flex:1;"><label style="font-size:10px; color:#8b949e;">RSI Sobrecompra</label><input type="number" id="tgRsiOver" class="form-control" style="background:#0d1117; color:#f85149; border:1px solid #30363d; font-weight:bold; font-size:12px;"></div>
                <div style="flex:1;"><label style="font-size:10px; color:#8b949e;">RSI Sobrevenda</label><input type="number" id="tgRsiUnder" class="form-control" style="background:#0d1117; color:#3fb950; border:1px solid #30363d; font-weight:bold; font-size:12px;"></div>
                <div style="flex:1;"><label style="font-size:10px; color:#8b949e;">Bollinger (Desvio)</label><input type="text" id="tgBbDev" class="form-control" style="background:#0d1117; color:#58a6ff; border:1px solid #30363d; font-weight:bold; font-size:12px;"></div>
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
        </div>

        <div id="adminTabRadar" style="display: none;">
            <div style="text-align:center; padding:10px; font-size:18px;">TOTAL OPORTUNIDADES: <b id="statTotal" style="color:#3fb950; font-size:24px;">0</b></div>
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
        </div>

        <div id="adminTabReport" style="display: none;">
            <h3 style="color:#58a6ff; text-align:center; margin-top:0;">📊 PERFORMANCE DO BANCO</h3>
            <div style="background:#161b22; padding:15px; border-radius:8px; border:1px solid #30363d; text-align:center;">
                <p style="color:#8b949e; margin:0;">Módulo de Auditoria Ativo.</p>
                <p style="font-size:11px; color:#3fb950;">Os sinais estão sendo gravados no Firebase.</p>
            </div>
            <div id="rankingListContainer" style="margin-top:15px; max-height:45vh; overflow-y:auto; padding-right:5px;">
                <div style="text-align:center; padding:20px; color:#8b949e;">Aguardando dados...</div>
            </div>
        </div>

        <div id="adminTabStrategies" style="display: none;">
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
        </div>

        <div class="modal-buttons" style="justify-content: center; margin-top: 20px;">
            <button class="btn btn-cancel" style="width: 100%; font-weight: bold;" id="btnCancelAdmin">FECHAR PAINEL</button>
        </div>
    `;

    adminPanelContent.setAttribute('data-loaded', 'true');

    // Fechar Modal
    document.getElementById('btnCancelAdmin').addEventListener('click', () => { document.getElementById('adminModal').style.display = 'none'; });

    // Botões Tab 1 (Usuários)
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

    // Botões Tab 3 (Preços)
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

    // Botões Tab 4 (Robô)
    if(document.getElementById('btnSalvarTg')) {
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
    }

    if(document.getElementById('btnForcarFree')) { document.getElementById('btnForcarFree').addEventListener('click', () => { auth.currentUser.getIdToken().then(token => socket.emit('admin_force_tg', { token, sala: 'FREE' })); }); }
    if(document.getElementById('btnForcarVip')) { document.getElementById('btnForcarVip').addEventListener('click', () => { auth.currentUser.getIdToken().then(token => socket.emit('admin_force_tg', { token, sala: 'VIP' })); }); }

    // Botão Tab 7 (Strategies)
    if(document.getElementById('btnSaveNewStrat')) {
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
    }
}