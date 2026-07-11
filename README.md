# SparkMinds Lab v1.9 — Cloudflare Workers 版

实验室物联网监控平台，部署在 Cloudflare 边缘网络。

## v1.9 新增：用户社交系统

### 用户 UID
- 每个用户自动分配唯一 UID（10001 起）
- 管理员可在用户管理表格中查看所有用户的 UID 和昵称
- 通过 UID 可查询用户公开信息

### 个人主页
- 查看自己的账号名、UID、密码、角色、注册时间
- 自定义昵称（30 个 emoji 头像可选）
- 自定义头像

### 好友系统
- 输入 UID 搜索用户，发送好友请求
- 收到好友请求时站内信面板顶部显示通知
- 接受/拒绝好友请求
- 好友列表显示在站内信面板左侧

### 站内信
- 左侧联系人列表（好友 + 管理员），显示最后消息和未读数
- 右侧聊天窗口，支持实时收发消息（5 秒轮询）
- 消息气泡区分自己/对方/广播
- 导航栏站内信按钮显示未读消息红色徽标

### 管理员广播
- 管理员可向全体用户或指定用户群发消息
- 广播消息在聊天窗口中以黄色气泡居中显示

## 仓库结构

```
├── public/
│   └── index.html        前端页面
├── src/
│   └── worker.js         Cloudflare Worker（API 逻辑）
├── wrangler.toml         Cloudflare 配置
├── package.json          依赖与脚本
└── .gitignore
```

## API 路由

### 用户认证
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/login | 登录 |
| GET | /api/users | 获取用户列表 |
| POST | /api/users | 新增用户 |
| DELETE | /api/users?name=xxx | 删除用户 |
| PUT | /api/users | 修改密码 |

### 个人主页
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/profile?uid=xxx | 按 UID 查询用户 |
| PUT | /api/profile | 更新昵称/头像 |

### 好友系统
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/friends?uid=xxx | 获取好友列表 |
| POST | /api/friends/request | 发送好友请求 |
| POST | /api/friends/accept | 接受好友请求 |
| POST | /api/friends/reject | 拒绝好友请求 |
| GET | /api/friends/requests?uid=xxx | 获取收到的好友请求 |
| POST | /api/friends/remove | 删除好友 |

### 站内信
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/messages?uid=xxx&peerUid=yyy | 获取聊天记录 |
| POST | /api/messages | 发送私聊消息 |
| POST | /api/messages/broadcast | 管理员广播 |
| GET | /api/messages/unread?uid=xxx | 未读消息数 |
| GET | /api/messages/contacts?uid=xxx | 联系人列表 |

### 申请授权系统
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/requests | 获取申请列表 |
| POST | /api/requests | 提交申请 |
| POST | /api/requests/approve | 管理员批准 |
| POST | /api/requests/deny | 管理员拒绝 |
| GET | /api/requests/pending | 待处理数量 |

## Cloudflare Pages Git 部署配置

| 配置项 | 值 |
|--------|-----|
| Framework preset | None |
| Build command | 留空 |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` |

## 部署前必做

1. 在 Cloudflare Dashboard 创建 KV 命名空间，名称 `USERS`
2. 把返回的 namespace ID 填入 `wrangler.toml`：`id = "你的真实ID"`
3. push 代码到 GitHub

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
