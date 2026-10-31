/* ============================================================
 * 互助曝光广告联盟 · 站点嵌入代码（双栏广告位）
 * ------------------------------------------------------------
 * 渲染效果：
 *   ┌─────────────┬───────────────────────────────┐
 *   │  左 100x100  │          右 300x100             │
 *   │  本站自身广告  │   随机参与联盟站点广告             │
 *   └─────────────┴───────────────────────────────┘
 *   左：联盟站点自身的图片 + 链接（指向自己）
 *   右：随机一个参与站点广告，点击经服务器 /click/ 中转统计
 *
 * 用法（三选一）：
 *
 *  方式一：外链引入（推荐，改配置后所有站点自动生效）
 *    <script src="https://ad.yourdomain.com/embed.js"
 *            data-site-id="你的站点ID"
 *            async defer></script>
 *
 *  方式二：内联到页面（复制本文件内容进 <script>，改底部 INLINE.siteId）
 *
 *  方式三：data-base 指定 API 域名（当 embed.js 与 API 不同域时）
 *
 * 注意事项：
 *  - data-site-id 必须填你的站点 ID（注册审核通过后返回）
 *  - 右侧广告点击统一走服务器 /click/... 中转，否则无法统计点击
 *  - 链接已加 rel="noopener nofollow sponsored"，符合平台规范
 * ============================================================ */
(function (global) {
  'use strict';

  // 读取 <script> 标签的 data-* 配置
  function readConfig() {
    var script = document.currentScript;
    if (!script) return { siteId: null, base: '' };
    var d = script.dataset;
    // 自动从 embed.js 自身的 URL 推导 API 域名（同域部署时不用手动填）
    var base = '';
    try { base = new URL(script.src).origin; } catch (e) {}
    return { siteId: d.siteId || null, base: d.base || base };
  }

  var cfg = readConfig();

  // 内联使用时也可直接改这里
  var INLINE = {
    siteId: null,   // 填你的站点 ID
    base: ''        // API 域名，留空则自动用 embed.js 所在域名
  };
  if (cfg.siteId) INLINE.siteId = cfg.siteId;
  INLINE.base = cfg.base || INLINE.base;

  if (!INLINE.siteId) {
    if (console && console.warn) console.warn('[AdAlliance] 未设置 data-site-id，广告位未渲染。');
    return;
  }

  var API = INLINE.base || 'https://ad.yourdomain.com';

  // ---- 创建双栏容器：左 100x100 自身广告 + 右 300x100 伙伴广告 ----
  var wrap = document.createElement('div');
  wrap.setAttribute('data-ad-alliance', '');
  wrap.style.cssText =
    'display:flex;align-items:stretch;gap:2px;margin:10px auto;' +
    'width:402px;max-width:100%;height:100px;overflow:hidden;';
  wrap.style.display = 'none'; // 数据未返回前隐藏，避免占位闪烁

  var left = document.createElement('div');   // 100x100
  left.style.cssText = 'flex:0 0 100px;width:100px;height:100px;overflow:hidden;background:#f1f3f4;';
  var right = document.createElement('div');  // 300x100
  right.style.cssText = 'flex:1 1 auto;min-width:0;height:100px;overflow:hidden;background:#f1f3f4;';
  wrap.appendChild(left);
  wrap.appendChild(right);

  var host = (document.currentScript && document.currentScript.parentNode) || document.body;
  host.appendChild(wrap);

  // 生成"图片+链接"广告块
  function makeAd(href, imgSrc) {
    var a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener nofollow sponsored';
    a.title = '赞助商广告';
    a.style.cssText = 'display:block;width:100%;height:100%;text-decoration:none;';
    var img = document.createElement('img');
    img.src = imgSrc;
    img.alt = '广告';
    img.loading = 'lazy';
    img.style.cssText = 'display:block;width:100%;height:100%;object-fit:cover;border:0;';
    a.appendChild(img);
    return a;
  }

  // 请求 /api/embed：一次拿到左右两块数据
  var xhr = new XMLHttpRequest();
  xhr.open('GET', API + '/api/embed?site_id=' + encodeURIComponent(INLINE.siteId) + '&_t=' + Date.now(), true);
  xhr.timeout = 8000;
  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4) return;
    if (xhr.status !== 200) return;
    try {
      var d = JSON.parse(xhr.responseText);
      var hasAny = false;

      // 左侧：本站自身广告（100x100），链接直接指向自己
      if (d.self && d.self.image_url && d.self.target_url) {
        left.appendChild(makeAd(d.self.target_url, d.self.image_url));
        hasAny = true;
        left.style.display = 'block';
      } else {
        left.style.display = 'none';
      }

      // 右侧：随机伙伴广告（300x100），点击走服务器中转
      if (d.partner && d.partner.image_url && d.partner.click_url) {
        right.appendChild(makeAd(d.partner.click_url, d.partner.image_url));
        hasAny = true;
      } else {
        // 无可用伙伴广告：给出提示，避免误以为是 bug
        right.innerHTML = '<span style="display:flex;width:100%;height:100%;align-items:center;justify-content:center;font-size:11px;color:#999;text-align:center;line-height:1.5">暂无联盟内其他会员广告<br>邀请更多博客加入即可互相曝光</span>';
        hasAny = true;
      }

      // 若左侧无自身广告，则让右侧伙伴广告占满整行
      if (hasAny) wrap.style.display = 'flex';
    } catch (e) {
      // 解析失败静默隐藏
    }
  };
  xhr.send();
})(window);
