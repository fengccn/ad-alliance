/**
 * /api/serve —— 曝光分发接口
 * 访客打开站点 A 页面 → 嵌入 JS 请求此接口（带 site_id=A）→
 * 服务端从"除 A 以外的已审核广告池"随机抽一条 → 返回 {ad_id, image_url, click_url} → JS 渲染。
 * 同时做曝光去重防刷，异步（waitUntil）记录曝光。
 */
import { hashIp, getSetting } from './utils.js';
import { selectAd, shouldCountImpression } from './risk.js';

/** GET /api/platform-ad —— 返回平台全局广告（公开接口，注册页预览用） */
export async function handlePlatformAd(env) {
  const image_url = await getSetting(env, 'platform_ad_image_url', '');
  const target_url = await getSetting(env, 'platform_ad_target_url', '');
  return { status: 200, body: { image_url, target_url } };
}

export async function handleServe(env, siteId, ip, ua) {
  if (!siteId) {
    return { status: 400, body: { error: 'missing site_id' } };
  }

  // 1) 校验站点有效性
  const site = await env.DB.prepare('SELECT id, status FROM sites WHERE id = ?')
    .bind(siteId)
    .first();
  if (!site) return { status: 404, body: { error: 'site not found' } };
  if (site.status !== 'active') {
    return { status: 403, body: { error: 'site not active' } };
  }

  // 2) 随机调度（含公平调度与每日配额过滤）
  const ad = await selectAd(env, siteId);
  if (!ad) {
    return { status: 200, body: { ad_id: 0, image_url: '', click_url: '', message: 'no available ads now' } };
  }

  // 3) 曝光防刷 + 异步记录
  const ipHash = await hashIp(ip, env.HASH_SALT);
  const countIt = await shouldCountImpression(env, ipHash, siteId);
  if (countIt) {
    await env.DB.prepare(
      `INSERT INTO impressions (ad_id, site_id, ip_hash, created_at)
       VALUES (?, ?, ?, datetime('now'))`
    )
      .bind(ad.id, siteId, ipHash)
      .run()
      .catch((e) => console.error('[AdAlliance] impression write failed:', e));
  }

  // 4) 返回广告数据。click_url 必须经过本服务端，否则无法统计点击
  return {
    status: 200,
    body: {
      ad_id: ad.id,
      image_url: ad.image_url,
      click_url: `${env.APP_BASE}/click/${ad.id}/${siteId}`,
      site_name: ad.site_name,
    },
  };
}

/**
 * /api/embed —— 双栏广告位数据（一次请求返回左右两块）
 * 嵌入代码在站点 A 页面渲染：
 *   左侧（100x100）：平台自身广告（全局，管理员在后台设置，来自 settings 表）
 *   右侧（300x100）：随机一个参与联盟站点的广告（公平调度 + 曝光防刷 + 异步记录）
 */
export async function handleEmbed(env, siteId, ip, ua) {
  if (!siteId) {
    return { status: 400, body: { error: 'missing site_id' } };
  }

  // 1) 校验站点有效性
  const site = await env.DB.prepare('SELECT id, status FROM sites WHERE id = ?')
    .bind(siteId)
    .first();
  if (!site) return { status: 404, body: { error: 'site not found' } };
  if (site.status !== 'active') {
    return { status: 403, body: { error: 'site not active' } };
  }

  // 2) 左侧：平台全局广告（100x100）。链接可直接跳转，无需服务器中转
  const pImage = await getSetting(env, 'platform_ad_image_url', '');
  const pTarget = await getSetting(env, 'platform_ad_target_url', '');
  const self =
    pImage && pTarget
      ? { image_url: pImage, target_url: pTarget }
      : null;

  // 3) 右侧：随机伙伴广告（300x100），公平调度 + 曝光防刷
  let partner = null;
  let ad = null;
  ad = await selectAd(env, siteId);
  if (ad) {
    partner = {
      ad_id: ad.id,
      image_url: ad.image_url,
      click_url: `${env.APP_BASE}/click/${ad.id}/${siteId}`,
    };
  }

  // 4) 曝光去重 + 异步记录
  if (partner) {
    const ipHash = await hashIp(ip, env.HASH_SALT);
    const countIt = await shouldCountImpression(env, ipHash, siteId);
    if (countIt) {
      await env.DB.prepare(
        `INSERT INTO impressions (ad_id, site_id, ip_hash, created_at)
         VALUES (?, ?, ?, datetime('now'))`
      )
        .bind(ad.id, siteId, ipHash)
        .run()
        .catch((e) => console.error('[AdAlliance] impression write failed:', e));
    }
  }

  return { status: 200, body: { self, partner } };
}
