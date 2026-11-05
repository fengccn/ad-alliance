/**
 * /api/register —— 站点注册 + 广告素材提交
 * 流程：提交站点资料 + 广告素材 → 建站(pending) → 建广告(pending) →
 * 返回 site_id + api_key。站点与广告均需管理员审核通过后才变为 active。
 *
 * 另外提供：
 *  /api/ads（POST）：已审核通过的 active 站点，用 api_key 修改自己的唯一广告。
 *     每次修改都会把广告置为 pending，需管理员重新审核通过后才恢复展示。
 *  /api/member/login（POST）：用 site_id + 密码 登录。
 *  /api/member/set-password（POST）：设置/修改登录密码。
 */
import { generateApiKey, hashPassword } from './utils.js';
import { fetchRss, refreshSiteRss } from './rss.js';

/** 基础校验：必须为合法 http(s) 链接 */
function isHttpUrl(v) {
  return typeof v === 'string' && /^https?:\/\/.+/i.test(v);
}

/** RSS 广告背景样式白名单 */
const RSS_THEMES = ['rice', 'card', 'grid', 'dot'];
function pickTheme(v) {
  return RSS_THEMES.includes(v) ? v : 'rice';
}

export async function handleRegister(env, body) {
  const site_name = (body.site_name || '').trim();
  const site_url = (body.site_url || '').trim();
  const contact_email = (body.contact_email || '').trim();
  const image_url = (body.image_url || '').trim();
  const target_url = (body.target_url || '').trim();
  const password = (body.password || '').trim();
  const ad_mode = body.ad_mode === 'rss' ? 'rss' : 'image';
  const rss_url = (body.rss_url || '').trim();
  const rss_theme = pickTheme(body.rss_theme);

  // 站点资料必填
  if (!site_name || !site_url || !contact_email) {
    return { status: 400, body: { error: 'missing required fields: site_name/site_url/contact_email' } };
  }
  if (!isHttpUrl(site_url)) return { status: 400, body: { error: 'site_url must be a valid http(s) url' } };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact_email)) {
    return { status: 400, body: { error: 'invalid contact_email' } };
  }

  // 广告素材（可选，注册时一并提交）
  if (image_url && !isHttpUrl(image_url)) {
    return { status: 400, body: { error: 'image_url must be a valid http(s) url' } };
  }
  if (target_url && !isHttpUrl(target_url)) {
    return { status: 400, body: { error: 'target_url must be a valid http(s) url' } };
  }

  // RSS 文章广告：必须先能成功读取到文章，才允许选用该形式
  let rssInfo = null;
  if (ad_mode === 'rss') {
    if (!rss_url) {
      return { status: 400, body: { error: '选择 RSS 文章广告时，必须填写 RSS 订阅地址' } };
    }
    if (!isHttpUrl(rss_url)) {
      return { status: 400, body: { error: 'RSS 地址必须是合法的 http(s) 链接' } };
    }
    rssInfo = await fetchRss(rss_url);
    if (!rssInfo.ok) {
      return {
        status: 400,
        body: { error: 'RSS 读取失败：' + rssInfo.error + '。请检查订阅地址，或改用图片广告形式。' },
      };
    }
  }

  // 登录密码必填（会员后台仅用密码登录）
  if (!password) return { status: 400, body: { error: 'missing password' } };
  if (password.length < 4) return { status: 400, body: { error: 'password must be at least 4 characters' } };

  const password_hash = await hashPassword(password, env.HASH_SALT);

  // 创建站点（默认 pending，需审核）
  const apiKey = generateApiKey();
  const siteRes = await env.DB.prepare(
    `INSERT INTO sites (site_name, site_url, contact_email, api_key, password_hash, status,
                        ad_mode, rss_url, rss_article_title, rss_article_url, rss_status, rss_theme, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, datetime('now'))`
  )
    .bind(
      site_name,
      site_url,
      contact_email,
      apiKey,
      password_hash,
      ad_mode,
      rss_url || null,
      rssInfo ? rssInfo.title : null,
      rssInfo ? rssInfo.link : null,
      'ok',
      rss_theme
    )
    .run();
  const siteId = siteRes.meta.last_row_id;

  // 创建广告（默认 pending，需审核）
  //  - image 模式：有图 + 有链接才建记录
  //  - rss 模式：也建一条记录（图片留空），用于统一记录曝光/点击与审核流转
  let adId = null;
  if (ad_mode === 'rss') {
    const adRes = await env.DB.prepare(
      `INSERT INTO ads (site_id, image_url, target_url, status, created_at)
       VALUES (?, '', ?, 'pending', datetime('now'))`
    )
      .bind(siteId, site_url)
      .run();
    adId = adRes.meta.last_row_id;
  } else if (image_url && target_url) {
    const adRes = await env.DB.prepare(
      `INSERT INTO ads (site_id, image_url, target_url, status, created_at)
       VALUES (?, ?, ?, 'pending', datetime('now'))`
    )
      .bind(siteId, image_url, target_url)
      .run();
    adId = adRes.meta.last_row_id;
  }

  return {
    status: 200,
    body: {
      site_id: siteId,
      api_key: apiKey,
      ad_id: adId,
      ad_mode,
      status: 'pending',
      message:
        ad_mode === 'rss'
          ? '注册成功（RSS 文章广告）。站点与广告已进入待审核队列，请等待管理员审核通过后即可开始曝光。'
          : '注册成功。站点与广告已进入待审核队列，请等待管理员审核通过后即可开始曝光。',
    },
  };
}

/** POST /api/ads —— 修改自己的唯一广告 / 切换广告形式（需 api_key 鉴权）。修改后自动置 pending，需重新审核 */
export async function handleAddAd(env, body) {
  const site_id = Number(body.site_id);
  const api_key = (body.api_key || '').trim();
  const ad_mode = body.ad_mode === 'rss' ? 'rss' : 'image';
  const image_url = (body.image_url || '').trim();
  const target_url = (body.target_url || '').trim();
  const rss_url = (body.rss_url || '').trim();

  const rss_theme = pickTheme(body.rss_theme);

  if (!site_id || !api_key) return { status: 400, body: { error: 'missing site_id or api_key' } };

  // 按所选形式校验：rss 必须先读取成功；image 必须有图和链接
  let rssInfo = null;
  if (ad_mode === 'rss') {
    if (!rss_url) {
      return { status: 400, body: { error: '选择 RSS 文章广告时，必须填写 RSS 订阅地址' } };
    }
    if (!isHttpUrl(rss_url)) {
      return { status: 400, body: { error: 'RSS 地址必须是合法的 http(s) 链接' } };
    }
    rssInfo = await fetchRss(rss_url);
    if (!rssInfo.ok) {
      return {
        status: 400,
        body: { error: 'RSS 读取失败：' + rssInfo.error + '。请检查订阅地址，或改用图片广告形式。' },
      };
    }
  } else {
    if (!image_url || !target_url) return { status: 400, body: { error: 'missing image_url or target_url' } };
    if (!isHttpUrl(image_url) || !isHttpUrl(target_url)) {
      return { status: 400, body: { error: 'image_url and target_url must be valid http(s) urls' } };
    }
  }

  const site = await env.DB.prepare('SELECT id, api_key, site_url, ad_mode, rss_url FROM sites WHERE id = ?')
    .bind(site_id)
    .first();
  if (!site) return { status: 404, body: { error: 'site not found' } };
  if (site.api_key !== api_key) return { status: 403, body: { error: 'unauthorized' } };

  // 整站切换广告形式（二选一，可随时切换，切换后广告需重新审核）
  if (ad_mode === 'rss') {
    await env.DB.prepare(
      `UPDATE sites
         SET ad_mode = 'rss', rss_url = ?, rss_article_title = ?, rss_article_url = ?, rss_status = 'ok', rss_theme = ?
       WHERE id = ?`
    )
      .bind(rss_url, rssInfo.title, rssInfo.link, rss_theme, site_id)
      .run();
  } else {
    await env.DB.prepare(`UPDATE sites SET ad_mode = 'image' WHERE id = ?`).bind(site_id).run();
  }

  // 该站点当前已有的广告（每会员仅一条）
  const exist = await env.DB.prepare('SELECT id, image_url, target_url, status FROM ads WHERE site_id = ? ORDER BY id LIMIT 1')
    .bind(site_id)
    .first();

  const prevMode = site.ad_mode === 'rss' ? 'rss' : 'image';

  // rss 模式不展示图片：图片留空，target_url 用站点首页兜底
  const finalImage = ad_mode === 'rss' ? '' : image_url;
  const finalTarget = ad_mode === 'rss' ? (target_url || site.site_url || '') : target_url;

  // 只有「切换形式」或「更换素材」才需要重新审核；
  // 仅调整 RSS 背景纹理时保持原状态，避免换个背景就把广告打回 pending。
  let materialChanged = prevMode !== ad_mode;
  if (!materialChanged) {
    if (ad_mode === 'rss') {
      materialChanged = (site.rss_url || '') !== rss_url;
    } else {
      materialChanged =
        (exist ? exist.image_url || '' : '') !== image_url ||
        (exist ? exist.target_url || '' : '') !== target_url;
    }
  }

  let ad_id;
  if (exist) {
    const nextStatus = materialChanged ? 'pending' : exist.status;
    await env.DB.prepare(
      `UPDATE ads SET image_url = ?, target_url = ?, status = ?, created_at = datetime('now') WHERE id = ?`
    )
      .bind(finalImage, finalTarget, nextStatus, exist.id)
      .run();
    ad_id = exist.id;
  } else {
    const res = await env.DB.prepare(
      `INSERT INTO ads (site_id, image_url, target_url, status, created_at)
       VALUES (?, ?, ?, 'pending', datetime('now'))`
    )
      .bind(site_id, finalImage, finalTarget)
      .run();
    ad_id = res.meta.last_row_id;
  }

  return {
    status: 200,
    body: {
      ad_id,
      ad_mode,
      status: materialChanged ? 'pending' : (exist ? exist.status : 'pending'),
      message: materialChanged
        ? (ad_mode === 'rss'
            ? '已切换为 RSS 文章广告，RSS 已读取成功。广告需管理员重新审核通过后恢复展示。'
            : '已切换为图片广告。广告需管理员重新审核通过后恢复展示。')
        : '样式已更新，广告保持在线，无需重新审核。',
    },
  };
}

/** POST /api/member/rss/refresh —— 会员手动刷新 RSS 缓存（需 api_key 鉴权） */
export async function handleRssRefresh(env, body) {
  const site_id = Number(body.site_id);
  const api_key = (body.api_key || '').trim();
  if (!site_id || !api_key) return { status: 400, body: { error: 'missing site_id or api_key' } };

  const site = await env.DB.prepare('SELECT id, api_key FROM sites WHERE id = ?').bind(site_id).first();
  if (!site) return { status: 404, body: { error: 'site not found' } };
  if (site.api_key !== api_key) return { status: 403, body: { error: 'unauthorized' } };

  const r = await refreshSiteRss(env, site_id);
  if (r.ok) {
    return {
      status: 200,
      body: { ok: true, title: r.title, link: r.link, message: 'RSS 已刷新，最新文章：' + r.title },
    };
  }
  return {
    status: 400,
    body: { ok: false, error: r.error, message: 'RSS 读取失败，该站点广告已自动暂停：' + r.error },
  };
}

/** POST /api/member/login —— 用 site_id + 密码 登录（返回 api_key 供后续调用） */
export async function handleMemberLogin(env, body) {
  const site_id = Number(body.site_id);
  const password = (body.password || '').trim();

  if (!site_id || !password) return { status: 400, body: { error: 'missing site_id or password' } };
  const site = await env.DB.prepare('SELECT id, site_name, api_key, password_hash FROM sites WHERE id = ?')
    .bind(site_id)
    .first();
  if (!site) return { status: 404, body: { error: 'site not found' } };
  if (!site.password_hash) return { status: 400, body: { error: 'no password set; use api_key to log in and set a password' } };
  const hash = await hashPassword(password, env.HASH_SALT);
  if (hash !== site.password_hash) return { status: 403, body: { error: 'wrong password' } };

  return { status: 200, body: { ok: true, site_id, site_name: site.site_name, api_key: site.api_key } };
}

/** POST /api/member/set-password —— 设置/修改登录密码（需 api_key 或原密码验证） */
export async function handleSetPassword(env, body) {
  const site_id = Number(body.site_id);
  const api_key = (body.api_key || '').trim();
  const old_password = (body.old_password || '').trim();
  const new_password = (body.new_password || '').trim();

  if (!site_id || !new_password) return { status: 400, body: { error: 'missing site_id or new_password' } };
  if (new_password.length < 4) return { status: 400, body: { error: 'password must be at least 4 characters' } };

  const site = await env.DB.prepare('SELECT id, api_key, password_hash FROM sites WHERE id = ?')
    .bind(site_id)
    .first();
  if (!site) return { status: 404, body: { error: 'site not found' } };

  // 鉴权：api_key 正确，或原密码正确
  let authed = false;
  if (api_key && api_key === site.api_key) authed = true;
  else if (old_password) {
    const hash = await hashPassword(old_password, env.HASH_SALT);
    if (hash === site.password_hash) authed = true;
  }
  if (!authed) return { status: 403, body: { error: 'unauthorized: need valid api_key or current password' } };

  const password_hash = await hashPassword(new_password, env.HASH_SALT);
  await env.DB.prepare('UPDATE sites SET password_hash = ? WHERE id = ?').bind(password_hash, site_id).run();
  return { status: 200, body: { ok: true, message: '登录密码已更新。' } };
}

/** POST /api/self —— 已激活站点更新自身广告素材（左侧 100x100，需 api_key 鉴权） */
export async function handleUpdateSelf(env, body) {
  const site_id = Number(body.site_id);
  const api_key = (body.api_key || '').trim();
  const self_image_url = (body.self_image_url || '').trim();
  const self_target_url = (body.self_target_url || '').trim();

  if (!site_id || !api_key) return { status: 400, body: { error: 'missing site_id or api_key' } };
  if (!self_image_url || !self_target_url) {
    return { status: 400, body: { error: 'missing self_image_url or self_target_url' } };
  }
  if (!isHttpUrl(self_image_url) || !isHttpUrl(self_target_url)) {
    return { status: 400, body: { error: 'self_image_url and self_target_url must be valid http(s) urls' } };
  }

  const site = await env.DB.prepare('SELECT id, api_key FROM sites WHERE id = ?').bind(site_id).first();
  if (!site) return { status: 404, body: { error: 'site not found' } };
  if (site.api_key !== api_key) return { status: 403, body: { error: 'unauthorized' } };

  await env.DB.prepare('UPDATE sites SET self_image_url = ?, self_target_url = ? WHERE id = ?')
    .bind(self_image_url, self_target_url, site_id)
    .run();

  return {
    status: 200,
    body: { ok: true, message: '自身广告素材已更新（左侧 100x100）。' },
  };
}
