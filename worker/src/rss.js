/**
 * RSS 文章广告 · 订阅抓取与解析
 * ------------------------------------------------------------
 * 用途：
 *  - /api/rss/test  ：会员在注册页/会员页填完 RSS 地址后点「读取测试」，调用本模块抓一次
 *  - 注册/保存广告  ：确认 RSS 可读，才允许把站点切到 rss 模式
 *  - 刷新缓存       ：把最新文章标题/链接写进 sites 表，嵌入代码直接读缓存（不每次曝光都抓第三方）
 *
 * 兼容范围：RSS 2.0（<item> + <link>文本）与 Atom（<entry> + <link href>）。
 * 只取最新 1 篇（取文件里的第一个条目）。
 */

/** 抓取时使用的 UA：部分博客会拦截默认的脚本 UA */
const RSS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** 是否为合法 http(s) 地址 */
export function isHttpUrl(v) {
  return typeof v === 'string' && /^https?:\/\/[^\s]+$/i.test(v);
}

/**
 * 是否指向本机/内网地址（SSRF 基础防护）。
 * Workers 本身访问不到用户内网，这里主要是防止把平台当成探测工具。
 */
function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h === '::1' || h === '[::1]' || h === '0.0.0.0') return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  const m = h.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return false;
}

/** 去掉 <![CDATA[ ... ]]> 包裹 */
function stripCdata(s) {
  return String(s || '').replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '');
}

/** 解码常见 HTML 实体（RSS 标题里经常出现） */
function decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** 归一化文本：去 CDATA、解码实体、压缩空白 */
function cleanText(s) {
  return decodeEntities(stripCdata(s)).replace(/\s+/g, ' ').trim();
}

/**
 * 解析 RSS/Atom 文本，返回第一个条目的 { title, link }。
 * 识别不到条目时返回 null。
 */
export function parseFeed(xml) {
  if (!xml || typeof xml !== 'string') return null;

  // 优先 RSS 的 <item>，其次 Atom 的 <entry>
  const itemMatch = xml.match(/<item\b[\s\S]*?<\/item>/i);
  const entryMatch = xml.match(/<entry\b[\s\S]*?<\/entry>/i);
  const block = itemMatch ? itemMatch[0] : (entryMatch ? entryMatch[0] : null);
  if (!block) return null;

  // ---- 标题 ----
  let title = '';
  const titleMatch = block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) title = cleanText(titleMatch[1]);

  // ---- 链接 ----
  // Atom：<link rel="alternate" href="..."> / <link href="..." rel="alternate">
  let link = '';
  const m1 = block.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*>/i);
  const m2 = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']alternate["'][^>]*>/i);
  if (m1) link = m1[1];
  else if (m2) link = m2[1];

  // 其它带 href 的 <link>（Atom 常见的 rel 省略写法）
  if (!link) {
    const hrefMatch = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
    if (hrefMatch) link = hrefMatch[1];
  }

  // RSS 2.0：<link>https://...</link>
  if (!link) {
    const linkText = block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
    if (linkText) link = cleanText(linkText[1]);
  }

  link = decodeEntities(link).trim();

  if (!title && !link) return null;
  return { title, link };
}

/**
 * 抓取并解析一个 RSS 地址。
 * 返回 { ok: true, title, link } 或 { ok: false, error }
 */
export async function fetchRss(url) {
  if (!isHttpUrl(url)) return { ok: false, error: 'RSS 地址必须是 http(s) 链接' };

  let u;
  try {
    u = new URL(url);
  } catch (e) {
    return { ok: false, error: 'RSS 地址格式不正确' };
  }
  if (isPrivateHost(u.hostname)) {
    return { ok: false, error: '不允许读取内网或本机地址' };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000); // 8 秒超时，避免拖垮请求

  try {
    const res = await fetch(u.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': RSS_UA,
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      signal: ctrl.signal,
      redirect: 'follow',
      cf: { cacheTtl: 0, cacheEverything: false },
    });

    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status + '（该地址拒绝访问或不返回内容）' };

    const text = await res.text();
    if (!text || text.length < 50) return { ok: false, error: '返回内容为空或过短' };

    const first = parseFeed(text);
    if (!first) return { ok: false, error: '未能识别到文章条目（该地址可能不是 RSS/Atom 输出）' };
    if (!first.link) return { ok: false, error: '条目缺少文章链接，无法生成跳转' };

    return { ok: true, title: first.title || '(无标题)', link: first.link };
  } catch (e) {
    const name = e && e.name;
    return {
      ok: false,
      error: name === 'AbortError' ? '读取超时（超过 8 秒）' : '读取失败：' + ((e && e.message) || String(e)),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 刷新某站点的 RSS 缓存：
 *  - 成功 → 写入 rss_article_title / rss_article_url，rss_status = 'ok'
 *  - 失败 → rss_status = 'error'（调度层会暂停该站点的广告）
 */
export async function refreshSiteRss(env, siteId) {
  const site = await env.DB.prepare('SELECT id, rss_url FROM sites WHERE id = ?')
    .bind(siteId)
    .first();
  if (!site) return { ok: false, error: '站点不存在' };
  if (!site.rss_url) return { ok: false, error: '该站点未设置 RSS 地址' };

  const r = await fetchRss(site.rss_url);
  if (r.ok) {
    await env.DB.prepare(
      `UPDATE sites
         SET rss_article_title = ?, rss_article_url = ?, rss_status = 'ok'
       WHERE id = ?`
    )
      .bind(r.title, r.link, siteId)
      .run();
    return { ok: true, title: r.title, link: r.link };
  }

  await env.DB.prepare(`UPDATE sites SET rss_status = 'error' WHERE id = ?`).bind(siteId).run();
  return { ok: false, error: r.error };
}

/**
 * 批量刷新所有启用 RSS 模式的 active 站点缓存。
 * 由 Cloudflare Cron Trigger 定时调用（见 wrangler.toml 的 [triggers]）。
 * 返回 { total, ok, fail } 便于日志排查。
 */
export async function refreshAllRss(env) {
  const rows = await env.DB.prepare(
    `SELECT id FROM sites
     WHERE ad_mode = 'rss' AND rss_url IS NOT NULL AND status = 'active'`
  ).all();

  let ok = 0;
  let fail = 0;
  for (const r of rows.results) {
    const res = await refreshSiteRss(env, r.id);
    if (res.ok) ok++;
    else fail++;
  }
  return { total: rows.results.length, ok, fail };
}
