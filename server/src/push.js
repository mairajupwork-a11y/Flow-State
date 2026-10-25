import webpush from 'web-push';

/**
 * Web Push (browser / phone notifications). The VAPID key pair identifies this
 * server to the browsers' push services. It comes from VAPID_PUBLIC_KEY /
 * VAPID_PRIVATE_KEY when set, otherwise it is generated once and kept in the
 * database, so subscriptions keep working across restarts and machines.
 */
export async function createPush(db, { env = process.env, appUrl = null, log = console } = {}) {
  let keys = env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY } : null;
  if (!keys) {
    const row = await db.get("SELECT value FROM app_kv WHERE key = 'vapid'");
    if (row) keys = JSON.parse(row.value);
    else {
      keys = webpush.generateVAPIDKeys();
      await db.run("INSERT OR IGNORE INTO app_kv (key, value) VALUES ('vapid', ?)", JSON.stringify(keys));
      // Another instance may have won the race; use whichever pair was stored.
      keys = JSON.parse((await db.get("SELECT value FROM app_kv WHERE key = 'vapid'")).value);
    }
  }
  // Push services want a contact: a mailto: or https: URL for the operator.
  const contact = env.VAPID_SUBJECT
    || (appUrl?.startsWith('https://') ? appUrl : null)
    || (/[^\s<>@]+@[^\s<>@]+/.exec(env.MAIL_FROM || env.SMTP_USER || '')?.[0] ? `mailto:${/[^\s<>@]+@[^\s<>@]+/.exec(env.MAIL_FROM || env.SMTP_USER)[0]}` : 'mailto:notifications@workmars.app');
  webpush.setVapidDetails(contact, keys.publicKey, keys.privateKey);

  /** Sends to every device the user enabled; drops subscriptions the push service says are gone. */
  async function sendToUser(userId, payload) {
    const subs = await db.all('SELECT * FROM push_subscriptions WHERE user_id = ?', userId);
    let sent = 0;
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 24 * 3600, urgency: 'high' });
        sent++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) await db.run('DELETE FROM push_subscriptions WHERE id = ?', s.id);
        else log.warn?.(`Push to user ${userId} failed: ${err.statusCode ?? ''} ${err.body || err.message}`);
      }
    }));
    return { devices: subs.length, sent };
  }

  return { publicKey: keys.publicKey, sendToUser };
}
