-- ============================================================
-- 互助曝光广告联盟 · Cloudflare D1 (SQLite) 数据库 Schema
-- 适用数据库：Cloudflare D1（兼容 SQLite 语法）
-- 共五张核心表 + 必要索引
-- ============================================================

-- ------------------------------------------------------------
-- 1) 站点表 sites
--    每个参与站点既可作为发布商展示别人的广告，也可作为广告主
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sites (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,          -- 站点唯一标识（嵌入 JS 时传入）
  site_name        TEXT    NOT NULL,                           -- 站点名称
  site_url         TEXT    NOT NULL,                           -- 站点网址
  contact_email    TEXT    NOT NULL,                           -- 联系邮箱
  api_key          TEXT    NOT NULL UNIQUE,                    -- 站点密钥（用于 /api/stats、/api/ads 鉴权）
  password_hash    TEXT,                                       -- 会员登录密码哈希（可自设，登录用）
  status           TEXT    NOT NULL DEFAULT 'pending',         -- pending / active / suspended
  daily_cap        INTEGER NOT NULL DEFAULT 5000,              -- 该站点广告每日最多被展示的次数（防止大户垄断）
  self_image_url   TEXT,                                       -- 联盟站点自身的广告图（左侧 100x100）
  self_target_url  TEXT,                                       -- 自身广告点击后跳转的真实地址
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))  -- 注册时间
);

-- ------------------------------------------------------------
-- 2) 广告表 ads
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id     INTEGER NOT NULL REFERENCES sites(id),           -- 归属哪个站点（广告主）
  image_url   TEXT    NOT NULL,                                -- 广告图片地址（联盟会员自己提供，外链）
  target_url  TEXT    NOT NULL,                                -- 点击后跳转的真实地址
  status      TEXT    NOT NULL DEFAULT 'pending',              -- pending / active / rejected（人工审核）
  weight      INTEGER NOT NULL DEFAULT 1,                      -- 曝光权重（默认 1）
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- 3) 曝光日志表 impressions
--    注意：只存 ip_hash，不存原始 IP，保护访客隐私
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS impressions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_id       INTEGER NOT NULL,                                -- 展示了哪条广告
  site_id     INTEGER NOT NULL,                                -- 在哪个站点被展示（发布商）
  ip_hash     TEXT,                                            -- 访客 IP 的哈希（用于防刷）
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- 4) 点击日志表 clicks
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clicks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_id       INTEGER NOT NULL,                                -- 点击了哪条广告（广告主）
  site_id     INTEGER NOT NULL,                                -- 在哪个站点被点击（发布商）
  ip_hash     TEXT,
  user_agent  TEXT,                                            -- 浏览器 UA（用于异常点击率分析）
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- 5) 每日统计表 stats_daily（可选，也可用视图实时计算）
--    这里作为可选的物化统计表；主要统计仍用上面的日志实时聚合
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stats_daily (
  date               TEXT NOT NULL,                            -- YYYY-MM-DD
  site_id            INTEGER NOT NULL,
  impressions_count  INTEGER NOT NULL DEFAULT 0,
  clicks_count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, site_id)
);

-- ============================================================
-- 索引：为了防刷查询和统计查询的高效性
-- ============================================================
-- 曝光防刷：同一 ip_hash 对同一站点，时间窗口内只计一次
CREATE INDEX IF NOT EXISTS idx_impressions_ip_site
  ON impressions (ip_hash, site_id, created_at);

-- 点击防刷：同一 ip_hash 对同一广告，时间窗口内只计一次
CREATE INDEX IF NOT EXISTS idx_clicks_ip_ad
  ON clicks (ip_hash, ad_id, created_at);

-- 曝光随机公平调度：快速定位某站点当天的曝光数
CREATE INDEX IF NOT EXISTS idx_impressions_site_date
  ON impressions (site_id, created_at);

-- 广告按站点 + 状态查询
CREATE INDEX IF NOT EXISTS idx_ads_site_status
  ON ads (site_id, status);

-- 点击统计
CREATE INDEX IF NOT EXISTS idx_clicks_site_date
  ON clicks (site_id, created_at);

CREATE INDEX IF NOT EXISTS idx_impressions_ad
  ON impressions (ad_id, created_at);

CREATE INDEX IF NOT EXISTS idx_clicks_ad
  ON clicks (ad_id, created_at);

-- 站点状态
CREATE INDEX IF NOT EXISTS idx_sites_status ON sites (status);

-- ------------------------------------------------------------
-- 6) 全局设置表（key-value）：平台自身广告（左侧 100x100）等
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('platform_ad_image_url', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('platform_ad_target_url', '');
