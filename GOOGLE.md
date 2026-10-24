# Turning on "Continue with Google"

WorkMars's sign-up and sign-in pages show a **Sign up with Google / Continue with Google** button. To make it work, WorkMars needs its own Google OAuth "client". It's free and takes about 10 minutes.

## 1. Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and sign in with your Google account.
2. Click the project picker at the top, then **New project**.
3. Name it `WorkMars` and click **Create**.
4. Make sure the new project is selected in the picker.

## 2. Set up the consent screen

This is the screen users see when they choose their Google account.

1. In the search bar at the top, type **"Google Auth Platform"** and open it. In some accounts it's under **APIs & Services → OAuth consent screen**.
2. Click **Get started** and fill in:
   - **App name:** `WorkMars`
   - **User support email:** your email
   - **Audience:** **External**
   - **Contact email:** your email
3. Agree to the policy and click **Create**.
4. Open **Audience**. While the app is in **Testing**, only the people you list under **Test users** can sign in, so add your own Gmail address and those of any teammates.

   When you're ready for anyone to use it, click **Publish app**. WorkMars only asks for name, email and profile picture, so Google doesn't require a review.

## 3. Create the OAuth client

1. Open **Clients** (or **APIs & Services → Credentials → Create credentials → OAuth client ID**).
2. Choose **Application type: Web application**. Name it `WorkMars web`.
3. Under **Authorized redirect URIs**, click **Add URI** and add both of these exactly:
   ```
   http://localhost:5173/api/auth/google/callback
   http://127.0.0.1:5173/api/auth/google/callback
   ```
   When WorkMars is online later, also add `https://your-domain/api/auth/google/callback`.
4. Click **Create**. Copy the **Client ID** and **Client secret**.

## 4. Add them to WorkMars

Open `.env` in the WorkMars folder (in `cmd`: `notepad .env`) and add:

```
GOOGLE_CLIENT_ID=1234567890-abc123.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-secret
```

Save, then restart WorkMars: close the black window and run `start-windows` again. The window shows:

```
[api] Google sign-in: on
```

Open the sign-up page and click **Sign up with Google**.

## How it behaves

- **New Google users** get a WorkMars account using their Google name and email, then go through onboarding.
- **Existing accounts are reused.** If an account already exists with the same email (for example from an email sign-up), Google sign-in logs into that same account. Only Google-verified emails are accepted.
- **Google-only accounts have no WorkMars password.** If someone tries the email form, they're told to use Google.
- **Invite links work with Google too.** After choosing a Google account, the person lands back on the invite.

## Troubleshooting

| Google shows | Fix |
| --- | --- |
| `Error 400: redirect_uri_mismatch` | The address in your browser isn't registered. Add the exact URI from step 3. `localhost` and `127.0.0.1` count as different addresses. |
| `Access blocked: … has not completed the Google verification process` / `403 access_denied` | The app is in Testing and your email isn't a test user. Add it under **Audience → Test users**, or publish the app. |
| `Error 401: invalid_client` | The Client ID or secret in `.env` is wrong or has spaces. Copy them again. |
| The button says Google isn't switched on | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` aren't in `.env`, or WorkMars wasn't restarted. |

**Advanced:** behind a proxy or custom domain, set `GOOGLE_REDIRECT_URL` to the full callback URL if the automatically detected one doesn't match.
