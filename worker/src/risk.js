/**
 * 风控与公平调度核心模块
 *
 * 职责：
 *  1. 曝光防刷   —— 同一 ip_hash 对同一站点，1 分钟内只记一次有效曝光
 *  2. 点击防刷   —— 同一 ip_hash 对同一广告，5 分钟内只计一次点击
 *  3. 公平随机   —— 排除本站广告，按权重加权随机；过滤达到每日曝光上限的站点
 *  4. 冷启动加权 —— 新站点短期待展示加权，帮助冷启动
 *  5. 异常检测   —— 曝光正常但点击率异常的站点，标记待人工审核
 */
import { hashIp, isNewSite } from './utils.js';

/** 时间窗口常量（秒） */
export const IMPRESSION_DUP_WINDOW = 60;   // 曝光去重窗口：1 分钟
export const CLICK_DUP_WINDOW = 300;       // 点击去重窗口：5 分钟

/**
 * 曝光防刷：判断本次曝光是否应被"有效计数"。
 * 无论是否计数，广告都照常返回（访客仍能看到广告），
 * 只是同一访客短时间内反复刷新不再重复累计曝光量。
 */
export async function shouldCountImpression(env, ipHash, siteId) {
  const dup = await env.DB.prepare(
    `SELECT id FROM impressions
     WHERE ip_hash = ? AND site_id = ?
       AND created_at > datetime('now', ?)
     LIMIT 1`
  )
    .bind(ipHash, siteId, `-${IMPRESSION_DUP_WINDOW} seconds`)
    .first();
  return !dup;
}

/** 点击防刷：同一 IP 对同一广告，5 分钟内只计一次。 */
export async function shouldCountClick(env, ipHash, adId) {
  const dup = await env.DB.prepare(
    `SELECT id FROM clicks
     WHERE ip_hash = ? AND ad_id = ?
       AND created_at > datetime('now', ?)
     LIMIT 1`
  )
    .bind(ipHash, adId, `-${CLICK_DUP_WINDOW} seconds`)
    .first();
  return !dup;
}

/**
 * 公平随机调度：从"除本站以外"的所有 active 广告中，
 * 过滤掉已达成每日曝光上限的站点，再按 weight × 冷启动加权做加权随机。
 * 返回 null 表示当前无可用广告（广告池为空或全部达上限）。
 */
export async function selectAd(env, siteId) {
  // 1) 今日各站点的曝光计数（一次性查全，避免 N+1）
  const todayCounts = {};
  const cntRows = await env.DB.prepare(
    `SELECT site_id, COUNT(*) AS cnt
     FROM impressions
     WHERE date(created_at) = date('now')
     GROUP BY site_id`
  ).all();
  for (const r of cntRows.results) todayCounts[r.site_id] = r.cnt;

  // 2) 取所有可投放的候选广告（active、非本站、所属站点 active）
  const rows = await env.DB.prepare(
    `SELECT a.id, a.image_url, a.target_url, a.weight,
            a.site_id AS owner_site, a.created_at AS ad_created,
            s.daily_cap, s.created_at AS site_created, s.site_name
     FROM ads a
     JOIN sites s ON s.id = a.site_id
     WHERE a.status = 'active'
       AND a.site_id != ?
       AND s.status = 'active'`
  )
    .bind(siteId)
    .all();

  // 3) 过滤达到每日上限的站点 + 计算加权
  const pool = [];
  for (const r of rows.results) {
    const used = todayCounts[r.owner_site] || 0;
    if (used >= r.daily_cap) continue; // 该站点今日曝光配额已用尽，本轮不分给它（防垄断）
    const boost = isNewSite(r.site_created, env.NEW_SITE_DAYS || 7) ? Number(env.NEW_SITE_BOOST || 1.5) : 1;
    pool.push({ id: r.id, image_url: r.image_url, target_url: r.target_url, w: r.weight * boost });
  }

  if (pool.length === 0) return null;

  // 4) 加权随机
  const totalW = pool.reduce((s, p) => s + p.w, 0);
  let roll = Math.random() * totalW;
  for (const p of pool) {
    roll -= p.w;
    if (roll <= 0) return p;
  }
  return pool[pool.length - 1];
}

/**
 * 异常点击率检测：某站点某天曝光量足够（>= minImp）但点击率超过阈值，
 * 返回需要标记的站点列表。供定时任务或管理端调用。
 */
export async function detectAnomalousSites(env, minImp = 100, ctrThreshold = 0.10) {
  const rows = await env.DB.prepare(
    `SELECT s.id, s.site_name,
            COUNT(DISTINCT i.id) AS imp,
            COUNT(DISTINCT c.id) AS clk
     FROM sites s
     LEFT JOIN impressions i ON i.site_id = s.id AND date(i.created_at) = date('now')
     LEFT JOIN clicks      c ON c.site_id = s.id AND date(c.created_at) = date('now')
     WHERE s.status = 'active'
     GROUP BY s.id
     HAVING imp >= ?
       AND (clk * 1.0 / imp) > ?`
  )
    .bind(minImp, ctrThreshold)
    .all();
  return rows.results;
}
