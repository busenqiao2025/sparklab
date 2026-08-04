# SparkMinds Lab v2.4 — 桌面版 + Web 版

实验室物联网监控平台，支持 Electron 桌面应用（自动更新）和 Cloudflare Workers Web 部署。

## v2.4 新增：Electron 桌面应用 + 自动更新 + KV 优化

### Electron 桌面应用
- 前端打包在本地，API 转发到 Cloudflare Worker
- 自动检测运行环境（Electron / 浏览器），动态切换 API 地址
- 窗口：1280×800，暗色主题，最小尺寸限制
- 开发模式支持 DevTools

### 自动更新
- 基于 electron-updater + GitHub Releases
- 启动后自动检查新版本，后台静默下载
- 下载进度实时 toast 提示
- 下载完成弹出对话框，一键重启安装
- 发布：`npm run publish` 自动构建 + 上传 GitHub Release

### 打包
- electron-builder NSIS 安装程序（Windows x64）
- 可选安装目录、桌面快捷方式、开始菜单
- 便携版：`npm run build:portable`

### KV 写入优化
- 心跳内存缓存：60 秒批量刷新（原来每用户每 30 秒单独写）
- 在线状态查询零 KV 消耗（内存读取）
- 删除操作合并写入（group_messages 只写一次）

### 仪表盘图表优化
- 环形图中心：种类 → 数量
- 耗材剩余率 → 耗材类型分布（按 PLA/PETG/ABS 等统计数量）

## 快速开始

### 桌面版
```powershell
npm install
npm start          # 开发运行
npm run build      # 打包成 exe
```

### Web 版
```bash
npx wrangler deploy
```

详细说明见 [桌面版使用指南.md](桌面版使用指南.md)

## 历史功能

### 消息已读回执 (v2.3)
- 聊天气泡显示 ✓（未读）/ ✓✓（已读）双勾标识
- 打开聊天自动标记对方消息为已读
- 消息轮询实时同步已读状态

### 在线状态实时显示 (v2.3)
- 30 秒心跳机制，90 秒内活跃判定为在线
- 联系人列表和聊天窗口显示绿点（在线）/灰点（离线）
- 离线状态显示最后活跃时间

### 消息搜索 (v2.3)
- 站内信面板顶部搜索栏
- 300ms 防抖触发，关键词高亮
- 搜索结果点击跳转聊天，清空恢复当前视图

### 卡片化 UI (v2.3)
- CSS Grid 卡片布局
- 请求项/库存卡片 hover 上浮动画
- 在线状态点发光效果 + 明暗主题适配

### 用户系统
- UID：5 位零填充编号（admin=00001，递增不复用）
- 个人主页：昵称、30 款 emoji 头像、自定义头像
- 好友系统：UID 搜索、好友请求、好友列表
- 多语言：简中 / 繁中 / 英文

### 站内信
- 私聊/群聊实时收发（5 秒轮询）
- 文件传输（最大 50MB，图片自动压缩，KV 分块存储）
- 管理员广播（全体/普通用户/指定 UID）
- 群组创建/加入/退出/解散

### 举报/惩罚/申诉系统
- 举报流程：用户举报 → 管理员查看聊天记录 → 处理
- 渐进式惩罚：警告 → 24h 禁言 → 30d 禁言 → 90d 禁言 → 永久禁言
- 申诉系统：用户申诉 → 管理员处理（通过/驳回）
- 处罚展示：禁言横幅、用户徽章、惩罚管理

### 实验室管理
- 传感器实时监控（温度/湿度/光照/CO₂）
- 灯光控制（仅管理员）
- 3D 打印材料管理
- 仓库元器件/主板管理
- 库存流水记录
- 数据快照/回滚 + UID 迁移工具

### UI/UX
- 毛玻璃效果（Glassmorphism）全面应用
- 明暗双主题 + B站风格切换动画
- SVG 火花星标 LOGO
- 自定义壁纸系统（9 预设 + 图片上传 + 调节滑块）
- Chart.js 数据概览仪表盘
- 卡片化布局 + 华丽动画系统

## 仓库结构

```
├── public/
│   └── index.html        前端页面（v2.3）
├── src/
│   └── worker.js         Cloudflare Worker（v2.3）
├── wrangler.toml         Cloudflare 配置
├── package.json          依赖与脚本
├── 更新日志.md            版本变更记录
├── 版本概览.md            版本总览
└── .gitignore
```

## API 路由（v2.3 新增标注 ✨）

### 用户认证
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/login | 登录 |
| GET | /api/users | 获取用户列表 |
| POST | /api/users | 新增用户 |
| DELETE | /api/users?name=xxx | 删除用户 |
| PUT | /api/users | 修改密码 |

### 站内信
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/messages?uid=&peerUid= | 获取聊天记录 |
| POST | /api/messages | 发送私聊消息 |
| POST | /api/messages/broadcast | 管理员广播 |
| GET | /api/messages/unread?uid= | 未读消息数 |
| GET | /api/messages/contacts?uid= | 联系人列表 |
| ✨ POST | /api/messages/read-receipt | 已读回执 |
| ✨ GET | /api/messages/search?uid=&q=&peerUid= | 搜索消息 |

### ✨ 在线状态（v2.3 新增）
| 方法 | 路径 | 说明 |
|------|------|------|
| ✨ POST | /api/heartbeat | 用户心跳 |
| ✨ GET | /api/online-batch?uids= | 批量查询在线状态 |

### 举报/惩罚/申诉
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/report | 提交举报 |
| GET | /api/reports | 举报列表 |
| POST | /api/report/handle | 处理举报 |
| GET | /api/report/chat-records?uid1=&uid2= | 查看聊天记录 |
| POST | /api/punishment/create | 创建惩罚 |
| GET | /api/punishments | 惩罚列表 |
| POST | /api/punishment/revoke | 撤销惩罚 |
| POST | /api/appeal/submit | 提交申诉 |
| GET | /api/appeals | 申诉列表 |
| POST | /api/appeal/handle | 处理申诉 |

## 部署

```bash
cd SparkMindsLab-v2.3
npx wrangler deploy
```

### 部署前必做
1. 在 Cloudflare Dashboard 创建 KV 命名空间，名称 `USERS`
2. 把返回的 namespace ID 填入 `wrangler.toml`：`id = "你的真实ID"`

## 默认账号

| 用户名 | 密码 | UID | 角色 |
|--------|------|-----|------|
| admin | admin123 | 00001 | admin |
| user | user123 | 00002 | user |

## KV 存储键

| 键 | 内容 |
|----|------|
| users | 用户数组（含 uid/nickname/avatar/friends） |
| messages | 站内信数组 |
| friend_requests | 好友请求数组 |
| requests | 授权申请数组 |
| reports | 举报记录数组 |
| punishments | 惩罚记录数组 |
| appeals | 申诉记录数组 |
| heartbeat_{uid} | ✨ 用户心跳（在线状态） |
| uid_counter | UID 持久化计数器 |
| file_{id} | 文件存储（<20MB 单键） |
| file_{id}_chunk_{n} | 文件分块（≥20MB） |
