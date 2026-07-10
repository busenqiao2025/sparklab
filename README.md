# SparkMinds Lab v1.5 — Cloudflare Workers 版

实验室物联网监控平台，部署在 Cloudflare 边缘网络。

## 仓库结构

```
├── public/
│   └── index.html        前端页面（静态资源）
├── src/
│   └── worker.js         Cloudflare Worker（API 逻辑）
├── wrangler.toml         Cloudflare 配置
├── package.json          依赖与脚本
└── .gitignore
```

## Cloudflare Pages Git 部署配置

在 Cloudflare Dashboard 中连接此 GitHub 仓库后，按以下配置设置：

| 配置项 | 值 |
|--------|-----|
| Framework preset | None |
| Build command | 留空（无需构建） |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` |

部署前需要：
1. 在 Cloudflare 创建 KV 命名空间，名称 `USERS`
2. 将返回的 namespace ID 填入 `wrangler.toml` 的 `id = "你的KV_NAMESPACE_ID"` 处
3. push 代码到 GitHub，Cloudflare 自动部署

## 默认账号

| 用户名 | 密码 | 角色 |
|--------|------|------|
| admin | admin123 | admin |
| user | user123 | user |
