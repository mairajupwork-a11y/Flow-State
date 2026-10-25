# Turning on emails

One email account powers everything WorkMars sends:

- **Invitations**: a "Join your workspace" email when you invite someone.
- **Password resets**: the "Forgot password?" link on the sign-in page emails a one-time reset link.
- **Notifications**: emails when someone mentions you, assigns you work, or an automation notifies you. Everyone chooses *Important*, *Everything* or *Off* in **Settings → Notifications**.

Recipients can use any email provider: Gmail, Outlook/Hotmail, Yahoo, iCloud or a company address.

Once WorkMars is online, also set `APP_URL` to its public address (for example `APP_URL=https://work.example.com`) so links in emails open the right site. Password resets refuse to send without it on a live server, so a stranger can't make reset links point somewhere else.

To send email, WorkMars needs an email account to send *from*. Two free options are below. Option A takes 5 minutes.

## Option A: Send from your Gmail (free, about 500 emails a day)

Gmail doesn't let apps use your normal password. Instead, you create a special **App Password**.

1. **Turn on 2-Step Verification.** Go to [myaccount.google.com/security](https://myaccount.google.com/security) and switch on **2-Step Verification**. App Passwords only appear once this is on.
2. **Create an App Password.** Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords), type the name `WorkMars`, and click **Create**.
3. **Copy it.** Google shows a 16-letter password like `abcd efgh ijkl mnop`. Copy it and remove the spaces.
4. **Add these lines to `.env`** in the WorkMars folder (in `cmd`: `notepad .env`):

   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=yourname@gmail.com
   SMTP_PASS=abcdefghijklmnop
   MAIL_FROM="WorkMars <yourname@gmail.com>"
   ```

5. **Restart WorkMars.** The black window should show:

   ```
   [api] Email: on (smtp.gmail.com, from WorkMars <yourname@gmail.com>)
   ```

## Option B: Brevo (free, 300 emails a day, best for a business address)

1. Sign up at [brevo.com](https://www.brevo.com).
2. Add and verify the address you want to send from under **Senders, domains & dedicated IPs**.
3. Open **SMTP & API → SMTP** and generate an SMTP key.
4. Add to `.env`:

   ```
   SMTP_HOST=smtp-relay.brevo.com
   SMTP_PORT=587
   SMTP_USER=your-brevo-login@example.com
   SMTP_PASS=your-smtp-key
   MAIL_FROM="WorkMars <you@yourcompany.com>"
   ```

Any other SMTP provider works the same way: Zoho Mail, Amazon SES, Resend, Mailgun, SendGrid and so on.

## Important: the link inside the email

The invitation contains a **Join** link pointing to wherever WorkMars is running.

- **While WorkMars only runs on your laptop,** the link is `http://127.0.0.1:5173/invite/…`. It only opens on *your* computer, so people elsewhere get the email but can't open the link yet.
- **Once WorkMars is online** (for example `https://workmars.yourcompany.com`), add this line so links point there:

  ```
  APP_URL=https://workmars.yourcompany.com
  ```

  Then the link works for everyone, on any device.

## How it behaves

- Inviting by email (from the Team page or during setup) sends the email straight away. The dialog shows **✓ Emailed** or **✕ Not emailed** for each person.
- Every invite also has a link you can copy and share yourself, for example over WhatsApp.
- On the Team page, pending invites have a **Resend** button.
- If email isn't set up, everything still works through copy-able links.

## Troubleshooting

| Black window or invite dialog says | Fix |
| --- | --- |
| `Email login was rejected` / `535 Username and Password not accepted` | For Gmail, use the 16-letter **App Password**, not your normal password, and make sure 2-Step Verification is on. |
| `Could not reach the SMTP server` | Check `SMTP_PORT`: 465 for Gmail, 587 for most others. Some office networks block these ports. |
| `The receiving mail server rejected this address` | The recipient's address is misspelled or doesn't exist. |
| Email arrives in **Spam** | Normal at first. Ask recipients to mark it "Not spam". For best delivery, send from your own domain via Brevo or similar. |
| No `Email: on` line | The `SMTP_…` lines aren't in `.env`, or WorkMars wasn't restarted. |
