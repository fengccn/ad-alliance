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

  // ---- RSS 文章广告样式（只向页面注入一次，避免重复） ----
  var RSS_CSS = [
    '.aa-rss{position:relative;display:flex;flex-direction:column;justify-content:center;',
    'width:100%;height:100%;padding:9px 14px;box-sizing:border-box;overflow:hidden;',
    'border:1px solid rgba(0,0,0,.07);border-radius:2px;}',
    '.aa-rss::after{content:"";position:absolute;inset:0;pointer-events:none;',
    'background:linear-gradient(180deg,rgba(255,255,255,.50),rgba(255,255,255,0));}',
    '.aa-rss .aa-link{position:relative;z-index:1;text-decoration:none;-webkit-tap-highlight-color:transparent;}',
    '.aa-rss .aa-site{display:block;height:22px;line-height:22px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.aa-rss .aa-label{font-size:11.5px;color:#8d8d8d;font-weight:400;letter-spacing:.5px;}',
    '.aa-rss .aa-name{font-size:15.5px;font-weight:700;letter-spacing:.3px;',
    'background:linear-gradient(92deg,#0b57d0,#8a3ffc,#0b57d0);-webkit-background-clip:text;',
    'background-clip:text;color:transparent;}',
    '.aa-rss .aa-post{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;',
    'min-height:35px;margin-top:5px;text-align:center;font-size:12px;line-height:1.45;',
    'background:linear-gradient(90deg,#0f766e,#1a73e8);-webkit-background-clip:text;',
    'background-clip:text;color:transparent;}',
    '.aa-rss a:hover{animation:aaRssBreath 1.8s ease-in-out infinite;}',
    '@keyframes aaRssBreath{0%,100%{opacity:1;filter:drop-shadow(0 0 0 rgba(26,115,232,0));}',
    '50%{opacity:.84;filter:drop-shadow(0 0 5px rgba(26,115,232,.45));}}',
    /* 宣纸：米白底 + 两层细纤维颗粒 */
    '.aa-theme-rice{background-color:#faf7ef;background-image:',
    'radial-gradient(rgba(140,105,60,.10) 1px,transparent 1.2px),',
    'radial-gradient(rgba(140,105,60,.06) 1px,transparent 1.2px),',
    'linear-gradient(180deg,#fffdf7,#f4efe1);',
    'background-size:13px 13px,9px 9px,100% 100%;background-position:0 0,5px 6px,0 0;}',
    /* 卡纸：暖白 + 极细横纹 */
    '.aa-theme-card{background-color:#f6f4f0;background-image:',
    'repeating-linear-gradient(0deg,rgba(0,0,0,.030) 0 1px,transparent 1px 4px),',
    'linear-gradient(180deg,#fbfaf7,#eeeae2);}',
    /* 格纹：浅青方格 */
    '.aa-theme-grid{background-color:#f7faf9;background-image:',
    'linear-gradient(rgba(15,118,110,.075) 1px,transparent 1px),',
    'linear-gradient(90deg,rgba(15,118,110,.075) 1px,transparent 1px);background-size:12px 12px;}',
    /* 点纹：淡蓝圆点 */
    '.aa-theme-dot{background-color:#f5f9ff;background-image:',
    'radial-gradient(rgba(26,115,232,.16) 1.4px,transparent 1.6px);background-size:9px 9px;}'
  ].join('');

  function injectRssStyle() {
    var head = document.head || document.documentElement;
    if (!head || document.getElementById('aa-rss-style')) return;
    var s = document.createElement('style');
    s.id = 'aa-rss-style';
    s.textContent = RSS_CSS;
    head.appendChild(s);
  }

  // 生成 RSS 文章广告块：上为「推荐博客：站点名」，下为居中、最多两行的最新文章标题
  function makeRssAd(p) {
    injectRssStyle();

    var theme = /^(rice|card|grid|dot)$/.test(p.theme || '') ? p.theme : 'rice';
    var box = document.createElement('div');
    box.className = 'aa-rss aa-theme-' + theme;

    // 第一行：推荐博客：站点名（整行链到站点首页）
    var a1 = document.createElement('a');
    a1.className = 'aa-link aa-site';
    a1.href = p.site_click_url || p.site_url || '#';
    a1.target = '_blank';
    a1.rel = 'noopener nofollow sponsored';
    a1.title = '访问该站点';

    var label = document.createElement('span');
    label.className = 'aa-label';
    label.textContent = '推荐博客：';

    var name = document.createElement('span');
    name.className = 'aa-name';
    name.textContent = p.site_name || '';

    a1.appendChild(label);
    a1.appendChild(name);

    // 第二行：最新文章标题（居中，超长最多两行，链到文章）
    var a2 = document.createElement('a');
    a2.className = 'aa-link aa-post';
    a2.href = p.article_click_url || p.article_url || '#';
    a2.target = '_blank';
    a2.rel = 'noopener nofollow sponsored';
    a2.title = '阅读最新文章';
    a2.textContent = p.article_title || '最新文章';

    box.appendChild(a1);
    box.appendChild(a2);
    return box;
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

      // 右侧：随机伙伴广告（300x100）。图片广告直接显图；RSS 广告显示站点名 + 最新文章标题
      if (d.partner && d.partner.mode === 'rss' && (d.partner.site_name || d.partner.article_title)) {
        right.appendChild(makeRssAd(d.partner));
        hasAny = true;
      } else if (d.partner && d.partner.image_url && d.partner.click_url) {
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
