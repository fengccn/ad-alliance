/**
 * 邮件提醒：新会员提交申请后，实时给管理员发一封审核提醒邮件。
 * 使用 Resend API（https://api.resend.com/emails）。
 *
 * 需要配置的 Worker 环境变量（Secrets，在 Cloudflare 控制台设置）：
 *   MAIL_API_KEY   Resend 的 API Key（必填）
 *   MAIL_FROM      发信地址，如 noreply@你的域名（必填，该域名需在 Resend 完成验证）
 *   ADMIN_EMAIL    收件邮箱（你的邮箱，必填）
 */
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/** 通过 Resend 发送一封邮件（未配置则跳过并打印提示） */
export async function sendMail(env, { to, subject, html }) {
  if (!env.MAIL_API_KEY) { console.warn('[mail] MAIL_API_KEY 未设置，跳过发送'); return; }
  if (!env.MAIL_FROM) { console.warn('[mail] MAIL_FROM 未设置，跳过发送'); return; }
  if (!to) { console.warn('[mail] 收件人为空，跳过发送'); return; }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + env.MAIL_API_KEY,
    },
    body: JSON.stringify({ from: env.MAIL_FROM, to, subject, html }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    console.error('[mail] 发送失败', res.status, t);
  } else {
    console.log('[mail] 已发送至 ' + to + ' | 主题：' + subject);
  }
}

/** 新会员提交申请 → 通知管理员去审核 */
export function notifyNewApplication(env, site) {
  return sendMail(env, {
    to: env.ADMIN_EMAIL,
    subject: '[互助广告联盟] 新会员待审核：' + (site.site_name || ''),
    html:
      '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#202124">' +
        '<h2 style="color:#1a73e8">有新会员提交了申请，等待审核</h2>' +
        '<table style="border-collapse:collapse;font-size:14px">' +
          '<tr><td style="padding:6px 12px;color:#5f6368">站点名称</td><td style="padding:6px 12px"><b>' + escapeHtml(site.site_name) + '</b></td></tr>' +
          '<tr><td style="padding:6px 12px;color:#5f6368">站点 ID</td><td style="padding:6px 12px">' + escapeHtml(site.site_id) + '</td></tr>' +
          '<tr><td style="padding:6px 12px;color:#5f6368">站点网址</td><td style="padding:6px 12px"><a href="' + escapeHtml(site.site_url) + '">' + escapeHtml(site.site_url) + '</a></td></tr>' +
          '<tr><td style="padding:6px 12px;color:#5f6368">联系邮箱</td><td style="padding:6px 12px">' + escapeHtml(site.contact_email) + '</td></tr>' +
          '<tr><td style="padding:6px 12px;color:#5f6368">提交时间</td><td style="padding:6px 12px">' + new Date().toLocaleString('zh-CN') + '</td></tr>' +
        '</table>' +
        '<p style="margin-top:20px">请登录管理后台审核该站点与广告。</p>' +
        '<p style="color:#888;font-size:12px">这是互助曝光广告联盟的自动通知邮件。</p>' +
      '</div>',
  });
}

/** 会员修改/重提广告 → 通知管理员重新审核 */
export function notifyAdReview(env, site) {
  return sendMail(env, {
    to: env.ADMIN_EMAIL,
    subject: '[互助广告联盟] 会员广告待审核：' + (site.site_name || ''),
    html:
      '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#202124">' +
        '<h2 style="color:#1a73e8">有会员更新了广告，等待重新审核</h2>' +
        '<table style="border-collapse:collapse;font-size:14px">' +
          '<tr><td style="padding:6px 12px;color:#5f6368">站点名称</td><td style="padding:6px 12px"><b>' + escapeHtml(site.site_name) + '</b></td></tr>' +
          '<tr><td style="padding:6px 12px;color:#5f6368">站点 ID</td><td style="padding:6px 12px">' + escapeHtml(site.site_id) + '</td></tr>' +
          (site.ad_id ? '<tr><td style="padding:6px 12px;color:#5f6368">广告 ID</td><td style="padding:6px 12px">' + escapeHtml(site.ad_id) + '</td></tr>' : '') +
          '<tr><td style="padding:6px 12px;color:#5f6368">更新时间</td><td style="padding:6px 12px">' + new Date().toLocaleString('zh-CN') + '</td></tr>' +
        '</table>' +
        '<p style="margin-top:20px">广告已自动置为待审，请到管理后台重新审核。</p>' +
        '<p style="color:#888;font-size:12px">这是互助曝光广告联盟的自动通知邮件。</p>' +
      '</div>',
  });
}

/** 审核通过 → 通知会员（kind: ad=广告通过 / site=站点激活） */
export function notifyMemberApproved(env, site) {
  const isAd = site.kind === 'ad';
  const subject = '[互助广告联盟] ' + (isAd ? '你的广告已通过审核' : '你的站点已激活') + '：' + (site.site_name || '');
  const headline = isAd ? '恭喜，你的广告已通过审核，开始展示' : '你的站点已激活，可以正式加入联盟';
  return sendMail(env, {
    to: site.contact_email,
    subject,
    html:
      '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#202124">' +
        '<h2 style="color:#1a73e8">' + headline + '</h2>' +
        '<table style="border-collapse:collapse;font-size:14px">' +
          '<tr><td style="padding:6px 12px;color:#5f6368">站点名称</td><td style="padding:6px 12px"><b>' + escapeHtml(site.site_name) + '</b></td></tr>' +
          '<tr><td style="padding:6px 12px;color:#5f6368">站点 ID</td><td style="padding:6px 12px">' + escapeHtml(site.site_id) + '</td></tr>' +
          '<tr><td style="padding:6px 12px;color:#5f6368">状态</td><td style="padding:6px 12px"><b style="color:#188038">已激活 / 正常展示</b></td></tr>' +
        '</table>' +
        '<p style="margin-top:20px">' + (isAd
          ? '你的广告已经可以展示在联盟内其他站点上，同时你的页面也会开始展示别人的广告。'
          : '请把你申请时获得的嵌入代码贴到网站中，即可开始互相曝光。') + '</p>' +
        '<p style="color:#888;font-size:12px">这是互助曝光广告联盟的自动通知邮件，请勿直接回复。</p>' +
      '</div>',
  });
}

/** 广告被驳回 → 通知会员，并提示可修改后重新递交 */
export function notifyMemberRejected(env, site) {
  return sendMail(env, {
    to: site.contact_email,
    subject: '[互助广告联盟] 很遗憾，你的广告未通过审核：' + (site.site_name || ''),
    html:
      '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#202124">' +
        '<h2 style="color:#d93025">很遗憾，你的广告未通过审核</h2>' +
        '<p style="font-size:14px">你的申请中提交的广告没有通过管理员审核，目前暂未展示。</p>' +
        '<table style="border-collapse:collapse;font-size:14px">' +
          '<tr><td style="padding:6px 12px;color:#5f6368">站点名称</td><td style="padding:6px 12px"><b>' + escapeHtml(site.site_name) + '</b></td></tr>' +
          '<tr><td style="padding:6px 12px;color:#5f6368">站点 ID</td><td style="padding:6px 12px">' + escapeHtml(site.site_id) + '</td></tr>' +
        '</table>' +
        '<p style="margin-top:20px">你可以登录<a href="#" style="color:#1a73e8">会员自助管理</a>页面，修改广告图片或链接后重新提交，我们将再次审核。</p>' +
        '<p style="color:#888;font-size:12px">这是互助曝光广告联盟的自动通知邮件，请勿直接回复。</p>' +
      '</div>',
  });
}
