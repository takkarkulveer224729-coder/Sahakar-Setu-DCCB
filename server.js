// Sahakar Setu Chat - a WhatsApp-style chat & file sharing server.
// Run with `npm start`, then open http://localhost:3000 on this PC
// (other PCs on the same network can use http://<this-pc-ip>:3000).

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const multer = require('multer');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 100;
const INLINE_TYPES = /^(image\/(png|jpe?g|gif|webp|bmp)|video\/(mp4|webm|ogg)|audio\/(mpeg|ogg|wav|webm|mp4|x-m4a)|application\/pdf)$/;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- Persistence (a simple JSON file) ----------

let db = { users: {}, sessions: {}, groups: {}, messages: {} };
if (fs.existsSync(DB_FILE)) {
  try {
    db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
  } catch (err) {
    console.error('Could not read database, starting fresh:', err.message);
  }
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

const COLORS = ['#00a884', '#53bdeb', '#e542a3', '#ffb02e', '#7f66ff', '#fc4c4c', '#25d366', '#ff7f50', '#02a698', '#a066aa'];

// ---------- Helpers ----------

const online = new Map(); // userId -> Set of socket ids

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    about: u.about,
    color: u.color,
    online: online.has(u.id),
    lastSeen: u.lastSeen,
  };
}

function dmId(a, b) {
  return 'dm:' + [a, b].sort().join(':');
}

function chatMembers(chatId) {
  if (chatId.startsWith('dm:')) return [...new Set(chatId.slice(3).split(':'))];
  const group = db.groups[chatId];
  return group ? group.members : [];
}

function canAccess(userId, chatId) {
  return chatMembers(chatId).includes(userId);
}

function chatSummary(chatId, userId) {
  const msgs = db.messages[chatId] || [];
  const last = msgs[msgs.length - 1] || null;
  const unread = msgs.filter((m) => m.from !== userId && !m.readBy.includes(userId) && !m.deleted).length;
  const base = { id: chatId, last, unread };
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
const io = new Server(server, { maxHttpBufferSize: 1e6 });

app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public')));

// Uploaded files: images/video/audio/pdf can be shown inline; everything else
// is forced to download so uploaded HTML/JS can never run on this origin.
app.use('/uploads', (req, res, next) => {
  const meta = db.files && db.files[path.basename(req.path)];
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  if (!meta) return res.status(404).end();
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

function authHttp(req, res, next) {
  const token = req.get('x-session-token');
  const userId = token && db.sessions[token];
  if (!userId || !db.users[userId]) return res.status(401).json({ error: 'Not logged in' });
  req.userId = userId;
  next();
}

app.post('/api/upload', authHttp, (req, res) => {
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
    };
    db.files = db.files || {};
    db.files[file.id] = file;
    save();
    res.json({ ...file, url: '/uploads/' + file.id });
  });
});

// ---------- Realtime ----------

io.on('connection', (socket) => {
  let me = null; // logged in user id

  function attach(userId, ack) {
    me = userId;
    socket.join('user:' + me);
    if (!online.has(me)) online.set(me, new Set());
    online.get(me).add(socket.id);

    // Anything sent to this user while offline is now delivered.
    for (const chat of userChats(me)) {
      for (const m of db.messages[chat.id] || []) {
        if (m.from !== me && !m.deliveredTo.includes(me)) {
          m.deliveredTo.push(me);
          emitToUser(m.from, 'message:status', statusOf(chat.id, m));
        }
      }
    }
    save();
    broadcastPresence(me);
    ack({ ok: true, ...bootstrap(me) });
  }

  function bootstrap(userId) {
    return {
      me: publicUser(db.users[userId]),
      users: Object.values(db.users).map(publicUser),
      chats: userChats(userId),
    };
  }

  socket.on('auth:login', ({ name, password } = {}, ack = () => {}) => {
    name = String(name || '').trim().slice(0, 32);
    password = String(password || '');
    if (name.length < 2) return ack({ error: 'Name must be at least 2 characters' });
    if (password.length < 4) return ack({ error: 'Password must be at least 4 characters' });

    let user = Object.values(db.users).find((u) => u.name.toLowerCase() === name.toLowerCase());
    if (user) {
      if (!checkPassword(user, password)) return ack({ error: 'Wrong password for this name' });
    } else {
      const id = newId();
      user = {
        id,
        name,
        about: 'Hey there! I am using Sahakar Setu Chat.',
        color: COLORS[Object.keys(db.users).length % COLORS.length],
        lastSeen: Date.now(),
        ...hashPassword(password),
      };
      db.users[id] = user;
      io.emit('user:new', publicUser(user));
    }
    const token = crypto.randomBytes(24).toString('hex');
    db.sessions[token] = user.id;
    save();
    attach(user.id, (data) => ack({ ...data, token }));
  });

  socket.on('auth:resume', ({ token } = {}, ack = () => {}) => {
    const userId = db.sessions[token];
    if (!userId || !db.users[userId]) return ack({ error: 'Session expired' });
    attach(userId, ack);
  });

  socket.on('auth:logout', ({ token } = {}) => {
    delete db.sessions[token];
    save();
    socket.disconnect(true);
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
      if (!db.users[peerId]) return ack({ error: 'Unknown user' });
      chatId = dmId(me, peerId);
    }
    if (!chatId || !canAccess(me, chatId)) return ack({ error: 'No access to this chat' });
    ack({ ok: true, chat: chatSummary(chatId, me), messages: db.messages[chatId] || [] });
  });

  socket.on('group:create', ({ name, members } = {}, ack = () => {}) => {
    if (!me) return ack({ error: 'Not logged in' });
    name = String(name || '').trim().slice(0, 48);
    if (!name) return ack({ error: 'Group needs a name' });
    const ids = [...new Set([me, ...(Array.isArray(members) ? members : [])])].filter((id) => db.users[id]);
    if (ids.length < 2) return ack({ error: 'Pick at least one other member' });
    const id = 'group:' + newId();
    db.groups[id] = { id, name, members: ids, createdBy: me, color: COLORS[Math.floor(Math.random() * COLORS.length)] };
    db.messages[id] = [];
    addMessage(id, { system: true, text: `${db.users[me].name} created group "${name}"` });
    for (const uid of ids) emitToUser(uid, 'chat:update', chatSummary(id, uid));
    ack({ ok: true, chatId: id });
  });

  socket.on('group:leave', ({ chatId } = {}, ack = () => {}) => {
    const g = db.groups[chatId];
    if (!me || !g || !g.members.includes(me)) return ack({ error: 'Not a member' });
    addMessage(chatId, { system: true, text: `${db.users[me].name} left` });
    g.members = g.members.filter((id) => id !== me);
    emitToUser(me, 'chat:removed', { chatId });
    for (const uid of g.members) emitToUser(uid, 'chat:update', chatSummary(chatId, uid));
    save();
    ack({ ok: true });
  });

  socket.on('message:send', ({ chatId, peerId, text, file, replyTo } = {}, ack = () => {}) => {
    if (!me) return ack({ error: 'Not logged in' });
    if (peerId && db.users[peerId]) chatId = dmId(me, peerId);
    if (!chatId || !canAccess(me, chatId)) return ack({ error: 'No access to this chat' });
    text = String(text || '').slice(0, 5000);
    let attachment = null;
    if (file && db.files && db.files[file.id] && db.files[file.id].owner === me) {
      const f = db.files[file.id];
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
    const msg = addMessage(chatId, { from: me, text, file: attachment, reply });
    ack({ ok: true, message: msg });
  });

  socket.on('message:delete', ({ chatId, messageId } = {}, ack = () => {}) => {
    if (!me || !canAccess(me, chatId)) return ack({ error: 'No access' });
    const m = (db.messages[chatId] || []).find((x) => x.id === messageId);
    if (!m || m.from !== me) return ack({ error: 'You can only delete your own messages' });
    m.deleted = true;
    m.text = '';
    m.file = null;
    m.reply = null;
    save();
    emitToChat(chatId, 'message:updated', { chatId, message: m });
    ack({ ok: true });
  });

  socket.on('chat:read', ({ chatId } = {}) => {
    if (!me || !canAccess(me, chatId)) return;
    let changed = false;
    for (const m of db.messages[chatId] || []) {
      if (m.from !== me && !m.readBy.includes(me)) {
        m.readBy.push(me);
        if (!m.deliveredTo.includes(me)) m.deliveredTo.push(me);
        if (m.from) emitToUser(m.from, 'message:status', statusOf(chatId, m));
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

  socket.on('disconnect', () => {
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

function statusOf(chatId, m) {
  const others = chatMembers(chatId).filter((id) => id !== m.from);
  let status = 'sent';
  if (others.length && others.every((id) => m.deliveredTo.includes(id))) status = 'delivered';
  if (others.length && others.every((id) => m.readBy.includes(id))) status = 'read';
  return { chatId, messageId: m.id, status };
}

function addMessage(chatId, { from = null, text = '', file = null, reply = null, system = false }) {
  const members = chatMembers(chatId);
  const msg = {
    id: newId(),
    chatId,
    from,
    text,
    file,
    reply,
    system,
    time: Date.now(),
    deliveredTo: members.filter((id) => id !== from && online.has(id)),
    readBy: [],
  };
  msg.status = statusOf(chatId, msg).status;
  (db.messages[chatId] = db.messages[chatId] || []).push(msg);
  save();
  for (const uid of members) {
    emitToUser(uid, 'message:new', { chatId, message: msg });
    emitToUser(uid, 'chat:update', chatSummary(chatId, uid));
  }
  return msg;
}

server.listen(PORT, () => {
  console.log(`\n  Sahakar Setu Chat is running!\n`);
  console.log(`  On this PC:        http://localhost:${PORT}`);
  for (const iface of Object.values(os.networkInterfaces()).flat()) {
    if (iface && iface.family === 'IPv4' && !iface.internal) {
      console.log(`  On your network:   http://${iface.address}:${PORT}`);
    }
  }
  console.log('');
});
