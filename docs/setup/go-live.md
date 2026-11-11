# Going live (support.ricoman.com)

A first install on the server with **no demo data**: Ricoman's categories, rights, views,
inboxes, working hours and reply targets, plus the four staff accounts. Staff sign in with
their **@ricoman.com Google account** and have no password. The two administrators also get an
emergency password for when Google is unavailable; it only works once they have turned on
two-factor.

This guide uses Docker (`docker-compose.prod.yml`), which runs the database, the API and the
web app on the server. Allow about an hour, most of it the Google Cloud steps.

## 1. Google Cloud (whoever administers Ricoman's Google Workspace)

Follow `gmail.md`, steps 1–3: create the project, enable the Gmail API, set up the **Internal**
consent screen, and create the OAuth client with **both** redirect addresses:

- `https://support.ricoman.com/api/oauth/google/callback` (connecting inboxes)
- `https://support.ricoman.com/api/auth/google/callback` (staff sign-in)

Keep the **Client ID** and **Client secret** for step 3. Send them through the password
manager, not by email.

## 2. Get the code

```bash
git clone https://github.com/rdolan-gif/Relay-Desk-.git relay-desk   # or, if already cloned: git pull
cd relay-desk
```

## 3. Production settings

Create a file called `.env` in the `relay-desk` folder. Generate the two secrets with:

```bash
openssl rand -base64 32    # for ENCRYPTION_KEY
openssl rand -hex 24       # for POSTGRES_PASSWORD
```

```dotenv
POSTGRES_PASSWORD=<the hex value>
ENCRYPTION_KEY=<the base64 value>
PUBLIC_URL=https://support.ricoman.com
WEB_ORIGIN=https://support.ricoman.com
COOKIE_SECURE=true
GOOGLE_CLIENT_ID=<from step 1>
GOOGLE_CLIENT_SECRET=<from step 1>
GOOGLE_SIGNIN_DOMAIN=ricoman.com
PASSWORD_SIGNIN=administrators
```

**Put `ENCRYPTION_KEY` and `POSTGRES_PASSWORD` in the password manager.** `ENCRYPTION_KEY`
protects the Gmail connections and two-factor secrets: if it is lost, every inbox has to be
reconnected and everyone has to set up two-factor again. The `.env` file is never committed to
GitHub (it is in `.gitignore`).

## 4. Start Relay Desk

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

The first build takes a few minutes. The API creates the database tables itself when it starts.
Check it is up:

```bash
curl http://127.0.0.1:8080/api/health/ready      # {"status":"ok","database":"ok"}
```

The web app listens on `127.0.0.1:8080` only. Point the server's HTTPS proxy for
support.ricoman.com at it (example at the end of this guide).

## 5. First install

Use each person's real name and @ricoman.com address. Richard and Ryan are administrators;
Thierry and Heather are agents. Each name must start with Richard, Ryan, Thierry or Heather
(the setup has views and rights for each of them); anyone else is added later in Settings › Users.

```bash
docker compose -f docker-compose.prod.yml exec api node dist/db/install.js \
  --admin "Richard Surname <richard@ricoman.com>" \
  --admin "Ryan Surname <ryan@ricoman.com>" \
  --agent "Thierry Surname <thierry@ricoman.com>" \
  --agent "Heather Surname <heather@ricoman.com>"
```

It prints each account and, for the two administrators, an **emergency password shown only
once**. Put them in the password manager.

It refuses to run if the database already has accounts. If you tried Relay Desk on this server
before (for example with `pnpm db:seed`, which adds demo test accounts with a known password),
start from an empty database:

```bash
docker compose -f docker-compose.prod.yml down -v    # deletes Relay Desk's database and stored emails
docker compose -f docker-compose.prod.yml up -d
```

The demo seed now refuses to run in production.

## 6. Sign in and connect the inboxes

1. Open https://support.ricoman.com and click **Sign in with Google (ricoman.com)**.
2. Each administrator: **My account › Two-factor authentication**, then set it up with an
   authenticator app. From then on the emergency password works (with the code) if Google is
   ever unavailable.
3. **Settings › Mailboxes** → **Connect Gmail** for each of the four inboxes, signing in to Google
   **as that inbox** (support@ as itself; Ryan for his own, and so on). See `gmail.md`, step 5.
4. Send a test email to each inbox and check where it lands:
   - support@ → **Enquiries**, assigned to whoever is _Ready for email_ with the fewest open
     tickets (turn on _Ready for email_ in the top bar first);
   - a personal inbox → that person's **"… Tickets"** view, assigned to them.

Someone who isn't on the staff list is turned away even with a ricoman.com Google account:
Google sign-in never creates accounts. Add new starters in **Settings › Users** (no password
needed) and deactivate leavers there; a deactivated account can't sign in with Google either.

## 7. Backups

Back up nightly and keep a copy off the server:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U relay relay_desk | gzip > relay-desk-$(date +%F).sql.gz
docker run --rm -v relay-desk_storage:/data -v "$PWD":/backup alpine tar czf /backup/relay-desk-storage-$(date +%F).tgz -C /data .
```

The first is the database; the second is the stored emails and attachments. Keep `.env` (or at
least `ENCRYPTION_KEY`) in the password manager.

## Updating later

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Database changes are applied automatically when the API starts. After adding people in
Settings › Users, re-run the setup to link their views and personal inbox (it only adds what is
missing):

```bash
docker compose -f docker-compose.prod.yml exec api node dist/db/setup-support-team.js
```

## Example HTTPS proxy

Caddy (gets the HTTPS certificate itself):

```
support.ricoman.com {
  reverse_proxy 127.0.0.1:8080 {
    flush_interval -1
  }
}
```

nginx:

```nginx
server {
  listen 443 ssl;
  server_name support.ricoman.com;
  # ssl_certificate … / ssl_certificate_key … (e.g. from certbot)
  client_max_body_size 30m;
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_buffering off;          # live updates (notifications) stream through
    proxy_read_timeout 1h;
  }
}
```

The proxy must pass `X-Forwarded-For`, so Relay Desk sees each visitor's real address (sign-in
lock-outs and the audit log use it).

## Without Docker

Run PostgreSQL 16 yourself, put the same settings plus `NODE_ENV=production`,
`DATABASE_URL=postgres://…` and `STORAGE_DIR=/var/lib/relay-desk/storage` in the environment, then:
`pnpm install --frozen-lockfile && pnpm build && pnpm db:migrate`, the first install with
`pnpm db:install -- --admin "…" …`, and run `node apps/api/dist/main.js` (API on port 3000) with
`apps/web/dist` served by a web server that sends `/api/` to the API (see
`apps/web/docker/nginx.conf`).
