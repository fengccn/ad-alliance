# 互助曝光广告联盟（Ad Alliance）

一套**轻量自托管**的互助曝光广告联盟平台。每个参与站点既是广告主（提供图片+链接），也是发布商（展示别人的广告）。

**双栏广告位**：访客打开你的页面，会看到
- **左侧 100×100** — 联盟站点自身的广告图 + 链接（指向自己）
- **右侧 300×100** — 随机一个参与联盟站点的广告（点击经服务器统计跳转）

双方互相导流、互相统计。

技术栈：**Cloudflare Workers + D1（SQLite）+ Workers Static Assets**，无第三方依赖，免费额度足够。
**部署方式**：代码托管在 **GitHub**，通过 **Cloudflare「连接 Git」** 实现 **push 即自动部署**——以后改代码只需改 GitHub。

---

## 双栏广告位渲染效果

```
访客打开站点 A 页面
      │
      ▼
嵌入 JS 请求 GET /api/embed?site_id=A   （一次请求，返回左右两块数据）
      │
      ▼
┌──────────────┬────────────────────────────────────────────┐
│  左 100×100    │          右 300×100                         │
│  本站自身广告   │     随机参与联盟站点广告                        │
│  (sites.self_*)│     (公平调度 + 点击经 /click 中转统计)        │
└──────────────┴────────────────────────────────────────────┘
```

> **关键点**：右侧伙伴广告的 `click_url` 必须经过服务器（`/click/...`）中转，否则无法统计每个站点带来的曝光和点击。左侧自身广告直链本站，无需中转。

---

## 目录结构

```
ad-alliance/
├── README.md
└── worker/                       # 整个部署单元 = 一个 Cloudflare Worker
    ├── src/                      # 后端 API（index 路由 + serve/click/register/stats/admin/risk/utils）
    ├── public/                   # 静态资源（Workers Static Assets 统一托管）
    │   ├── embed.js              # 参与站点嵌入代码（双栏广告位）
    │   ├── join.html             # 站点会员申请注册页
    │   ├── member.html           # 站点会员自助管理页
    │   ├── demo.html             # 嵌入演示页
    │   ├── admin/index.html      # 管理后台（管理员：审核/站点/看板）
    │   └── docs/                 # architecture.html（架构图）、DEPLOY.md（部署教程）
    ├── schema.sql                # D1 建表 SQL
    ├── wrangler.toml             # Worker 配置（[assets] + D1 + vars）
    └── package.json
```

---

## 数据库（五张核心表）

| 表 | 作用 | 关键字段 |
| --- | --- | --- |
| `sites` | 站点（既是广告主也是发布商） | id, site_name, site_url, contact_email, api_key, status, daily_cap, **self_image_url, self_target_url** |
| `ads` | 广告 | id, site_id, image_url, target_url, status, weight |
| `impressions` | 曝光日志 | ad_id, site_id, ip_hash, created_at |
| `clicks` | 点击日志 | ad_id, site_id, ip_hash, user_agent, created_at |
| `stats_daily` | 每日统计（可选物化表） | date, site_id, counts |

> `sites.self_image_url` / `self_target_url` 存储左侧 100×100 自身广告素材。
> 隐私设计：日志**只存 `ip_hash`**（SHA-256 + 盐），不存原始 IP。

---

## API 一览

| 接口 | 方法 | 鉴权 | 作用 |
| --- | --- | --- | --- |
| `/api/embed?site_id=X` | GET | 站点需 active | 双栏广告位数据（self + partner），一次返回 |
| `/api/serve?site_id=X` | GET | 站点需 active | 单条随机广告（兼容/备用） |
| `/click/:ad_id/:site_id` | GET | 无 | 记录点击，返回延迟跳转页 |
| `/api/register` | POST | 无 | 站点注册 + 广告素材 + 自身广告(100×100) |
| `/api/self` | POST | `api_key` | 更新自身广告素材（左侧 100×100） |
| `/api/ads` | POST | `api_key` | 已激活站点提交新广告 |
| `/api/stats?site_id=X&api_key=K` | GET | `api_key` | 站点自助统计（双向） |
| `/admin/api/*` | - | `X-Admin-Token` | 审核 / 站点管理 / 数据看板 |

---

## 风控与公平性（已在代码中实现）

1. **曝光防刷**：同一 `ip_hash` 对同一站点，**1 分钟**内只记一次有效曝光。
2. **点击防刷**：同一 IP 对同一广告，**5 分钟**内只计一次；点击跳转用 **HTML 延迟跳转页**（非裸 302）过滤脚本。
3. **人工审核**：所有站点和广告提交后为 `pending`，审核通过才 `active`。
4. **公平随机**：伙伴广告池排除本站；按 `weight × 冷启动加权` 加权随机。
5. **每日配额**：每站点广告每天最多被展示 `daily_cap` 次，防大户 / 马甲垄断。
6. **冷启动加权**：新站（默认 7 天内）权重 ×1.5。
7. **异常检测**：`detectAnomalousSites()` 检测"曝光正常但点击率 > 10%"的站点，可做成定时任务。

---

## 快速开始

完整分步部署见 **[worker/public/docs/DEPLOY.md](worker/public/docs/DEPLOY.md)**。核心流程：

```bash
# 1) 推送到 GitHub
cd ad-alliance && git init && git add -A && git commit -m "init" && git push

# 2) 创建 D1 并初始化表（本地执行一次）
cd worker
wrangler d1 create ad-alliance-db
# 把 database_id 填进 wrangler.toml 并 push
wrangler d1 execute ad-alliance-db --file=./schema.sql --remote

# 3) Cloudflare → Workers & Pages → Create → Worker → Connect to Git
#    Root directory = worker，连接后 push 即自动部署
```

## 三套页面（部署后即可访问）

| 页面 | 路径 | 使用者 | 作用 |
| --- | --- | --- | --- |
| 申请注册 | `/join.html` | 站点会员 | 提交站点资料 + 广告素材 + 自身广告(100×100)，申请加入 |
| 会员自助管理 | `/member.html` | 站点会员 | 用 site_id + api_key 登录，看双向数据、更新自身广告、提交新广告 |
| 管理后台 | `/admin/index.html` | 管理员 | 审核广告/站点、调每日上限、看全局看板（X-Admin-Token） |

之后把 `embed.js` 提供给参与站点引入即可。
