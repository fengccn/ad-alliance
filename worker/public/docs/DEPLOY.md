# 部署教程（GitHub + Cloudflare 自动部署 · 分步可执行）

目标：**整套系统代码放在一个 GitHub 仓库**，通过 Cloudflare「连接 Git」实现 **push 即自动部署**。以后改代码，只需要改 GitHub 并 push，Cloudflare 自动构建发布，前后端一次更新。

全程约 30 分钟。需要：Cloudflare 账号、GitHub 账号、一个域名（建议）、装了 git 和 node 的电脑。

---

## 0. 前置准备

- 注册 [Cloudflare](https://dash.cloudflare.com/sign-up)（免费）与 [GitHub](https://github.com)（免费）。
- 本地装 Git 与 Node.js ≥ 18：
  ```bash
  git --version && node -v
  ```
- 安装 wrangler（只用于创建 D1 数据库和初始化表，可选）：
  ```bash
  npm install -g wrangler && wrangler --version
  ```

---

## 1. 项目代码结构（已按自动部署规划好）

```
ad-alliance/
├── README.md
└── worker/                       # 整个部署单元 = 一个 Cloudflare Worker
    ├── src/                      # 后端 API 代码（serve/click/register/stats/admin/risk/utils）
    ├── public/                   # 静态资源（由 Worker Static Assets 统一托管）
    │   ├── embed.js              # 参与站点嵌入代码（双栏广告位）
    │   ├── demo.html             # 嵌入演示页
    │   ├── admin/index.html      # 管理后台
    │   └── docs/architecture.html # 架构图
    ├── schema.sql                # D1 建表 SQL
    ├── wrangler.toml             # Worker 配置（含 [assets] 静态资源 + D1 + vars）
    └── package.json
```

> 说明：`public/` 下的文件（embed.js、admin、demo、架构图）由 **Workers Static Assets** 直接托管，`/api/*`、`/click/*` 等路径进入 Worker 逻辑——**一个 Worker、一个域名、一次部署**覆盖全部。

---

## 2. 把项目推到 GitHub

```bash
cd ad-alliance
git init
git add -A
git commit -m "init: 互助曝光广告联盟（双栏广告位 + 自动部署）"
git branch -M main

# 在 GitHub 上新建一个空仓库（不要勾选 README），然后：
git remote add origin https://github.com/你的用户名/ad-alliance.git
git push -u origin main
```

之后每次改动，只需：
```bash
git add -A && git commit -m "改动说明" && git push
```

---

## 3. 创建 D1 数据库并初始化表

在 `worker/` 目录执行（此时仓库已在你本地）：

```bash
cd worker
wrangler d1 create ad-alliance-db
```

输出里有 `database_id = xxxx`，复制它。

打开 `worker/wrangler.toml`，替换两处：

```toml
[[d1_databases]]
binding = "DB"
database_name = "ad-alliance-db"
database_id = "你的数据库ID"      # ← 替换

[vars]
APP_BASE = "https://ad.yourdomain.com"   # ← 你的广告域名（后面再定也行）
HASH_SALT = "一长串随机字符"              # ← 务必改强
ADMIN_TOKEN = "一长串随机密码"            # ← 务必改强
```

把改动提交并推送（D1 的 ID 只有建好库后才拿到，所以这一步要 push 一次）：

```bash
git add -A && git commit -m "config: 填写 D1 database_id 与 vars" && git push
```

然后初始化表结构（只此一次）：
```bash
wrangler d1 execute ad-alliance-db --file=./schema.sql --remote
```

看到 `Executed ... statements` 即成功。

---

## 4. 连接 Cloudflare，实现 push 自动部署

1. 打开 Cloudflare Dashboard → **Workers & Pages** → **Create application**。
2. 选 **Worker** → 下方选 **「Connect to Git」**（连接 GitHub 仓库）。
3. 授权 Cloudflare 访问你的 GitHub，选 `ad-alliance` 仓库，选分支 `main`。
4. **Build configuration**（构建配置）：
   - Root directory（根目录）：`worker`
   - Build command：留空
   - Build output：留空（Worker 用不到）
   - Entry point：`src/index.js`
   - **Compatibility date**：`2025-01-01`（或更高）
5. 确认后点 **Deploy**。Cloudflare 会自动执行 `wrangler deploy`（识别 `wrangler.toml` 中的 D1 绑定、vars 与 Static Assets）。

部署成功后，你会得到：
- Worker 域名：`https://ad-alliance.<你的账号子域>.workers.dev`
- `wrangler.toml` 里的 `APP_BASE` 建议改成这个域名，或改成你绑定的自定义域名后再次 push 生效。

> **以后改代码**：改完 `git push`，Cloudflare 在几秒内自动重新构建部署，前后端（API + 静态资源）一起更新，无需手动操作。

---

## 5. 绑定自定义域名（强烈建议）

免费版 `*.workers.dev` 已被浏览器 / 邮箱 / 部分平台标记为高滥用域名，广告跳转请务必用自域：

1. Cloudflare Dashboard → Workers & Pages → 你的 Worker → **Settings → Domains & Routes** → Add custom domain。
2. 输入 `ad.yourdomain.com`，按提示把 CNAME 指向 `ad-alliance.<账号子域>.workers.dev`（域名托管在 Cloudflare DNS 时通常自动完成）。
3. 把 `wrangler.toml` 的 `APP_BASE` 改为 `https://ad.yourdomain.com`，push 一次。

---

## 6. 验证部署（推荐先本地跑通）

本地预览（可选）：
```bash
cd worker
wrangler d1 execute ad-alliance-db --file=./schema.sql --local   # 本地建表
wrangler dev
```
访问 `http://localhost:8787/` 有健康检查 JSON；`http://localhost:8787/admin/index.html` 能看到管理后台。

线上验证接口：
```bash
# 注册两个测试站点（含自身广告 100×100 素材）
curl -X POST https://ad.yourdomain.com/api/register \
  -H 'Content-Type: application/json' \
  -d '{"site_name":"站点A","site_url":"https://a.com","contact_email":"a@a.com","image_url":"https://picsum.photos/600/200","target_url":"https://a.com/ad","self_image_url":"https://picsum.photos/200/200","self_target_url":"https://a.com"}'
# 站点B同理...

# 在管理后台把站点与广告审核为 active 后，请求双栏广告位数据
curl 'https://ad.yourdomain.com/api/embed?site_id=1'
# 返回 { self:{image_url,target_url}, partner:{ad_id,image_url,click_url} }
```

---

## 7. 给参与站点发嵌入代码

每个参与站点拿到这段代码（替换 `data-site-id`）：

```html
<script src="https://ad.yourdomain.com/embed.js"
        data-site-id="你的站点ID"
        async defer></script>
```

渲染效果（左 100×100 自身广告 + 右 300×100 随机伙伴广告）：
```
┌──────────────┬────────────────────────────────────────────┐
│  左 100×100    │          右 300×100                         │
│  本站自身广告   │      随机参与联盟站点广告                       │
└──────────────┴────────────────────────────────────────────┘
```

若 `embed.js` 部署在别的域名，给脚本加 `data-base="https://ad.yourdomain.com"` 指定 API 地址。

---

## 8. 运营流程（人工审核闭环）

部署后可直接访问三套页面（同一域名下）：

| 页面 | 路径 | 使用者 | 作用 |
| --- | --- | --- | --- |
| 申请注册 | `/join.html` | 站点会员 | 提交站点资料 + 广告素材 + 自身广告(100×100) |
| 会员自助管理 | `/member.html` | 站点会员 | 用 site_id + api_key 看数据、更新自身广告、提交新广告 |
| 管理后台 | `/admin/index.html` | 管理员 | 审核、站点管理、看板（X-Admin-Token） |

流程闭环：
1. **注册**：站点打开 `/join.html` 填表申请 → 得到 `site_id` + `api_key`。
2. **审核**：管理员在 `/admin/index.html`「待审广告」通过/驳回，「站点管理」把站点设为 `active`。
3. **上线**：站点把双栏嵌入代码放到自己页面。
4. **看数**：站点到 `/member.html` 用 `site_id + api_key` 登录看双向数据。
5. **改自身广告**：站点在 `/member.html` 随时更新左侧 100×100 素材。
6. **风控巡检**：调 `detectAnomalousSites()`（可做成定时任务）排查异常点击率站点。

---

## 9. 后续如何"改代码 → 自动部署"

所有修改都走同一流程，**前后端一起自动更新**：

| 想改什么 | 改哪里 | 效果 |
| --- | --- | --- |
| 嵌入代码样式/尺寸 | `worker/public/embed.js` | 所有站点引用同一文件，push 后全局生效 |
| 后端接口/风控逻辑 | `worker/src/*.js` | push 后自动重新部署 |
| 管理后台界面 | `worker/public/admin/index.html` | push 后自动更新 |
| 数据库字段/表 | `worker/schema.sql` | 改后需在本地 `wrangler d1 execute ... --remote` 执行迁移 |

> 注意：**Static Assets（embed.js / admin / 静态页）随 Worker 一起部署**，改了 `public/` 里的文件 push 后即刻生效，不用单独发布 Pages。

---

## 10. 常见问题

**Q：改了 GitHub 但线上没更新？**
A：确认 push 到了连接 Cloudflare 的那个分支（默认 `main`），并到 Workers 的 **Deployments** 页查看构建是否成功、有无报错。

**Q：D1 表结构没生效？**
A：schema 改动需要手动执行迁移（见第 9 节表格），自动部署只更新代码，不自动改表。

**Q：`*.workers.dev` 被拦截？**
A：绑定自定义域名（第 5 步）。广告跳转用自域是必须的。

**Q：点击没统计？**
A：确认嵌入用的是 `/api/embed` 返回的 `partner.click_url`（含 `/click/...`），而不是直接指向 `target_url`。

**Q：`/api/embed` 返回的 partner 为空？**
A：① 至少 2 个不同 active 站点；② 站点和广告都审核为 active；③ 广告不能属于请求站点自己。

---

## 安全提醒

- `ADMIN_TOKEN`、`HASH_SALT` 用强随机值，别用默认值。
- 广告图片与链接**必须人工审核**，防止钓鱼/违规内容导致你的域名被浏览器标记。
- 生产环境建议给管理后台再加一层 Cloudflare Access 保护。
