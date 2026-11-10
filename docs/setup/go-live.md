# Going live (support.ricoman.com)

A first install on the server, with **no demo data**: Ricoman's categories, rights, views,
inboxes, working hours and reply targets, and the four staff accounts. Staff sign in with
their **@ricoman.com Google account**; there are no staff passwords. Administrators also get
an emergency password for when Google is unavailable, which only works once they have turned
on two-factor.

Allow about an hour, most of it the Google Cloud steps.

## 1. Get the code

```bash
git pull                 # the latest main
pnpm install --frozen-lockfile
pnpm build
```

## 2. Production settings

Put these in the server's `.env` (or the `api` service's environment). **Never** use the
values from `.env.example`.

| Variable               | Value                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `NODE_ENV`             | `production`                                                                               |
| `DATABASE_URL`         | The live PostgreSQL 16 database (empty for a first install)                                |
| `ENCRYPTION_KEY`       | New, random: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `PUBLIC_URL`           | `https://support.ricoman.com`                                                              |
| `WEB_ORIGIN`           | `https://support.ricoman.com`                                                              |
| `COOKIE_SECURE`        | `true` (the site must be served over HTTPS)                                                |
| `GOOGLE_CLIENT_ID`     | From the Google Cloud steps (`gmail.md`, steps 1–3)                                        |
| `GOOGLE_CLIENT_SECRET` | From the same steps                                                                        |
| `GOOGLE_SIGNIN_DOMAIN` | `ricoman.com`                                                                              |
| `PASSWORD_SIGNIN`      | `administrators`                                                                           |
| `STORAGE_DIR`          | Where emails and attachments are kept, e.g. `/var/lib/relay-desk/storage` (back it up)     |

**Keep `ENCRYPTION_KEY` safe and backed up** (e.g. in the company password manager). It
protects the Gmail connections and two-factor secrets; if it is lost, every inbox has to be
reconnected and everyone has to set up two-factor again.

The Google OAuth client needs **both** redirect addresses (`gmail.md`, step 3):
`https://support.ricoman.com/api/oauth/google/callback` and
`https://support.ricoman.com/api/auth/google/callback`.

## 3. Create the database tables

```bash
pnpm db:migrate
```

## 4. First install

Name each person once, with their real name and @ricoman.com address. Richard and Ryan are
administrators; Thierry and Heather are agents. Names must start with Richard, Ryan, Thierry or
Heather (the setup has views and rights for each); anyone else is added later in Settings › Users.

```bash
pnpm db:install -- \
  --admin "Richard Surname <richard@ricoman.com>" \
  --admin "Ryan Surname <ryan@ricoman.com>" \
  --agent "Thierry Surname <thierry@ricoman.com>" \
  --agent "Heather Surname <heather@ricoman.com>"
```

It prints each account and, for the two administrators, an **emergency password shown only
once**. Store them in the password manager.

The command refuses to run if the database already has any accounts. **If `pnpm db:seed` was
run on this database, it holds demo test accounts with a known password: drop it, create an
empty one, and start again from step 3.** (`pnpm db:seed` now refuses to run in production.)

## 5. Start Relay Desk and sign in

Start the API and the web app (e.g. `docker compose up -d api web`, or your process manager
running `pnpm --filter @relay-desk/api start` behind the web server).

1. Open https://support.ricoman.com and click **Sign in with Google (ricoman.com)**.
2. Each administrator: **My account › Two-factor authentication** → set it up. From then on the
   emergency password works (with the code) if Google is ever unavailable.
3. **Settings › Mailboxes** → **Connect Gmail** for each inbox, signing in as that inbox
   (`gmail.md`, step 5).
4. Send a test email to each inbox and check it arrives:
   - support@ → **Enquiries**, assigned to whoever is _Ready for email_ with the fewest open;
   - a personal inbox → that person's **"… Tickets"** view, assigned to them.

Someone not on the staff list who signs in with a ricoman.com Google account is turned away:
Google sign-in never creates accounts. Add new starters in **Settings › Users** (no password
needed), and deactivate leavers there; a deactivated account can't sign in with Google either.

## 6. Backups

Back up nightly, and keep a copy off the server:

- the PostgreSQL database (`pg_dump`);
- `STORAGE_DIR` (the raw emails and attachments);
- the `.env` file, or at least `ENCRYPTION_KEY`.

## Changing things later

- `pnpm db:setup:support` can be run again at any time; it only adds what is missing and links
  the person views and personal inboxes to their accounts.
- To turn Google sign-in off, empty `GOOGLE_SIGNIN_DOMAIN` and set `PASSWORD_SIGNIN=all`; staff
  then need a password set by an administrator.
