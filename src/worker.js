/**
 * SparkMinds Lab v1.5 — Cloudflare Worker
 * API 路由 + KV 用户存储，静态资源由 Cloudflare Assets 分发
 */

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
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
          return json({ ok: true, time: Date.now(), version: 'v1.5' });

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

        return json({ ok: false, msg: 'not found' }, 404);
      } catch (e) {
        return json({ ok: false, msg: '服务器错误: ' + e.message }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
