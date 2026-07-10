/**
 * SparkMinds Lab v1.8 — Cloudflare Worker
 * API 路由 + KV 用户存储 + 申请授权系统，静态资源由 Cloudflare Assets 分发
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

const DEFAULT_USERS = [
  { name: 'admin', pass: 'admin123', role: 'admin', created: 1783588201655 },
  { name: 'user', pass: 'user123', role: 'user', created: 1783588201655 },
];

async function loadUsers(env) {
  const raw = await env.USERS.get('users');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (e) {}
  }
  await env.USERS.put('users', JSON.stringify(DEFAULT_USERS));
  return [...DEFAULT_USERS];
}

async function saveUsers(env, users) {
  await env.USERS.put('users', JSON.stringify(users));
}

function sanitize(user) {
  const { pass, ...safe } = user;
  return safe;
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
          return json({ ok: true, time: Date.now(), version: 'v1.8' });

        if (url.pathname === '/api/login' && request.method === 'POST') {
          const { name, pass } = await readBody(request);
          if (!name || !pass) return json({ ok: false, msg: '用户名和密码不能为空' });
          const users = await loadUsers(env);
          const found = users.find(u => u.name === name && u.pass === pass);
          if (found) return json({ ok: true, user: sanitize(found) });
          return json({ ok: false, msg: '用户名或密码错误' });
        }

        if (url.pathname === '/api/users' && request.method === 'GET') {
          const users = await loadUsers(env);
          // admin 请求带 ?with_pass=1 时返回密码字段，普通请求不返回
          const withPass = url.searchParams.get('with_pass') === '1';
          if (withPass) {
            return json({ ok: true, users });
          }
          return json({ ok: true, users: users.map(sanitize) });
        }

        if (url.pathname === '/api/users' && request.method === 'POST') {
          const { name, pass, role } = await readBody(request);
          if (!name || !pass) return json({ ok: false, msg: '用户名和密码不能为空' });
          const users = await loadUsers(env);
          if (users.find(u => u.name === name)) return json({ ok: false, msg: '用户已存在' });
          const newUser = { name, pass, role: role || 'user', created: Date.now() };
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

        // PUT /api/users — 修改用户密码
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

        // ========== 申请授权系统 ==========
        // GET /api/requests — 获取申请列表
        if (url.pathname === '/api/requests' && request.method === 'GET') {
          const raw = await env.USERS.get('requests');
          let requests = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(requests)) requests = [];
          return json({ ok: true, requests });
        }

        // POST /api/requests — 用户提交申请
        if (url.pathname === '/api/requests' && request.method === 'POST') {
          const { user, type, target, detail } = await readBody(request);
          if (!user || !type) return json({ ok: false, msg: '缺少必要参数' });
          const raw = await env.USERS.get('requests');
          let requests = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(requests)) requests = [];
          const newReq = {
            id: Date.now(),
            user, type,
            target: target || '',
            detail: detail || '',
            status: 'pending',
            created: Date.now(),
            reviewedBy: '',
            reviewedAt: null,
            adminNote: ''
          };
          requests.push(newReq);
          await env.USERS.put('requests', JSON.stringify(requests));
          return json({ ok: true, request: newReq });
        }

        // POST /api/requests/approve — 管理员批准
        if (url.pathname === '/api/requests/approve' && request.method === 'POST') {
          const { id, reviewer, note } = await readBody(request);
          const raw = await env.USERS.get('requests');
          let requests = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(requests)) requests = [];
          const req = requests.find(r => r.id === id);
          if (!req) return json({ ok: false, msg: '申请不存在' });
          if (req.status !== 'pending') return json({ ok: false, msg: '该申请已处理' });
          req.status = 'approved';
          req.reviewedBy = reviewer || 'admin';
          req.reviewedAt = Date.now();
          req.adminNote = note || '';
          await env.USERS.put('requests', JSON.stringify(requests));
          return json({ ok: true, request: req });
        }

        // POST /api/requests/deny — 管理员拒绝
        if (url.pathname === '/api/requests/deny' && request.method === 'POST') {
          const { id, reviewer, note } = await readBody(request);
          const raw = await env.USERS.get('requests');
          let requests = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(requests)) requests = [];
          const req = requests.find(r => r.id === id);
          if (!req) return json({ ok: false, msg: '申请不存在' });
          if (req.status !== 'pending') return json({ ok: false, msg: '该申请已处理' });
          req.status = 'denied';
          req.reviewedBy = reviewer || 'admin';
          req.reviewedAt = Date.now();
          req.adminNote = note || '';
          await env.USERS.put('requests', JSON.stringify(requests));
          return json({ ok: true, request: req });
        }

        // GET /api/requests/pending — 获取待处理数量（轮询用）
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
