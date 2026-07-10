# SparkMinds Lab v1.8 — Cloudflare Workers 版

实验室物联网监控平台，部署在 Cloudflare 边缘网络。

## v1.8 更新：UI 全面优化

- 登录页：移除 ASCII art，改用渐变背景 + 现代卡片 + Logo 图标
- 配色：更柔和自然的 Tailwind 风格调色板，统一 accent/danger/success/warning 色系
- 阴影：多层次阴影系统（xs/sm/md/lg/xl），营造自然深度感
- 间距：增大卡片内边距和组件间距，提升呼吸感
- 导航：去掉终端风格 `[BRACKETS]`，改用中文标签
- 弹窗：修复未定义 CSS 变量（`--rule`/`--ink`/`--accent2`），统一 modal 样式
- 表格/按钮：统一圆角和 hover 效果，更柔和的交互反馈
- Toast 通知：改为深色背景，更醒目

## v1.7 功能：申请授权系统

普通用户无法直接修改数据（灯光控制、3D材料、元器件、主板），但可以提交授权申请，管理员收到通知后审批。

### 工作流程
1. 普通用户点击修改操作 → 自动弹出申请窗口（预填操作类型和目标）
2. 用户填写详细说明并提交
3. 管理员导航栏「审批」按钮出现红色通知徽标（每 10 秒轮询）
4. 管理员打开审批面板，查看申请详情，选择批准或拒绝
5. 用户可在「我的申请」中查看审批状态

### 申请类型
| 类型 | 说明 |
|------|------|
| material_add/edit/del | 3D材料 增/改/删 |
| comp_add/edit/del | 元器件 增/改/删 |
| board_add/edit/del | 主板 增/改/删 |
| light_control | 灯光控制 |

## 仓库结构

```
├── public/
│   └── index.html        前端页面（静态资源）
├── src/
│   └── worker.js         Cloudflare Worker（API 逻辑 + 申请授权 API）
├── wrangler.toml         Cloudflare 配置
├── package.json          依赖与脚本
└── .gitignore
```

## API 路由

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/login | 登录 |
| GET | /api/users | 获取用户列表 |
| POST | /api/users | 新增用户 |
| DELETE | /api/users?name=xxx | 删除用户 |
| PUT | /api/users | 修改密码 |
| GET | /api/requests | 获取申请列表 |
| POST | /api/requests | 提交申请 |
| POST | /api/requests/approve | 管理员批准 |
| POST | /api/requests/deny | 管理员拒绝 |
| GET | /api/requests/pending | 待处理数量（轮询） |

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

| 用户名 | 密码 | 角色 |
|--------|------|------|
| admin | admin123 | admin |
| user | user123 | user |
