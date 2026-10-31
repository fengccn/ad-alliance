/**
 * 互助曝光广告联盟 · Cloudflare Workers 入口
 *
 * 路由：
 *   GET  /api/embed?site_id=X           双栏广告位（左侧自身广告 + 右侧随机伙伴广告）
 *   GET  /api/serve?site_id=X           曝光分发（随机广告 + 记录曝光）
 *   GET  /click/:ad_id/:site_id         点击追踪 + HTML 延迟跳转
 *   POST /api/register                  站点注册 + 广告素材提交
 *   POST /api/ads                       已激活站点提交新广告（api_key 鉴权）
 *   POST /api/self                      已激活站点更新自身广告素材（api_key 鉴权）
 *   GET  /api/stats?site_id=X&api_key=K 站点自助统计
 *   GET  /admin/api/*                   管理后台 API（X-Admin-Token 鉴权）
 */
import { getClientIp, cors, respond } from './utils.js';
import { handleServe, handleEmbed, handlePlatformAd } from './serve.js';
import { handleClick } from './click.js';
import { handleRegister, handleAddAd, handleUpdateSelf, handleMemberLogin, handleSetPassword } from './register.js';
import { handleStats } from './stats.js';
import { handleAdmin } from './admin.js';
import { notifyNewApplication, notifyAdReview } from './notify.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const ip = getClientIp(request);
    const ua = request.headers.get('user-agent') || '';
    const origin = request.headers.get('Origin') || '*';
    const corsHeaders = cors(origin);

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      let result;

      // ---- 双栏广告位（嵌入代码使用，一次请求返回左右两块） ----
      if (path === '/api/embed' && request.method === 'GET') {
        result = await handleEmbed(env, url.searchParams.get('site_id'), ip, ua);
      }
      // ---- 平台全局广告（公开，注册页预览用） ----
      else if (path === '/api/platform-ad' && request.method === 'GET') {
        result = await handlePlatformAd(env);
      }
      // ---- 曝光分发 ----
      else if (path === '/api/serve' && request.method === 'GET') {
        result = await handleServe(env, url.searchParams.get('site_id'), ip, ua);
      }
      // ---- 点击追踪 ----
      else if (path.startsWith('/click/') && request.method === 'GET') {
        const p = path.split('/'); // ['', 'click', adId, siteId]
        result = await handleClick(env, p[2], p[3], ip, ua);
      }
      // ---- 站点注册 ----
      else if (path === '/api/register' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        result = await handleRegister(env, body);
        // 注册成功 → 异步给管理员发审核提醒邮件（不阻塞响应）
        if (result && result.status === 200) {
          ctx.waitUntil(notifyNewApplication(env, {
            site_id: result.body.site_id,
            site_name: body.site_name || '',
            site_url: body.site_url || '',
            contact_email: body.contact_email || '',
          }));
        }
      }
      // ---- 已激活站点提交新广告 ----
      else if (path === '/api/ads' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        result = await handleAddAd(env, body);
        // 广告更新成功（已置 pending）→ 异步提醒管理员重新审核
        if (result && result.status === 200) {
          const site = await env.DB.prepare('SELECT id, site_name, contact_email FROM sites WHERE id = ?')
            .bind(Number(body.site_id))
            .first();
          if (site) {
            ctx.waitUntil(notifyAdReview(env, {
              site_id: site.id,
              site_name: site.site_name,
              site_url: site.site_url || '',
              ad_id: result.body.ad_id,
            }));
          }
        }
      }
      // ---- 已激活站点更新自身广告素材 ----
      else if (path === '/api/self' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        result = await handleUpdateSelf(env, body);
      }
      // ---- 站点自助统计 ----
      else if (path === '/api/stats' && request.method === 'GET') {
        result = await handleStats(env, url.searchParams.get('site_id'), url.searchParams.get('api_key'));
      }
      // ---- 会员密码登录 ----
      else if (path === '/api/member/login' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        result = await handleMemberLogin(env, body);
      }
      // ---- 会员设置/修改登录密码 ----
      else if (path === '/api/member/set-password' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        result = await handleSetPassword(env, body);
      }
      // ---- 管理后台 API ----
      else if (path.startsWith('/admin/api')) {
        result = await handleAdmin(env, request, url, path, ctx);
      }
      // ---- 根路径：健康检查 / 提示 ----
      else if (path === '/' && request.method === 'GET') {
        result = {
          status: 200,
          body: { ok: true, service: 'ad-alliance', message: '互助曝光广告联盟 API 运行中', endpoints: ['/api/serve', '/click/:ad_id/:site_id', '/api/register', '/api/ads', '/api/stats', '/admin/api'] },
        };
      }
      else {
        result = { status: 404, body: { error: 'not found' } };
      }

      return respond(result, corsHeaders);
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message || 'internal error' }), {
        status: 500,
        headers: { 'content-type': 'application/json', ...corsHeaders },
      });
    }
  },
};
