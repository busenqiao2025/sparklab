/**
 * SparkMinds Lab v1.9 — Cloudflare Worker
 * API 路由 + KV 用户存储 + 申请授权 + 用户主页 + 好友 + 站内信
 */

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() },
  });
}

async function readBody(request) {
  try { return await request.json(); }
  catch (e) { return {}; }
}

const AVATARS = ['😀','😎','🤓','🧑‍💻','👨‍🔬','👩‍🔬','🧑‍🔧','👷','🦊','🐱','🐧','🤖','🦉','🐯','🐨','🦁','🐸','🐙','🦄','🐲'];
const DEFAULT_USERS = [
  { name: 'admin', pass: 'admin123', role: 'admin', uid: '00001', nickname: '管理员', avatar: '👨‍💼', friends: [], created: 1783588201655 },
  { name: 'user', pass: 'user123', role: 'user', uid: '00002', nickname: '普通用户', avatar: '😀', friends: [], created: 1783588201655 },
];

async function loadUsers(env) {
  const raw = await env.USERS.get('users');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // 补全旧用户缺少的字段
        let modified = false;
        for (const u of parsed) {
          if (!u.uid) { u.uid = String(parsed.indexOf(u) + 1).padStart(5, '0'); modified = true; }
          else if (!/^\d{5}$/.test(u.uid)) {
            // 兼容旧格式（如 10001），补零为 5 位
            const n = parseInt(u.uid);
            if (!isNaN(n)) { u.uid = String(n).padStart(5, '0'); modified = true; }
          }
          if (!u.nickname) { u.nickname = u.name; modified = true; }
          if (!u.avatar) { u.avatar = AVATARS[Math.floor(Math.random()*AVATARS.length)]; modified = true; }
          if (!u.friends) { u.friends = []; modified = true; }
        }
        if (modified) await env.USERS.put('users', JSON.stringify(parsed));
        return parsed;
      }
    } catch (e) {}
  }
  await env.USERS.put('users', JSON.stringify(DEFAULT_USERS));
  return [...DEFAULT_USERS];
}

async function saveUsers(env, users) {
  await env.USERS.put('users', JSON.stringify(users));
}

async function loadMessages(env) {
  const raw = await env.USERS.get('messages');
  if (raw) {
    try { const p = JSON.parse(raw); if (Array.isArray(p)) return p; } catch(e) {}
  }
  return [];
}

async function saveMessages(env, msgs) {
  await env.USERS.put('messages', JSON.stringify(msgs));
}

async function loadFriendReqs(env) {
  const raw = await env.USERS.get('friend_requests');
  if (raw) {
    try { const p = JSON.parse(raw); if (Array.isArray(p)) return p; } catch(e) {}
  }
  return [];
}

async function saveFriendReqs(env, reqs) {
  await env.USERS.put('friend_requests', JSON.stringify(reqs));
}

function sanitize(user) {
  const { pass, ...safe } = user;
  return safe;
}

function genUid(users) {
  let max = 0;
  for (const u of users) {
    const n = parseInt(u.uid);
    if (!isNaN(n) && n > max) max = n;
  }
  return String(max + 1).padStart(5, '0');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname.startsWith('/api/')) {
      try {
        if (url.pathname === '/api/health')
          return json({ ok: true, time: Date.now(), version: 'v1.9' });

        // ========== 用户认证 ==========
        if (url.pathname === '/api/login' && request.method === 'POST') {
          const { name, pass } = await readBody(request);
          if (!name || !pass) return json({ ok: false, msg: '用户名和密码不能为空' });
          const users = await loadUsers(env);
          const found = users.find(u => u.name === name && u.pass === pass);
          if (found) return json({ ok: true, user: sanitize(found) });
          return json({ ok: false, msg: '用户名或密码错误' });
        }

        // ========== 用户管理 ==========
        if (url.pathname === '/api/users' && request.method === 'GET') {
          const users = await loadUsers(env);
          const withPass = url.searchParams.get('with_pass') === '1';
          if (withPass) return json({ ok: true, users });
          return json({ ok: true, users: users.map(sanitize) });
        }

        if (url.pathname === '/api/users' && request.method === 'POST') {
          const { name, pass, role } = await readBody(request);
          if (!name || !pass) return json({ ok: false, msg: '用户名和密码不能为空' });
          const users = await loadUsers(env);
          if (users.find(u => u.name === name)) return json({ ok: false, msg: '用户已存在' });
          const uid = genUid(users);
          const newUser = { name, pass, role: role || 'user', uid, nickname: name, avatar: AVATARS[Math.floor(Math.random()*AVATARS.length)], friends: [], created: Date.now() };
          users.push(newUser);
          await saveUsers(env, users);
          return json({ ok: true, user: sanitize(newUser) });
        }

        if (url.pathname === '/api/users' && request.method === 'DELETE') {
          const name = url.searchParams.get('name');
          if (!name) return json({ ok: false, msg: '缺少 name 参数' });
          if (name === 'admin') return json({ ok: false, msg: '不能删除 admin' });
          let users = await loadUsers(env);
          users = users.filter(u => u.name !== name);
          await saveUsers(env, users);
          return json({ ok: true });
        }

        if (url.pathname === '/api/users' && request.method === 'PUT') {
          const { name, pass } = await readBody(request);
          if (!name || !pass) return json({ ok: false, msg: '用户名和新密码不能为空' });
          let users = await loadUsers(env);
          const target = users.find(u => u.name === name);
          if (!target) return json({ ok: false, msg: '用户不存在' });
          target.pass = pass;
          await saveUsers(env, users);
          return json({ ok: true });
        }

        // ========== 个人主页 ==========
        // GET /api/profile?uid=xxx — 按 UID 查询用户公开信息
        if (url.pathname === '/api/profile' && request.method === 'GET') {
          const uid = url.searchParams.get('uid');
          if (!uid) return json({ ok: false, msg: '缺少 uid 参数' });
          const users = await loadUsers(env);
          const user = users.find(u => u.uid === uid);
          if (!user) return json({ ok: false, msg: '用户不存在' });
          return json({ ok: true, user: { uid: user.uid, name: user.name, nickname: user.nickname, avatar: user.avatar, role: user.role } });
        }

        // PUT /api/profile — 更新自己的昵称和头像
        if (url.pathname === '/api/profile' && request.method === 'PUT') {
          const { uid, nickname, avatar } = await readBody(request);
          if (!uid) return json({ ok: false, msg: '缺少 uid' });
          let users = await loadUsers(env);
          const target = users.find(u => u.uid === uid);
          if (!target) return json({ ok: false, msg: '用户不存在' });
          if (nickname) target.nickname = nickname;
          if (avatar) target.avatar = avatar;
          await saveUsers(env, users);
          return json({ ok: true, user: sanitize(target) });
        }

        // ========== 好友系统 ==========
        // GET /api/friends?uid=xxx — 获取好友列表（含好友信息）
        if (url.pathname === '/api/friends' && request.method === 'GET') {
          const uid = url.searchParams.get('uid');
          if (!uid) return json({ ok: false, msg: '缺少 uid' });
          const users = await loadUsers(env);
          const user = users.find(u => u.uid === uid);
          if (!user) return json({ ok: false, msg: '用户不存在' });
          const friends = (user.friends || []).map(fuid => {
            const f = users.find(u => u.uid === fuid);
            return f ? { uid: f.uid, name: f.name, nickname: f.nickname, avatar: f.avatar } : null;
          }).filter(Boolean);
          return json({ ok: true, friends });
        }

        // POST /api/friends/request — 发送好友请求
        if (url.pathname === '/api/friends/request' && request.method === 'POST') {
          const { fromUid, toUid } = await readBody(request);
          if (!fromUid || !toUid) return json({ ok: false, msg: '缺少参数' });
          if (fromUid === toUid) return json({ ok: false, msg: '不能添加自己为好友' });
          const users = await loadUsers(env);
          const fromUser = users.find(u => u.uid === fromUid);
          const toUser = users.find(u => u.uid === toUid);
          if (!toUser) return json({ ok: false, msg: '目标用户不存在' });
          if (fromUser.friends && fromUser.friends.includes(toUid)) return json({ ok: false, msg: '已经是好友了' });
          let reqs = await loadFriendReqs(env);
          // 检查是否已有待处理请求
          const existing = reqs.find(r => r.from === fromUid && r.to === toUid && r.status === 'pending');
          if (existing) return json({ ok: false, msg: '已发送过好友请求，等待对方确认' });
          const newReq = { id: Date.now(), from: fromUid, to: toUid, status: 'pending', created: Date.now() };
          reqs.push(newReq);
          await saveFriendReqs(env, reqs);
          return json({ ok: true, request: newReq });
        }

        // POST /api/friends/accept — 接受好友请求
        if (url.pathname === '/api/friends/accept' && request.method === 'POST') {
          const { reqId } = await readBody(request);
          let reqs = await loadFriendReqs(env);
          const req = reqs.find(r => r.id === reqId);
          if (!req) return json({ ok: false, msg: '请求不存在' });
          if (req.status !== 'pending') return json({ ok: false, msg: '该请求已处理' });
          req.status = 'accepted';
          await saveFriendReqs(env, reqs);
          // 双向添加好友
          let users = await loadUsers(env);
          const u1 = users.find(u => u.uid === req.from);
          const u2 = users.find(u => u.uid === req.to);
          if (u1 && u2) {
            if (!u1.friends) u1.friends = [];
            if (!u2.friends) u2.friends = [];
            if (!u1.friends.includes(req.to)) u1.friends.push(req.to);
            if (!u2.friends.includes(req.from)) u2.friends.push(req.from);
            await saveUsers(env, users);
          }
          return json({ ok: true });
        }

        // POST /api/friends/reject — 拒绝好友请求
        if (url.pathname === '/api/friends/reject' && request.method === 'POST') {
          const { reqId } = await readBody(request);
          let reqs = await loadFriendReqs(env);
          const req = reqs.find(r => r.id === reqId);
          if (!req) return json({ ok: false, msg: '请求不存在' });
          req.status = 'rejected';
          await saveFriendReqs(env, reqs);
          return json({ ok: true });
        }

        // GET /api/friends/requests?uid=xxx — 获取收到的好友请求
        if (url.pathname === '/api/friends/requests' && request.method === 'GET') {
          const uid = url.searchParams.get('uid');
          if (!uid) return json({ ok: false, msg: '缺少 uid' });
          let reqs = await loadFriendReqs(env);
          const users = await loadUsers(env);
          const pending = reqs.filter(r => r.to === uid && r.status === 'pending').map(r => {
            const fromUser = users.find(u => u.uid === r.from);
            return { id: r.id, from: r.from, fromName: fromUser ? fromUser.nickname : '未知', fromAvatar: fromUser ? fromUser.avatar : '?', created: r.created };
          });
          return json({ ok: true, requests: pending });
        }

        // POST /api/friends/remove — 删除好友
        if (url.pathname === '/api/friends/remove' && request.method === 'POST') {
          const { uid, friendUid } = await readBody(request);
          let users = await loadUsers(env);
          const u1 = users.find(u => u.uid === uid);
          const u2 = users.find(u => u.uid === friendUid);
          if (u1 && u1.friends) u1.friends = u1.friends.filter(f => f !== friendUid);
          if (u2 && u2.friends) u2.friends = u2.friends.filter(f => f !== uid);
          await saveUsers(env, users);
          return json({ ok: true });
        }

        // ========== 站内信系统 ==========
        // GET /api/messages?uid=xxx&peerUid=yyy — 获取与某人的聊天记录
        if (url.pathname === '/api/messages' && request.method === 'GET') {
          const uid = url.searchParams.get('uid');
          const peerUid = url.searchParams.get('peerUid');
          if (!uid) return json({ ok: false, msg: '缺少 uid' });
          let msgs = await loadMessages(env);
          let result;
          if (peerUid) {
            // 两人私聊
            result = msgs.filter(m =>
              (m.broadcast && m.from === peerUid && m.to === uid) ||
              (!m.broadcast && ((m.from === uid && m.to === peerUid) || (m.from === peerUid && m.to === uid)))
            );
          } else {
            // 所有与我相关的消息（含广播）
            result = msgs.filter(m => m.broadcast ? m.to === 'all' || m.to === uid : m.from === uid || m.to === uid);
          }
          // 标记为已读
          let changed = false;
          for (const m of msgs) {
            if (m.to === uid && !m.read) { m.read = true; changed = true; }
          }
          if (changed) await saveMessages(env, msgs);
          return json({ ok: true, messages: result.sort((a,b) => a.created - b.created) });
        }

        // POST /api/messages — 发送私聊消息
        if (url.pathname === '/api/messages' && request.method === 'POST') {
          const { from, to, content } = await readBody(request);
          if (!from || !to || !content) return json({ ok: false, msg: '缺少参数' });
          let msgs = await loadMessages(env);
          const newMsg = { id: Date.now(), from, to, content, broadcast: false, read: false, created: Date.now() };
          msgs.push(newMsg);
          await saveMessages(env, msgs);
          return json({ ok: true, message: newMsg });
        }

        // POST /api/messages/broadcast — 管理员广播
        // to: 'all_including_admin' | 'all_users' | UID 数组
        if (url.pathname === '/api/messages/broadcast' && request.method === 'POST') {
          const { from, to, content } = await readBody(request);
          if (!from || !content) return json({ ok: false, msg: '缺少参数' });
          const users = await loadUsers(env);
          let targets;
          if (to === 'all_including_admin') {
            // 全体用户（含管理员自己）
            targets = users.map(u => u.uid);
          } else if (to === 'all_users') {
            // 仅普通用户
            targets = users.filter(u => u.role !== 'admin').map(u => u.uid);
          } else {
            // 指定 UID 数组
            targets = Array.isArray(to) ? to : [to];
            // 验证 UID 是否存在
            const validUids = users.map(u => u.uid);
            const invalid = targets.filter(t => !validUids.includes(t));
            if (invalid.length > 0) return json({ ok: false, msg: `UID 不存在: ${invalid.join(', ')}` });
          }
          let msgs = await loadMessages(env);
          const baseTime = Date.now();
          for (const t of targets) {
            msgs.push({ id: baseTime + Math.random(), from, to: t, content, broadcast: true, read: false, created: baseTime });
          }
          await saveMessages(env, msgs);
          return json({ ok: true, count: targets.length });
        }

        // GET /api/messages/unread?uid=xxx — 获取未读消息数
        if (url.pathname === '/api/messages/unread' && request.method === 'GET') {
          const uid = url.searchParams.get('uid');
          if (!uid) return json({ ok: false, msg: '缺少 uid' });
          let msgs = await loadMessages(env);
          const count = msgs.filter(m => m.to === uid && !m.read).length;
          return json({ ok: true, count });
        }

        // GET /api/messages/contacts?uid=xxx — 获取联系人列表（好友+有过私聊的人+广播）
        if (url.pathname === '/api/messages/contacts' && request.method === 'GET') {
          const uid = url.searchParams.get('uid');
          if (!uid) return json({ ok: false, msg: '缺少 uid' });
          const users = await loadUsers(env);
          const user = users.find(u => u.uid === uid);
          let msgs = await loadMessages(env);
          // 好友列表
          let contacts = [];
          if (user && user.friends) {
            for (const fuid of user.friends) {
              const f = users.find(u => u.uid === fuid);
              if (f) {
                const fMsgs = msgs.filter(m => (m.from === uid && m.to === fuid) || (m.from === fuid && m.to === uid));
                const lastMsg = fMsgs.sort((a,b) => b.created - a.created)[0];
                const unread = fMsgs.filter(m => m.to === uid && !m.read).length;
                contacts.push({ uid: f.uid, name: f.name, nickname: f.nickname, avatar: f.avatar, lastMsg: lastMsg ? lastMsg.content : '', lastTime: lastMsg ? lastMsg.created : 0, unread });
              }
            }
          }
          // 加上管理员（如果当前用户不是管理员）
          if (user && user.role !== 'admin') {
            const admin = users.find(u => u.role === 'admin');
            if (admin && (!user.friends || !user.friends.includes(admin.uid))) {
              const aMsgs = msgs.filter(m => (m.from === uid && m.to === admin.uid) || (m.from === admin.uid && m.to === uid));
              const lastMsg = aMsgs.sort((a,b) => b.created - a.created)[0];
              const unread = aMsgs.filter(m => m.to === uid && !m.read).length;
              contacts.unshift({ uid: admin.uid, name: admin.name, nickname: admin.nickname, avatar: admin.avatar, lastMsg: lastMsg ? lastMsg.content : '', lastTime: lastMsg ? lastMsg.created : 0, unread, isAdmin: true });
            }
          }
          // 管理员视角：查看有广播消息往来的用户
          if (user && user.role === 'admin') {
            // 管理员发出的广播目标用户（非好友）也显示在联系人列表
            const broadcastTargets = msgs.filter(m => m.broadcast && m.from === uid).map(m => m.to);
            for (const tUid of [...new Set(broadcastTargets)]) {
              if (contacts.find(c => c.uid === tUid)) continue;
              const t = users.find(u => u.uid === tUid);
              if (t) {
                const tMsgs = msgs.filter(m => (m.from === uid && m.to === tUid) || (m.from === tUid && m.to === uid));
                const lastMsg = tMsgs.sort((a,b) => b.created - a.created)[0];
                contacts.push({ uid: t.uid, name: t.name, nickname: t.nickname, avatar: t.avatar, lastMsg: lastMsg ? lastMsg.content : '', lastTime: lastMsg ? lastMsg.created : 0, unread: 0 });
              }
            }
          }
          return json({ ok: true, contacts });
        }

        // ========== 申请授权系统（v1.7 保留） ==========
        if (url.pathname === '/api/requests' && request.method === 'GET') {
          const raw = await env.USERS.get('requests');
          let requests = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(requests)) requests = [];
          return json({ ok: true, requests });
        }

        if (url.pathname === '/api/requests' && request.method === 'POST') {
          const { user, type, target, detail } = await readBody(request);
          if (!user || !type) return json({ ok: false, msg: '缺少必要参数' });
          const raw = await env.USERS.get('requests');
          let requests = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(requests)) requests = [];
          const newReq = { id: Date.now(), user, type, target: target || '', detail: detail || '', status: 'pending', created: Date.now(), reviewedBy: '', reviewedAt: null, adminNote: '' };
          requests.push(newReq);
          await env.USERS.put('requests', JSON.stringify(requests));
          return json({ ok: true, request: newReq });
        }

        if (url.pathname === '/api/requests/approve' && request.method === 'POST') {
          const { id, reviewer, note } = await readBody(request);
          const raw = await env.USERS.get('requests');
          let requests = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(requests)) requests = [];
          const req = requests.find(r => r.id === id);
          if (!req) return json({ ok: false, msg: '申请不存在' });
          if (req.status !== 'pending') return json({ ok: false, msg: '该申请已处理' });
          req.status = 'approved'; req.reviewedBy = reviewer || 'admin'; req.reviewedAt = Date.now(); req.adminNote = note || '';
          await env.USERS.put('requests', JSON.stringify(requests));
          return json({ ok: true, request: req });
        }

        if (url.pathname === '/api/requests/deny' && request.method === 'POST') {
          const { id, reviewer, note } = await readBody(request);
          const raw = await env.USERS.get('requests');
          let requests = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(requests)) requests = [];
          const req = requests.find(r => r.id === id);
          if (!req) return json({ ok: false, msg: '申请不存在' });
          if (req.status !== 'pending') return json({ ok: false, msg: '该申请已处理' });
          req.status = 'denied'; req.reviewedBy = reviewer || 'admin'; req.reviewedAt = Date.now(); req.adminNote = note || '';
          await env.USERS.put('requests', JSON.stringify(requests));
          return json({ ok: true, request: req });
        }

        if (url.pathname === '/api/requests/pending' && request.method === 'GET') {
          const raw = await env.USERS.get('requests');
          let requests = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(requests)) requests = [];
          const count = requests.filter(r => r.status === 'pending').length;
          return json({ ok: true, count });
        }

        return json({ ok: false, msg: 'not found' }, 404);
      } catch (e) {
        return json({ ok: false, msg: '服务器错误: ' + e.message }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
