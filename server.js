/**
 * SparkMinds Lab — 模拟服务器 + MQTT 数据模拟器
 * 
 * 功能:
 * 1. 启动本地 HTTP 服务器 (默认 http://localhost:8080)
 * 2. 连接公共 MQTT Broker 并模拟 7 个 ESP32 设备发送传感器数据
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

// ========== HTTP SERVER ==========
const PORT = 8080;
const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.md': 'text/markdown',
};

const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
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
    console.log('[MQTT] Command received:', payload.toString());
  });
}
