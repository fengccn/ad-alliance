/**
 * /click/:ad_id/:site_id —— 点击追踪 + 跳转
 * 关键设计：不直接 302，而是返回一个极简 HTML 页面（meta refresh + setTimeout 跳转），
 * 这样能过滤掉部分直接抓取重定向的脚本；同时记录点击（带 5 分钟去重防刷）。
 */
import { hashIp, esc } from './utils.js';
import { shouldCountClick } from './risk.js';

export async function handleClick(env, adId, siteId, ip, ua) {
  if (!adId || !siteId) {
    return { status: 400, body: { error: 'missing params' } };
  }

  // 1) 校验广告
  const ad = await env.DB.prepare('SELECT id, target_url, status FROM ads WHERE id = ?')
    .bind(adId)
    .first();
  if (!ad) return { status: 404, body: { error: 'ad not found' } };
  if (ad.status !== 'active') return { status: 403, body: { error: 'ad not active' } };

  // 2) 点击防刷：同一 IP 对同一广告 5 分钟内只计一次
  const ipHash = await hashIp(ip, env.HASH_SALT);
  const countIt = await shouldCountClick(env, ipHash, adId);
  if (countIt) {
    await env.DB.prepare(
      `INSERT INTO clicks (ad_id, site_id, ip_hash, user_agent, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    )
      .bind(adId, siteId, ipHash, (ua || '').slice(0, 500))
      .run();
  }

  // 3) 返回 HTML 延迟跳转页
  return {
    status: 200,
    contentType: 'text/html',
    body: redirectPage(ad.target_url),
  };
}

/** 生成延迟跳转 HTML：meta refresh + JS setTimeout + 手动兜底链接 */
function redirectPage(target) {
  const safeHref = esc(target);                       // HTML 属性安全
  const jsTarget = JSON.stringify(target);            // JS 字符串安全
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<meta http-equiv="refresh" content="0;url=${safeHref}">
<title>正在跳转…</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #f4f5f7; color: #333; font-family: system-ui, -apple-system, sans-serif; }
  .card { text-align: center; padding: 32px 40px; background: #fff; border-radius: 12px;
          box-shadow: 0 8px 30px rgba(0,0,0,.08); }
  .spin { width: 28px; height: 28px; margin: 0 auto 16px; border: 3px solid #e5e7eb;
          border-top-color: #1a73e8; border-radius: 50%; animation: r 0.8s linear infinite; }
  @keyframes r { to { transform: rotate(360deg); } }
  a { color: #1a73e8; text-decoration: none; }
</style>
</head>
<body>
  <div class="card">
    <div class="spin"></div>
    <p style="margin:0 0 6px;">正在为你跳转到广告主页面…</p>
    <p style="margin:0;color:#888;font-size:13px;">如未自动跳转，<a href="${safeHref}" rel="noopener nofollow sponsored">请点击这里</a></p>
  </div>
  <script>
    setTimeout(function () { window.location.replace(${jsTarget}); }, 600);
  </script>
</body>
</html>`;
}
