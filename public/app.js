/* Coop Connect - browser client */
(() => {
  const $ = (sel) => document.querySelector(sel);
  const socket = io({ autoConnect: false });

  const state = {
    me: null,
    users: new Map(),
    chats: new Map(),
    current: null, // chat summary of the open chat
    messages: [], // messages of the open chat
    typing: new Map(), // chatId -> Map(userId -> timeout)
    replyTo: null,
    unreadTitle: 0,
  };

  const EMOJIS = ('😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😋 😛 😜 🤪 😎 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 😈 👿 👻 💀 👽 🤖 💩 😺 😸 😹 😻 ' +
    '👋 🤚 ✋ 🖖 👌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💪 ' +
    '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💯 💢 💥 💫 💦 💨 🔥 ⭐ 🌟 ✨ ⚡ ' +
    '🎉 🎊 🎈 🎁 🏆 🥇 ⚽ 🏏 🎵 🎶 📷 📱 💻 📞 📎 📌 📝 📅 ✅ ❌ ❓ ❗ 🌹 🌸 🌻 🍀 🍕 🍔 🍟 🍰 🎂 ☕ 🍵 🚗 ✈️ 🏠 🏦 💰 💵 🇮🇳').split(' ');

  // ---------- Small helpers ----------

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  function initials(name) {
    return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0].toUpperCase()).join('');
  }

  function avatar(name, color, cls = '', showOnline = false) {
    const a = el('div', { class: 'avatar ' + cls }, initials(name));
    a.style.background = color || '#bbb';
    if (showOnline) a.append(el('span', { class: 'dot' }));
    return a;
  }

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function fmtDay(ts) {
    const d = new Date(ts);
    const today = new Date();
    const yesterday = new Date(Date.now() - 86400000);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    if (Date.now() - ts < 6 * 86400000) return d.toLocaleDateString([], { weekday: 'long' });
    return d.toLocaleDateString();
  }

  function fmtListTime(ts) {
    const day = fmtDay(ts);
    return day === 'Today' ? fmtTime(ts) : day;
  }

  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 ** 3) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024 ** 3).toFixed(2) + ' GB';
  }

  function lastSeen(u) {
    if (u.online) return 'online';
    if (!u.lastSeen) return '';
    const day = fmtDay(u.lastSeen);
    return `last seen ${day === 'Today' ? 'today' : day.toLowerCase()} at ${fmtTime(u.lastSeen)}`;
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.add('hidden'), 3000);
  }

  function linkify(text) {
    const parts = [];
    const re = /\bhttps?:\/\/[^\s<]+/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      parts.push(text.slice(last, m.index));
      parts.push(el('a', { href: m[0], target: '_blank', rel: 'noopener noreferrer' }, m[0]));
      last = m.index + m[0].length;
    }
    parts.push(text.slice(last));
    return parts;
  }

  function userName(id) {
    if (state.me && id === state.me.id) return 'You';
    return (state.users.get(id) || {}).name || 'Unknown';
  }

  function chatTitle(chat) {
    if (chat.type === 'group') return chat.name;
    const u = state.users.get(chat.peer);
    return u ? (u.id === state.me.id ? u.name + ' (You)' : u.name) : 'Unknown';
  }

  function chatAvatar(chat, cls) {
    if (chat.type === 'group') return avatar(chat.name, chat.color, cls);
    const u = state.users.get(chat.peer) || {};
    return avatar(u.name, u.color, cls, u.online && u.id !== state.me.id);
  }

  const TICK_SINGLE = '<svg viewBox="0 0 12 11"><path d="M11.1 1.1 10.4.5a.4.4 0 0 0-.6.1L4.6 7.2 2.2 4.9a.4.4 0 0 0-.6 0l-.6.6a.4.4 0 0 0 0 .6l3.3 3.2a.4.4 0 0 0 .6 0l6.2-7.6a.4.4 0 0 0 0-.6z"/></svg>';
  const TICK_DOUBLE = '<svg viewBox="0 0 16 11"><path d="M11.1 1.1 10.4.5a.4.4 0 0 0-.6.1L4.6 7.2 2.2 4.9a.4.4 0 0 0-.6 0l-.6.6a.4.4 0 0 0 0 .6l3.3 3.2a.4.4 0 0 0 .6 0l6.2-7.6a.4.4 0 0 0 0-.6zm4 0-.7-.6a.4.4 0 0 0-.6.1L8.6 7.2l-.8-.8-.9 1.1 1.4 1.4a.4.4 0 0 0 .6 0l6.2-7.6a.4.4 0 0 0 0-.6z"/></svg>';

  function tick(status) {
    const t = el('span', { class: 'tick ' + (status === 'read' ? 'read' : '') });
    t.innerHTML = status === 'sent' ? TICK_SINGLE : TICK_DOUBLE;
    t.title = status;
    return t;
  }

  function previewText(m) {
    if (!m) return '';
    if (m.deleted) return '🚫 This message was deleted';
    if (m.file) {
      const icon = m.file.mime.startsWith('image/') ? '📷' : m.file.mime.startsWith('video/') ? '🎥' : m.file.mime.startsWith('audio/') ? '🎵' : '📄';
      return `${icon} ${m.text || m.file.name}`;
    }
    return m.text;
  }

  // ---------- Notifications ----------

  let audioCtx;
  function beep() {
    try {
      audioCtx = audioCtx || new AudioContext();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.08, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.25);
      o.connect(g).connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + 0.25);
    } catch { /* sound is optional */ }
  }

  function notify(chatId, m) {
    beep();
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const chat = state.chats.get(chatId);
    const title = chat ? chatTitle(chat) : 'New message';
    const body = (chat && chat.type === 'group' ? userName(m.from) + ': ' : '') + previewText(m);
    const n = new Notification(title, { body, tag: chatId });
    n.onclick = () => { window.focus(); openChat({ chatId }); n.close(); };
  }

  function updateTitle() {
    let total = 0;
    for (const c of state.chats.values()) total += c.unread;
    document.title = total ? `(${total}) Coop Connect` : 'Coop Connect';
  }

  // ---------- Auth ----------

  async function api(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body || {}),
    });
    let data = {};
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) throw new Error(data.error || 'Something went wrong, please try again');
    return data;
  }

  function showAuthForm(which) {
    const login = which === 'login';
    $('#tab-login').classList.toggle('active', login);
    $('#tab-register').classList.toggle('active', !login);
    $('#login-form').classList.toggle('hidden', !login);
    $('#register-form').classList.toggle('hidden', login);
    for (const err of document.querySelectorAll('[data-error]')) err.textContent = '';
    (login ? $('#login-username') : $('#reg-name')).focus();
  }
  $('#tab-login').addEventListener('click', () => showAuthForm('login'));
  $('#tab-register').addEventListener('click', () => showAuthForm('register'));
  for (const a of document.querySelectorAll('[data-switch]')) {
    a.addEventListener('click', (e) => { e.preventDefault(); showAuthForm(a.dataset.switch); });
  }

  function showLogin() {
    state.me = null;
    $('#app').classList.add('hidden');
    $('#login').classList.remove('hidden');
    $('#login-username').focus();
  }

  function startApp(data) {
    state.me = data.me;
    state.users = new Map(data.users.map((u) => [u.id, u]));
    state.chats = new Map(data.chats.map((c) => [c.id, c]));
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    const myAv = $('#my-avatar');
    myAv.textContent = initials(state.me.name);
    myAv.style.background = state.me.color;
    myAv.title = `${state.me.name} (@${state.me.username}) — profile`;
    renderChatList();
    if (state.current) openChat({ chatId: state.current.id });
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  }

  async function submitAuth(form, path, body) {
    const btn = form.querySelector('button[type=submit]');
    const err = form.querySelector('[data-error]');
    err.textContent = '';
    btn.disabled = true;
    try {
      await api(path, body);
      for (const input of form.querySelectorAll('input[type=password]')) input.value = '';
      socket.connect();
    } catch (e) {
      err.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  }

  $('#login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitAuth(e.target, '/api/login', { username: $('#login-username').value, password: $('#login-pass').value });
  });

  $('#register-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if ($('#reg-pass').value !== $('#reg-pass2').value) {
      e.target.querySelector('[data-error]').textContent = 'Passwords do not match';
      return;
    }
    submitAuth(e.target, '/api/register', {
      name: $('#reg-name').value,
      username: $('#reg-username').value,
      password: $('#reg-pass').value,
    });
  });

  $('#btn-logout').addEventListener('click', async () => {
    if (!confirm('Log out of Coop Connect on this device?')) return;
    socket.disconnect();
    await api('/api/logout').catch(() => {});
    state.current = null;
    closeChatView();
    closePanel();
    showLogin();
  });

  socket.on('bootstrap', startApp);

  socket.on('connect_error', (err) => {
    if (err.message === 'unauthorized') showLogin();
    else if (state.me) toast('Cannot reach Coop Connect — retrying…');
  });

  socket.on('disconnect', (reason) => {
    // The server ends the connection when this session is logged out elsewhere.
    if (reason === 'io server disconnect') {
      state.current = null;
      closeChatView();
      showLogin();
    } else if (reason !== 'io client disconnect') {
      toast('Connection lost — reconnecting…');
    }
  });

  // ---------- Chat list ----------

  function renderChatList() {
    const q = $('#search').value.trim().toLowerCase();
    const list = $('#chat-list');
    list.replaceChildren();
    const chats = [...state.chats.values()]
      .filter((c) => c.last || c.kept || c.type === 'group')
      .sort((a, b) => ((b.last && b.last.time) || 0) - ((a.last && a.last.time) || 0));

    const matching = chats.filter((c) => !q || chatTitle(c).toLowerCase().includes(q));
    for (const c of matching) list.append(chatItem(c));

    // When searching, also offer people you haven't chatted with yet.
    if (q) {
      const known = new Set(chats.filter((c) => c.type === 'dm').map((c) => c.peer));
      const people = [...state.users.values()].filter((u) => !known.has(u.id) && (u.name.toLowerCase().includes(q) || u.username.includes(q)));
      if (people.length) {
        list.append(el('div', { class: 'section-label' }, 'Contacts'));
        for (const u of people) list.append(personItem(u, () => openChat({ peerId: u.id })));
      }
    }
    if (!list.children.length) {
      list.append(el('div', { class: 'empty-list' }, q ? 'No chats or contacts found' : 'No chats yet. Click the 💬 icon above to start one.'));
    }
    updateTitle();
  }

  function chatItem(c) {
    const typingUsers = state.typing.get(c.id);
    const isTyping = typingUsers && typingUsers.size;
    let preview;
    if (isTyping) {
      preview = el('span', { class: 'typing' }, c.type === 'group' ? `${userName([...typingUsers.keys()][0])} is typing…` : 'typing…');
    } else if (c.last) {
      const mine = c.last.from === state.me.id;
      preview = [
        mine && !c.last.system && !c.last.deleted ? tick(c.last.status) : null,
        el('span', {}, (c.type === 'group' && c.last.from && !mine && !c.last.system ? userName(c.last.from) + ': ' : '') + previewText(c.last)),
      ];
    }
    return el('div', {
      class: 'chat-item' + (state.current && state.current.id === c.id ? ' active' : '') + (c.unread ? ' unread' : ''),
      onclick: () => openChat({ chatId: c.id }),
    },
      chatAvatar(c, 'lg'),
      el('div', { class: 'body' },
        el('div', { class: 'row' }, el('span', { class: 'name' }, chatTitle(c)), el('span', { class: 'time' }, c.last ? fmtListTime(c.last.time) : '')),
        el('div', { class: 'row' }, el('span', { class: 'preview' }, preview), c.unread ? el('span', { class: 'badge' }, c.unread) : null),
      ),
    );
  }

  function personItem(u, onclick, extra) {
    return el('div', { class: 'pick', onclick },
      avatar(u.name, u.color, 'lg', u.online && u.id !== state.me.id),
      el('div', { class: 'body' },
        el('span', { class: 'name' }, u.id === state.me.id ? u.name + ' (You)' : u.name),
        el('span', { class: 'sub' }, '@' + u.username + (u.about ? ' · ' + u.about : '')),
      ),
      extra,
    );
  }

  $('#search').addEventListener('input', renderChatList);

  // ---------- Side panel (new chat / group / profile) ----------

  function openPanel(title, content) {
    $('#panel-title').textContent = title;
    $('#panel-body').replaceChildren(...[content].flat(Infinity).filter(Boolean));
    $('#panel').classList.add('open');
    $('#app').classList.add('show-panel');
  }
  const closePanel = () => {
    $('#panel').classList.remove('open');
    $('#app').classList.remove('show-panel');
  };
  $('#panel-back').addEventListener('click', closePanel);

  function sortedUsers() {
    return [...state.users.values()].sort((a, b) => {
      if (a.id === state.me.id) return -1;
      if (b.id === state.me.id) return 1;
      return (b.online - a.online) || a.name.localeCompare(b.name);
    });
  }

  $('#btn-new-chat').addEventListener('click', () => {
    const users = sortedUsers();
    openPanel('New chat', [
      el('div', { class: 'pick', onclick: showNewGroup },
        el('div', { class: 'avatar lg', style: 'background: var(--accent)' }, '👥'),
        el('div', { class: 'body' }, el('span', { class: 'name' }, 'New group')),
      ),
      el('div', { class: 'section-label' }, 'People on Coop Connect'),
      users.length > 1 ? users.map((u) => personItem(u, () => { closePanel(); openChat({ peerId: u.id }); }))
        : el('div', { class: 'empty-list' }, 'Nobody else has joined yet. Ask colleagues to open this app\'s address in their browser.'),
    ]);
  });

  function showNewGroup() {
    const nameInput = el('input', { placeholder: 'Group subject', maxlength: 48 });
    const checks = new Map();
    const others = sortedUsers().filter((u) => u.id !== state.me.id);
    const create = el('button', { class: 'btn-primary', onclick: () => {
      const members = [...checks].filter(([, cb]) => cb.checked).map(([id]) => id);
      socket.emit('group:create', { name: nameInput.value, members }, (res) => {
        if (res.error) return toast(res.error);
        closePanel();
        openChat({ chatId: res.chatId });
      });
    } }, 'Create group');
    openPanel('New group', [
      el('div', { class: 'field' }, el('label', {}, 'Group name'), nameInput),
      el('div', { class: 'section-label' }, 'Add members'),
      others.length ? others.map((u) => {
        const cb = el('input', { type: 'checkbox' });
        checks.set(u.id, cb);
        const row = personItem(u, (e) => { if (e.target !== cb) cb.checked = !cb.checked; }, cb);
        return row;
      }) : el('div', { class: 'empty-list' }, 'Nobody else has joined yet.'),
      el('div', { class: 'actions' }, create),
    ]);
    nameInput.focus();
  }
  $('#btn-new-group').addEventListener('click', showNewGroup);

  // WhatsApp-style "About" presets, tuned for co-op staff.
  const ABOUT_PRESETS = [
    '🟢 Available', '🔴 Busy', '🏦 At the branch', '🤝 In a meeting', '🚜 On field visit',
    '📞 Urgent calls only', '🍽️ At lunch', '🏖️ On leave', '😴 Sleeping',
    '🔋 Battery about to die', '💬 Can\'t talk, Coop Connect only',
  ];
  const ABOUT_EMOJIS = ['😊', '🙏', '👍', '🏦', '🌾', '🚜', '📞', '💼', '📚', '🏠', '✈️', '🎉', '❤️', '🔥', '⏳', '🤒'];

  function saveAbout(text, done) {
    text = text.trim();
    if (!text) return toast('About can\'t be empty');
    socket.emit('profile:update', { about: text }, () => {
      state.me.about = text;
      toast('About updated');
      if (done) done();
    });
  }

  function aboutEditor() {
    const box = el('div', { class: 'about-editor' });
    const render = () => {
      const input = el('input', { value: state.me.about || '', maxlength: 140, placeholder: 'Write your own…' });
      const count = el('span', { class: 'about-count' }, `${140 - input.value.length}`);
      input.addEventListener('input', () => { count.textContent = `${140 - input.value.length}`; });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveAbout(input.value, render); });
      const emojiRow = el('div', { class: 'about-emojis' }, ABOUT_EMOJIS.map((em) => el('button', {
        type: 'button',
        title: 'Add ' + em,
        onclick: () => {
          const { selectionStart: s, selectionEnd: e } = input;
          input.value = (input.value.slice(0, s) + em + input.value.slice(e)).slice(0, 140);
          input.selectionStart = input.selectionEnd = s + em.length;
          input.focus();
          count.textContent = `${140 - input.value.length}`;
        },
      }, em)));
      box.replaceChildren(
        el('div', { class: 'field' },
          el('label', {}, 'About'),
          el('div', { class: 'about-input' }, input, count),
          emojiRow,
        ),
        el('div', { class: 'actions' }, el('button', { class: 'btn-primary', onclick: () => saveAbout(input.value, render) }, 'Save About')),
        el('div', { class: 'section-label' }, 'Select About'),
        ...ABOUT_PRESETS.map((p) => el('div', {
          class: 'about-preset' + (p === state.me.about ? ' selected' : ''),
          onclick: () => saveAbout(p, render),
        }, el('span', {}, p), p === state.me.about ? el('span', { class: 'check' }, '✓') : null)),
      );
    };
    render();
    return box;
  }

  $('#my-avatar').addEventListener('click', () => {
    const current = el('input', { type: 'password', placeholder: 'Current password', autocomplete: 'current-password' });
    const next = el('input', { type: 'password', placeholder: 'New password (min 6 characters)', autocomplete: 'new-password' });
    const next2 = el('input', { type: 'password', placeholder: 'Confirm new password', autocomplete: 'new-password' });
    openPanel('Profile', [
      avatar(state.me.name, state.me.color, 'xl'),
      el('div', { class: 'field' }, el('label', {}, 'Your name'),
        el('div', { style: 'font-size:17px' }, state.me.name),
        el('div', { class: 'username' }, '@' + state.me.username)),
      aboutEditor(),
      el('div', { class: 'field pw-form' }, el('label', {}, 'Change password'), current, next, next2),
      el('div', { class: 'actions' }, el('button', { class: 'btn-primary', onclick: async () => {
        if (next.value !== next2.value) return toast('New passwords do not match');
        try {
          await api('/api/password', { current: current.value, next: next.value });
          toast('Password changed. Other devices were logged out.');
          closePanel();
        } catch (e) {
          toast(e.message);
        }
      } }, 'Change password')),
    ]);
  });

  // Contact / group info, opened by clicking the chat header.
  function showChatInfo() {
    const c = state.current;
    if (!c) return;
    if (c.type === 'group') {
      openPanel('Group info', [
        avatar(c.name, c.color, 'xl'),
        el('div', { class: 'info-name' }, c.name),
        el('div', { class: 'info-sub' }, `Group · ${c.members.length} members`),
        el('div', { class: 'section-label' }, `${c.members.length} members`),
        c.members.map((id) => state.users.get(id)).filter(Boolean).map((u) => personItem(u, () => {
          if (u.id === state.me.id) return;
          closePanel();
          openChat({ peerId: u.id });
        })),
      ]);
      return;
    }
    const u = state.users.get(c.peer);
    if (!u) return;
    openPanel('Contact info', [
      avatar(u.name, u.color, 'xl'),
      el('div', { class: 'info-name' }, u.name),
      el('div', { class: 'info-sub' }, '@' + u.username + (u.id !== state.me.id ? ' · ' + lastSeen(u) : '')),
      el('div', { class: 'field' }, el('label', {}, 'About'), el('div', { class: 'info-about' }, u.about || '—')),
    ]);
  }
  $('.conv-header').addEventListener('click', (e) => {
    if (!e.target.closest('button')) showChatInfo();
  });

  // ---------- Conversation ----------

  function openChat({ chatId, peerId }) {
    socket.emit('chat:open', { chatId, peerId }, (res) => {
      if (res.error) return toast(res.error);
      if (!state.current || state.current.id !== res.chat.id) {
        cancelReply();
        $('#msg-input').value = loadDraft(res.chat.id);
      }
      state.current = res.chat;
      state.chats.set(res.chat.id, { ...state.chats.get(res.chat.id), ...res.chat });
      state.messages = res.messages;
      $('#welcome').classList.add('hidden');
      $('#conversation').classList.remove('hidden');
      $('#app').classList.add('in-chat');
      autoGrow();
      renderHeader();
      renderMessages();
      renderChatList();
      markRead();
      $('#msg-input').focus();
    });
  }

  function closeChatView() {
    state.current = null;
    $('#conversation').classList.add('hidden');
    $('#welcome').classList.remove('hidden');
    $('#app').classList.remove('in-chat');
  }
  $('#conv-back').addEventListener('click', () => { closeChatView(); renderChatList(); });

  function renderHeader() {
    const c = state.current;
    if (!c) return;
    $('#conv-avatar').replaceWith(Object.assign(chatAvatar(c), { id: 'conv-avatar' }));
    $('#conv-name').textContent = chatTitle(c);
    const status = $('#conv-status');
    const typingUsers = state.typing.get(c.id);
    status.classList.toggle('typing', !!(typingUsers && typingUsers.size));
    if (typingUsers && typingUsers.size) {
      status.textContent = c.type === 'group' ? `${[...typingUsers.keys()].map(userName).join(', ')} typing…` : 'typing…';
    } else if (c.type === 'group') {
      status.textContent = c.members.map(userName).join(', ');
    } else {
      const u = state.users.get(c.peer);
      status.textContent = u && u.id !== state.me.id ? lastSeen(u) : 'Message yourself';
    }
  }


  function renderMessages() {
    const box = $('#messages');
    box.replaceChildren();
    let prev = null;
    for (const m of state.messages) {
      if (!prev || fmtDay(prev.time) !== fmtDay(m.time) || new Date(prev.time).toDateString() !== new Date(m.time).toDateString()) {
        box.append(el('div', { class: 'day-sep' }, fmtDay(m.time)));
        prev = null;
      }
      box.append(messageNode(m, prev));
      prev = m;
    }
    box.scrollTop = box.scrollHeight;
  }

  function messageNode(m, prev) {
    if (m.system) return el('div', { class: 'sys-msg', 'data-id': m.id }, m.text);
    const mine = m.from === state.me.id;
    const first = !prev || prev.system || prev.from !== m.from;
    const node = el('div', { class: `msg ${mine ? 'out' : 'in'}${first ? ' first' : ''}`, 'data-id': m.id });

    if (first && !mine && state.current && state.current.type === 'group') {
      const u = state.users.get(m.from) || {};
      node.append(el('div', { class: 'sender', style: `color:${u.color || 'var(--accent)'}` }, u.name || 'Unknown'));
    }

    if (m.deleted) {
      node.append(el('span', { class: 'text deleted' }, mine ? '🚫 You deleted this message' : '🚫 This message was deleted'));
    } else {
      if (m.reply) {
        node.append(el('div', { class: 'quote', onclick: () => jumpTo(m.reply.id) },
          el('div', { class: 'q-name' }, userName(m.reply.from)),
          el('div', { class: 'q-text' }, m.reply.text || (m.reply.fileName ? '📎 ' + m.reply.fileName : '')),
        ));
      }
      if (m.file) node.append(fileNode(m.file));
      if (m.text) node.append(el('span', { class: 'text' }, linkify(m.text)));
    }
    node.append(el('button', { class: 'menu-btn', title: 'Message options', onclick: (e) => showMsgMenu(e, m) }, '▼'));

    node.append(el('span', { class: 'meta' }, fmtTime(m.time), mine && !m.deleted ? tick(m.status) : null));
    node.addEventListener('dblclick', () => !m.deleted && startReply(m));
    return node;
  }

  function fileNode(f) {
    const url = f.url;
    if (f.mime.startsWith('image/')) {
      return el('img', { class: 'media', src: url, alt: f.name, loading: 'lazy', onclick: () => openViewer(f) });
    }
    if (f.mime.startsWith('video/')) {
      return el('video', { class: 'media', src: url, controls: true, preload: 'metadata' });
    }
    if (f.mime.startsWith('audio/')) {
      return el('audio', { src: url, controls: true, preload: 'metadata' });
    }
    const ext = (f.name.split('.').pop() || 'file').slice(0, 4);
    const colors = { pdf: '#e2574c', doc: '#2a5699', docx: '#2a5699', xls: '#1d6f42', xlsx: '#1d6f42', csv: '#1d6f42', ppt: '#d24726', pptx: '#d24726', zip: '#8e6c3a', rar: '#8e6c3a' };
    const badge = el('div', { class: 'ext' }, ext);
    badge.style.background = colors[ext.toLowerCase()] || '#7f8c8d';
    return el('a', { class: 'file-card', href: url + '?download=1', download: f.name, title: 'Download ' + f.name },
      badge,
      el('div', { style: 'min-width:0' }, el('div', { class: 'fname' }, f.name), el('div', { class: 'fsize' }, fmtSize(f.size) + ' · ' + ext.toUpperCase())),
      el('span', { class: 'dl' }, '⬇'),
    );
  }

  function jumpTo(id) {
    const node = $(`#messages [data-id="${CSS.escape(id)}"]`);
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    node.classList.remove('highlight');
    void node.offsetWidth;
    node.classList.add('highlight');
  }

  // Message context menu
  let openMenu = null;
  function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }
  document.addEventListener('click', (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); });

  function popupMenu(anchor, items) {
    closeMenu();
    openMenu = el('div', { class: 'msg-menu' }, items.filter(Boolean).map(([label, action, cls]) =>
      el('button', { class: cls, onclick: () => { closeMenu(); action(); } }, label)));
    document.body.append(openMenu);
    const r = anchor.getBoundingClientRect();
    const w = openMenu.offsetWidth;
    const h = openMenu.offsetHeight;
    openMenu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
    openMenu.style.top = (r.bottom + h > window.innerHeight ? r.top - h : r.bottom) + 'px';
  }

  function showMsgMenu(e, m) {
    e.stopPropagation();
    popupMenu(e.currentTarget, [
      !m.deleted && ['Reply', () => startReply(m)],
      !m.deleted && m.text && ['Copy text', () => navigator.clipboard.writeText(m.text).then(() => toast('Copied'))],
      !m.deleted && m.file && ['Download', () => window.open(m.file.url + '?download=1')],
      ['Delete', () => confirmDeleteMessage(m), 'danger'],
    ]);
  }

  // WhatsApp-style "Delete message?" choice.
  function confirmDeleteMessage(m) {
    const mine = m.from === state.me.id && !m.deleted;
    showDialog({
      title: 'Delete message?',
      text: mine ? 'You can delete this message for everyone or just for yourself.' : 'This message will be removed from this device and your other devices only.',
      buttons: [
        mine && ['Delete for everyone', () => socket.emit('message:delete', { chatId: m.chatId, messageId: m.id }, (r) => r.error && toast(r.error)), 'primary'],
        ['Delete for me', () => socket.emit('message:hide', { chatId: m.chatId, messageIds: [m.id] }, (r) => r.error && toast(r.error)), mine ? '' : 'primary'],
        ['Cancel', () => {}],
      ],
    });
  }

  function showDialog({ title, text, buttons }) {
    $('#dialog-title').textContent = title;
    $('#dialog-text').textContent = text || '';
    $('#dialog-buttons').replaceChildren(...buttons.filter(Boolean).map(([label, action, cls]) =>
      el('button', { class: 'dialog-btn ' + (cls || ''), onclick: () => { closeDialog(); action(); } }, label)));
    $('#dialog').classList.remove('hidden');
    $('#dialog-buttons button').focus();
  }
  const closeDialog = () => $('#dialog').classList.add('hidden');
  $('#dialog').addEventListener('click', (e) => { if (e.target.id === 'dialog') closeDialog(); });

  // Chat menu (⋮): info, clear chat, delete chat / exit group.
  $('#btn-chat-menu').addEventListener('click', (e) => {
    e.stopPropagation();
    const c = state.current;
    if (!c) return;
    const name = chatTitle(c);
    const clear = (after, remove = false) => socket.emit('chat:clear', { chatId: c.id, remove }, (r) => {
      if (r.error) return toast(r.error);
      if (after) after();
    });
    popupMenu(e.currentTarget, [
      [c.type === 'group' ? 'Group info' : 'Contact info', showChatInfo],
      ['Clear chat', () => showDialog({
        title: `Clear this chat?`,
        text: `All messages in "${name}" will be removed for you only. Others still see them.`,
        buttons: [['Clear chat', () => clear(() => toast('Chat cleared')), 'primary'], ['Cancel', () => {}]],
      })],
      c.type === 'group'
        ? ['Exit group', () => showDialog({
          title: `Exit "${c.name}"?`,
          text: 'You will stop getting messages from this group, and it will be removed from your chats.',
          buttons: [['Exit group', () => clear(() => socket.emit('group:leave', { chatId: c.id }, (r) => r.error && toast(r.error))), 'primary'], ['Cancel', () => {}]],
        }), 'danger']
        : ['Delete chat', () => showDialog({
          title: `Delete chat with ${name}?`,
          text: 'Messages will be removed for you only. The chat comes back if a new message arrives.',
          buttons: [['Delete chat', () => clear(() => { closeChatView(); renderChatList(); toast('Chat deleted'); }, true), 'primary'], ['Cancel', () => {}]],
        }), 'danger'],
    ]);
  });

  // ---------- Reply ----------

  function startReply(m) {
    state.replyTo = m;
    $('#reply-name').textContent = userName(m.from);
    $('#reply-text').textContent = previewText(m);
    $('#reply-bar').classList.remove('hidden');
    $('#msg-input').focus();
  }
  function cancelReply() {
    state.replyTo = null;
    $('#reply-bar').classList.add('hidden');
  }
  $('#reply-cancel').addEventListener('click', cancelReply);

  // ---------- Composer ----------

  const input = $('#msg-input');

  function loadDraft(chatId) { return sessionStorage.getItem('draft:' + chatId) || ''; }
  function saveDraft() { if (state.current) sessionStorage.setItem('draft:' + state.current.id, input.value); }

  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  }

  let typingTimer = null;
  let isTyping = false;
  function setTyping(on) {
    if (!state.current || isTyping === on) return;
    isTyping = on;
    socket.emit('typing', { chatId: state.current.id, typing: on });
  }

  input.addEventListener('input', () => {
    autoGrow();
    saveDraft();
    setTyping(input.value.length > 0);
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => setTyping(false), 2500);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendText();
    } else if (e.key === 'Escape') {
      cancelReply();
      $('#emoji-picker').classList.add('hidden');
    }
  });

  $('#btn-send').addEventListener('click', sendText);

  function sendText() {
    const text = input.value.trim();
    if (!text || !state.current) return;
    sendMessage({ text });
    input.value = '';
    saveDraft();
    autoGrow();
    setTyping(false);
  }

  function sendMessage({ text = '', file = null }) {
    socket.emit('message:send', {
      chatId: state.current.id,
      text,
      file,
      replyTo: state.replyTo && state.replyTo.id,
    }, (res) => res.error && toast(res.error));
    cancelReply();
  }

  // Emoji picker
  const picker = $('#emoji-picker');
  picker.append(...EMOJIS.map((em) => el('button', { type: 'button', onclick: () => {
    const { selectionStart: s, selectionEnd: e } = input;
    input.value = input.value.slice(0, s) + em + input.value.slice(e);
    input.selectionStart = input.selectionEnd = s + em.length;
    input.focus();
    saveDraft();
  } }, em)));
  $('#btn-emoji').addEventListener('click', (e) => { e.stopPropagation(); picker.classList.toggle('hidden'); });
  document.addEventListener('click', (e) => {
    if (!picker.contains(e.target) && e.target !== $('#btn-emoji')) picker.classList.add('hidden');
  });

  // ---------- File sharing ----------

  $('#btn-attach').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', (e) => {
    uploadFiles([...e.target.files]);
    e.target.value = '';
  });

  // Paste images/files straight from the clipboard.
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData && e.clipboardData.files || [])];
    if (files.length) {
      e.preventDefault();
      uploadFiles(files);
    }
  });

  // Drag & drop onto the conversation.
  const conv = $('#conversation');
  let dragDepth = 0;
  conv.addEventListener('dragenter', (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    dragDepth++;
    $('#drop-overlay').classList.remove('hidden');
  });
  conv.addEventListener('dragover', (e) => e.preventDefault());
  conv.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop-overlay').classList.add('hidden'); } });
  conv.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('#drop-overlay').classList.add('hidden');
    uploadFiles([...e.dataTransfer.files]);
  });

  async function uploadFiles(files) {
    if (!state.current) return;
    const chatId = state.current.id;
    const caption = input.value.trim();
    for (const [i, file] of files.entries()) {
      try {
        const info = await uploadOne(file);
        const text = i === files.length - 1 ? caption : '';
        socket.emit('message:send', { chatId, text, file: { id: info.id }, replyTo: i === 0 && state.replyTo ? state.replyTo.id : null },
          (res) => res.error && toast(res.error));
        if (text) { input.value = ''; saveDraft(); autoGrow(); }
      } catch (err) {
        toast(`Could not send ${file.name}: ${err.message}`);
      }
    }
    cancelReply();
  }

  function uploadOne(file) {
    return new Promise((resolve, reject) => {
      const bar = $('#upload-progress');
      const fill = bar.firstElementChild;
      const xhr = new XMLHttpRequest();
      const form = new FormData();
      form.append('file', file);
      xhr.open('POST', '/api/upload');
      bar.classList.remove('hidden');
      fill.style.width = '0';
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) fill.style.width = (e.loaded / e.total) * 100 + '%'; };
      xhr.onload = () => {
        bar.classList.add('hidden');
        let body = {};
        try { body = JSON.parse(xhr.responseText); } catch { /* handled below */ }
        if (xhr.status === 200) resolve(body);
        else reject(new Error(body.error || 'upload failed'));
      };
      xhr.onerror = () => { bar.classList.add('hidden'); reject(new Error('network error')); };
      xhr.send(form);
    });
  }

  // ---------- Viewer ----------

  function openViewer(f) {
    $('#viewer-content').replaceChildren(el('img', { src: f.url, alt: f.name }));
    const dl = $('#viewer-download');
    dl.href = f.url + '?download=1';
    dl.setAttribute('download', f.name);
    $('#viewer').classList.remove('hidden');
  }
  const closeViewer = () => { $('#viewer').classList.add('hidden'); $('#viewer-content').replaceChildren(); };
  $('#viewer-close').addEventListener('click', closeViewer);
  $('#viewer').addEventListener('click', (e) => { if (e.target.id === 'viewer') closeViewer(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeViewer(); closePanel(); closeMenu(); closeDialog(); } });

  // ---------- Realtime events ----------

  function markRead() {
    if (!state.current || document.hidden) return;
    const c = state.chats.get(state.current.id);
    if (c && c.unread) socket.emit('chat:read', { chatId: state.current.id });
  }
  document.addEventListener('visibilitychange', markRead);
  window.addEventListener('focus', markRead);

  socket.on('message:new', ({ chatId, message }) => {
    const isOpen = state.current && state.current.id === chatId;
    if (isOpen) {
      const box = $('#messages');
      const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 150;
      const prev = state.messages[state.messages.length - 1];
      state.messages.push(message);
      if (!prev || new Date(prev.time).toDateString() !== new Date(message.time).toDateString()) {
        box.append(el('div', { class: 'day-sep' }, fmtDay(message.time)));
      }
      box.append(messageNode(message, prev && new Date(prev.time).toDateString() === new Date(message.time).toDateString() ? prev : null));
      if (nearBottom || message.from === state.me.id) box.scrollTop = box.scrollHeight;
    }
    if (message.from && message.from !== state.me.id) {
      clearTyping(chatId, message.from);
      if (!isOpen || document.hidden) notify(chatId, message);
    }
  });

  socket.on('chat:update', (summary) => {
    state.chats.set(summary.id, summary);
    if (state.current && state.current.id === summary.id) {
      state.current = summary;
      renderHeader();
      if (summary.unread) markRead();
    }
    renderChatList();
  });

  socket.on('chat:removed', ({ chatId }) => {
    state.chats.delete(chatId);
    if (state.current && state.current.id === chatId) closeChatView();
    renderChatList();
  });

  socket.on('message:status', ({ chatId, messageId, status }) => {
    const m = state.messages.find((x) => x.id === messageId);
    if (m && state.current && state.current.id === chatId) {
      m.status = status;
      const node = $(`#messages [data-id="${CSS.escape(messageId)}"] .tick`);
      if (node) node.replaceWith(tick(status));
    }
    const c = state.chats.get(chatId);
    if (c && c.last && c.last.id === messageId) {
      c.last.status = status;
      renderChatList();
    }
  });

  socket.on('message:updated', ({ chatId, message }) => {
    if (state.current && state.current.id === chatId) {
      const i = state.messages.findIndex((x) => x.id === message.id);
      if (i >= 0) {
        state.messages[i] = message;
        const node = $(`#messages [data-id="${CSS.escape(message.id)}"]`);
        const prev = state.messages[i - 1];
        if (node) node.replaceWith(messageNode(message, prev && !prev.system && fmtDay(prev.time) === fmtDay(message.time) ? prev : null));
      }
    }
  });

  socket.on('message:removed', ({ chatId, messageIds }) => {
    if (!state.current || state.current.id !== chatId) return;
    const gone = new Set(messageIds);
    state.messages = state.messages.filter((m) => !gone.has(m.id));
    renderMessagesKeepScroll();
  });

  socket.on('chat:cleared', ({ chatId }) => {
    if (!state.current || state.current.id !== chatId) return;
    state.messages = [];
    renderMessages();
  });

  function renderMessagesKeepScroll() {
    const box = $('#messages');
    const top = box.scrollTop;
    renderMessages();
    box.scrollTop = top;
  }

  function clearTyping(chatId, userId) {
    const map = state.typing.get(chatId);
    if (!map || !map.has(userId)) return;
    clearTimeout(map.get(userId));
    map.delete(userId);
    renderChatList();
    if (state.current && state.current.id === chatId) renderHeader();
  }

  socket.on('typing', ({ chatId, userId, typing }) => {
    if (!state.typing.has(chatId)) state.typing.set(chatId, new Map());
    const map = state.typing.get(chatId);
    clearTimeout(map.get(userId));
    if (typing) map.set(userId, setTimeout(() => clearTyping(chatId, userId), 6000));
    else map.delete(userId);
    renderChatList();
    if (state.current && state.current.id === chatId) renderHeader();
  });

  socket.on('presence', (u) => {
    state.users.set(u.id, u);
    if (state.me && u.id === state.me.id) state.me = { ...state.me, ...u };
    renderChatList();
    renderHeader();
  });

  socket.on('user:new', (u) => {
    state.users.set(u.id, u);
    if (state.me) renderChatList();
  });

  // Refresh "last seen" texts every minute.
  setInterval(() => { if (state.me) { renderHeader(); } }, 60000);

  // ---------- Boot ----------
  // The session cookie (if any) is checked when the socket connects.
  socket.connect();
})();
