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
          } if (to === 'all_users') {
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

        // GET /api/messages/broadcasts?uid=xxx — 获取所有广播消息（不标记已读，客户端用 localStorage 控制已读）
        if (url.pathname === '/api/messages/broadcasts' && request.method === 'GET') {
          const uid = url.searchParams.get('uid');
          if (!uid) return json({ ok: false, msg: '缺少 uid' });
          let msgs = await loadMessages(env);
          const broadcasts = msgs.filter(m => m.broadcast && m.to === uid && m.from !== uid)
            .map(m => ({ id: m.id, from: m.from, content: m.content, created: m.created }));
          return json({ ok: true, broadcasts });
        }

        // POST /api/messages/mark-read — 标记指定消息为已读
        if (url.pathname === '/api/messages/mark-read' && request.method === 'POST') {
          const { uid, msgIds } = await readBody(request);
          if (!uid) return json({ ok: false, msg: '缺少 uid' });
          let msgs = await loadMessages(env);
          let changed = false;
          const idSet = new Set(Array.isArray(msgIds) ? msgIds : [msgIds]);
          for (const m of msgs) {
            if (m.to === uid && idSet.has(m.id) && !m.read) { m.read = true; changed = true; }
          }
          if (changed) await saveMessages(env, msgs);
          return json({ ok: true });
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

        // ========== 数据快照/回滚系统 ==========
        // GET /api/backup — 获取备份列表
        if (url.pathname === '/api/backup' && request.method === 'GET') {
          const raw = await env.USERS.get('backups');
          let backups = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(backups)) backups = [];
          // 按时间倒序
          backups.sort((a,b) => b.created - a.created);
          return json({ ok: true, backups });
        }

        // POST /api/backup — 创建手动备份
        if (url.pathname === '/api/backup' && request.method === 'POST') {
          const { operator, note } = await readBody(request);
          const users = await loadUsers(env);
          const messages = await loadMessages(env);
          const requestsRaw = await env.USERS.get('requests');
          const snapshot = {
            id: Date.now(),
            created: Date.now(),
            operator: operator || 'admin',
            note: note || '手动备份',
            type: 'manual',
            data: {
              users: JSON.parse(JSON.stringify(users)),
              messages: JSON.parse(JSON.stringify(messages)),
              requests: requestsRaw ? JSON.parse(requestsRaw) : [],
            }
          };
          const raw = await env.USERS.get('backups');
          let backups = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(backups)) backups = [];
          backups.push(snapshot);
          // 最多保留 30 个备份
          if (backups.length > 30) backups = backups.slice(-30);
          await env.USERS.put('backups', JSON.stringify(backups));
          return json({ ok: true, backup: { id: snapshot.id, created: snapshot.created, note: snapshot.note, type: snapshot.type } });
        }

        // POST /api/backup/restore — 从备份恢复数据
        if (url.pathname === '/api/backup/restore' && request.method === 'POST') {
          const { backupId, operator } = await readBody(request);
          const raw = await env.USERS.get('backups');
          let backups = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(backups)) backups = [];
          const backup = backups.find(b => b.id === backupId);
          if (!backup) return json({ ok: false, msg: '备份不存在' });
          // 恢复前先创建一个当前状态的备份
          const users = await loadUsers(env);
          const messages = await loadMessages(env);
          const requestsRaw = await env.USERS.get('requests');
          const preRestore = {
            id: Date.now(),
            created: Date.now(),
            operator: operator || 'admin',
            note: `恢复前自动备份 (恢复到: ${new Date(backup.created).toLocaleString()})`,
            type: 'auto',
            data: {
              users: JSON.parse(JSON.stringify(users)),
              messages: JSON.parse(JSON.stringify(messages)),
              requests: requestsRaw ? JSON.parse(requestsRaw) : [],
            }
          };
          backups.push(preRestore);
          if (backups.length > 30) backups = backups.slice(-30);
          await env.USERS.put('backups', JSON.stringify(backups));
          // 执行恢复
          await saveUsers(env, backup.data.users);
          await saveMessages(env, backup.data.messages);
          await env.USERS.put('requests', JSON.stringify(backup.data.requests));
          return json({ ok: true, msg: '数据已恢复' });
        }

        // DELETE /api/backup?id=xxx — 删除备份
        if (url.pathname === '/api/backup' && request.method === 'DELETE') {
          const backupId = parseInt(url.searchParams.get('id'));
          const raw = await env.USERS.get('backups');
          let backups = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(backups)) backups = [];
          backups = backups.filter(b => b.id !== backupId);
          await env.USERS.put('backups', JSON.stringify(backups));
          return json({ ok: true });
        }

        // ========== 库存流水记录系统 ==========
        // GET /api/transactions?type=material|component|board — 获取流水记录
        if (url.pathname === '/api/transactions' && request.method === 'GET') {
          const type = url.searchParams.get('type') || 'all';
          const raw = await env.USERS.get('transactions');
          let txns = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(txns)) txns = [];
          let result = txns;
          if (type !== 'all') result = txns.filter(t => t.category === type);
          // 按时间倒序
          result.sort((a,b) => b.created - a.created);
          return json({ ok: true, transactions: result });
        }

        // POST /api/transactions — 记录一条库存变动
        if (url.pathname === '/api/transactions' && request.method === 'POST') {
          const { category, itemId, itemName, action, change, before, after, operator, note } = await readBody(request);
          if (!category || !action) return json({ ok: false, msg: '缺少参数' });
          const raw = await env.USERS.get('transactions');
          let txns = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(txns)) txns = [];
          const txn = {
            id: Date.now(),
            category,       // 'material' | 'component' | 'board'
            itemId,         // 项目 ID
            itemName,       // 项目名称
            action,         // 'add' | 'consume' | 'edit' | 'delete' | 'create'
            change,         // 变化量（如 +5, -3, 或百分比变化）
            before,         // 变化前值
            after,          // 变化后值
            operator: operator || 'unknown',
            note: note || '',
            created: Date.now()
          };
          txns.push(txn);
          // 最多保留 500 条
          if (txns.length > 500) txns = txns.slice(-500);
          await env.USERS.put('transactions', JSON.stringify(txns));
          return json({ ok: true, transaction: txn });
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

        // ========== 文件传输 ==========
        // POST /api/upload — 上传文件（base64），返回 fileId
        if (url.pathname === '/api/upload' && request.method === 'POST') {
          const { name, size, type, data, from } = await readBody(request);
          if (!data || !name) return json({ ok: false, msg: '缺少文件数据' });
          if (size > 5 * 1024 * 1024) return json({ ok: false, msg: '文件不能超过5MB' });
          const fileId = 'file_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
          const fileRecord = { id: fileId, name, size, type, data, from: from || 'unknown', created: Date.now() };
          const raw = await env.USERS.get('files');
          let files = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(files)) files = [];
          files.push(fileRecord);
          // 最多保留 200 个文件
          if (files.length > 200) files = files.slice(-200);
          await env.USERS.put('files', JSON.stringify(files));
          return json({ ok: true, fileId, name, size });
        }

        // GET /api/download?id=xxx — 下载文件
        if (url.pathname === '/api/download' && request.method === 'GET') {
          const fileId = url.searchParams.get('id');
          if (!fileId) return json({ ok: false, msg: '缺少 id' });
          const raw = await env.USERS.get('files');
          let files = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(files)) files = [];
          const file = files.find(f => f.id === fileId);
          if (!file) return json({ ok: false, msg: '文件不存在' }, 404);
          return json({ ok: true, file });
        }

        // ========== 群组系统 ==========
        // GET /api/groups?uid=xxx — 获取用户所在群组
        if (url.pathname === '/api/groups' && request.method === 'GET') {
          const uid = url.searchParams.get('uid');
          if (!uid) return json({ ok: false, msg: '缺少 uid' });
          const raw = await env.USERS.get('groups');
          let groups = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(groups)) groups = [];
          const myGroups = groups.filter(g => g.members.includes(uid));
          return json({ ok: true, groups: myGroups });
        }

        // POST /api/groups — 创建群组
        if (url.pathname === '/api/groups' && request.method === 'POST') {
          const { name, type, creator, description } = await readBody(request);
          if (!name || !creator) return json({ ok: false, msg: '缺少参数' });
          const raw = await env.USERS.get('groups');
          let groups = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(groups)) groups = [];
          const gid = 'grp_' + Date.now();
          const group = { id: gid, name, type: type || 'normal', creator, description: description || '', members: [creator], created: Date.now() };
          groups.push(group);
          await env.USERS.put('groups', JSON.stringify(groups));
          return json({ ok: true, group });
        }

        // POST /api/groups/join — 加入群组
        if (url.pathname === '/api/groups/join' && request.method === 'POST') {
          const { gid, uid } = await readBody(request);
          if (!gid || !uid) return json({ ok: false, msg: '缺少参数' });
          const raw = await env.USERS.get('groups');
          let groups = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(groups)) groups = [];
          const group = groups.find(g => g.id === gid);
          if (!group) return json({ ok: false, msg: '群组不存在' });
          if (!group.members.includes(uid)) group.members.push(uid);
          await env.USERS.put('groups', JSON.stringify(groups));
          return json({ ok: true, group });
        }

        // POST /api/groups/leave — 离开群组
        if (url.pathname === '/api/groups/leave' && request.method === 'POST') {
          const { gid, uid } = await readBody(request);
          const raw = await env.USERS.get('groups');
          let groups = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(groups)) groups = [];
          const group = groups.find(g => g.id === gid);
          if (!group) return json({ ok: false, msg: '群组不存在' });
          group.members = group.members.filter(m => m !== uid);
          await env.USERS.put('groups', JSON.stringify(groups));
          return json({ ok: true });
        }

        // POST /api/groups/dissolve — 解散群组（仅群主）
        if (url.pathname === '/api/groups/dissolve' && request.method === 'POST') {
          const { gid, uid } = await readBody(request);
          const raw = await env.USERS.get('groups');
          let groups = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(groups)) groups = [];
          const group = groups.find(g => g.id === gid);
          if (!group) return json({ ok: false, msg: '群组不存在' });
          if (group.creator !== uid) return json({ ok: false, msg: '只有群主可以解散群组' });
          groups = groups.filter(g => g.id !== gid);
          await env.USERS.put('groups', JSON.stringify(groups));
          // 也删除群组消息
          const msgRaw = await env.USERS.get('group_messages');
          if (msgRaw) {
            let gmsgs = JSON.parse(msgRaw);
            if (Array.isArray(gmsgs)) {
              gmsgs = gmsgs.filter(m => m.gid !== gid);
              await env.USERS.put('group_messages', JSON.stringify(gmsgs));
            }
          }
          return json({ ok: true });
        }

        // GET /api/groups/search?q=xxx — 搜索群组
        if (url.pathname === '/api/groups/search' && request.method === 'GET') {
          const q = (url.searchParams.get('q') || '').toLowerCase();
          const raw = await env.USERS.get('groups');
          let groups = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(groups)) groups = [];
          const result = q ? groups.filter(g => g.name.toLowerCase().includes(q) || (g.description||'').toLowerCase().includes(q)) : groups.slice(-20);
          return json({ ok: true, groups: result });
        }

        // GET /api/groups/messages?gid=xxx — 获取群组消息
        if (url.pathname === '/api/groups/messages' && request.method === 'GET') {
          const gid = url.searchParams.get('gid');
          if (!gid) return json({ ok: false, msg: '缺少 gid' });
          const raw = await env.USERS.get('group_messages');
          let gmsgs = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(gmsgs)) gmsgs = [];
          const msgs = gmsgs.filter(m => m.gid === gid).sort((a,b) => a.created - b.created).slice(-100);
          return json({ ok: true, messages: msgs });
        }

        // POST /api/groups/messages — 发送群组消息
        if (url.pathname === '/api/groups/messages' && request.method === 'POST') {
          const { gid, from, fromName, content, fileId, fileName } = await readBody(request);
          if (!gid || !from || !content) return json({ ok: false, msg: '缺少参数' });
          const raw = await env.USERS.get('group_messages');
          let gmsgs = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(gmsgs)) gmsgs = [];
          const msg = { id: 'gm_' + Date.now(), gid, from, fromName, content, fileId, fileName, created: Date.now() };
          gmsgs.push(msg);
          if (gmsgs.length > 1000) gmsgs = gmsgs.slice(-1000);
          await env.USERS.put('group_messages', JSON.stringify(gmsgs));
          return json({ ok: true, message: msg });
        }

        // ========== 用户举报 ==========
        // POST /api/report — 提交举报
        if (url.pathname === '/api/report' && request.method === 'POST') {
          const { reporter, target, targetUid, reason, detail } = await readBody(request);
          if (!reporter || !target || !reason) return json({ ok: false, msg: '缺少参数' });
          const raw = await env.USERS.get('reports');
          let reports = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(reports)) reports = [];
          const report = { id: 'rpt_' + Date.now(), reporter, target, targetUid, reason, detail: detail || '', status: 'pending', created: Date.now() };
          reports.push(report);
          if (reports.length > 500) reports = reports.slice(-500);
          await env.USERS.put('reports', JSON.stringify(reports));
          return json({ ok: true, report });
        }

        // GET /api/report — 获取举报列表（管理员）
        if (url.pathname === '/api/report' && request.method === 'GET') {
          const raw = await env.USERS.get('reports');
          let reports = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(reports)) reports = [];
          reports.sort((a,b) => b.created - a.created);
          return json({ ok: true, reports });
        }

        // POST /api/report/handle — 处理举报（管理员）
        if (url.pathname === '/api/report/handle' && request.method === 'POST') {
          const { reportId, action, note } = await readBody(request);
          const raw = await env.USERS.get('reports');
          let reports = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(reports)) reports = [];
          const report = reports.find(r => r.id === reportId);
          if (!report) return json({ ok: false, msg: '举报不存在' });
          report.status = action; // 'resolved' | 'dismissed'
          report.handleNote = note || '';
          report.handledAt = Date.now();
          await env.USERS.put('reports', JSON.stringify(reports));
          return json({ ok: true });
        }

        // ========== 论坛系统 ==========
        // GET /api/forum — 获取帖子列表
        if (url.pathname === '/api/forum' && request.method === 'GET') {
          const raw = await env.USERS.get('forum_posts');
          let posts = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(posts)) posts = [];
          posts.sort((a,b) => b.created - a.created);
          return json({ ok: true, posts });
        }

        // POST /api/forum — 发帖
        if (url.pathname === '/api/forum' && request.method === 'POST') {
          const { author, authorUid, title, content, category } = await readBody(request);
          if (!author || !title || !content) return json({ ok: false, msg: '缺少参数' });
          const raw = await env.USERS.get('forum_posts');
          let posts = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(posts)) posts = [];
          const post = { id: 'post_' + Date.now(), author, authorUid, title, content, category: category || 'general', likes: [], views: 0, comments: [], created: Date.now() };
          posts.push(post);
          if (posts.length > 500) posts = posts.slice(-500);
          await env.USERS.put('forum_posts', JSON.stringify(posts));
          return json({ ok: true, post });
        }

        // GET /api/forum/post?id=xxx — 获取帖子详情
        if (url.pathname === '/api/forum/post' && request.method === 'GET') {
          const postId = url.searchParams.get('id');
          if (!postId) return json({ ok: false, msg: '缺少 id' });
          const raw = await env.USERS.get('forum_posts');
          let posts = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(posts)) posts = [];
          const post = posts.find(p => p.id === postId);
          if (!post) return json({ ok: false, msg: '帖子不存在' }, 404);
          post.views = (post.views || 0) + 1;
          await env.USERS.put('forum_posts', JSON.stringify(posts));
          return json({ ok: true, post });
        }

        // POST /api/forum/like — 点赞/取消点赞
        if (url.pathname === '/api/forum/like' && request.method === 'POST') {
          const { postId, uid } = await readBody(request);
          const raw = await env.USERS.get('forum_posts');
          let posts = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(posts)) posts = [];
          const post = posts.find(p => p.id === postId);
          if (!post) return json({ ok: false, msg: '帖子不存在' });
          if (!post.likes) post.likes = [];
          const idx = post.likes.indexOf(uid);
          if (idx >= 0) post.likes.splice(idx, 1);
          else post.likes.push(uid);
          await env.USERS.put('forum_posts', JSON.stringify(posts));
          return json({ ok: true, likes: post.likes });
        }

        // POST /api/forum/comment — 评论
        if (url.pathname === '/api/forum/comment' && request.method === 'POST') {
          const { postId, author, authorUid, content } = await readBody(request);
          if (!postId || !author || !content) return json({ ok: false, msg: '缺少参数' });
          const raw = await env.USERS.get('forum_posts');
          let posts = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(posts)) posts = [];
          const post = posts.find(p => p.id === postId);
          if (!post) return json({ ok: false, msg: '帖子不存在' });
          if (!post.comments) post.comments = [];
          const comment = { id: 'cmt_' + Date.now(), author, authorUid, content, created: Date.now() };
          post.comments.push(comment);
          await env.USERS.put('forum_posts', JSON.stringify(posts));
          return json({ ok: true, comment });
        }

        // DELETE /api/forum/post?id=xxx — 删除帖子
        if (url.pathname === '/api/forum/post' && request.method === 'DELETE') {
          const postId = url.searchParams.get('id');
          const raw = await env.USERS.get('forum_posts');
          let posts = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(posts)) posts = [];
          posts = posts.filter(p => p.id !== postId);
          await env.USERS.put('forum_posts', JSON.stringify(posts));
          return json({ ok: true });
        }

        return json({ ok: false, msg: 'not found' }, 404);
      } catch (e) {
        return json({ ok: false, msg: '服务器错误: ' + e.message }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
