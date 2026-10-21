// Coop Connect - a WhatsApp-style chat & file sharing server.
// Run with `npm start`, then open http://localhost:3000. To reach it from any
// network, put it online (see README: public link or cloud hosting).

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const multer = require('multer');
const { Server } = require('socket.io');

// Optional settings file next to server.js (KEY=value per line), so settings
// also apply when Coop Connect runs as a Windows startup task.
const SETTINGS_FILE = path.join(__dirname, 'settings.env');
if (fs.existsSync(SETTINGS_FILE)) {
  for (const line of fs.readFileSync(SETTINGS_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const APP_NAME = 'Coop Connect';
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(DATA_DIR, '..', 'uploads'));
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 100;
const SESSION_DAYS = 30;
const COOKIE = 'cc_session';
const USERNAME_RE = /^[a-z0-9._]{3,20}$/;
const RING_TIMEOUT_MS = 45000;

// Calls go directly between browsers (WebRTC). STUN lets them find each other; a TURN
// relay is only needed on strict networks (some mobile data / office firewalls).
const ICE_SERVERS = [{ urls: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302').split(',') }];
if (process.env.TURN_URLS) {
  ICE_SERVERS.push({
    urls: process.env.TURN_URLS.split(','),
    username: process.env.TURN_USERNAME || '',
    credential: process.env.TURN_CREDENTIAL || '',
  });
}
const INLINE_TYPES = /^(image\/(png|jpe?g|gif|webp|bmp)|video\/(mp4|webm|ogg)|audio\/(mpeg|ogg|wav|webm|mp4|x-m4a)|application\/pdf)$/;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- Persistence (a simple JSON file) ----------

// hidden: userId -> { messageId: 1 } for "delete for me"; clears: "userId|chatId" -> time of "clear chat";
// removedChats: "userId|chatId" -> 1 when the chat was deleted from that user's list.
let db = { users: {}, sessions: {}, groups: {}, messages: {}, files: {}, hidden: {}, clears: {}, removedChats: {} };
if (fs.existsSync(DB_FILE)) {
  try {
    db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
  } catch (err) {
    console.error('Could not read database, starting fresh:', err.message);
  }
}

// Older data: give every user a username and drop old-style sessions.
for (const u of Object.values(db.users)) {
  if (!u.username) {
    let base = u.name.toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 16) || 'user';
    if (base.length < 3) base = base.padEnd(3, '0');
    let candidate = base;
    for (let n = 2; Object.values(db.users).some((x) => x.username === candidate); n++) candidate = base + n;
    u.username = candidate;
  }
}
for (const [token, s] of Object.entries(db.sessions)) {
  if (typeof s !== 'object' || s.expires < Date.now()) delete db.sessions[token];
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + '.tmp';
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, DB_FILE);
    } catch (err) {
      console.error('Could not save database:', err.message);
    }
  }, 200);
}

const newId = () => crypto.randomBytes(8).toString('hex');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function checkPassword(user, password) {
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}

function passwordProblem(password) {
  if (password.length < 6) return 'Password must be at least 6 characters';
  if (password.length > 128) return 'Password is too long';
  return null;
}

const COLORS = ['#00a884', '#53bdeb', '#e542a3', '#ffb02e', '#7f66ff', '#fc4c4c', '#25d366', '#ff7f50', '#02a698', '#a066aa'];

// ---------- Sessions ----------

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionUser(cookieHeader) {
  const token = parseCookies(cookieHeader)[COOKIE];
  const s = token && db.sessions[token];
  if (!s || s.expires < Date.now() || !db.users[s.userId]) return null;
  return { token, userId: s.userId };
}

function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[token] = { userId, expires: Date.now() + SESSION_DAYS * 86400000 };
  save();
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: SESSION_DAYS * 86400000,
    path: '/',
  });
}

// Requests from other websites must not act with the user's cookie.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    return originHost === req.headers.host || originHost === req.headers['x-forwarded-host'];
  } catch {
    return false;
  }
}

// Slow down password guessing: 10 failed logins per 15 minutes per address.
const failures = new Map();
function tooManyFailures(key) {
  const f = failures.get(key);
  if (f && f.reset < Date.now()) failures.delete(key);
  return (failures.get(key) || { count: 0 }).count >= 10;
}
function recordFailure(key) {
  const f = failures.get(key) || { count: 0, reset: Date.now() + 15 * 60000 };
  f.count++;
  failures.set(key, f);
}

// ---------- Helpers ----------

const online = new Map(); // userId -> Set of socket ids

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    about: u.about,
    color: u.color,
    online: online.has(u.id),
    lastSeen: u.lastSeen,
  };
}

function dmId(a, b) {
  return 'dm:' + [a, b].sort().join(':');
}

const isUser = (id) => typeof id === 'string' && Object.hasOwn(db.users, id);

function chatMembers(chatId) {
  if (typeof chatId !== 'string') return [];
  if (chatId.startsWith('dm:')) return [...new Set(chatId.slice(3).split(':'))];
  return Object.hasOwn(db.groups, chatId) ? db.groups[chatId].members : [];
}

function canAccess(userId, chatId) {
  return chatMembers(chatId).includes(userId);
}

// Messages a user still sees: not deleted "for me" and not wiped by "clear chat".
function visibleMessages(chatId, userId) {
  const hidden = db.hidden[userId] || {};
  const clearedAt = db.clears[userId + '|' + chatId] || 0;
  return (db.messages[chatId] || []).filter((m) => m.time > clearedAt && !hidden[m.id]);
}

function chatSummary(chatId, userId) {
  const msgs = visibleMessages(chatId, userId);
  const last = msgs[msgs.length - 1] || null;
  const unread = msgs.filter((m) => m.from !== userId && !m.readBy.includes(userId) && !m.deleted).length;
  const key = userId + '|' + chatId;
  // A cleared (not deleted) chat stays in the list even with no messages.
  const kept = !!db.clears[key] && !db.removedChats[key];
  const base = { id: chatId, last, unread, kept };
  if (chatId.startsWith('dm:')) {
    const otherId = chatMembers(chatId).find((id) => id !== userId) || userId;
    return { ...base, type: 'dm', peer: otherId };
  }
  const g = db.groups[chatId];
  return { ...base, type: 'group', name: g.name, color: g.color, members: g.members, createdBy: g.createdBy };
}

function userChats(userId) {
  const ids = new Set();
  for (const chatId of Object.keys(db.messages)) {
    if (chatId.startsWith('dm:') && canAccess(userId, chatId)) ids.add(chatId);
  }
  for (const g of Object.values(db.groups)) {
    if (g.members.includes(userId)) ids.add(g.id);
  }
  return [...ids].map((id) => chatSummary(id, userId));
}

function emitToUser(userId, event, payload) {
  io.to('user:' + userId).emit(event, payload);
}

function emitToChat(chatId, event, payload) {
  for (const uid of chatMembers(chatId)) emitToUser(uid, event, payload);
}

function broadcastPresence(userId) {
  const u = db.users[userId];
  if (u) io.emit('presence', publicUser(u));
}

// ---------- HTTP ----------

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e6,
  allowRequest: (req, cb) => cb(null, sameOrigin(req)),
});

// Behind a tunnel or cloud host the real client address / https comes from the proxy.
const TRUST_PROXY = process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal';
app.set('trust proxy', /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) {
    return res.status(403).json({ error: 'Cross-site request blocked' });
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; frame-ancestors 'none'"),
}));
app.use('/api', express.json({ limit: '10kb' }));

function requireLogin(req, res, next) {
  const s = sessionUser(req.headers.cookie);
  if (!s) return res.status(401).json({ error: 'Please log in' });
  req.userId = s.userId;
  req.token = s.token;
  next();
}

app.post('/api/register', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 32);
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (name.length < 2) return res.status(400).json({ error: 'Please enter your full name' });
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Username must be 3–20 characters: letters, numbers, dot or underscore' });
  }
  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });
  if (Object.values(db.users).some((u) => u.username === username)) {
    return res.status(409).json({ error: 'That username is already taken' });
  }
  const id = newId();
  const user = {
    id,
    name,
    username,
    about: `Hey there! I am using ${APP_NAME}.`,
    color: COLORS[Object.keys(db.users).length % COLORS.length],
    lastSeen: Date.now(),
    ...hashPassword(password),
  };
  db.users[id] = user;
  io.emit('user:new', publicUser(user));
  startSession(req, res, id);
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const key = req.ip + '|' + username;
  if (tooManyFailures(key)) {
    return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
  }
  const user = Object.values(db.users).find((u) => u.username === username);
  if (!user || !checkPassword(user, password)) {
    recordFailure(key);
    return res.status(401).json({ error: 'Wrong username or password' });
  }
  failures.delete(key);
  startSession(req, res, user.id);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const s = sessionUser(req.headers.cookie);
  if (s) {
    delete db.sessions[s.token];
    save();
    io.in('session:' + s.token).disconnectSockets(true);
  }
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

app.post('/api/password', requireLogin, (req, res) => {
  const user = db.users[req.userId];
  const current = String(req.body.current || '');
  const next = String(req.body.next || '');
  const key = req.ip + '|' + user.username;
  if (tooManyFailures(key)) return res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
  if (!checkPassword(user, current)) {
    recordFailure(key);
    return res.status(401).json({ error: 'Current password is wrong' });
  }
  const problem = passwordProblem(next);
  if (problem) return res.status(400).json({ error: problem });
  Object.assign(user, hashPassword(next));
  // Log out every other device.
  for (const [token, s] of Object.entries(db.sessions)) {
    if (s.userId === user.id && token !== req.token) {
      delete db.sessions[token];
      io.in('session:' + token).disconnectSockets(true);
    }
  }
  save();
  res.json({ ok: true });
});

// Shared files are only visible to people in a chat they were sent to.
// Images/video/audio/pdf can be shown inline; everything else is forced to
// download so uploaded HTML/JS can never run on this site.
app.use('/uploads', requireLogin, (req, res, next) => {
  const id = path.basename(req.path);
  const meta = Object.hasOwn(db.files, id) && db.files[id];
  const allowed = meta && (meta.owner === req.userId || (meta.chats || []).some((c) => canAccess(req.userId, c)));
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('Cache-Control', 'private, max-age=86400');
  if (!allowed) return res.status(404).end();
  const inline = meta.mime && INLINE_TYPES.test(meta.mime);
  // res.attachment() guesses a type from the file name, so set the real one after it.
  if (!inline || req.query.download) res.attachment(meta.name);
  res.type(inline ? meta.mime : 'application/octet-stream');
  next();
}, express.static(UPLOAD_DIR, { index: false }));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, newId() + newId()),
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

app.post('/api/upload', requireLogin, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? `File is larger than ${MAX_UPLOAD_MB} MB` : err.message;
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'No file received' });
    // Browsers send the filename as latin1 bytes; recover UTF-8 names.
    const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const file = {
      id: req.file.filename,
      name,
      size: req.file.size,
      mime: req.file.mimetype || 'application/octet-stream',
      owner: req.userId,
      chats: [],
    };
    db.files[file.id] = file;
    save();
    res.json({ id: file.id, name: file.name, size: file.size, mime: file.mime, url: '/uploads/' + file.id });
  });
});

// ---------- Realtime ----------

io.use((socket, next) => {
  const s = sessionUser(socket.request.headers.cookie);
  if (!s) return next(new Error('unauthorized'));
  socket.data.userId = s.userId;
  socket.data.token = s.token;
  next();
});

io.on('connection', (socket) => {
  const me = socket.data.userId;
  socket.join('user:' + me);
  socket.join('session:' + socket.data.token);
  if (!online.has(me)) online.set(me, new Set());
  online.get(me).add(socket.id);

  // Anything sent to this user while offline is now delivered.
  for (const chat of userChats(me)) {
    for (const m of db.messages[chat.id] || []) {
      if (m.from !== me && !m.deliveredTo.includes(me)) {
        m.deliveredTo.push(me);
        if (m.from) emitToUser(m.from, 'message:status', updateStatus(chat.id, m));
      }
    }
  }
  save();
  broadcastPresence(me);
  socket.emit('bootstrap', {
    me: publicUser(db.users[me]),
    users: Object.values(db.users).map(publicUser),
    chats: userChats(me),
    iceServers: ICE_SERVERS,
  });

  socket.on('profile:update', ({ about } = {}, ack = () => {}) => {
    if (!me) return;
    db.users[me].about = String(about || '').slice(0, 140);
    save();
    broadcastPresence(me);
    ack({ ok: true });
  });

  socket.on('chat:open', ({ peerId, chatId } = {}, ack = () => {}) => {
    if (!me) return ack({ error: 'Not logged in' });
    if (peerId) {
      if (!isUser(peerId)) return ack({ error: 'Unknown user' });
      chatId = dmId(me, peerId);
    }
    if (!chatId || !canAccess(me, chatId)) return ack({ error: 'No access to this chat' });
    ack({ ok: true, chat: chatSummary(chatId, me), messages: visibleMessages(chatId, me) });
  });

  socket.on('group:create', ({ name, members } = {}, ack = () => {}) => {
    if (!me) return ack({ error: 'Not logged in' });
    name = String(name || '').trim().slice(0, 48);
    if (!name) return ack({ error: 'Group needs a name' });
    const ids = [...new Set([me, ...(Array.isArray(members) ? members : [])])].filter(isUser);
    if (ids.length < 2) return ack({ error: 'Pick at least one other member' });
    const id = 'group:' + newId();
    db.groups[id] = { id, name, members: ids, createdBy: me, color: COLORS[Math.floor(Math.random() * COLORS.length)] };
    db.messages[id] = [];
    addMessage(id, { system: true, text: `${db.users[me].name} created group "${name}"` });
    for (const uid of ids) emitToUser(uid, 'chat:update', chatSummary(id, uid));
    ack({ ok: true, chatId: id });
  });

  socket.on('group:leave', ({ chatId } = {}, ack = () => {}) => {
    const g = Object.hasOwn(db.groups, String(chatId)) && db.groups[chatId];
    if (!me || !g || !g.members.includes(me)) return ack({ error: 'Not a member' });
    addMessage(chatId, { system: true, text: `${db.users[me].name} left` });
    g.members = g.members.filter((id) => id !== me);
    emitToUser(me, 'chat:removed', { chatId });
    for (const uid of g.members) emitToUser(uid, 'chat:update', chatSummary(chatId, uid));
    save();
    ack({ ok: true });
  });

  socket.on('message:send', ({ chatId, peerId, text, file, replyTo, websnap } = {}, ack = () => {}) => {
    if (!me) return ack({ error: 'Not logged in' });
    if (isUser(peerId)) chatId = dmId(me, peerId);
    if (!chatId || !canAccess(me, chatId)) return ack({ error: 'No access to this chat' });
    text = String(text || '').slice(0, 5000);
    let attachment = null;
    const f = file && Object.hasOwn(db.files, String(file.id)) && db.files[file.id];
    if (f && f.owner === me) {
      f.chats = f.chats || [];
      if (!f.chats.includes(chatId)) f.chats.push(chatId);
      attachment = { id: f.id, name: f.name, size: f.size, mime: f.mime, url: '/uploads/' + f.id };
    }
    if (!text.trim() && !attachment) return ack({ error: 'Empty message' });
    let reply = null;
    if (replyTo) {
      const orig = (db.messages[chatId] || []).find((m) => m.id === replyTo);
      if (orig && !orig.deleted) {
        reply = { id: orig.id, from: orig.from, text: orig.text.slice(0, 200), fileName: orig.file && orig.file.name };
      }
    }
    // WebSnap = a photo taken live with the sender's camera inside Coop Connect.
    websnap = !!websnap && !!attachment && attachment.mime.startsWith('image/');
    const msg = addMessage(chatId, { from: me, text, file: attachment, reply, websnap });
    ack({ ok: true, message: msg });
  });

  // Delete for everyone: only your own messages. The text, file and any quotes of it disappear.
  socket.on('message:delete', ({ chatId, messageId } = {}, ack = () => {}) => {
    if (!me || !canAccess(me, chatId)) return ack({ error: 'No access' });
    const msgs = db.messages[chatId] || [];
    const m = msgs.find((x) => x.id === messageId);
    if (!m || m.from !== me) return ack({ error: 'You can only delete your own messages for everyone' });
    if (m.deleted) return ack({ ok: true });
    if (m.file) removeFile(m.file.id);
    m.deleted = true;
    m.text = '';
    m.file = null;
    m.websnap = false;
    m.reply = null;
    const changed = [m];
    for (const other of msgs) {
      if (other.reply && other.reply.id === m.id) {
        other.reply = { id: m.id, from: m.from, text: '🚫 This message was deleted', fileName: null };
        changed.push(other);
      }
    }
    save();
    for (const x of changed) emitToChat(chatId, 'message:updated', { chatId, message: x });
    for (const uid of chatMembers(chatId)) emitToUser(uid, 'chat:update', chatSummary(chatId, uid));
    ack({ ok: true });
  });

  // Delete for me: hides any message (yours or others') on your own devices only.
  socket.on('message:hide', ({ chatId, messageIds } = {}, ack = () => {}) => {
    if (!me || !canAccess(me, chatId)) return ack({ error: 'No access' });
    const ids = new Set((Array.isArray(messageIds) ? messageIds : []).map(String));
    const hidden = (db.hidden[me] = db.hidden[me] || {});
    for (const m of db.messages[chatId] || []) if (ids.has(m.id)) hidden[m.id] = 1;
    save();
    emitToUser(me, 'message:removed', { chatId, messageIds: [...ids] });
    emitToUser(me, 'chat:update', chatSummary(chatId, me));
    ack({ ok: true });
  });

  // Clear chat: empties the conversation for you only. Others keep their copy.
  // With remove: true it is "Delete chat" and the chat also leaves your list until a new message comes.
  socket.on('chat:clear', ({ chatId, remove } = {}, ack = () => {}) => {
    if (!me || !canAccess(me, chatId)) return ack({ error: 'No access' });
    const msgs = db.messages[chatId] || [];
    const key = me + '|' + chatId;
    db.clears[key] = Math.max(Date.now(), ...msgs.map((m) => m.time));
    if (remove) db.removedChats[key] = 1;
    else delete db.removedChats[key];
    save();
    emitToUser(me, 'chat:cleared', { chatId });
    emitToUser(me, 'chat:update', chatSummary(chatId, me));
    ack({ ok: true });
  });

  socket.on('chat:read', ({ chatId } = {}) => {
    if (!me || !canAccess(me, chatId)) return;
    let changed = false;
    for (const m of db.messages[chatId] || []) {
      if (m.from !== me && !m.readBy.includes(me)) {
        m.readBy.push(me);
        if (!m.deliveredTo.includes(me)) m.deliveredTo.push(me);
        if (m.from) emitToUser(m.from, 'message:status', updateStatus(chatId, m));
        changed = true;
      }
    }
    if (changed) {
      save();
      emitToUser(me, 'chat:update', chatSummary(chatId, me));
    }
  });

  socket.on('typing', ({ chatId, typing } = {}) => {
    if (!me || !canAccess(me, chatId)) return;
    for (const uid of chatMembers(chatId)) {
      if (uid !== me) emitToUser(uid, 'typing', { chatId, userId: me, typing: !!typing });
    }
  });

  // ---------- Voice & video calls (one-to-one) ----------
  // The server only passes connection details between the two browsers;
  // the audio/video itself flows directly between them.

  socket.on('call:start', ({ peerId, kind } = {}, ack = () => {}) => {
    if (!isUser(peerId) || peerId === me) return ack({ error: 'You cannot call this person' });
    kind = kind === 'video' ? 'video' : 'voice';
    const name = db.users[peerId].name;
    const chatId = dmId(me, peerId);
    if (userInCall(me)) return ack({ error: 'You are already in a call' });
    if (!online.has(peerId) || userInCall(peerId)) {
      addMessage(chatId, { from: me, call: { kind, status: 'missed', duration: 0 } });
      return ack({ error: online.has(peerId) ? `${name} is on another call` : `${name} is not online right now. They will see a missed call.` });
    }
    const call = { id: newId(), from: me, to: peerId, kind, fromSocket: socket.id, toSocket: null, startedAt: null };
    call.timer = setTimeout(() => finishCall(call, 'missed'), RING_TIMEOUT_MS);
    calls.set(call.id, call);
    emitToUser(peerId, 'call:incoming', { callId: call.id, from: me, kind });
    ack({ ok: true, callId: call.id });
  });

  socket.on('call:accept', ({ callId } = {}, ack = () => {}) => {
    const call = calls.get(callId);
    if (!call || call.to !== me || call.toSocket) return ack({ error: 'This call has ended' });
    call.toSocket = socket.id;
    call.startedAt = Date.now();
    clearTimeout(call.timer);
    io.to(call.fromSocket).emit('call:accepted', { callId });
    // Stop it ringing on the person's other devices.
    for (const sid of online.get(me) || []) {
      if (sid !== socket.id) io.to(sid).emit('call:ended', { callId, status: 'answered-elsewhere' });
    }
    ack({ ok: true });
  });

  socket.on('call:decline', ({ callId } = {}) => {
    const call = calls.get(callId);
    if (call && call.to === me && !call.toSocket) finishCall(call, 'declined');
  });

  socket.on('call:end', ({ callId } = {}) => {
    const call = calls.get(callId);
    if (call && (call.fromSocket === socket.id || call.toSocket === socket.id)) finishCall(call, 'missed');
  });

  socket.on('call:signal', ({ callId, data } = {}) => {
    const call = calls.get(callId);
    if (!call || !call.toSocket || !data || typeof data !== 'object') return;
    const target = socket.id === call.fromSocket ? call.toSocket : socket.id === call.toSocket ? call.fromSocket : null;
    if (target) io.to(target).emit('call:signal', { callId, data });
  });

  socket.on('disconnect', () => {
    for (const call of [...calls.values()]) {
      if (call.fromSocket === socket.id || call.toSocket === socket.id) finishCall(call, 'missed');
    }
    if (!me || !online.has(me)) return;
    const set = online.get(me);
    set.delete(socket.id);
    if (set.size === 0) {
      online.delete(me);
      db.users[me].lastSeen = Date.now();
      save();
      broadcastPresence(me);
    }
  });
});

// Store the new tick state on the message so reopened chats show it too.
function updateStatus(chatId, m) {
  const s = statusOf(chatId, m);
  m.status = s.status;
  return s;
}

const calls = new Map(); // callId -> active or ringing call

function userInCall(userId) {
  for (const c of calls.values()) if (c.from === userId || c.to === userId) return c;
  return null;
}

// End a call on every device of both people and record it in their chat.
function finishCall(call, status) {
  if (!calls.delete(call.id)) return;
  clearTimeout(call.timer);
  const answered = !!call.startedAt;
  const duration = answered ? Math.round((Date.now() - call.startedAt) / 1000) : 0;
  const finalStatus = answered ? 'completed' : status;
  emitToUser(call.from, 'call:ended', { callId: call.id, status: finalStatus });
  emitToUser(call.to, 'call:ended', { callId: call.id, status: finalStatus });
  addMessage(dmId(call.from, call.to), {
    from: call.from,
    call: { kind: call.kind, status: finalStatus, duration },
    readBy: finalStatus === 'missed' ? [] : [call.to],
  });
}

function removeFile(fileId) {
  if (!Object.hasOwn(db.files, fileId)) return;
  delete db.files[fileId];
  fs.unlink(path.join(UPLOAD_DIR, fileId), () => {});
}

function statusOf(chatId, m) {
  const others = chatMembers(chatId).filter((id) => id !== m.from);
  let status = 'sent';
  if (others.length && others.every((id) => m.deliveredTo.includes(id))) status = 'delivered';
  if (others.length && others.every((id) => m.readBy.includes(id))) status = 'read';
  return { chatId, messageId: m.id, status };
}

function addMessage(chatId, { from = null, text = '', file = null, reply = null, system = false, call = null, websnap = false, readBy = [] }) {
  const members = chatMembers(chatId);
  const msg = {
    id: newId(),
    chatId,
    from,
    text,
    file,
    reply,
    system,
    call,
    websnap,
    time: Date.now(),
    deliveredTo: members.filter((id) => id !== from && (online.has(id) || readBy.includes(id))),
    readBy,
  };
  updateStatus(chatId, msg);
  (db.messages[chatId] = db.messages[chatId] || []).push(msg);
  save();
  for (const uid of members) {
    emitToUser(uid, 'message:new', { chatId, message: msg });
    emitToUser(uid, 'chat:update', chatSummary(chatId, uid));
  }
  return msg;
}

server.listen(PORT, () => {
  console.log(`\n  ${APP_NAME} is running!\n`);
  console.log(`  On this PC:        http://localhost:${PORT}`);
  for (const iface of Object.values(os.networkInterfaces()).flat()) {
    if (iface && iface.family === 'IPv4' && !iface.internal) {
      console.log(`  On your network:   http://${iface.address}:${PORT}`);
    }
  }
  console.log('\n  To use it from any network, see "Use it from anywhere" in README.md\n');
});
