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
