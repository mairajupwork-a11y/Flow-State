import nodemailer from 'nodemailer';

/**
 * Outgoing email over SMTP — works with any provider (Gmail, Outlook,
 * Brevo, Zoho, Amazon SES, Resend, …). Configure either SMTP_URL
 * (e.g. smtps://user:pass@smtp.gmail.com:465) or SMTP_HOST / SMTP_PORT /
 * SMTP_USER / SMTP_PASS, plus MAIL_FROM. Returns null when not configured.
 */
export function createMailer(env = process.env) {
  const from = env.MAIL_FROM || env.SMTP_USER;
  let options;
  if (env.SMTP_URL) options = env.SMTP_URL;
  else if (env.SMTP_HOST) {
    const port = Number(env.SMTP_PORT) || 587;
    options = { host: env.SMTP_HOST, port, secure: port === 465, auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined };
  } else return null;
  if (!from) throw new Error('Set MAIL_FROM to the address emails should come from (e.g. "Flowstate <you@gmail.com>").');

  const transport = nodemailer.createTransport(options, { from });
  const host = typeof options === 'string' ? new URL(options).hostname : options.host;
  return {
    host,
    from,
    /** Checks the login works; returns an error message or null. */
    verify: () => transport.verify().then(() => null, (err) => err.message),
    send: (message) => transport.sendMail(message),
  };
}

export { mailHint } from './emails.js';
