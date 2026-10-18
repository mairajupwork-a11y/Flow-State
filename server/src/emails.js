/** Email templates. Plain functions so they also work in the browser demo build. */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const oneLine = (s) => String(s).replace(/[\r\n]+/g, ' ').trim();
const ROLE = { admin: 'an admin', member: 'a member', viewer: 'a viewer' };

export function inviteEmail({ to, inviter, workspace, role, url }) {
  const subject = oneLine(`${inviter} invited you to ${workspace} on Flowstate`);
  const text = [
    `Hi,`,
    ``,
    `${inviter} has invited you to join ${workspace} on Flowstate as ${ROLE[role] ?? 'a member'}.`,
    ``,
    `Accept the invitation: ${url}`,
    ``,
    `Flowstate is free for everyone — boards, sprints, timelines and a free AI guide.`,
    `If you weren't expecting this, you can ignore this email.`,
  ].join('\n');
  const html = `<!doctype html>
<html><body style="margin:0;background:#f4f3f7;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1b1d29">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:32px">
        <tr><td style="font-size:20px;font-weight:700;color:#3a1f86;padding-bottom:20px">flowstate<span style="color:#8278f4">.</span></td></tr>
        <tr><td style="font-size:22px;font-weight:700;line-height:1.3;padding-bottom:12px">You're invited to ${esc(workspace)}</td></tr>
        <tr><td style="font-size:15px;line-height:1.6;color:#5d6072;padding-bottom:24px">
          <b style="color:#1b1d29">${esc(inviter)}</b> has invited you to join <b style="color:#1b1d29">${esc(workspace)}</b> on Flowstate as ${ROLE[role] ?? 'a member'}.
        </td></tr>
        <tr><td style="padding-bottom:24px">
          <a href="${esc(url)}" style="display:inline-block;background:#3a1f86;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:999px">Join ${esc(workspace)}</a>
        </td></tr>
        <tr><td style="font-size:13px;line-height:1.6;color:#858899;padding-bottom:8px">Or paste this link into your browser:<br><a href="${esc(url)}" style="color:#4b2fa8;word-break:break-all">${esc(url)}</a></td></tr>
        <tr><td style="font-size:12px;line-height:1.6;color:#858899;border-top:1px solid #ebeaf0;padding-top:16px;margin-top:16px">
          Flowstate is free for everyone. This invitation was sent to ${esc(to)}. If you weren't expecting it, you can ignore this email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
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
