/**
 * /api/stats —— 站点自助统计
 * 站点用 site_id + api_key 查询自己的数据。返回两个方向：
 *  as_publisher  ：我的站点展示别人的广告所获得的曝光/点击（我是发布商）
 *  as_advertiser ：我的广告在别人站点被展示/被点击（我是广告主）
 * 以及近 30 天每日明细。
 */
export async function handleStats(env, siteId, apiKey) {
  if (!siteId || !apiKey) return { status: 400, body: { error: 'missing site_id or api_key' } };

  const site = await env.DB.prepare('SELECT id, api_key, site_name FROM sites WHERE id = ?')
    .bind(siteId)
    .first();
  if (!site) return { status: 404, body: { error: 'site not found' } };
  if (site.api_key !== apiKey) return { status: 403, body: { error: 'unauthorized' } };

  // 我的广告 id 列表
  const ads = await env.DB.prepare('SELECT id FROM ads WHERE site_id = ?').bind(siteId).all();
  const adIds = ads.results.map((a) => a.id);

  // 当前唯一广告（供会员页面回显）
  const curAd = await env.DB.prepare(
    'SELECT id, image_url, target_url, status FROM ads WHERE site_id = ? ORDER BY id LIMIT 1'
  ).bind(siteId).first();

  // —— 我是发布商：我的站点产生的曝光/点击 ——
  const pubImp = (await env.DB.prepare('SELECT COUNT(*) AS c FROM impressions WHERE site_id = ?').bind(siteId).first()).c;
  const pubClk = (await env.DB.prepare('SELECT COUNT(*) AS c FROM clicks WHERE site_id = ?').bind(siteId).first()).c;

  // —— 我是广告主：我的广告在其他站点的曝光/点击 ——
  let advImp = 0;
  let advClk = 0;
  if (adIds.length > 0) {
    const ph = adIds.map(() => '?').join(',');
    advImp = (await env.DB.prepare(`SELECT COUNT(*) AS c FROM impressions WHERE ad_id IN (${ph})`).bind(...adIds).first()).c;
    advClk = (await env.DB.prepare(`SELECT COUNT(*) AS c FROM clicks WHERE ad_id IN (${ph})`).bind(...adIds).first()).c;
  }

  // —— 近 30 天每日明细（我的站点作为发布商） ——
  const impRows = await env.DB.prepare(
    `SELECT date(created_at) AS d, COUNT(*) AS c FROM impressions
     WHERE site_id = ? AND created_at >= datetime('now', '-29 day')
     GROUP BY d`
  ).bind(siteId).all();
  const clkRows = await env.DB.prepare(
    `SELECT date(created_at) AS d, COUNT(*) AS c FROM clicks
     WHERE site_id = ? AND created_at >= datetime('now', '-29 day')
     GROUP BY d`
  ).bind(siteId).all();

  const impMap = {};
  for (const r of impRows.results) impMap[r.d] = r.c;
  const clkMap = {};
  for (const r of clkRows.results) clkMap[r.d] = r.c;

  const daily = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    daily.push({ date: d, impressions: impMap[d] || 0, clicks: clkMap[d] || 0 });
  }

  return {
    status: 200,
    body: {
      site_name: site.site_name,
      as_publisher: { impressions: pubImp, clicks: pubClk, ctr: pubImp ? +(pubClk / pubImp * 100).toFixed(2) : 0 },
      as_advertiser: { impressions: advImp, clicks: advClk, ctr: advImp ? +(advClk / advImp * 100).toFixed(2) : 0 },
      current_ad: curAd ? { id: curAd.id, image_url: curAd.image_url, target_url: curAd.target_url, status: curAd.status } : null,
      daily,
    },
  };
}
