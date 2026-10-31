/**
 * 公共工具函数
 * 依赖：Cloudflare Workers 环境（Web Crypto, TextEncoder）
 */

/** 获取访客真实 IP（优先 Cloudflare 直连 IP，其次 x-forwarded-for） */
export function getClientIp(request) {
  const cf = request.headers.get('CF-Connecting-IP');
  if (cf) return cf;
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return '0.0.0.0';
}

/**
 * 对 IP 做不可逆哈希，只存哈希不存原始 IP。
 * 加盐（env.HASH_SALT）防止针对常见 IP 列表的反查。
 */
export async function hashIp(ip, salt) {
  const input = `${salt || 'ad-alliance'}::${ip}`;
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 对会员登录密码做不可逆哈希（加盐），只存哈希不存明文 */
export async function hashPassword(password, salt) {
  const input = `pwd::${salt || 'ad-alliance'}::${password}`;
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** CORS 头：管理后台（另一域名）也要能跨域调用 /admin/api */
export function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** 统一响应封装：支持 JSON 与 HTML */
export function respond(result, corsHeaders) {
  const status = result.status || 200;
  if (result.contentType === 'text/html') {
    return new Response(result.body, {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8', ...corsHeaders },
    });
  }
  return new Response(JSON.stringify(result.body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders },
  });
}

/** 生成站点 API Key */
export function generateApiKey() {
  return crypto.randomUUID().replace(/-/g, '');
}

/** 返回 YYYY-MM-DD 的今天 */
export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/** 读取全局设置（settings 表，key-value） */
export async function getSetting(env, key, def = '') {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?')
    .bind(key)
    .first();
  return row ? row.value : def;
}

/** 写入全局设置（不存在则插入，存在则更新） */
export async function setSetting(env, key, value) {
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  )
    .bind(key, value)
    .run();
}

/** 判断站点是否为"新站"（注册不满 N 天，用于冷启动加权） */
export function isNewSite(createdAt, days = 7) {
  if (!createdAt) return false;
  const created = new Date(createdAt + 'Z').getTime();
  if (Number.isNaN(created)) return false;
  return Date.now() - created < days * 24 * 3600 * 1000;
}

/** 简单的 HTML 转义，用于把用户输入安全地渲染进 HTML */
export function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
