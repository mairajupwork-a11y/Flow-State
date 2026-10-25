/** Email templates. Plain functions so they also work in the browser demo build. */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const oneLine = (s) => String(s).replace(/[\r\n]+/g, ' ').trim();
const ROLE = { admin: 'an admin', member: 'a member', viewer: 'a viewer' };

export function inviteEmail({ to, inviter, workspace, role, designation = '', url }) {
  const as = designation ? designation : ROLE[role] ?? 'a member';
  const asText = designation ? `as ${designation}` : `as ${as}`;
  const subject = oneLine(`${inviter} invited you to ${workspace} on WorkMars`);
  const text = [
    `Hi,`,
    ``,
    `${inviter} has invited you to join ${workspace} on WorkMars ${asText}.`,
    ``,
    `Accept the invitation: ${url}`,
    ``,
    `WorkMars is free for everyone — boards, sprints, timelines and a free AI guide.`,
    `If you weren't expecting this, you can ignore this email.`,
  ].join('\n');
  const html = `<!doctype html>
<html><body style="margin:0;background:#f3e9da;font-family:'Plus Jakarta Sans',Segoe UI,Helvetica,Arial,sans-serif;color:#2b160d">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:32px">
        <tr><td style="font-size:22px;font-weight:800;letter-spacing:-.5px;color:#2b160d;padding-bottom:20px">Work<span style="color:#a65a2e">Mars</span></td></tr>
        <tr><td style="font-size:22px;font-weight:700;line-height:1.3;padding-bottom:12px">You're invited to ${esc(workspace)}</td></tr>
        <tr><td style="font-size:15px;line-height:1.6;color:#785e4c;padding-bottom:24px">
          <b style="color:#2b160d">${esc(inviter)}</b> has invited you to join <b style="color:#2b160d">${esc(workspace)}</b> on WorkMars ${designation ? `as <b style="color:#2b160d">${esc(designation)}</b>` : `as ${as}`}.
        </td></tr>
        <tr><td style="padding-bottom:24px">
          <a href="${esc(url)}" style="display:inline-block;background:#2b160d;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:999px">Join ${esc(workspace)}</a>
        </td></tr>
        <tr><td style="font-size:13px;line-height:1.6;color:#8f7461;padding-bottom:8px">Or paste this link into your browser:<br><a href="${esc(url)}" style="color:#a65a2e;word-break:break-all">${esc(url)}</a></td></tr>
        <tr><td style="font-size:12px;line-height:1.6;color:#8f7461;border-top:1px solid #eadbc6;padding-top:16px;margin-top:16px">
          WorkMars is free for everyone. This invitation was sent to ${esc(to)}. If you weren't expecting it, you can ignore this email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  return { to, subject, text, html };
}

/** Shared frame for simple one-button emails, in the WorkMars palette. */
function frame({ heading, body, button, url, footer }) {
  return `<!doctype html>
<html><body style="margin:0;background:#f3e9da;font-family:'Plus Jakarta Sans',Segoe UI,Helvetica,Arial,sans-serif;color:#2b160d">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fffaf3;border-radius:16px;padding:32px">
        <tr><td style="font-size:22px;font-weight:800;letter-spacing:-.5px;color:#2b160d;padding-bottom:20px">Work<span style="color:#a65a2e">Mars</span></td></tr>
        <tr><td style="font-size:21px;font-weight:700;line-height:1.3;padding-bottom:12px">${heading}</td></tr>
        <tr><td style="font-size:15px;line-height:1.6;color:#785e4c;padding-bottom:24px">${body}</td></tr>
        ${url ? `<tr><td style="padding-bottom:24px"><a href="${esc(url)}" style="display:inline-block;background:#2b160d;color:#fbf1e3;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:999px">${button}</a></td></tr>
        <tr><td style="font-size:13px;line-height:1.6;color:#8f7461;padding-bottom:8px">Or paste this link into your browser:<br><a href="${esc(url)}" style="color:#a65a2e;word-break:break-all">${esc(url)}</a></td></tr>` : ''}
        <tr><td style="font-size:12px;line-height:1.6;color:#8f7461;border-top:1px solid #eadbc6;padding-top:16px">${footer}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function passwordResetEmail({ to, name, url, minutes = 60 }) {
  const subject = 'Reset your WorkMars password';
  const text = [`Hi ${oneLine(name)},`, '', 'Someone (hopefully you) asked to reset your WorkMars password.', '', `Choose a new password: ${url}`, '',
    `This link works once and expires in ${minutes} minutes. If you didn't ask for this, ignore this email — your password stays the same.`].join('\n');
  const html = frame({
    heading: 'Reset your password',
    body: `Hi ${esc(name)}, someone (hopefully you) asked to reset your WorkMars password. The link below works once and expires in ${minutes} minutes.`,
    button: 'Choose a new password', url,
    footer: `Sent to ${esc(to)}. If you didn't ask for this, you can ignore it — your password stays the same.`,
  });
  return { to, subject, text, html };
}

export function notificationEmail({ to, name, text: message, workspace, url, issueKey }) {
  const subject = oneLine(issueKey ? `[${workspace}] ${message}` : `[${workspace}] ${message}`).slice(0, 180);
  const text = [`Hi ${oneLine(name)},`, '', message, '', url ? `Open it in WorkMars: ${url}` : '', '',
    'You get these emails for mentions and assignments. Change this any time in WorkMars → Settings → Notifications.'].join('\n');
  const html = frame({
    heading: issueKey ? `${esc(issueKey)} · ${esc(workspace)}` : esc(workspace),
    body: esc(message),
    button: issueKey ? `Open ${esc(issueKey)}` : 'Open WorkMars', url,
    footer: `Sent to ${esc(to)}. Choose which emails you get in WorkMars → Settings → Notifications.`,
  });
  return { to, subject, text, html };
}

/** Explains common SMTP failures in plain English. */
export function mailHint(message = '') {
  if (/\b(550|551|553|554)\b|recipient|mailbox unavailable|no such user|address rejected/i.test(message)) {
    return 'The receiving mail server rejected this address — check it is spelled correctly.';
  }
  if (/535|Username and Password not accepted|Invalid login|authentication failed/i.test(message)) {
    return 'The email login was rejected. For Gmail, use a 16-character App Password (not your normal password) — see EMAIL.md.';
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) return 'The SMTP server name could not be found. Check SMTP_HOST.';
  if (/ETIMEDOUT|ECONNREFUSED|timeout/i.test(message)) return 'Could not reach the SMTP server. Check SMTP_PORT (587 or 465) and your internet/firewall.';
  return 'Check the SMTP settings in .env (see EMAIL.md).';
}
