// ⚙️ ADMIN PANEL CONTROLLER (Somente Lógica)

function setupTelegramAdminUI(auth, socket) {
    
    // 🎯 BOTÃO FECHAR
    const btnClose = document.getElementById('btnCancelAdmin');
    if (btnClose) {
        const newBtnClose = btnClose.cloneNode(true);
        btnClose.parentNode.replaceChild(newBtnClose, btnClose);
        newBtnClose.addEventListener('click', () => { document.getElementById('adminModal').style.display = 'none'; });
    }

    // 🎯 ABA USUÁRIOS
    const btnCreateUser = document.getElementById('btnCreateUser');
    if (btnCreateUser) {
        const newBtnCreate = btnCreateUser.cloneNode(true);
        btnCreateUser.parentNode.replaceChild(newBtnCreate, btnCreateUser);
        newBtnCreate.addEventListener('click', () => { 
            const newEmail = document.getElementById('newUserEmail').value; 
            const newPassword = document.getElementById('newUserPassword').value; 
            const newRole = document.getElementById('newUserRole').value; 
            newBtnCreate.innerText = '...'; 
            auth.currentUser.getIdToken().then(token => socket.emit('admin_create_user', { token, newEmail, newPassword, newRole })); 
        }); 
    }

    const btnInjectCookie = document.getElementById('btnInjectCookie');
    if (btnInjectCookie) {
        const newBtnInject = btnInjectCookie.cloneNode(true);
        btnInjectCookie.parentNode.replaceChild(newBtnInject, btnInjectCookie);
        newBtnInject.addEventListener('click', () => { 
            const cookieVal = document.getElementById('adminCookieInput').value; 
            if(cookieVal.length > 20) { 
                socket.emit('inject_cookie', cookieVal); 
                document.getElementById('adminCookieInput').value = ''; 
                newBtnInject.innerText = 'Injetado! ✅'; 
                setTimeout(() => { newBtnInject.innerText = 'Injetar'; }, 3000); 
            } else { alert('❌ Cookie inválido!'); } 
        }); 
    }

    // 🎯 ABA PREÇOS
    const btnSavePricing = document.getElementById('btnSavePricing');
    if (btnSavePricing) {
        const newBtnPricing = btnSavePricing.cloneNode(true);
        btnSavePricing.parentNode.replaceChild(newBtnPricing, btnSavePricing);
        newBtnPricing.addEventListener('click', () => {
            const pricing = {
                month1: parseFloat(document.getElementById('price1').value),
                month3: parseFloat(document.getElementById('price3').value),
                month6: parseFloat(document.getElementById('price6').value),
                month12: parseFloat(document.getElementById('price12').value)
            };
            auth.currentUser.getIdToken().then(token => socket.emit('admin_save_pricing', { token, pricing }));
        });
    }

    // 🎯 ABA TELEGRAM (ROBÔ)
    const btnSalvarTg = document.getElementById('btnSalvarTg');
    if (btnSalvarTg) {
        const newBtnSalvarTg = btnSalvarTg.cloneNode(true);
        btnSalvarTg.parentNode.replaceChild(newBtnSalvarTg, btnSalvarTg);
        newBtnSalvarTg.addEventListener('click', () => {
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

    const btnForcarFree = document.getElementById('btnForcarFree');
    if (btnForcarFree) {
        const newBtnFree = btnForcarFree.cloneNode(true);
        btnForcarFree.parentNode.replaceChild(newBtnFree, btnForcarFree);
        newBtnFree.addEventListener('click', () => { auth.currentUser.getIdToken().then(token => socket.emit('admin_force_tg', { token, sala: 'FREE' })); });
    }

    const btnForcarVip = document.getElementById('btnForcarVip');
    if (btnForcarVip) {
        const newBtnVip = btnForcarVip.cloneNode(true);
        btnForcarVip.parentNode.replaceChild(newBtnVip, btnForcarVip);
        newBtnVip.addEventListener('click', () => { auth.currentUser.getIdToken().then(token => socket.emit('admin_force_tg', { token, sala: 'VIP' })); });
    }

    // 🎯 ABA ESTRATÉGIAS
    const btnSaveNewStrat = document.getElementById('btnSaveNewStrat');
    if (btnSaveNewStrat) {
        const newBtnStrat = btnSaveNewStrat.cloneNode(true);
        btnSaveNewStrat.parentNode.replaceChild(newBtnStrat, btnSaveNewStrat);
        newBtnStrat.addEventListener('click', () => {
            try {
                const newStrategyJSON = JSON.parse(document.getElementById('newStratJson').value);
                newBtnStrat.innerText = 'Gravando...';
                socket.emit('add_new_strategy', newStrategyJSON); 
                setTimeout(() => { 
                    newBtnStrat.innerText = '💾 Adicionar Estratégia';
                    auth.currentUser.getIdToken().then(token => socket.emit('admin_get_strategies', token));
                }, 1000);
            } catch (error) {
                alert("❌ Erro: Formato JSON inválido!");
                newBtnStrat.innerText = '💾 Adicionar Estratégia';
            }
        });
    }
}