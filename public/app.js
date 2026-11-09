/* ============================================
   LOCAL CHESS ARENA — Phase 11 Frontend
   ============================================ */

(function () {
  'use strict';

  const STORAGE_KEY = 'lca_user';
  const pieceUnicode = { 'wp': '♙', 'wn': '♘', 'wb': '♗', 'wr': '♖', 'wq': '♕', 'wk': '♔', 'bp': '♟', 'bn': '♞', 'bb': '♝', 'br': '♜', 'bq': '♛', 'bk': '♚' };

  let socket = null;
  let currentUser = null;
  let reconnectTimer = null;
  let currentRoom = null, selectedSquare = null, isProcessingMove = false;
  let timerInterval = null, gameStartTime = null;
  let pendingRoomId = null;
  let lastTappedUser = null;
  let lastTapTime = 0;
  let pendingLoginUsername = null;
  let masterKeyTargetUser = null;
  let unreadCount = 0;

  // SAFE ELEMENT GETTER
  function $(id) { return document.getElementById(id); }
  function safeBind(id, event, callback) { const el = $(id); if (el) el.addEventListener(event, callback); }

  // Elements
  const userSelectionList = $('userSelectionList');
  const loginPasswordArea = $('loginPasswordArea');
  const loginPasswordInput = $('loginPasswordInput');
  const profileChip = $('profileChip');
  const profileDropdown = $('profileDropdown');
  const userNameEl = $('userName');
  const userInitialEl = $('userInitial');
  const dropdownUserList = $('dropdownUserList');
  const connStatus = $('connStatus');
  const connText = $('connText');
  const roomsGrid = $('roomsGrid');
  const viewLobbyList = $('view-lobby-list');
  const viewRoom = $('view-room');
  const roomTitle = $('roomTitle');
  const whiteNameEl = $('whiteName');
  const blackNameEl = $('blackName');
  const specListEl = $('specList');
  const specCountEl = $('specCount');
  const boardEl = $('chessBoard');
  const gameStatusEl = $('gameStatus');
  const gameTimerEl = $('gameTimer');
  const historyListEl = $('historyList');
  const gameActions = $('gameActions');
  const chatDrawer = $('chatDrawer');
  const chatMessages = $('chatMessages');
  const chatInput = $('chatInput');
  const chatBadge = $('chatBadge');
  const toastContainer = $('toastContainer');
  
  const addUserModal = $('addUserModal');
  const newUsernameInput = $('newUsernameInput');
  const createRoomModal = $('createRoomModal');
  const newRoomNameInput = $('newRoomNameInput');
  const joinColorModal = $('joinColorModal');
  const forceLoginModal = $('forceLoginModal');
  const loginApprovalModal = $('loginApprovalModal');
  const loginApprovalText = $('loginApprovalText');
  const masterKeyModal = $('masterKeyModal');
  const masterKeyInput = $('masterKeyInput');
  const settingsModal = $('settingsModal');
  const settingsUsername = $('settingsUsername');
  const settingsPassword = $('settingsPassword');
  const settingsLockUser = $('settingsLockUser');
  const adminSection = $('adminSection');
  const settingsMasterKey = $('settingsMasterKey');
  const restartNotification = $('restartNotification');
  const restartReqText = $('restartReqText');
  const drawModal = $('drawModal');
  const drawReqText = $('drawReqText');

  let pendingLoginRequest = null;

  function showScreen(id) { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); const el = $(id); if (el) el.classList.add('active'); }
  function switchView(viewName, animateOut = false) {
    const currentView = document.querySelector('.view.active');
    const targetView = $('view-' + viewName);
    if (!targetView) return;
    if (animateOut && currentView) {
      currentView.classList.add('leaving');
      setTimeout(() => { currentView.classList.remove('active', 'leaving'); targetView.classList.add('active', 'entering'); setTimeout(() => targetView.classList.remove('entering'), 350); }, 350);
    } else {
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active', 'leaving', 'entering'));
      targetView.classList.add('active');
    }
  }
  function showToast(msg, isError = false) {
    if (!toastContainer) return;
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    if (isError) { t.style.borderColor = 'var(--red)'; t.style.color = 'var(--red)'; }
    toastContainer.appendChild(t); setTimeout(() => t.remove(), 3500);
  }

  function safeSend(data) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(data));
      return true;
    } else if (socket && socket.readyState === WebSocket.CONNECTING) {
      showToast("Connecting... please wait.", true); return false;
    } else {
      showToast("Server disconnected. Reconnecting...", true); connectWebSocket(); return false;
    }
  }

  function connectWebSocket() {
    if (socket) { socket.onopen = null; socket.onmessage = null; socket.onclose = null; if (socket.readyState < 2) socket.close(); }
    if (reconnectTimer) clearTimeout(reconnectTimer);
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host || '127.0.0.1:3000';
    socket = new WebSocket(protocol + '//' + host);

    socket.onopen = () => {
      if (connStatus) connStatus.className = 'connection-status connected'; if (connText) connText.textContent = 'Live';
      if (currentUser) {
        socket.send(JSON.stringify({ type: 'login', username: currentUser.username, password: currentUser.password || '' }));
      } else {
        socket.send(JSON.stringify({ type: 'get_users' }));
      }
    };

    socket.onmessage = (event) => {
      try { handleServerMessage(JSON.parse(event.data)); } catch (e) { console.error('Msg Error', e); }
    };

    socket.onclose = () => { 
      if (connStatus) connStatus.className = 'connection-status'; if (connText) connText.textContent = 'Reconnecting...'; 
      reconnectTimer = setTimeout(connectWebSocket, 3000); 
    };
  }

  function handleServerMessage(msg) {
    if (msg.type === 'users_list') { renderUsersList(msg.users); } 
    else if (msg.type === 'register_success') { showToast("Account created!"); }
    else if (msg.type === 'login_success') {
      currentUser = { username: msg.username };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentUser));
      showScreen('screen-lobby');
      if (userNameEl) userNameEl.textContent = msg.username;
      if (userInitialEl) userInitialEl.textContent = msg.username.charAt(0).toUpperCase();
      socket.send(JSON.stringify({ type: 'get_users' }));
    }
    else if (msg.type === 'force_login_prompt') {
      pendingLoginUsername = msg.username;
      if (forceLoginModal) forceLoginModal.classList.remove('hidden');
    }
    else if (msg.type === 'login_approval_request') {
      pendingLoginRequest = msg;
      if (loginApprovalText) loginApprovalText.textContent = `Someone is trying to log in to your account. Allow them to take over?`;
      if (loginApprovalModal) loginApprovalModal.classList.remove('hidden');
    }
    else if (msg.type === 'kicked') {
      showToast("Session ended: Someone else logged in.", true);
      localStorage.removeItem(STORAGE_KEY);
      currentUser = null; currentRoom = null; clearInterval(timerInterval);
      if (chatMessages) chatMessages.innerHTML = '';
      unreadCount = 0; if (chatBadge) chatBadge.classList.add('hidden');
      showScreen('screen-login');
      if (socket) socket.send(JSON.stringify({ type: 'get_users' }));
    }
    else if (msg.type === 'error') { showToast(msg.text, true); }
    else if (msg.type === 'system') { showToast(msg.text); }
    else if (msg.type === 'rooms_list') { renderRooms(msg.rooms); }
    else if (msg.type === 'joined_room') { isProcessingMove = false; currentRoom = msg.room; switchView('room'); updateRoomUI(msg.room); }
    else if (msg.type === 'room_state') { isProcessingMove = false; currentRoom = msg.room; updateRoomUI(msg.room); }
    else if (msg.type === 'left_room') { currentRoom = null; switchView('lobby-list', true); clearInterval(timerInterval); }
    else if (msg.type === 'chat') { addChatMessage(msg.sender, msg.text); }
    else if (msg.type === 'restart_request') {
      if (restartReqText) restartReqText.textContent = `${msg.requesterName} wants to restart.`;
      if (restartNotification) restartNotification.classList.remove('hidden');
    }
    else if (msg.type === 'draw_request') {
      if (drawReqText) drawReqText.textContent = `${msg.requesterName} offers a draw.`;
      if (drawModal) drawModal.classList.remove('hidden');
    }
  }

  function renderUsersList(users) {
    if (!userSelectionList || !dropdownUserList) return;
    userSelectionList.innerHTML = ''; dropdownUserList.innerHTML = '';
    if (!Array.isArray(users)) return;
    
    users.forEach(u => {
      const div = document.createElement('div');
      div.className = 'user-select-item';
      div.innerHTML = `
        <div class="u-avatar" style="background:${u.color || '#fff'}">${(u.username || '?').charAt(0).toUpperCase()}</div>
        <div class="u-name">${u.username}</div>
        ${u.isLocked ? '<div class="u-lock">🔒</div>' : ''}
      `;
      div.addEventListener('click', () => {
        if (u.hasPassword) {
          pendingLoginUsername = u.username;
          if (loginPasswordArea) loginPasswordArea.classList.remove('hidden');
          if (loginPasswordInput) loginPasswordInput.focus();
        } else {
          safeSend({ type: 'login', username: u.username, password: '' });
        }
      });

      div.addEventListener('touchstart', (e) => {
        const now = Date.now();
        if (now - lastTapTime < 300 && lastTappedUser === u.username) {
          masterKeyTargetUser = u.username;
          if (masterKeyModal) masterKeyModal.classList.remove('hidden');
          if (masterKeyInput) { masterKeyInput.value = ''; masterKeyInput.focus(); }
          lastTappedUser = null;
        } else { lastTappedUser = u.username; lastTapTime = now; }
      });
      div.addEventListener('dblclick', () => {
        masterKeyTargetUser = u.username;
        if (masterKeyModal) masterKeyModal.classList.remove('hidden');
        if (masterKeyInput) { masterKeyInput.value = ''; masterKeyInput.focus(); }
      });

      userSelectionList.appendChild(div);

      // Dropdown list item
      const dItem = document.createElement('button');
      dItem.className = 'dropdown-item';
      dItem.innerHTML = `${u.username} ${currentUser && currentUser.username === u.username ? '(Active)' : ''}`;
      dItem.addEventListener('click', () => {
        if (currentUser && currentUser.username === u.username) return;
        
        let pass = '';
        if (u.hasPassword) {
          pass = prompt(`Enter password for ${u.username}:`);
          if (pass === null) return;
        }
        safeSend({ type: 'login', username: u.username, password: pass });
        if (profileDropdown) profileDropdown.classList.add('hidden'); // Isara dropdown
      });
      dropdownUserList.appendChild(dItem);
    });
  }

  function renderRooms(rooms) {
    if (!roomsGrid) return;
    roomsGrid.innerHTML = '';
    if (rooms.length === 0) { roomsGrid.innerHTML = '<div class="empty-state">No rooms yet. Create one!</div>'; return; }
    rooms.forEach(r => {
      const card = document.createElement('div'); card.className = 'room-card';
      let timeStr = "00:00";
      if (r.startTime) { const diff = Math.floor((Date.now() - r.startTime) / 1000); const m = String(Math.floor(diff / 60)).padStart(2, '0'); const s = String(diff % 60).padStart(2, '0'); timeStr = `${m}:${s}`; }
      card.innerHTML = `
        <div class="r-header"><span>${r.name}</span><span class="r-time">${timeStr}</span></div>
        <div class="r-body"><span>♔ ${r.white || 'Empty'}</span><span class="r-vs">VS</span><span>♚ ${r.black || 'Empty'}</span></div>
        <div class="r-footer"><span>👁 ${r.spectators}</span><span>Host: ${r.hostName}</span></div>
        <div class="r-actions"><button class="btn-play" onclick="window.openJoinModal('${r.id}')">Join / Play</button></div>`;
      roomsGrid.appendChild(card);
    });
  }

  window.openJoinModal = function(roomId) { pendingRoomId = roomId; if (joinColorModal) joinColorModal.classList.remove('hidden'); };

  function getMyColor() {
    if (!currentRoom || !currentUser) return null;
    if (currentRoom.white && currentRoom.white.name === currentUser.username) return 'w';
    if (currentRoom.black && currentRoom.black.name === currentUser.username) return 'b';
    return null;
  }

  function updateRoomUI(room) {
    if (!room || !room.gameState) return;
    if (roomTitle) roomTitle.textContent = room.name;
    if (whiteNameEl) whiteNameEl.textContent = room.white ? room.white.name : 'Waiting...';
    if (blackNameEl) blackNameEl.textContent = room.black ? room.black.name : 'Waiting...';
    if (specCountEl) specCountEl.textContent = room.spectators.length;
    if (specListEl) specListEl.innerHTML = room.spectators.map(s => `<span>${s.name}</span>`).join('');

    const myColor = getMyColor();
    if (boardEl) boardEl.style.transform = myColor === 'b' ? 'rotate(180deg)' : 'none';

    if (gameActions) {
      if (myColor && room.gameState.status === 'playing' && currentUser.username !== 'Guest') gameActions.style.display = 'flex';
      else gameActions.style.display = 'none';
    }

    renderBoard(room.gameState, myColor === 'b');
    renderHistory(room.gameState.moveHistory);
    
    let statusTxt = `Turn: ${room.gameState.turn === 'w' ? 'White' : 'Black'}`;
    if (room.gameState.status === 'checkmate') statusTxt = `Checkmate! ${room.gameState.winner === 'w' ? 'White' : 'Black'} wins.`;
    if (gameStatusEl) gameStatusEl.textContent = statusTxt;

    clearInterval(timerInterval);
    gameStartTime = room.startTime;
    if (gameStartTime) { updateTimerDisplay(); timerInterval = setInterval(updateTimerDisplay, 1000); } 
    else if (gameTimerEl) { gameTimerEl.textContent = "00:00"; }
  }

  function updateTimerDisplay() {
    if (!gameStartTime || !gameTimerEl) return;
    const diff = Math.floor((Date.now() - gameStartTime) / 1000);
    const m = String(Math.floor(diff / 60)).padStart(2, '0');
    const s = String(diff % 60).padStart(2, '0');
    gameTimerEl.textContent = `${m}:${s}`;
  }

  function renderHistory(history) {
    if (!historyListEl) return;
    historyListEl.innerHTML = '';
    if (!history) return;
    for (let i = 0; i < history.length; i += 2) {
      const turnNum = Math.floor(i / 2) + 1;
      const wDiv = document.createElement('div'); wDiv.className = 'history-item turn-num'; wDiv.textContent = `${turnNum}.`;
      const wMove = document.createElement('div'); wMove.className = 'history-item'; wMove.textContent = history[i];
      const bMove = document.createElement('div'); bMove.className = 'history-item'; bMove.textContent = history[i + 1] || '';
      historyListEl.appendChild(wDiv); historyListEl.appendChild(wMove); historyListEl.appendChild(bMove);
    }
    historyListEl.scrollTop = historyListEl.scrollHeight;
  }

  function renderBoard(gameState, isFlipped) {
    if (!boardEl) return;
    boardEl.innerHTML = '';
    const lastMove = gameState.lastMove;

    for (let vy = 0; vy < 8; vy++) {
      for (let vx = 0; vx < 8; vx++) {
        const x = isFlipped ? 7 - vx : vx, y = isFlipped ? 7 - vy : vy;
        const square = document.createElement('div');
        square.className = `square ${(x + y) % 2 === 0 ? 'light' : 'dark'}`;
        square.dataset.x = x; square.dataset.y = y;

        if (lastMove) {
          if (lastMove.from[0] === x && lastMove.from[1] === y) square.classList.add('last-move-from');
          if (lastMove.to[0] === x && lastMove.to[1] === y) square.classList.add('last-move-to');
        }
        
        const piece = gameState.board[y][x];
        if (piece) {
          const pieceEl = document.createElement('span');
          pieceEl.className = `piece ${piece[0] === 'w' ? 'white-piece' : 'black-piece'}`;
          pieceEl.textContent = pieceUnicode[piece];
          if (isFlipped) pieceEl.style.transform = 'rotate(180deg)';
          if (lastMove && lastMove.to[0] === x && lastMove.to[1] === y) pieceEl.classList.add('just-moved');
          square.appendChild(pieceEl);
        }
        square.addEventListener('click', () => handleSquareClick(x, y, gameState));
        boardEl.appendChild(square);
      }
    }
    if (selectedSquare) showHighlights(selectedSquare[0], selectedSquare[1], gameState);
  }

  function handleSquareClick(x, y, gameState) {
    if (gameState.status !== 'playing' || isProcessingMove) return;
    if (currentUser.username === 'Guest') return;
    const myColor = getMyColor();
    if (myColor !== gameState.turn) return;
    if (selectedSquare) {
      const from = selectedSquare, to = [x, y];
      const isValid = gameState.legalMoves.some(m => m.from[0] === from[0] && m.from[1] === from[1] && m.to[0] === to[0] && m.to[1] === to[1]);
      if (isValid) {
        isProcessingMove = true; let promo = null;
        if (gameState.board[from[1]][from[0]] === myColor + 'p' && (to[1] === 0 || to[1] === 7)) promo = prompt("Promote to (q, r, b, n):", "q") || 'q';
        safeSend({ type: 'move', from, to, promotion: promo });
        selectedSquare = null; clearHighlights();
      } else {
        const piece = gameState.board[y][x];
        if (piece && piece[0] === myColor) { selectedSquare = [x, y]; showHighlights(x, y, gameState); } 
        else { selectedSquare = null; clearHighlights(); }
      }
    } else {
      const piece = gameState.board[y][x];
      if (piece && piece[0] === myColor) { selectedSquare = [x, y]; showHighlights(x, y, gameState); }
    }
  }

  function showHighlights(x, y, gameState) {
    clearHighlights();
    const selEl = document.querySelector(`.square[data-x="${x}"][data-y="${y}"]`); if (selEl) selEl.classList.add('selected');
    gameState.legalMoves.forEach(m => {
      if (m.from[0] === x && m.from[1] === y) {
        const el = document.querySelector(`.square[data-x="${m.to[0]}"][data-y="${m.to[1]}"]`);
        if (el) { el.classList.add('valid-move'); if (gameState.board[m.to[1]][m.to[0]] || m.isEp) el.classList.add('capture'); }
      }
    });
  }
  function clearHighlights() { document.querySelectorAll('.square').forEach(el => el.classList.remove('selected', 'valid-move', 'capture')); }

  function addChatMessage(sender, text) {
    if (!chatMessages) return;
    const div = document.createElement('div');
    div.style.padding = '6px 10px'; div.style.borderRadius = '6px'; div.style.background = 'rgba(255,255,255,0.04)';
    if (sender === currentUser.username) div.style.background = 'rgba(212,175,55,0.1)';
    div.innerHTML = `<span style="color:var(--gold); font-weight:bold; font-size:0.75rem; display:block;">${sender}</span>${text}`;
    chatMessages.appendChild(div); chatMessages.scrollTop = chatMessages.scrollHeight;
    
    if (chatDrawer && !chatDrawer.classList.contains('open')) {
      unreadCount++;
      if (chatBadge) { chatBadge.textContent = unreadCount; chatBadge.classList.remove('hidden'); }
    }
  }

  // --- EVENT LISTENERS ---
  safeBind('refreshUsersBtn', 'click', () => { safeSend({ type: 'get_users' }); });

  safeBind('addUserBtn', 'click', () => {
    if (newUsernameInput) newUsernameInput.value = '';
    if (addUserModal) addUserModal.classList.remove('hidden');
    if (newUsernameInput) newUsernameInput.focus();
  });
  
  safeBind('createUserBtn', 'click', () => {
    const uname = newUsernameInput ? newUsernameInput.value.trim() : '';
    if (uname.length >= 2) {
      if (addUserModal) addUserModal.classList.add('hidden');
      safeSend({ type: 'register_user', username: uname });
    }
  });
  
  safeBind('cancelUserBtn', 'click', () => { if (addUserModal) addUserModal.classList.add('hidden'); });
  
  safeBind('confirmLoginBtn', 'click', () => {
    const pass = loginPasswordInput ? loginPasswordInput.value : '';
    safeSend({ type: 'login', username: pendingLoginUsername, password: pass });
    if (loginPasswordInput) loginPasswordInput.value = '';
    if (loginPasswordArea) loginPasswordArea.classList.add('hidden');
  });

  safeBind('profileChip', 'click', () => { if (profileDropdown) profileDropdown.classList.toggle('hidden'); });
  document.addEventListener('click', (e) => {
    if (profileChip && profileDropdown && !profileChip.contains(e.target) && !profileDropdown.contains(e.target)) profileDropdown.classList.add('hidden');
  });

  safeBind('settingsBtn', 'click', () => {
    if (profileDropdown) profileDropdown.classList.add('hidden');
    if (settingsUsername) settingsUsername.value = currentUser.username;
    if (settingsPassword) settingsPassword.value = '';
    safeSend({ type: 'get_users' });
    const isAdmin = currentUser.username === 'admin';
    if (adminSection) adminSection.classList.toggle('hidden', !isAdmin);
    if (isAdmin && settingsMasterKey) settingsMasterKey.value = 'admin';
    if (settingsModal) settingsModal.classList.remove('hidden');
  });

  safeBind('saveSettingsBtn', 'click', () => {
    const updates = {
      newUsername: settingsUsername ? settingsUsername.value.trim() : '',
      password: settingsPassword ? settingsPassword.value : '',
      isLocked: settingsLockUser ? settingsLockUser.checked : false
    };
    if (adminSection && adminSection.classList.contains('hidden') === false && settingsMasterKey) updates.masterKey = settingsMasterKey.value;
    safeSend({ type: 'update_settings', data: updates });
    if (settingsModal) settingsModal.classList.add('hidden');
  });
  
  safeBind('closeSettingsBtn', 'click', () => { if (settingsModal) settingsModal.classList.add('hidden'); });

  safeBind('logoutBtn', 'click', () => {
    localStorage.removeItem(STORAGE_KEY);
    currentUser = null;
    if (socket) socket.close();
    showScreen('screen-login');
    safeSend({ type: 'get_users' });
  });

  safeBind('forceLoginAcceptBtn', 'click', () => { if (forceLoginModal) forceLoginModal.classList.add('hidden'); safeSend({ type: 'force_login', username: pendingLoginUsername }); });
  safeBind('forceLoginCancelBtn', 'click', () => { if (forceLoginModal) forceLoginModal.classList.add('hidden'); });

  safeBind('acceptLoginReqBtn', 'click', () => {
    if (loginApprovalModal) loginApprovalModal.classList.add('hidden');
    if (pendingLoginRequest) safeSend({ type: 'respond_login_request', accept: true, targetUsername: pendingLoginRequest.username, waitingSocketId: pendingLoginRequest.newSocketId });
    pendingLoginRequest = null;
  });
  safeBind('denyLoginReqBtn', 'click', () => {
    if (loginApprovalModal) loginApprovalModal.classList.add('hidden');
    if (pendingLoginRequest) safeSend({ type: 'respond_login_request', accept: false, waitingSocketId: pendingLoginRequest.newSocketId });
    pendingLoginRequest = null;
  });

  safeBind('submitMasterKeyBtn', 'click', () => {
    const key = masterKeyInput ? masterKeyInput.value : '';
    if (masterKeyModal) masterKeyModal.classList.add('hidden');
    safeSend({ type: 'master_login', username: masterKeyTargetUser, masterKey: key });
  });
  safeBind('cancelMasterKeyBtn', 'click', () => { if (masterKeyModal) masterKeyModal.classList.add('hidden'); });

  safeBind('createRoomBtn', 'click', () => {
    if (newRoomNameInput) newRoomNameInput.value = `${currentUser.username}'s Room`;
    if (createRoomModal) createRoomModal.classList.remove('hidden');
    if (newRoomNameInput) setTimeout(() => newRoomNameInput.focus(), 100);
  });
  safeBind('cancelCreateBtn', 'click', () => { if (createRoomModal) createRoomModal.classList.add('hidden'); });
  safeBind('confirmCreateBtn', 'click', () => {
    const rName = newRoomNameInput ? newRoomNameInput.value.trim() : '';
    if (rName) safeSend({ type: 'create_room', name: rName });
    if (createRoomModal) createRoomModal.classList.add('hidden');
  });
  
  safeBind('joinWhiteBtn', 'click', () => { if (joinColorModal) joinColorModal.classList.add('hidden'); safeSend({ type: 'join_room', roomId: pendingRoomId, color: 'w' }); });
  safeBind('joinBlackBtn', 'click', () => { if (joinColorModal) joinColorModal.classList.add('hidden'); safeSend({ type: 'join_room', roomId: pendingRoomId, color: 'b' }); });
  safeBind('joinSpectateBtn', 'click', () => { if (joinColorModal) joinColorModal.classList.add('hidden'); safeSend({ type: 'join_room', roomId: pendingRoomId, color: 's' }); });
  safeBind('cancelJoinBtn', 'click', () => { if (joinColorModal) joinColorModal.classList.add('hidden'); });

  safeBind('leaveRoomBtn', 'click', () => safeSend({ type: 'leave_room' }));
  safeBind('resetGameBtn', 'click', () => safeSend({ type: 'reset_game' }));
  safeBind('drawBtn', 'click', () => safeSend({ type: 'offer_draw' }));
  safeBind('resignBtn', 'click', () => { if (confirm("Are you sure you want to resign?")) safeSend({ type: 'resign' }); });

  safeBind('acceptRestartBtn', 'click', () => { if (restartNotification) restartNotification.classList.add('hidden'); safeSend({ type: 'respond_restart', accept: true }); });
  safeBind('declineRestartBtn', 'click', () => { if (restartNotification) restartNotification.classList.add('hidden'); safeSend({ type: 'respond_restart', accept: false }); });
  
  safeBind('acceptDrawBtn', 'click', () => { if (drawModal) drawModal.classList.add('hidden'); safeSend({ type: 'respond_draw', accept: true }); });
  safeBind('declineDrawBtn', 'click', () => { if (drawModal) drawModal.classList.add('hidden'); safeSend({ type: 'respond_draw', accept: false }); });

  safeBind('chatToggleBtn', 'click', () => { 
    if (chatDrawer) {
      chatDrawer.classList.toggle('open');
      if (chatDrawer.classList.contains('open')) {
        unreadCount = 0; if (chatBadge) chatBadge.classList.add('hidden');
      }
    }
  });
  safeBind('chatCloseBtn', 'click', () => { if (chatDrawer) chatDrawer.classList.remove('open'); });
  safeBind('chatSendBtn', 'click', () => { const text = chatInput ? chatInput.value.trim() : ''; if (text) { safeSend({ type: 'chat', text }); if (chatInput) chatInput.value = ''; } });
  safeBind('chatInput', 'keydown', (e) => { if (e.key === 'Enter') { const btn = $('chatSendBtn'); if (btn) btn.click(); } });

  // --- INIT ---
  const savedUser = localStorage.getItem(STORAGE_KEY);
  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
      if (userNameEl) userNameEl.textContent = currentUser.username;
      if (userInitialEl) userInitialEl.textContent = currentUser.username.charAt(0).toUpperCase();
      showScreen('screen-lobby');
    } catch(e) {
      localStorage.removeItem(STORAGE_KEY); showScreen('screen-login');
    }
  } else {
    showScreen('screen-login');
  }
  
  connectWebSocket();

})();