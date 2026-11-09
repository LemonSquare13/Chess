const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const crypto = require('crypto');
const Chess = require('./chess.js');
const Auth = require('./auth.js');

process.on('uncaughtException', (err) => console.error('Uncaught:', err.message));
process.on('unhandledRejection', (reason) => console.error('Unhandled:', reason));

const PORT = 3000;
const HOST = '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME_TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    const ext = path.extname(filePath).toLowerCase();
    const cacheHeader = 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0';
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream', 'Cache-Control': cacheHeader });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const filePath = path.join(PUBLIC_DIR, urlPath === '/' ? '/index.html' : urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  sendFile(res, filePath);
});

const players = new Map();
const rooms = new Map();
const rawSockets = new Map();
let socketCounter = 1;

function getRoomsList() {
  const list = [];
  for (const r of rooms.values()) {
    list.push({
      id: r.id, name: r.name,
      hostName: players.get(r.hostId)?.name || 'Unknown',
      white: r.white && players.has(r.white) ? players.get(r.white).name : null,
      black: r.black && players.has(r.black) ? players.get(r.black).name : null,
      spectators: r.spectators.length, status: r.game.status, startTime: r.startTime
    });
  }
  return list;
}

function getRoomDetails(roomId) {
  const r = rooms.get(roomId);
  if (!r) return null;
  return {
    id: r.id, name: r.name, hostId: r.hostId, hostName: players.get(r.hostId)?.name,
    white: r.white ? { id: r.white, name: players.get(r.white)?.name } : null,
    black: r.black ? { id: r.black, name: players.get(r.black)?.name } : null,
    spectators: r.spectators.map(id => ({ id, name: players.get(id)?.name })),
    gameState: { board: r.game.board, turn: r.game.turn, status: r.game.status, winner: r.game.winner, legalMoves: r.game.generateMoves(r.game.turn), moveHistory: r.game.moveHistory, lastMove: r.game.lastMove },
    startTime: r.startTime,
    restartRequestedBy: r.restartRequestedBy ? players.get(r.restartRequestedBy)?.name : null,
    drawRequestedBy: r.drawRequestedBy ? players.get(r.drawRequestedBy)?.name : null
  };
}

function broadcastRoomsList() { broadcast(JSON.stringify({ type: 'rooms_list', rooms: getRoomsList() })); }
function broadcastRoomState(roomId) {
  const r = rooms.get(roomId); if (!r) return;
  const state = { type: 'room_state', room: getRoomDetails(roomId) };
  const inRoom = [r.white, r.black, ...r.spectators].filter(id => id !== null);
  for (const pId of inRoom) sendToSocket(pId, state);
}

server.on('upgrade', (req, socket, head) => {
  if (!req.headers.upgrade || req.headers.upgrade.toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  
  try {
    const acceptKey = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acceptKey + '\r\n\r\n');
  } catch (e) { socket.destroy(); return; }
  
  const socketId = 'sock_' + (socketCounter++);
  rawSockets.set(socketId, socket);
  socket.setNoDelay(true);
  const client = { socket, socketId, buffer: Buffer.alloc(0) };
  
  socket.on('data', (chunk) => {
    try {
      client.buffer = Buffer.concat([client.buffer, chunk]);
      while (client.buffer.length >= 2) {
        const opcode = client.buffer[0] & 0x0f;
        const isMasked = (client.buffer[1] & 0x80) === 0x80;
        let payloadLength = client.buffer[1] & 0x7f;
        let offset = 2;
        
        if (payloadLength === 126) { 
          if (client.buffer.length < 4) break; 
          payloadLength = client.buffer.readUInt16BE(2); offset += 2; 
        } else if (payloadLength === 127) { 
          if (client.buffer.length < 10) break; 
          const len = Number(client.buffer.readBigUInt64BE(2)); offset += 8; payloadLength = len; 
        }
        
        if (isMasked) {
          if (client.buffer.length < offset + 4 + payloadLength) break;
          const mask = client.buffer.subarray(offset, offset + 4); offset += 4;
          const payload = client.buffer.subarray(offset, offset + payloadLength);
          for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
          
          if (opcode === 0x1) {
            try { handleMessage(client, JSON.parse(payload.toString('utf8'))); } catch (e) { }
          }
          client.buffer = client.buffer.subarray(offset + payloadLength); 
        } else {
          client.buffer = client.buffer.subarray(offset + payloadLength);
        }
        
        if (opcode === 0x8) { handleDisconnect(client); return; }
      }
    } catch (e) { }
  });
  socket.on('close', () => { rawSockets.delete(socketId); handleDisconnect(client); });
  socket.on('error', () => { rawSockets.delete(socketId); handleDisconnect(client); });
});

function handleMessage(client, msg) {
  if (msg.type === 'get_users') {
    sendToSocket(client.socketId, { type: 'users_list', users: Auth.getUsersList() });
  }
  else if (msg.type === 'register_user') {
    if (Auth.registerUser(msg.username)) {
      broadcast(JSON.stringify({ type: 'users_list', users: Auth.getUsersList() }));
      sendToSocket(client.socketId, { type: 'register_success', username: msg.username });
    } else {
      sendToSocket(client.socketId, { type: 'error', text: 'Username already exists.' });
    }
  }
  else if (msg.type === 'login') {
    const user = Auth.getUser(msg.username);
    if (!user) { sendToSocket(client.socketId, { type: 'error', text: 'User not found' }); return; }
    
    const existingSession = Auth.getSession(msg.username);
    if (existingSession && existingSession !== client.socketId) {
      if (user.isLocked) {
        sendToSocket(existingSession, { type: 'login_approval_request', username: msg.username, newSocketId: client.socketId });
        sendToSocket(client.socketId, { type: 'waiting_approval', text: 'Waiting for user approval...' });
        return;
      }
      sendToSocket(client.socketId, { type: 'force_login_prompt', username: msg.username });
      return;
    }

    if (user.password && user.password !== msg.password) {
      sendToSocket(client.socketId, { type: 'error', text: 'Incorrect password' }); return;
    }

    Auth.setSession(msg.username, client.socketId);
    players.set(client.socketId, { id: client.socketId, name: msg.username, socket: client.socket, isOnline: true, roomId: null, isGuest: false });
    sendToSocket(client.socketId, { type: 'login_success', username: msg.username });
    broadcast(JSON.stringify({ type: 'system', text: `${msg.username} logged in.` }));
  }
  else if (msg.type === 'master_login') {
    const admin = Auth.getUser('admin');
    if (admin && msg.masterKey === admin.masterKey) {
      const oldSession = Auth.getSession(msg.username);
      if (oldSession) {
        sendToSocket(oldSession, { type: 'kicked' });
        players.delete(oldSession);
      }
      
      Auth.setSession(msg.username, client.socketId);
      players.set(client.socketId, { id: client.socketId, name: msg.username, socket: client.socket, isOnline: true, roomId: null, isGuest: false });
      sendToSocket(client.socketId, { type: 'login_success', username: msg.username });
      broadcast(JSON.stringify({ type: 'system', text: `Admin Override: ${msg.username} logged in.` }));
    } else {
      sendToSocket(client.socketId, { type: 'error', text: 'Invalid Master Key' });
    }
  }
  else if (msg.type === 'force_login') {
    const oldSession = Auth.getSession(msg.username);
    if (oldSession) {
      sendToSocket(oldSession, { type: 'kicked' });
      const oldPlayer = players.get(oldSession);
      if (oldPlayer && oldPlayer.roomId) leaveRoom(oldPlayer);
      players.delete(oldSession);
    }
    
    Auth.setSession(msg.username, client.socketId);
    players.set(client.socketId, { id: client.socketId, name: msg.username, socket: client.socket, isOnline: true, roomId: null, isGuest: false });
    sendToSocket(client.socketId, { type: 'login_success', username: msg.username });
    broadcast(JSON.stringify({ type: 'system', text: `${msg.username} force logged in.` }));
  }
  else if (msg.type === 'respond_login_request') {
    const waitingSocketId = msg.waitingSocketId;
    if (msg.accept) {
      const loggedUsername = Auth.getUsernameBySocket(client.socketId);
      if (loggedUsername) {
        sendToSocket(client.socketId, { type: 'kicked' });
        const oldPlayer = players.get(client.socketId);
        if (oldPlayer && oldPlayer.roomId) leaveRoom(oldPlayer);
        players.delete(client.socketId);
        Auth.clearSession(loggedUsername);
      }

      const targetUser = Auth.getUser(msg.targetUsername);
      if (targetUser) {
        Auth.setSession(msg.targetUsername, waitingSocketId);
        players.set(waitingSocketId, { id: waitingSocketId, name: msg.targetUsername, socket: rawSockets.get(waitingSocketId), isOnline: true, roomId: null, isGuest: false });
        sendToSocket(waitingSocketId, { type: 'login_success', username: msg.targetUsername });
        broadcast(JSON.stringify({ type: 'system', text: `${msg.targetUsername} logged in.` }));
      }
    } else {
      sendToSocket(waitingSocketId, { type: 'error', text: 'Login request denied by user.' });
    }
  }
  else if (msg.type === 'update_settings') {
    const loggedUsername = Auth.getUsernameBySocket(client.socketId);
    if (!loggedUsername) return;
    if (Auth.updateUser(loggedUsername, msg.data)) {
      broadcast(JSON.stringify({ type: 'users_list', users: Auth.getUsersList() }));
      sendToSocket(client.socketId, { type: 'system', text: 'Settings saved.' });
      if (msg.data.newUsername) {
        const p = players.get(client.socketId);
        if (p) p.name = msg.data.newUsername;
        broadcast(JSON.stringify({ type: 'system', text: `User renamed to ${msg.data.newUsername}` }));
      }
    } else {
      sendToSocket(client.socketId, { type: 'error', text: 'Username taken or invalid.' });
    }
  }
  else if (msg.type === 'create_room') {
    const p = players.get(client.socketId); if (!p) return;
    const roomId = 'room_' + Date.now();
    rooms.set(roomId, { id: roomId, name: msg.name || `${p.name}'s Room`, hostId: client.socketId, white: client.socketId, black: null, spectators: [], game: new Chess(), startTime: null, restartRequestedBy: null, drawRequestedBy: null });
    p.roomId = roomId;
    broadcastRoomsList();
    sendToSocket(client.socketId, { type: 'joined_room', room: getRoomDetails(roomId) });
  }
  else if (msg.type === 'join_room') {
    const room = rooms.get(msg.roomId); if (!room) return;
    const p = players.get(client.socketId); if (!p) return;
    if (p.roomId && p.roomId !== room.id) leaveRoom(p);
    
    if (msg.color === 'w') {
      if (room.white && room.white !== p.id) { sendToSocket(p.id, { type: 'error', text: "May iba na (White is taken)" }); return; }
      room.white = p.id;
      if (room.spectators.includes(p.id)) room.spectators = room.spectators.filter(id => id !== p.id);
    } 
    else if (msg.color === 'b') {
      if (room.black && room.black !== p.id) { sendToSocket(p.id, { type: 'error', text: "May iba na (Black is taken)" }); return; }
      room.black = p.id;
      if (room.spectators.includes(p.id)) room.spectators = room.spectators.filter(id => id !== p.id);
    } 
    else {
      if (!room.spectators.includes(p.id)) room.spectators.push(p.id);
    }
    p.roomId = room.id;
    broadcastRoomsList(); 
    sendToSocket(p.id, { type: 'joined_room', room: getRoomDetails(room.id) });
    broadcastRoomState(room.id);
  }
  else if (msg.type === 'leave_room') {
    const p = players.get(client.socketId);
    if (p && p.roomId) { leaveRoom(p); sendToSocket(p.id, { type: 'left_room' }); }
  }
  else if (msg.type === 'move') {
    const p = players.get(client.socketId);
    if (!p || !p.roomId || p.isGuest) return;
    const room = rooms.get(p.roomId); if (!room) return;
    if ((room.game.turn === 'w' && room.white !== p.id) || (room.game.turn === 'b' && room.black !== p.id)) return;
    if (room.game.history.length === 0 && !room.startTime) room.startTime = Date.now(); 
    if (room.game.makeMove(msg.from, msg.to, msg.promotion)) broadcastRoomState(room.id);
  }
  else if (msg.type === 'reset_game') {
    const p = players.get(client.socketId);
    if (p && p.roomId) {
      const room = rooms.get(p.roomId); if (!room) return;
      if (p.id === room.hostId) {
        room.game = new Chess(); room.startTime = null; room.restartRequestedBy = null; room.drawRequestedBy = null;
        broadcastRoomState(room.id);
        broadcast(JSON.stringify({ type: 'system', text: `Game is Restarted.` }));
      } else {
        if (room.restartRequestedBy) return;
        room.restartRequestedBy = p.id;
        sendToSocket(room.hostId, { type: 'restart_request', requesterName: p.name });
      }
    }
  }
  else if (msg.type === 'respond_restart') {
    const p = players.get(client.socketId);
    if (p && p.roomId) {
      const room = rooms.get(p.roomId);
      if (room && p.id === room.hostId && room.restartRequestedBy) {
        if (msg.accept) {
          room.game = new Chess(); room.startTime = null;
          broadcast(JSON.stringify({ type: 'system', text: `Host accepted restart.` }));
          broadcastRoomState(room.id);
        } else {
          sendToSocket(room.restartRequestedBy, { type: 'system', text: 'Host declined restart request.' });
        }
        room.restartRequestedBy = null;
      }
    }
  }
  else if (msg.type === 'chat') {
    const p = players.get(client.socketId); if (!p) return;
    if (p.roomId && rooms.has(p.roomId)) {
      const room = rooms.get(p.roomId);
      const inRoom = [room.white, room.black, ...room.spectators].filter(id => id !== null);
      const chatMsg = JSON.stringify({ type: 'chat', sender: p.name, text: msg.text });
      for (const pId of inRoom) sendToSocket(pId, JSON.parse(chatMsg));
    } else broadcast(JSON.stringify({ type: 'chat', sender: p.name, text: msg.text }));
  }
}

function leaveRoom(player) {
  const room = rooms.get(player.roomId); if (!room) return;
  if (room.white === player.id) room.white = null;
  else if (room.black === player.id) room.black = null;
  else room.spectators = room.spectators.filter(id => id !== player.id);
  if (room.hostId === player.id) {
    if (room.white) room.hostId = room.white;
    else if (room.black) room.hostId = room.black;
    else if (room.spectators.length > 0) room.hostId = room.spectators[0];
  }
  player.roomId = null;
  if (!room.white && !room.black && room.spectators.length === 0) rooms.delete(room.id);
  broadcastRoomsList(); 
  if (rooms.has(room.id)) broadcastRoomState(room.id);
}

function handleDisconnect(client) {
  const p = players.get(client.socketId);
  if (p) {
    const username = Auth.getUsernameBySocket(client.socketId);
    if (username) Auth.clearSession(username);
    if (p.roomId) leaveRoom(p);
    players.delete(client.socketId);
    broadcast(JSON.stringify({ type: 'system', text: `${p.name} left the game.` }));
  }
}

function createFrame(data) {
  const payload = Buffer.from(data), len = payload.length; let header;
  if (len < 126) { header = Buffer.alloc(2); header[0] = 0x81; header[1] = len; }
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([header, payload]);
}

function broadcast(message) {
  const frame = createFrame(message);
  for (const p of players.values()) { try { p.socket.write(frame); } catch(e) {} }
}

function sendToSocket(socketId, message) {
  const p = players.get(socketId);
  const sock = p ? p.socket : rawSockets.get(socketId);
  if (sock && !sock.destroyed) {
    try { sock.write(createFrame(JSON.stringify(message))); } catch(e) {}
  }
}

server.listen(PORT, HOST, () => {
  console.log('  Phase 11 Server Started (Auth & Security Fix)');
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) for (const net of nets[name]) {
    if (net.family === 'IPv4' && !net.internal) console.log('  http://' + net.address + ':' + PORT);
  }
});