/**
 * SparkMinds Lab v1.4 — 模拟服务器 + MQTT 数据模拟器 + 用户数据持久化
 * 
 * 功能:
 * 1. 启动本地 HTTP 服务器 (默认 http://localhost:8080)
 * 2. 连接公共 MQTT Broker 并模拟 7 个 ESP32 设备发送传感器数据
 * 3. 审计灯光控制命令，记录操作者与权限判定
 * 4. 用户数据服务端持久化（data/users.json），支持跨设备登录
 * 
 * 权限策略 (v1.1+):
 *   - admin 角色: 可查看数据 + 控制灯光开关 + 增删改库存
 *   - user  角色: 仅可查看数据（传感器/灯光状态/库存），禁止控制灯光与改库存
 *   - 前端已隐藏普通用户的灯光控制按钮，命令发送时附带 user/role 字段
 *   - 服务端对收到的命令做权限审计日志（ALLOWED / DENIED）
 * 
 * 数量融合 (v1.2):
 *   - 元器件/主板卡片显示的数量 = 该类别所有记录 qty 之和（不再是记录条数）
 *   - 卡片 +/- 与输入框联动 qty 总和；详情表格改任意行 qty 卡片实时刷新
 *   - 材料仍按记录条数（卷数）计，每卷有独立 remain%
 * 
 * Bug 修复 (v1.3):
 *   - getUsers() 空数组回退：localStorage 存空数组 "[]" 时恢复默认用户，避免列表永久空白
 *   - 新增用户表单密码框改为 type=password，修复明文显示
 * 
 * 用户数据持久化 (v1.4):
 *   - 用户账号存储由浏览器 localStorage 迁移到服务端 data/users.json
 *   - 提供 REST API：登录验证、用户列表、新增/删除用户
 *   - 任意设备注册的账号，其他设备均可登录（跨设备同步）
 *   - 库存数据（材料/元器件/主板）仍存浏览器 localStorage，后续版本迁移
 * 
 * REST API:
 *   POST /api/login        body:{name,pass}        → {ok:true,user} | {ok:false}
 *   GET  /api/users                                → [用户列表，不含密码]
 *   POST /api/users        body:{name,pass,role}   → {ok:true,user} | {ok:false,msg}
 *   DELETE /api/users?name=xxx                     → {ok:true} | {ok:false,msg}
 * 
 * 使用方法:
 *   node server.js
 * 
 * 依赖:
 *   npm install mqtt
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// ========== 用户数据持久化 ==========
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadUsers() {
  ensureDataDir();
  if (!fs.existsSync(USERS_FILE)) {
    const defaults = [
      { name: 'admin', pass: 'admin123', role: 'admin', created: Date.now() },
      { name: 'user', pass: 'user123', role: 'user', created: Date.now() }
    ];
    fs.writeFileSync(USERS_FILE, JSON.stringify(defaults, null, 2), 'utf-8');
    return defaults;
  }
  const raw = fs.readFileSync(USERS_FILE, 'utf-8');
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch (e) { /* 损坏则走默认 */ }
  const defaults = [
    { name: 'admin', pass: 'admin123', role: 'admin', created: Date.now() },
    { name: 'user', pass: 'user123', role: 'user', created: Date.now() }
  ];
  fs.writeFileSync(USERS_FILE, JSON.stringify(defaults, null, 2), 'utf-8');
  return defaults;
}

function saveUsers(users) {
  ensureDataDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

// 读取请求 body（JSON）
function readBody(req) {
  return new Promise((resolve) => {
    let chunks = '';
    req.on('data', c => chunks += c);
    req.on('end', () => {
      try { resolve(JSON.parse(chunks || '{}')); }
      catch (e) { resolve({}); }
    });
  });
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

// ========== HTTP SERVER ==========
const PORT = 8080;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.md': 'text/markdown',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // ---------- REST API ----------
  if (pathname.startsWith('/api/')) {
    // CORS 预检
    if (req.method === 'OPTIONS') { sendJSON(res, 204, {}); return; }

    // POST /api/login
    if (pathname === '/api/login' && req.method === 'POST') {
      const { name, pass } = await readBody(req);
      const users = loadUsers();
      const found = users.find(u => u.name === name && u.pass === pass);
      if (found) {
        const { pass: _p, ...safe } = found;
        console.log(`[API] login OK: ${name}`);
        sendJSON(res, 200, { ok: true, user: safe });
      } else {
        console.log(`[API] login FAIL: ${name}`);
        sendJSON(res, 200, { ok: false, msg: 'invalid credentials' });
      }
      return;
    }

    // GET /api/users
    if (pathname === '/api/users' && req.method === 'GET') {
      const users = loadUsers().map(({ pass, ...rest }) => rest);
      sendJSON(res, 200, { ok: true, users });
      return;
    }

    // POST /api/users
    if (pathname === '/api/users' && req.method === 'POST') {
      const { name, pass, role } = await readBody(req);
      if (!name || !pass) { sendJSON(res, 200, { ok: false, msg: 'username and password required' }); return; }
      let users = loadUsers();
      if (users.find(u => u.name === name)) { sendJSON(res, 200, { ok: false, msg: 'user already exists' }); return; }
      const newUser = { name, pass, role: role || 'user', created: Date.now() };
      users.push(newUser);
      saveUsers(users);
      console.log(`[API] user created: ${name} (${role || 'user'})`);
      const { pass: _p, ...safe } = newUser;
      sendJSON(res, 200, { ok: true, user: safe });
      return;
    }

    // DELETE /api/users?name=xxx
    if (pathname === '/api/users' && req.method === 'DELETE') {
      const name = url.searchParams.get('name');
      if (!name) { sendJSON(res, 200, { ok: false, msg: 'name required' }); return; }
      if (name === 'admin') { sendJSON(res, 200, { ok: false, msg: 'cannot delete admin' }); return; }
      let users = loadUsers();
      users = users.filter(u => u.name !== name);
      saveUsers(users);
      console.log(`[API] user deleted: ${name}`);
      sendJSON(res, 200, { ok: true });
      return;
    }

    // 未匹配的 API
    sendJSON(res, 404, { ok: false, msg: 'not found' });
    return;
  }

  // ---------- 静态文件 ----------
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mime,
      'Access-Control-Allow-Origin': '*'
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`[HTTP] Server running at http://localhost:${PORT}`);
  console.log(`[DATA] 用户数据持久化于: ${USERS_FILE}`);
  // 启动时确保用户文件存在
  loadUsers();
});

// ========== MQTT SIMULATOR ==========
let mqtt;
try {
  mqtt = require('mqtt');
} catch (e) {
  console.log('[MQTT] mqtt module not found. Skipping simulation.');
  console.log('       To enable: npm install mqtt');
}

if (mqtt) {
  const BROKER = 'ws://broker.emqx.io:8083/mqtt';
  const TOPIC = 'SparkMinds_Lab';

  const ROOMS = [
    'chuangzao', 'chuangxin', 'chuangzhi', 'chuangyi',
    'xiuxi', 'bangong', '3d'
  ];

  function rand(min, max) { return Math.random() * (max - min) + min; }
  function randInt(min, max) { return Math.floor(rand(min, max + 1)); }

  function genData(room) {
    return {
      room: room,
      temp: parseFloat(rand(22, 32).toFixed(1)),
      humi: parseFloat(rand(40, 75).toFixed(1)),
      light: randInt(100, 4095),
      aqi: randInt(0, 3),
      tvoc: randInt(50, 800),
      eco2: randInt(420, 900)
    };
  }

  const client = mqtt.connect(BROKER, {
    clientId: 'simulator_' + Math.random().toString(36).slice(2, 8),
    clean: true,
    reconnectPeriod: 5000,
  });

  client.on('connect', () => {
    console.log('[MQTT] Connected to ' + BROKER);
    console.log('[MQTT] Publishing simulated data to ' + TOPIC + ' every 4s');
  });

  client.on('error', (err) => {
    console.log('[MQTT] Error:', err.message);
  });

  setInterval(() => {
    if (!client.connected) return;
    const room = ROOMS[Math.floor(Math.random() * ROOMS.length)];
    const data = genData(room);
    client.publish(TOPIC, JSON.stringify(data));
    console.log('[MQTT] Published:', JSON.stringify(data));
  }, 4000);

  // Also listen for commands
  client.subscribe('SparkMinds_Lab/Cmd', (err) => {
    if (!err) console.log('[MQTT] Subscribed to SparkMinds_Lab/Cmd');
  });

  client.on('message', (topic, payload) => {
    let raw = payload.toString();
    console.log('[MQTT] Command received:', raw);
    // 权限审计：仅 admin 角色的灯光控制命令被允许
    try {
      const cmd = JSON.parse(raw);
      const role = cmd.role || 'unknown';
      const user = cmd.user || 'unknown';
      const allowed = role === 'admin';
      console.log(`[PERM] ${allowed ? 'ALLOWED' : 'DENIED'} | user=${user} role=${role} | room=${cmd.room} light=${cmd.light} cmd=${cmd.cmd}`);
      if (!allowed) {
        console.log(`[PERM] 拒绝非管理员用户 ${user} 的灯光控制请求 (${cmd.room} L${cmd.light} ${cmd.cmd})`);
      }
    } catch (e) {
      // 非 JSON 命令，跳过权限审计
    }
  });
}
