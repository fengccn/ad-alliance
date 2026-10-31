/**
 * /admin/api/* —— 管理后台 API（供 admin/index.html 调用）
 * 鉴权：请求头 X-Admin-Token（或 ?token=），与 env.ADMIN_TOKEN 比对。
 * 提供：待审广告列表 / 通过 / 驳回 / 站点列表 / 站点状态变更 / 全局数据看板 / 平台设置。
 */
import { setSetting } from './utils.js';
import { notifyMemberApproved, notifyMemberRejected } from './notify.js';

export async function handleAdmin(env, request, url, path, ctx) {
  const token = request.headers.get('X-Admin-Token') || url.searchParams.get('token');
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
    return { status: 401, body: { error: 'unauthorized' } };
  }

  // ---- 待审/指定状态广告列表 ----
  if (path === '/admin/api/ads' && request.method === 'GET') {
    const status = url.searchParams.get('status') || 'pending';
    const rows = await env.DB.prepare(
      `SELECT a.id, a.image_url, a.target_url, a.weight, a.created_at,
              s.id AS site_id, s.site_name, s.site_url
       FROM ads a JOIN sites s ON s.id = a.site_id
       WHERE a.status = ?
       ORDER BY a.created_at DESC`
    )
      .bind(status)
      .all();
    return { status: 200, body: rows.results };
  }

  // ---- 通过 / 驳回广告 ----
  const m = path.match(/^\/admin\/api\/ads\/(\d+)\/(approve|reject)$/);
  if (m && request.method === 'POST') {
    const newStatus = m[2] === 'approve' ? 'active' : 'rejected';
    await env.DB.prepare('UPDATE ads SET status = ? WHERE id = ?').bind(newStatus, m[1]).run();
    // 广告审核结果 → 异步通知会员（通过/驳回）
    if (ctx) {
      const ad = await env.DB.prepare(
        `SELECT a.site_id, s.site_name, s.contact_email
         FROM ads a JOIN sites s ON s.id = a.site_id WHERE a.id = ?`
      ).bind(m[1]).first();
      if (ad && ad.contact_email) {
        if (newStatus === 'active') {
          ctx.waitUntil(notifyMemberApproved(env, {
            site_id: ad.site_id, site_name: ad.site_name,
            contact_email: ad.contact_email, kind: 'ad',
          }));
        } else {
          ctx.waitUntil(notifyMemberRejected(env, {
            site_id: ad.site_id, site_name: ad.site_name,
            contact_email: ad.contact_email,
          }));
        }
      }
    }
    return { status: 200, body: { ok: true, id: Number(m[1]), status: newStatus } };
  }

  // ---- 站点列表（含广告数） ----
  if (path === '/admin/api/sites' && request.method === 'GET') {
    const rows = await env.DB.prepare(
      `SELECT s.id, s.site_name, s.site_url, s.contact_email, s.status, s.daily_cap,
              s.created_at,
              (SELECT a.image_url FROM ads a WHERE a.site_id = s.id ORDER BY a.id LIMIT 1) AS ad_image_url,
              (SELECT COUNT(*) FROM ads a WHERE a.site_id = s.id) AS ad_count,
              (SELECT COUNT(*) FROM impressions i WHERE i.site_id = s.id) AS imp_count,
              (SELECT COUNT(*) FROM clicks c WHERE c.site_id = s.id) AS clk_count
       FROM sites s
       ORDER BY s.created_at DESC`
    ).all();
    return { status: 200, body: rows.results };
  }

  // ---- 站点状态变更 ----
  const sm = path.match(/^\/admin\/api\/sites\/(\d+)\/status$/);
  if (sm && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const allowed = ['pending', 'active', 'suspended'];
    if (!allowed.includes(body.status)) return { status: 400, body: { error: 'bad status' } };
    await env.DB.prepare('UPDATE sites SET status = ? WHERE id = ?').bind(body.status, sm[1]).run();
    // 站点激活 → 异步通知会员
    if (body.status === 'active' && ctx) {
      const s = await env.DB.prepare('SELECT id, site_name, contact_email FROM sites WHERE id = ?')
        .bind(sm[1]).first();
      if (s && s.contact_email) {
        ctx.waitUntil(notifyMemberApproved(env, {
          site_id: s.id, site_name: s.site_name,
          contact_email: s.contact_email, kind: 'site',
        }));
      }
    }
    return { status: 200, body: { ok: true } };
  }

  // ---- 删除站点（连同其广告、日志一并删除） ----
  const dm = path.match(/^\/admin\/api\/sites\/(\d+)$/);
  if (dm && request.method === 'DELETE') {
    const sid = dm[1];
    await env.DB.prepare('DELETE FROM impressions WHERE site_id = ?').bind(sid).run();
    await env.DB.prepare('DELETE FROM clicks WHERE site_id = ?').bind(sid).run();
    await env.DB.prepare('DELETE FROM ads WHERE site_id = ?').bind(sid).run();
    await env.DB.prepare('DELETE FROM stats_daily WHERE site_id = ?').bind(sid).run();
    await env.DB.prepare('DELETE FROM sites WHERE id = ?').bind(sid).run();
    return { status: 200, body: { ok: true } };
  }

  // ---- 每日曝光配额调整 ----
  const cm = path.match(/^\/admin\/api\/sites\/(\d+)\/cap$/);
  if (cm && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const cap = Number(body.daily_cap);
    if (!Number.isInteger(cap) || cap <= 0) return { status: 400, body: { error: 'invalid daily_cap' } };
    await env.DB.prepare('UPDATE sites SET daily_cap = ? WHERE id = ?').bind(cap, cm[1]).run();
    return { status: 200, body: { ok: true } };
  }

  // ---- 全局数据看板（近 30 天曝光/点击趋势 + 汇总） ----
  if (path === '/admin/api/dashboard' && request.method === 'GET') {
    const days = Number(url.searchParams.get('days')) || 30;
    const since = `datetime('now', '-${days - 1} day')`;

    const impRows = await env.DB.prepare(
      `SELECT date(created_at) AS d, COUNT(*) AS c FROM impressions
       WHERE created_at >= ${since} GROUP BY d`
    ).all();
    const clkRows = await env.DB.prepare(
      `SELECT date(created_at) AS d, COUNT(*) AS c FROM clicks
       WHERE created_at >= ${since} GROUP BY d`
    ).all();

    const series = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      series.push({ date: d, impressions: 0, clicks: 0 });
    }
    const impMap = {};
    for (const r of impRows.results) impMap[r.d] = r.c;
    const clkMap = {};
    for (const r of clkRows.results) clkMap[r.d] = r.c;
    for (const s of series) {
      s.impressions = impMap[s.date] || 0;
      s.clicks = clkMap[s.date] || 0;
    }

    const totals = {
      impressions: impRows.results.reduce((s, r) => s + r.c, 0),
      clicks: clkRows.results.reduce((s, r) => s + r.c, 0),
    };
    totals.ctr = totals.impressions ? +(totals.clicks / totals.impressions * 100).toFixed(2) : 0;

    // 今日最活跃的站点（曝光 top）
    const topSites = await env.DB.prepare(
      `SELECT s.site_name, COUNT(*) AS imp
       FROM impressions i JOIN sites s ON s.id = i.site_id
       WHERE date(i.created_at) = date('now')
       GROUP BY s.id ORDER BY imp DESC LIMIT 10`
    ).all();

    return { status: 200, body: { days, series, totals, top_sites: topSites.results } };
  }

  // ---- 平台全局设置（左侧 100x100 自身广告） ----
  if (path === '/admin/api/settings' && request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT key, value FROM settings').all();
    const out = {};
    for (const r of rows.results) out[r.key] = r.value;
    return { status: 200, body: out };
  }
  if (path === '/admin/api/settings' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    for (const k of ['platform_ad_image_url', 'platform_ad_target_url']) {
      if (typeof body[k] === 'string') await setSetting(env, k, body[k]);
    }
    return { status: 200, body: { ok: true } };
  }

  return { status: 404, body: { error: 'not found' } };
}
