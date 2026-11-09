const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, 'users.json');
let users = {};
let activeSessions = {};

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = fs.readFileSync(USERS_FILE, 'utf8');
      users = JSON.parse(data);
      if (typeof users !== 'object' || users === null || Array.isArray(users)) {
        users = {};
      }
    }
  } catch (e) {
    console.error('Error loading users:', e.message);
    users = {};
  }
  
  let needsSave = false;

  if (!users['admin']) {
    users['admin'] = { password: 'admin', color: '#d4af37', isLocked: false, masterKey: 'admin' };
    needsSave = true;
  }

  for (const key in users) {
    if (typeof users[key] !== 'object' || users[key] === null) {
      users[key] = { password: '', color: '#ffffff', isLocked: false, masterKey: 'admin' };
      needsSave = true;
    } else {
      if (!users[key].color) { users[key].color = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0'); needsSave = true; }
      if (users[key].isLocked === undefined) { users[key].isLocked = false; needsSave = true; }
      if (users[key].masterKey === undefined) { users[key].masterKey = 'admin'; needsSave = true; }
      if (users[key].password === undefined) { users[key].password = ''; needsSave = true; }
    }
  }
  
  if (needsSave) saveUsers();
}

function saveUsers() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
    console.log('SUCCESS: users.json saved at', USERS_FILE);
  } catch (e) {
    console.log('FAILED TO SAVE users.json:', e.message);
  }
}

function getUsersList() {
  if (!users || typeof users !== 'object' || Array.isArray(users)) users = {};
  
  if (!users['admin']) {
    users['admin'] = { password: 'admin', color: '#d4af37', isLocked: false, masterKey: 'admin' };
  }
  
  return Object.keys(users)
    .filter(k => users[k] && typeof users[k] === 'object')
    .map(username => ({
      username,
      color: users[username].color || '#ffffff',
      isLocked: !!users[username].isLocked,
      hasPassword: !!users[username].password
    }));
}

function getUser(username) { return users[username]; }

function registerUser(username) {
  if (users[username]) return false;
  const colors = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];
  const randomColor = colors[Math.floor(Math.random() * colors.length)];
  users[username] = { password: '', color: randomColor, isLocked: false, masterKey: 'admin' };
  saveUsers();
  return true;
}

function updateUser(username, newData) {
  if (!users[username]) return false;
  if (newData.newUsername && newData.newUsername !== username) {
    if (users[newData.newUsername]) return false;
    users[newData.newUsername] = { ...users[username] };
    delete users[username];
    username = newData.newUsername;
  }
  if (newData.password !== undefined) users[username].password = newData.password;
  if (newData.isLocked !== undefined) users[username].isLocked = newData.isLocked;
  if (newData.masterKey !== undefined) users[username].masterKey = newData.masterKey;
  saveUsers();
  return true;
}

function deleteUser(username) {
  if (users[username] && username !== 'admin') {
    delete users[username];
    saveUsers();
    return true;
  }
  return false;
}

function setSession(username, socketId) { activeSessions[username] = socketId; }
function getSession(username) { return activeSessions[username]; }
function clearSession(username) { delete activeSessions[username]; }
function getUsernameBySocket(socketId) {
  for (const [username, id] of Object.entries(activeSessions)) {
    if (id === socketId) return username;
  }
  return null;
}

loadUsers();

module.exports = {
  getUsersList, getUser, registerUser, updateUser, deleteUser,
  setSession, getSession, clearSession, getUsernameBySocket
};