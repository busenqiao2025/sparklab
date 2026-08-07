/**
 * SparkMinds Lab v2.4 — Cloudflare Worker
 * API 路由 + KV 用户存储 + 申请授权 + 用户主页 + 好友 + 站内信
 */

// ========== 在线状态内存缓存（减少 KV 写入） ==========
// Worker isolate 内共享，心跳先写内存，每 60 秒批量刷入 KV
let hbCache = null;       // { [uid]: lastSeen }
let hbFlushTime = 0;      // 上次刷新 KV 的时间
let hbDirty = false;      // 是否有未刷入的变更
const HB_FLUSH_INTERVAL = 60000;  // 刷新间隔 60 秒
const HB_ONLINE_WINDOW = 90000;   // 在线判定窗口 90 秒
const HB_EXPIRE = 300000;         // 清理超过 5 分钟无心跳的记录

async function ensureHbCache(env) {
  if (hbCache) return;
  try {
    const raw = await env.USERS.get('heartbeats');
    hbCache = raw ? JSON.parse(raw) : {};
  } catch(e) { hbCache = {}; }
  hbFlushTime = Date.now();
}

async function flushHbCache(env) {
  if (!hbCache) return;
  // 清理过期记录
  const now = Date.now();
  for (const uid in hbCache) {
    if (now - hbCache[uid] > HB_EXPIRE) delete hbCache[uid];
  }
  await env.USERS.put('heartbeats', JSON.stringify(hbCache));
  hbFlushTime = now;
  hbDirty = false;
}

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

async function genUid(env, users) {
  // 使用持久化计数器，删除用户后不回退，避免 UID 复用导致历史数据串联
  let counter = 0;
  const raw = await env.USERS.get('uid_counter');
  if (raw) { const n = parseInt(raw); if (!isNaN(n)) counter = n; }
  // 兼容历史数据：取现有用户中的最大 UID，确保新 UID 不与现存用户冲突
  let maxExisting = 0;
  for (const u of users) {
    const n = parseInt(u.uid);
    if (!isNaN(n) && n > maxExisting) maxExisting = n;
  }
  const next = Math.max(counter, maxExisting) + 1;
  await env.USERS.put('uid_counter', String(next));
  return String(next).padStart(5, '0');
}

// ========== 举报/惩罚辅助函数 ==========
async function loadReports(env) {
  const raw = await env.USERS.get('reports');
  if (raw) {
    try { const p = JSON.parse(raw); if (Array.isArray(p)) return p; } catch(e) {}
  }
  return [];
}

async function saveReports(env, reports) {
  await env.USERS.put('reports', JSON.stringify(reports));
}

async function loadPunishments(env) {
  const raw = await env.USERS.get('punishments');
  if (raw) {
    try { const p = JSON.parse(raw); if (Array.isArray(p)) return p; } catch(e) {}
  }
  return [];
}

async function savePunishments(env, punishments) {
  await env.USERS.put('punishments', JSON.stringify(punishments));
}

// 检查用户是否被禁言：permanent 永久禁言，或 mute 未过期
// 返回 { muted: false } 或 { muted: true, punishment, msg }
async function checkMuted(env, uid) {
  if (!uid) return { muted: false };
  const punishments = await loadPunishments(env);
  const now = Date.now();
  const active = punishments.find(p => p.uid === uid && p.active === true && (
    p.type === 'permanent' || (p.type === 'mute' && p.until && p.until > now)
  ));
  if (!active) return { muted: false };
  let msg;
  if (active.type === 'permanent') {
    msg = '您已被永久禁言，禁止发送消息和提交申请';
  } else {
    const remainHours = Math.ceil((active.until - now) / (1000 * 60 * 60));
    msg = `您已被禁言，剩余约 ${remainHours} 小时，禁止发送消息和提交申请`;
  }
  return { muted: true, punishment: active, msg };
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
          return json({ ok: true, time: Date.now(), version: 'v2.4' });

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
          const uid = await genUid(env, users);
          const newUser = { name, pass, role: role || 'user', uid, nickname: name, avatar: AVATARS[Math.floor(Math.random()*AVATARS.length)], friends: [], created: Date.now() };
          // 自动与 admin 建立双向好友关系
          const adminUser = users.find(u => u.role === 'admin');
          if (adminUser && adminUser.uid !== uid) {
            newUser.friends.push(adminUser.uid);
            if (!adminUser.friends) adminUser.friends = [];
            if (!adminUser.friends.includes(uid)) adminUser.friends.push(uid);
          }
          users.push(newUser);
          await saveUsers(env, users);
          return json({ ok: true, user: sanitize(newUser) });
        }

        if (url.pathname === '/api/users' && request.method === 'DELETE') {
          const name = url.searchParams.get('name');
          if (!name) return json({ ok: false, msg: '缺少 name 参数' });
          if (name === 'admin') return json({ ok: false, msg: '不能删除 admin' });
          let users = await loadUsers(env);
          const target = users.find(u => u.name === name);
          const removedUid = target ? target.uid : null;
          users = users.filter(u => u.name !== name);
          // 先从其他用户的好友列表中移除该 UID，再统一保存
          if (removedUid) {
            for (const u of users) {
              if (u.friends && u.friends.includes(removedUid)) {
                u.friends = u.friends.filter(f => f !== removedUid);
              }
            }
          }
          // 级联清理该用户的关联数据（合并写入，减少 KV put 次数）
          let cleaned = { messages: 0, groupMessages: 0, friendReqs: 0, groupsDissolved: 0 };
          let needSaveUsers = false;
          let needSaveMessages = false;
          let needSaveFriendReqs = false;
          let needSaveGroups = false;
          let needSaveGroupMsgs = false;

          if (removedUid) {
            needSaveUsers = true;
            // 1. 清理私聊消息
            let msgs = await loadMessages(env);
            const beforeMsg = msgs.length;
            msgs = msgs.filter(m => {
              if (m.broadcast) return m.to !== removedUid;
              return m.from !== removedUid && m.to !== removedUid;
            });
            cleaned.messages = beforeMsg - msgs.length;
            if (cleaned.messages > 0) { await saveMessages(env, msgs); }

            // 2. 一次性读取群消息 + 群组，合并过滤后只写一次
            let gmsgs = [];
            try {
              const gRaw = await env.USERS.get('group_messages');
              if (gRaw) gmsgs = JSON.parse(gRaw);
              if (!Array.isArray(gmsgs)) gmsgs = [];
            } catch(e) { gmsgs = []; }

            let groups = [];
            try {
              const grRaw = await env.USERS.get('groups');
              if (grRaw) groups = JSON.parse(grRaw);
              if (!Array.isArray(groups)) groups = [];
            } catch(e) { groups = []; }

            const dissolvedIds = [];
            let memberChanged = false;
            groups = groups.filter(g => {
              if (g.creator === removedUid) { dissolvedIds.push(g.id); return false; }
              if (g.members && g.members.includes(removedUid)) {
                g.members = g.members.filter(m => m !== removedUid);
                memberChanged = true;
              }
              return true;
            });
            cleaned.groupsDissolved = dissolvedIds.length;
            if (dissolvedIds.length || memberChanged) needSaveGroups = true;

            // 合并两种群消息过滤：移除该用户发的 + 解散群的消息
            const beforeG = gmsgs.length;
            gmsgs = gmsgs.filter(m => m.from !== removedUid && !dissolvedIds.includes(m.gid));
            cleaned.groupMessages = beforeG - gmsgs.length;
            if (cleaned.groupMessages > 0) needSaveGroupMsgs = true;

            // 3. 清理好友请求
            let reqs = await loadFriendReqs(env);
            const beforeR = reqs.length;
            reqs = reqs.filter(r => r.from !== removedUid && r.to !== removedUid);
            cleaned.friendReqs = beforeR - reqs.length;
            if (cleaned.friendReqs > 0) needSaveFriendReqs = true;
          }

          // 统一批量写入（最多 5 次 KV put，而非原来的 6 次+重复读）
          try {
            if (needSaveUsers) await saveUsers(env, users);
            if (needSaveFriendReqs) await saveFriendReqs(env, reqs);
            if (needSaveGroups) await env.USERS.put('groups', JSON.stringify(groups));
            if (needSaveGroupMsgs) await env.USERS.put('group_messages', JSON.stringify(gmsgs));
          } catch(e) {
            return json({ ok: false, msg: '服务器存储配额已用尽，请明天 UTC 0:00 后重试' });
          }
          return json({ ok: true, cleaned });
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

        // ========== 在线状态 ==========
        // POST /api/heartbeat — 用户心跳（内存缓存，60 秌批量刷入 KV）
        if (url.pathname === '/api/heartbeat' && request.method === 'POST') {
          const { uid } = await readBody(request);
          if (!uid) return json({ ok: false, msg: '缺少 uid' });
          await ensureHbCache(env);
          hbCache[uid] = Date.now();
          hbDirty = true;
          // 每 60 秒批量刷新一次，所有用户共用一次 KV 写入
          if (Date.now() - hbFlushTime > HB_FLUSH_INTERVAL) {
            await flushHbCache(env);
          }
          return json({ ok: true });
        }

        // GET /api/online?uid=xxx — 查询单个用户在线状态（90 秒内活跃视为在线）
        if (url.pathname === '/api/online' && request.method === 'GET') {
          const uid = url.searchParams.get('uid');
          if (!uid) return json({ ok: false, msg: '缺少 uid' });
          await ensureHbCache(env);
          const lastSeen = hbCache[uid] || null;
          const online = !!lastSeen && (Date.now() - lastSeen) <= HB_ONLINE_WINDOW;
          return json({ ok: true, online, lastSeen });
        }

        // GET /api/online-batch?uids=xxx,yyy — 批量查询在线状态（内存读取，零 KV 消耗）
        if (url.pathname === '/api/online-batch' && request.method === 'GET') {
          const uidsParam = url.searchParams.get('uids') || '';
          const uids = uidsParam.split(',').map(s => s.trim()).filter(Boolean);
          await ensureHbCache(env);
          const now = Date.now();
          const statuses = uids.map(uid => {
            const lastSeen = hbCache[uid] || null;
            const online = !!lastSeen && (now - lastSeen) <= HB_ONLINE_WINDOW;
            return { uid, online, lastSeen };
          });
          return json({ ok: true, statuses });
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

        // GET /api/messages/search?uid=xxx&q=keyword&peerUid=yyy — 搜索私聊消息
        if (url.pathname === '/api/messages/search' && request.method === 'GET') {
          const uid = url.searchParams.get('uid');
          const q = url.searchParams.get('q') || '';
          const peerUid = url.searchParams.get('peerUid');
          if (!uid) return json({ ok: false, msg: '缺少 uid' });
          if (!q) return json({ ok: false, msg: '缺少搜索关键词 q' });
          let msgs = await loadMessages(env);
          // 仅搜索与我相关的私聊消息（排除广播），且内容包含关键词
          let result = msgs.filter(m => !m.broadcast && (m.from === uid || m.to === uid) && m.content && m.content.includes(q));
          // 若指定了 peerUid，则进一步限定为与该用户的对话
          if (peerUid) {
            result = result.filter(m => (m.from === uid && m.to === peerUid) || (m.from === peerUid && m.to === uid));
          }
          // 按 created 降序，最多返回 50 条
          result = result.sort((a, b) => b.created - a.created).slice(0, 50);
          return json({ ok: true, messages: result });
        }

        // POST /api/messages — 发送私聊消息
        if (url.pathname === '/api/messages' && request.method === 'POST') {
          const { from, to, content, fileId, fileName } = await readBody(request);
          if (!from || !to) return json({ ok: false, msg: '缺少参数' });
          if (!content && !fileId) return json({ ok: false, msg: '缺少内容' });
          // 禁言检查
          const mute = await checkMuted(env, from);
          if (mute.muted) return json({ ok: false, msg: mute.msg, muted: true });
          let msgs = await loadMessages(env);
          const newMsg = { id: Date.now(), from, to, content: content || '', fileId: fileId || null, fileName: fileName || null, broadcast: false, read: false, created: Date.now() };
          msgs.push(newMsg);
          await saveMessages(env, msgs);
          return json({ ok: true, message: newMsg });
        }

        // POST /api/messages/read-receipt — 发送已读回执
        // body: { from, to, messageIds } — messageIds 可选，不传则标记该 from→to 的所有消息为已读
        if (url.pathname === '/api/messages/read-receipt' && request.method === 'POST') {
          const { from, to, messageIds } = await readBody(request);
          if (!from || !to) return json({ ok: false, msg: '缺少参数' });
          let msgs = await loadMessages(env);
          const now = Date.now();
          let changed = false;
          // messageIds 可为数组、单值或不传；不传则标记 from→to 的全部消息
          let idSet = null;
          if (Array.isArray(messageIds)) idSet = new Set(messageIds);
          else if (messageIds) idSet = new Set([messageIds]);
          for (const m of msgs) {
            if (m.from === from && m.to === to) {
              if (!idSet || idSet.has(m.id)) {
                m.readAt = now;
                m.read = true;
                changed = true;
              }
            }
          }
          if (changed) await saveMessages(env, msgs);
          return json({ ok: true });
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
          // 加上管理员（如果当前用户不是管理员）— 自动修复双向好友关系
          if (user && user.role !== 'admin') {
            const admin = users.find(u => u.role === 'admin');
            if (admin && admin.uid !== uid) {
              // 如果用户没有 admin 好友，自动补上双向关系
              let needSave = false;
              if (!user.friends) { user.friends = []; needSave = true; }
              if (!user.friends.includes(admin.uid)) { user.friends.push(admin.uid); needSave = true; }
              if (!admin.friends) { admin.friends = []; needSave = true; }
              if (!admin.friends.includes(uid)) { admin.friends.push(uid); needSave = true; }
              if (needSave) await saveUsers(env, users);
              // 如果 admin 不在联系人列表中（没有聊天记录），则添加
              if (!contacts.find(c => c.uid === admin.uid)) {
                const aMsgs = msgs.filter(m => (m.from === uid && m.to === admin.uid) || (m.from === admin.uid && m.to === uid));
                const lastMsg = aMsgs.sort((a,b) => b.created - a.created)[0];
                const unread = aMsgs.filter(m => m.to === uid && !m.read).length;
                contacts.unshift({ uid: admin.uid, name: admin.name, nickname: admin.nickname, avatar: admin.avatar, lastMsg: lastMsg ? lastMsg.content : '', lastTime: lastMsg ? lastMsg.created : 0, unread, isAdmin: true });
              }
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

        // ========== UID 迁移（一次性运维操作） ==========
        // POST /api/migrate-uids — 重新分配所有用户 UID（admin 固定 00001，其余按创建时间顺延）
        // 并重映射消息/群组/好友请求中的 UID 引用，设置 uid_counter 防止未来复用
        if (url.pathname === '/api/migrate-uids' && request.method === 'POST') {
          const { operator } = await readBody(request);
          const users = await loadUsers(env);
          // 鉴权：仅 admin 可执行
          const opUser = users.find(u => u.name === operator || u.uid === operator);
          if (!opUser || opUser.role !== 'admin') return json({ ok: false, msg: '仅管理员可执行 UID 迁移' });
          // 1. 读取全部相关数据
          const messages = await loadMessages(env);
          let groupMsgs = []; const gmRaw = await env.USERS.get('group_messages');
          try { if (gmRaw) { const p = JSON.parse(gmRaw); if (Array.isArray(p)) groupMsgs = p; } } catch(e) {}
          let groups = []; const grRaw = await env.USERS.get('groups');
          try { if (grRaw) { const p = JSON.parse(grRaw); if (Array.isArray(p)) groups = p; } } catch(e) {}
          let friendReqs = await loadFriendReqs(env);
          // 2. 迁移前完整快照（含 groups/group_messages/friend_requests，比普通备份更全）
          const snapshot = {
            id: Date.now(), created: Date.now(), operator: opUser.name,
            note: 'UID 迁移前自动备份', type: 'auto',
            data: {
              users: JSON.parse(JSON.stringify(users)),
              messages: JSON.parse(JSON.stringify(messages)),
              requests: (await env.USERS.get('requests')) ? JSON.parse(await env.USERS.get('requests')) : [],
              groups: JSON.parse(JSON.stringify(groups)),
              group_messages: JSON.parse(JSON.stringify(groupMsgs)),
              friend_requests: JSON.parse(JSON.stringify(friendReqs)),
            }
          };
          const bkRaw = await env.USERS.get('backups');
          let backups = bkRaw ? JSON.parse(bkRaw) : [];
          if (!Array.isArray(backups)) backups = [];
          backups.push(snapshot);
          if (backups.length > 30) backups = backups.slice(-30);
          await env.USERS.put('backups', JSON.stringify(backups));
          // 3. 构建 oldUid -> newUid 映射：admin=00001，其余按 created 升序
          const adminUser = users.find(u => u.role === 'admin') || users.find(u => u.name === 'admin');
          const others = users.filter(u => u !== adminUser);
          others.sort((a, b) => (a.created || 0) - (b.created || 0) || (parseInt(a.uid) - parseInt(b.uid)));
          const uidMap = {};
          let seq = 1;
          if (adminUser) { uidMap[adminUser.uid] = String(seq).padStart(5, '0'); seq++; }
          for (const u of others) { uidMap[u.uid] = String(seq).padStart(5, '0'); seq++; }
          const remap = (uid) => uidMap[uid] || uid; // 未在映射中的孤儿 UID 保持原值
          // 4. 重映射 users
          let changedUsers = 0;
          for (const u of users) {
            if (uidMap[u.uid] && uidMap[u.uid] !== u.uid) changedUsers++;
            u.uid = remap(u.uid);
            if (Array.isArray(u.friends)) u.friends = u.friends.map(remap);
          }
          // 5. 重映射 messages（私聊 from/to；广播副本 to=具体UID 也重映射，to='all'/'all_users' 保留）
          let changedMsgs = 0;
          for (const m of messages) {
            const of = m.from, ot = m.to;
            m.from = remap(m.from);
            if (m.to !== 'all' && m.to !== 'all_users' && m.to !== 'all_including_admin') m.to = remap(m.to);
            if (m.from !== of || m.to !== ot) changedMsgs++;
          }
          // 6. 重映射 group_messages（from）
          let changedGm = 0;
          for (const m of groupMsgs) { const of = m.from; m.from = remap(m.from); if (m.from !== of) changedGm++; }
          // 7. 重映射 groups（creator + members）
          let changedGroups = 0;
          for (const g of groups) {
            const oc = g.creator;
            g.creator = remap(g.creator);
            if (Array.isArray(g.members)) g.members = g.members.map(remap);
            if (g.creator !== oc) changedGroups++;
          }
          // 8. 重映射 friend_requests（from/to）
          let changedReqs = 0;
          for (const r of friendReqs) {
            const of = r.from, ot = r.to;
            r.from = remap(r.from); r.to = remap(r.to);
            if (r.from !== of || r.to !== ot) changedReqs++;
          }
          // 9. 写回全部数据
          await saveUsers(env, users);
          await saveMessages(env, messages);
          await env.USERS.put('group_messages', JSON.stringify(groupMsgs));
          await env.USERS.put('groups', JSON.stringify(groups));
          await saveFriendReqs(env, friendReqs);
          // 10. 设置 uid_counter = 当前最大 UID，确保未来新建用户 UID 永远递增不复用
          let maxUid = 0;
          for (const u of users) { const n = parseInt(u.uid); if (!isNaN(n) && n > maxUid) maxUid = n; }
          await env.USERS.put('uid_counter', String(maxUid));
          return json({ ok: true, migrated: true, mapping: uidMap, summary: {
            users: users.length, changedUsers, messages: messages.length, changedMsgs,
            groupMessages: groupMsgs.length, changedGm, groups: groups.length, changedGroups,
            friendRequests: friendReqs.length, changedReqs, uidCounter: maxUid,
            backupId: snapshot.id
          }});
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
          // 禁言检查：user 可能是用户名或 UID，统一解析为 UID
          let _reqUid = user;
          if (!/^\d{5}$/.test(user)) {
            const _users = await loadUsers(env);
            const _u = _users.find(u => u.name === user);
            if (_u) _reqUid = _u.uid;
          }
          if (_reqUid) {
            const _mute = await checkMuted(env, _reqUid);
            if (_mute.muted) return json({ ok: false, msg: _mute.msg, muted: true });
          }
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

        // ========== 文件传输（分块存储，支持大文件） ==========
        // POST /api/upload — 上传文件（base64），返回 fileId
        if (url.pathname === '/api/upload' && request.method === 'POST') {
          const body = await readBody(request);
          const { name, size, type, data, from } = body;
          if (!data || !name) return json({ ok: false, msg: '缺少文件数据（可能请求体过大被截断）' });
          if (size > 50 * 1024 * 1024) return json({ ok: false, msg: '文件不能超过50MB' });
          const fileId = 'file_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
          const meta = { id: fileId, name, size, type, from: from || 'unknown', created: Date.now() };
          // KV 单值上限 25MB；JSON.stringify 后 base64 数据约膨胀 1.33x
          // 超过 20MB 则分块存储，每块 10MB
          const dataLen = typeof data === 'string' ? data.length : 0;
          if (dataLen < 20 * 1024 * 1024) {
            // 小文件：单键存储
            const fileRecord = { ...meta, data };
            try {
              await env.USERS.put('file_' + fileId, JSON.stringify(fileRecord));
            } catch(e) {
              return json({ ok: false, msg: '文件存储失败：' + e.message });
            }
          } else {
            // 大文件：分块存储
            const chunkSize = 10 * 1024 * 1024;
            const numChunks = Math.ceil(dataLen / chunkSize);
            meta.chunked = true;
            meta.numChunks = numChunks;
            try {
              // 先存元数据（不含 data）
              await env.USERS.put('file_' + fileId, JSON.stringify(meta));
              // 逐块存储
              for (let i = 0; i < numChunks; i++) {
                const chunk = data.slice(i * chunkSize, (i + 1) * chunkSize);
                await env.USERS.put('file_' + fileId + '_chunk_' + i, chunk);
              }
            } catch(e) {
              // 清理已写入的块
              for (let i = 0; i < numChunks; i++) {
                try { await env.USERS.delete('file_' + fileId + '_chunk_' + i); } catch(_) {}
              }
              try { await env.USERS.delete('file_' + fileId); } catch(_) {}
              return json({ ok: false, msg: '文件存储失败（分块）：' + e.message });
            }
          }
          // 更新文件索引列表（仅元信息）
          const idxRaw = await env.USERS.get('file_index');
          let idx = idxRaw ? JSON.parse(idxRaw) : [];
          if (!Array.isArray(idx)) idx = [];
          idx.push({ id: fileId, name, size, type, from: from || 'unknown', created: meta.created });
          if (idx.length > 500) idx = idx.slice(-500);
          await env.USERS.put('file_index', JSON.stringify(idx));
          return json({ ok: true, fileId, name, size });
        }

        // GET /api/download?id=xxx — 下载文件
        if (url.pathname === '/api/download' && request.method === 'GET') {
          const fileId = url.searchParams.get('id');
          if (!fileId) return json({ ok: false, msg: '缺少 id' });
          // 优先从独立 KV 键读取
          const raw = await env.USERS.get('file_' + fileId);
          if (raw) {
            try {
              const file = JSON.parse(raw);
              // 分块文件：逐块读取并拼接
              if (file.chunked && file.numChunks) {
                let data = '';
                for (let i = 0; i < file.numChunks; i++) {
                  const chunk = await env.USERS.get('file_' + fileId + '_chunk_' + i);
                  if (chunk !== null) data += chunk;
                }
                return json({ ok: true, file: { ...file, data, chunked: false, numChunks: undefined } });
              }
              return json({ ok: true, file });
            } catch(e) {}
          }
          // 兼容旧数据：从聚合 'files' 键中查找
          const oldRaw = await env.USERS.get('files');
          if (oldRaw) {
            try {
              let files = JSON.parse(oldRaw);
              if (Array.isArray(files)) {
                const file = files.find(f => f.id === fileId);
                if (file) return json({ ok: true, file });
              }
            } catch(e) {}
          }
          return json({ ok: false, msg: '文件不存在' }, 404);
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
          if (!gid || !from) return json({ ok: false, msg: '缺少参数' });
          if (!content && !fileId) return json({ ok: false, msg: '缺少内容' });
          // 禁言检查
          const mute = await checkMuted(env, from);
          if (mute.muted) return json({ ok: false, msg: mute.msg, muted: true });
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
          const { reporter, reporterUid, target, targetUid, reason, detail } = await readBody(request);
          if (!reporter || !target || !reason) return json({ ok: false, msg: '缺少参数' });
          let reports = await loadReports(env);
          const report = { id: 'rpt_' + Date.now(), reporter, reporterUid: reporterUid || '', target, targetUid: targetUid || '', reason, detail: detail || '', status: 'pending', created: Date.now(), offenseCount: 0 };
          reports.push(report);
          if (reports.length > 500) reports = reports.slice(-500);
          await saveReports(env, reports);
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

        // POST /api/report/handle — 处理举报（管理员），resolved 时按累计次数自动生成惩罚
        if (url.pathname === '/api/report/handle' && request.method === 'POST') {
          const { reportId, action, note, muteDuration } = await readBody(request);
          if (!reportId || !action) return json({ ok: false, msg: '缺少参数' });
          if (action !== 'resolved' && action !== 'dismissed') return json({ ok: false, msg: '无效的处理动作' });
          let reports = await loadReports(env);
          const report = reports.find(r => r.id === reportId);
          if (!report) return json({ ok: false, msg: '举报不存在' });
          if (report.status !== 'pending') return json({ ok: false, msg: '该举报已处理' });
          report.status = action;
          report.handleNote = note || '';
          report.handledAt = Date.now();
          // resolved 时根据累计次数自动确定惩罚级别
          if (action === 'resolved') {
            const targetUid = report.targetUid;
            if (targetUid) {
              // 累计 resolved 举报次数（含本次，此时 report.status 已置为 resolved）
              const offenseCount = reports.filter(r => r.targetUid === targetUid && r.status === 'resolved').length;
              report.offenseCount = offenseCount;
              // 根据次数确定惩罚级别
              let pType, duration, until;
              if (offenseCount === 1) {
                pType = 'warning'; duration = 0; until = 0;
              } else if (offenseCount === 2) {
                pType = 'mute';
                duration = parseInt(muteDuration) > 0 ? parseInt(muteDuration) : 24;
                until = Date.now() + duration * 3600 * 1000;
              } else if (offenseCount === 3) {
                pType = 'mute';
                const md = parseInt(muteDuration) > 0 ? parseInt(muteDuration) : 720;
                duration = Math.max(md, 720);
                until = Date.now() + duration * 3600 * 1000;
              } else if (offenseCount === 4) {
                pType = 'mute';
                const md = parseInt(muteDuration) > 0 ? parseInt(muteDuration) : 2160;
                duration = Math.max(md, 2160);
                until = Date.now() + duration * 3600 * 1000;
              } else {
                pType = 'permanent'; duration = 0; until = 0;
              }
              const punishment = {
                id: 'pn_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                uid: targetUid,
                type: pType,
                duration,
                reason: report.reason || '',
                until,
                createdAt: Date.now(),
                active: true,
                reportId: report.id
              };
              let punishments = await loadPunishments(env);
              punishments.push(punishment);
              if (punishments.length > 1000) punishments = punishments.slice(-1000);
              await savePunishments(env, punishments);
              // 在举报上记录惩罚信息
              report.punishment = {
                type: pType,
                duration,
                reason: punishment.reason,
                until,
                createdAt: punishment.createdAt
              };
            }
          }
          await saveReports(env, reports);
          return json({ ok: true, report });
        }

        // GET /api/report/chat-records?uid1=xxx&uid2=yyy — 查看两用户间私聊记录（管理员）
        if (url.pathname === '/api/report/chat-records' && request.method === 'GET') {
          const uid1 = url.searchParams.get('uid1');
          const uid2 = url.searchParams.get('uid2');
          if (!uid1 || !uid2) return json({ ok: false, msg: '缺少参数' });
          let msgs = await loadMessages(env);
          const records = msgs.filter(m => !m.broadcast && (
            (m.from === uid1 && m.to === uid2) || (m.from === uid2 && m.to === uid1)
          )).sort((a, b) => a.created - b.created);
          return json({ ok: true, messages: records });
        }

        // POST /api/report/appeal — 用户提交申诉
        if (url.pathname === '/api/report/appeal' && request.method === 'POST') {
          const { reportId, uid, content } = await readBody(request);
          if (!reportId || !uid || !content) return json({ ok: false, msg: '缺少参数' });
          let reports = await loadReports(env);
          const report = reports.find(r => r.id === reportId);
          if (!report) return json({ ok: false, msg: '举报不存在' });
          if (report.targetUid !== uid) return json({ ok: false, msg: '只有被举报者可以申诉' });
          if (!report.punishment) return json({ ok: false, msg: '该举报未产生惩罚，无需申诉' });
          if (report.appeal && report.appeal.status === 'pending') return json({ ok: false, msg: '已提交申诉，等待处理' });
          report.appeal = { content, status: 'pending', adminReply: '', createdAt: Date.now() };
          await saveReports(env, reports);
          return json({ ok: true, appeal: report.appeal });
        }

        // GET /api/report/appeals — 获取待处理申诉列表（管理员）
        if (url.pathname === '/api/report/appeals' && request.method === 'GET') {
          let reports = await loadReports(env);
          const appeals = reports.filter(r => r.appeal && r.appeal.status === 'pending');
          appeals.sort((a, b) => (a.appeal.createdAt || 0) - (b.appeal.createdAt || 0));
          return json({ ok: true, reports: appeals });
        }

        // POST /api/report/appeal/handle — 管理员处理申诉
        if (url.pathname === '/api/report/appeal/handle' && request.method === 'POST') {
          const { reportId, action, adminReply, newReason, revokePunishment } = await readBody(request);
          if (!reportId || !action) return json({ ok: false, msg: '缺少参数' });
          if (action !== 'accepted' && action !== 'rejected') return json({ ok: false, msg: '无效的处理动作' });
          let reports = await loadReports(env);
          const report = reports.find(r => r.id === reportId);
          if (!report) return json({ ok: false, msg: '举报不存在' });
          if (!report.appeal || report.appeal.status !== 'pending') return json({ ok: false, msg: '该举报没有待处理的申诉' });
          report.appeal.status = action;
          report.appeal.adminReply = adminReply || '';
          report.appeal.handledAt = Date.now();
          // 申诉通过：可修改惩罚原因 或 撤销当前惩罚
          if (action === 'accepted') {
            let punishments = await loadPunishments(env);
            let pChanged = false;
            const p = punishments.find(x => x.reportId === reportId && x.active === true);
            if (newReason) {
              report.punishment = report.punishment || {};
              report.punishment.reason = newReason;
              if (p) { p.reason = newReason; pChanged = true; }
            }
            if (revokePunishment && p) {
              p.active = false;
              p.revokedAt = Date.now();
              pChanged = true;
              if (report.punishment) report.punishment.revoked = true;
            }
            if (pChanged) await savePunishments(env, punishments);
          }
          await saveReports(env, reports);
          return json({ ok: true, report });
        }

        // ========== 惩罚记录系统 ==========
        // GET /api/punishments — 管理员查看所有有效惩罚；?uid=xxx 查看指定用户当前有效惩罚；?uid=xxx&all=1 查看全部历史
        if (url.pathname === '/api/punishments' && request.method === 'GET') {
          const uid = url.searchParams.get('uid');
          const showAll = url.searchParams.get('all') === '1';
          let punishments = await loadPunishments(env);
          const now = Date.now();
          // 自动过期清理：将已过期的 mute 标记为 inactive
          let changed = false;
          for (const p of punishments) {
            if (p.active === true && p.type === 'mute' && p.until && p.until <= now) {
              p.active = false; p.expiredAt = now; changed = true;
            }
          }
          if (changed) await savePunishments(env, punishments);
          let result;
          if (uid) {
            result = showAll ? punishments.filter(p => p.uid === uid) : punishments.filter(p => p.uid === uid && p.active === true);
          } else {
            result = punishments.filter(p => p.active === true);
          }
          result.sort((a, b) => b.createdAt - a.createdAt);
          return json({ ok: true, punishments: result });
        }

        // POST /api/punishments/revoke — 管理员撤销惩罚
        if (url.pathname === '/api/punishments/revoke' && request.method === 'POST') {
          const { uid, punishmentId } = await readBody(request);
          if (!uid || !punishmentId) return json({ ok: false, msg: '缺少参数' });
          let punishments = await loadPunishments(env);
          const p = punishments.find(x => x.id === punishmentId && x.uid === uid);
          if (!p) return json({ ok: false, msg: '惩罚记录不存在' });
          if (!p.active) return json({ ok: false, msg: '该惩罚已失效' });
          p.active = false;
          p.revokedAt = Date.now();
          await savePunishments(env, punishments);
          return json({ ok: true, punishment: p });
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

        // ========== 库存数据同步 ==========
        // GET /api/inventory — 获取库存（materials/components/boards）
        if (url.pathname === '/api/inventory' && request.method === 'GET') {
          const type = url.searchParams.get('type') || 'all';
          const result = {};
          if (type === 'all' || type === 'materials') {
            const raw = await env.USERS.get('inventory_materials');
            result.materials = raw ? JSON.parse(raw) : [];
          }
          if (type === 'all' || type === 'components') {
            const raw = await env.USERS.get('inventory_components');
            result.components = raw ? JSON.parse(raw) : [];
          }
          if (type === 'all' || type === 'boards') {
            const raw = await env.USERS.get('inventory_boards');
            result.boards = raw ? JSON.parse(raw) : [];
          }
          return json({ ok: true, ...result });
        }

        // PUT /api/inventory — 保存库存（body: { type, data }）
        if (url.pathname === '/api/inventory' && request.method === 'PUT') {
          const { type, data } = await readBody(request);
          if (!['materials', 'components', 'boards'].includes(type)) {
            return json({ ok: false, msg: '无效的库存类型' });
          }
          await env.USERS.put('inventory_' + type, JSON.stringify(data));
          return json({ ok: true });
        }

        // ========== 公告与更新日志 ==========
        // GET /api/notice — 获取公告和更新日志（公开接口，登录页可用）
        if (url.pathname === '/api/notice' && request.method === 'GET') {
          const annRaw = await env.USERS.get('announcement');
          const logRaw = await env.USERS.get('changelog');
          let announcements = [];
          let changelogs = [];
          if (annRaw) {
            const parsed = JSON.parse(annRaw);
            announcements = Array.isArray(parsed) ? parsed : [{ id: 1, title: '', content: parsed.content || '', updated: parsed.updated || 0, author: parsed.author || '' }];
          }
          if (logRaw) {
            const parsed = JSON.parse(logRaw);
            changelogs = Array.isArray(parsed) ? parsed : [{ id: 1, title: '', content: parsed.content || '', updated: parsed.updated || 0, author: parsed.author || '' }];
          }
          return json({ ok: true, announcements, changelogs });
        }

        // PUT /api/notice — 增删改公告或更新日志（仅管理员）
        if (url.pathname === '/api/notice' && request.method === 'PUT') {
          const { uid, type, action, item } = await readBody(request);
          if (!uid || !type || !action) return json({ ok: false, msg: '缺少参数' });
          if (!['announcement', 'changelog'].includes(type)) return json({ ok: false, msg: '无效的类型' });
          if (!['add', 'update', 'delete', 'reorder'].includes(action)) return json({ ok: false, msg: '无效的操作' });
          const users = await loadUsers(env);
          const user = users.find(u => u.uid === uid);
          if (!user || user.role !== 'admin') return json({ ok: false, msg: '仅管理员可修改' });
          const key = type;
          const raw = await env.USERS.get(key);
          let list = [];
          if (raw) {
            const parsed = JSON.parse(raw);
            list = Array.isArray(parsed) ? parsed : [{ id: 1, title: '', content: parsed.content || '', updated: parsed.updated || 0, author: parsed.author || '' }];
          }
          if (action === 'add') {
            const newItem = { id: Date.now(), title: (item && item.title) || '', content: (item && item.content) || '', updated: Date.now(), author: user.name, pinned: !!(item && item.pinned) };
            list.unshift(newItem);
          } else if (action === 'update') {
            if (!item || !item.id) return json({ ok: false, msg: '缺少 item.id' });
            const idx = list.findIndex(x => x.id === item.id);
            if (idx === -1) return json({ ok: false, msg: '条目不存在' });
            list[idx] = { ...list[idx], title: item.title ?? list[idx].title, content: item.content ?? list[idx].content, pinned: item.pinned ?? list[idx].pinned, updated: Date.now(), author: user.name };
          } else if (action === 'delete') {
            if (!item || !item.id) return json({ ok: false, msg: '缺少 item.id' });
            list = list.filter(x => x.id !== item.id);
          } else if (action === 'reorder') {
            if (!item || !Array.isArray(item.ids)) return json({ ok: false, msg: '缺少 item.ids' });
            const map = new Map(list.map(x => [x.id, x]));
            list = item.ids.map(id => map.get(id)).filter(Boolean);
          }
          await env.USERS.put(key, JSON.stringify(list));
          return json({ ok: true, list });
        }

        return json({ ok: false, msg: 'not found' }, 404);
      } catch (e) {
        return json({ ok: false, msg: '服务器错误: ' + e.message }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
