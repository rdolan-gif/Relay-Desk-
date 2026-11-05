# Connecting the Gmail inboxes

Relay Desk reads and sends mail through the **free Gmail API** (owner decisions O-2, O-10).
Nothing is paid for: the Google Cloud project, the API and the OAuth app are free for a
Google Workspace domain.

This is a one-off job for whoever administers Ricoman's Google Workspace (about 15 minutes).

## 1. Create the Google Cloud project

1. Sign in to <https://console.cloud.google.com> with a @ricoman.com admin account.
2. Create a project, e.g. **Relay Desk**.
3. **APIs & Services › Library** → search for **Gmail API** → **Enable**.

## 2. Set up the consent screen (internal)

1. **APIs & Services › OAuth consent screen** (or **Google Auth Platform › Branding**).
2. User type: **Internal**. Only @ricoman.com accounts can then sign in, Google does not
   need to review the app, and access does not expire every 7 days.
3. App name **Relay Desk**, support email and developer contact: an IT address.
4. Scopes (**Data access**): add
   - `https://www.googleapis.com/auth/gmail.readonly` (read new mail)
   - `https://www.googleapis.com/auth/gmail.send` (send replies)

   Relay Desk never deletes, labels or moves mail in Gmail; the inbox stays as it is.

## 3. Create the OAuth client

1. **APIs & Services › Credentials › Create credentials › OAuth client ID**.
2. Application type: **Web application**, name **Relay Desk**.
3. **Authorised redirect URI**: `<PUBLIC_URL>/api/oauth/google/callback`, for example
   `https://helpdesk.ricoman.com/api/oauth/google/callback`. Settings › Mailboxes in Relay
   Desk shows the exact address to paste while Google is not yet set up.
4. Copy the **Client ID** and **Client secret**.

## 4. Configure Relay Desk

Set these on the server (in `.env` or the `api` service's environment) and restart the API:

| Variable               | Value                                                          |
| ---------------------- | -------------------------------------------------------------- |
| `PUBLIC_URL`           | The address staff use, e.g. `https://helpdesk.ricoman.com`     |
| `GOOGLE_CLIENT_ID`     | From step 3                                                    |
| `GOOGLE_CLIENT_SECRET` | From step 3                                                    |
| `ENCRYPTION_KEY`       | Already set; the Gmail access is stored encrypted with it      |
| `MAIL_POLL_SECONDS`    | Optional; how often to check for new mail (default 60 seconds) |

## 5. Connect each inbox

`pnpm db:setup:support` creates the four mailboxes (support@, ryan@, thierry@ and
heather@ricoman.com). For each one:

1. An administrator opens **Settings › Mailboxes** and clicks **Connect Gmail**.
2. Google asks which account to use. **Sign in as the inbox itself** (for example
   support@ricoman.com, or Ryan signs in for ryan@ricoman.com) and allow access.
   Relay Desk refuses the connection if the account signed in does not match the mailbox
   address.
3. Back in Relay Desk the mailbox shows **Connected as …**. New mail is collected from that
   moment on; older mail already in the inbox is not imported (no migration, owner answer).

**Check for new mail now** collects mail immediately. The mailbox page shows the last check
time, any error, and the recent mail log (new ticket, added to ticket, ignored, bounce).

If someone changes their Google password or removes the app's access, the mailbox shows an
error; click **Reconnect**. **Disconnect** removes the stored Gmail access from Relay Desk.

## Who can send from which inbox

Rights profiles have a **Mailboxes they can send from** setting. `pnpm db:setup:support` gives
everyone the Support inbox and each person their own inbox. Back-office users never send email.

## Limits

The Gmail API's free quotas are far above 20–30 emails a day. A Google Workspace user can send
about 2,000 emails a day.
