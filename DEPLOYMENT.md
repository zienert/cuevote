# CueVote Deployment Guide

This guide details the steps to set up CueVote on a fresh Debian server.

## 1. System Requirements & Dependencies

Run the following commands as `root` or with `sudo`.

### Update System
```bash
sudo apt update && sudo apt upgrade -y
```

### Install Core Dependencies
Use `curl` to set up the Node.js 18+ repository (Debian 12/Bookworm example):
```bash
sudo apt install -y curl git build-essential python3 nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### Install Process Manager
Install PM2 to keep the server running.
```bash
sudo npm install -g pm2
```

## 2. Project Setup

If using `/var/www`, use `sudo` to clone and then fix permissions:

```bash
# Clone directly to /var/www/cuevote
sudo git clone https://github.com/zienert/cuevote.git /var/www/cuevote

# Fix permissions so you own it
sudo chown -R $USER:$USER /var/www/cuevote

# Enter directory
cd /var/www/cuevote
```



## 3. Backend Setup (cuevote-server)

```bash
cd cuevote-server
npm install
```

### Environment Configuration
Create a `.env` file **inside the `cuevote-server` directory** (`nano .env`):
```ini
PORT=8080
YOUTUBE_API_KEY=your_actual_youtube_api_key
GOOGLE_CLIENT_ID=your_actual_google_client_id_web
GOOGLE_IOS_CLIENT_ID=your_actual_google_client_id_ios
ALLOWED_ORIGINS=https://cuevote.com,https://www.cuevote.com
URL=https://cuevote.com
NODE_ENV=production
# Optional Configuration
ACTIVE_CHANNEL_DAYS=60
# LOG_LEVEL=info
#
# Which peers may speak for a client. The per-IP socket cap identifies clients
# by X-Real-IP / X-Forwarded-For, but only when the connection arrives from one
# of these addresses — otherwise by the socket address. The default covers the
# usual "nginx on the same host" layout; set this only if nginx (or another
# reverse proxy) runs elsewhere. Never list an address you do not control: a
# peer on this list can name itself anything and the cap stops counting.
# TRUSTED_PROXY_IPS=127.0.0.1,::1,::ffff:127.0.0.1
# MAX_SOCKETS_PER_IP=20
#
# How many NEW guest identities one address may obtain per 10 minutes. A guest
# identity is what stops one person voting a track up repeatedly, so minting
# them has to cost something; a socket gets exactly one, and this bounds how
# many can be had by opening more connections. A device mints once and then
# re-presents its stored token, so the budget is spent by NEW devices — the
# default comfortably covers a large party behind a single NAT. Raise it for a
# venue with heavy turnover; lower it if you see vote manipulation.
# MAX_GUEST_MINTS_PER_IP=60
#
# Signing secret for guest identities (people who vote without an account).
# Optional: when unset the server generates one on first start and keeps it in
# the database, which is correct for a single instance. Set it explicitly if you
# run more than one server process, or you want guest identities to survive a
# database restore — a changed secret signs every existing guest out. Minimum
# 32 characters; shorter values are ignored with a warning.
# GUEST_TOKEN_SECRET=generate_a_long_random_secret
#
# Admin API for the cuevote-mcp ops server (Phase 1b). Disabled unless
# ADMIN_TOKEN is set. Binds to 127.0.0.1 only — do NOT expose this port via
# nginx or any public reverse proxy.
# ADMIN_TOKEN=generate_a_long_random_secret
# ADMIN_PORT=8081
# ADMIN_HOST=127.0.0.1
#
# Public remote DJ MCP (cuevote-mcp/DESIGN-remote-dj.md). MCP_SESSION_SECRET
# enables the localhost internal "mint a WS session for a user" route used by
# the OAuth-authenticated DJ service. Leave unset until you deploy that service.
# MCP_SESSION_SECRET=generate_a_long_random_secret
# MCP_SESSION_TTL=3600
# CUEVOTE_OAUTH_FINALIZE_SECRET=generate_a_long_random_secret  # = MCP value; enables the consent bridge
# MCP_INTERNAL_URL=http://127.0.0.1:8082                       # where the remote DJ MCP listens
```

> **MCP ops server (optional):** rather than setting `ADMIN_TOKEN` by hand, run
> `./setup-mcp.sh` from the repo root after deploying — it generates the token,
> builds the MCP, writes its `.env`, verifies the admin API, and prints the
> client command. See [cuevote-mcp/README.md](cuevote-mcp/README.md).

### Start Backend
```bash
pm2 start index.js --name cuevote-server
```

### Enable Auto-Start on Reboot
This is a **two-step process**. Skipping the second step means PM2 will NOT restart the server after a reboot.

```bash
# Step 1: Generate the systemd service command
pm2 startup systemd
```

PM2 will print a `sudo env PATH=... pm2 startup systemd -u <user> --hp /home/<user>` command. **Copy and run that exact command** — only this step actually creates the systemd service.

```bash
# Step 2: Save the current process list so it gets restored on boot
pm2 save
```

Verify the service is active:
```bash
systemctl status pm2-$USER
# Should show "active (running)"
```

### Configure Log Rotation

PM2 stores logs in `~/.pm2/logs/` and does **not** rotate them by default — over time they grow until the disk fills. Install `pm2-logrotate` and set sensible limits:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'   # daily at midnight
```

This keeps 14 rotated files of max 10 MB each, compressed. Aligned with the 14-day retention window stated in the Privacy Policy.

Verify the configuration:
```bash
pm2 conf pm2-logrotate   # should print the four values you just set
pm2 status               # should list pm2-logrotate as a module, status "online"
```

**If you are installing pm2-logrotate on a server that has been running for a while**, the existing log files will not be touched by the rotation policy and may already be huge. Check and truncate them safely (PM2 keeps writing into the same file descriptor, so this works without restart):

```bash
du -sh ~/.pm2/logs/cuevote-server-*
sudo truncate -s 0 ~/.pm2/logs/cuevote-server-out.log
sudo truncate -s 0 ~/.pm2/logs/cuevote-server-error.log
```

From the next rotation onwards, log files are bounded automatically.

> **The MCP audit log is separate.** `cuevote-mcp` writes `mcp-audit.log`
> directly rather than through PM2, so `pm2-logrotate` does not touch it. It
> rotates itself (`CUEVOTE_AUDIT_MAX_BYTES`, default 10 MB × `CUEVOTE_AUDIT_KEEP`,
> default 5). Raise the retention if you want a longer window on OAuth client
> registrations — that log is the only record of which DJ clients were ever
> registered, since the registry itself is in-memory and empty after a restart.

Nginx access logs are rotated automatically by the Debian default `logrotate` config (`/etc/logrotate.d/nginx`, daily, 14 days kept) — no extra setup needed.

## 4. Frontend Setup (cuevote-client)

```bash
cd ../cuevote-client
npm install
```

### Environment Configuration
Create a `.env` file **inside the `cuevote-client` directory** (`nano .env`):
```ini
VITE_GOOGLE_CLIENT_ID=your_google_client_id_here

# Legal & Contact Info (Optional - for Legal Page)
# If omitted, KVK/VAT sections will be hidden.
VITE_LEGAL_NAME="Your Official Name"
VITE_LEGAL_ADDRESS_LINE1="Street Address 123"
VITE_LEGAL_ADDRESS_LINE2="1000 AB Amsterdam"
VITE_LEGAL_EMAIL="privacy@cuevote.com"
# VITE_IMPRINT_EMAIL="hello@cuevote.com"
# VITE_ABUSE_EMAIL="abuse@cuevote.com"
# VITE_LEGAL_PHONE="+31 6 12345678"
# VITE_LEGAL_KVK="12345678"
# VITE_LEGAL_VAT="NL123456789B01"
```

### Build Client
```bash
npm run build
```
This creates a `dist` directory with the static files.

## 5. Nginx Configuration

Create a new configuration file:
```bash
sudo nano /etc/nginx/sites-available/cuevote
```

Paste the following configuration (replace `your-domain.com`):

```nginx
server {
    listen 80;
    server_name your-domain.com; # Replace with your actual domain

    # Security: Point root to the built artifacts directory (dist)
    # ensuring source files are not exposed.
    root /var/www/cuevote/cuevote-client/dist;
    index index.html;

    # Security: Deny access to all hidden files (starting with .)
    # Exception: Allow .well-known (for SSL challenges)
    location ~ /\.(?!well-known) {
        deny all;
        access_log off;
        log_not_found off;
    }

    # Security headers
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    # HSTS: force HTTPS for the next 2 years incl. subdomains. preload is
    # the strongest signal to browsers; only enable once HTTPS is stable.
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    # CSP: lock script/connect/frame sources to first-party + the third
    # parties CueVote actually uses (Google OAuth, YouTube IFrame Player,
    # gstatic for the player JS). Tighten further once you can confirm
    # nothing inline survives the build.
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' https://accounts.google.com https://apis.google.com https://www.youtube.com https://www.gstatic.com; frame-src https://www.youtube.com https://accounts.google.com; img-src 'self' data: https://*.ytimg.com https://*.googleusercontent.com; connect-src 'self' wss: https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com; style-src 'self' 'unsafe-inline'; font-src 'self' data:; base-uri 'self'; form-action 'self'; frame-ancestors 'self'" always;
    # Permissions-Policy: deny everything CueVote does not use. QR
    # scanning runs in the native Android/iOS shells, not the web client.
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Health check endpoint
    location /health {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # RFC 9116 security.txt — proxied to the Node app so `Expires` is computed
    # per request and never lapses. Exact match (=) so /.well-known/acme-challenge/
    # (Certbot HTTP-01 cert renewal) stays on the origin, untouched.
    location = /.well-known/security.txt {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Proxy WebSocket connections
    location /ws {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

Enable the site and restart Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/cuevote /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## 6. SSL Setup (Optional but Recommended)

install certbot:
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## 7. Firewall Setup (UFW)

It is highly recommended to enable a firewall.

```bash
# Install UFW (Uncomplicated Firewall)
sudo apt install ufw

# 1. ALLOW SSH FIRST (Critical, otherwise you lock yourself out!)
sudo ufw allow ssh

# 2. Allow Web Traffic (HTTP & HTTPS)
sudo ufw allow "Nginx Full"

# 3. Enable Firewall
sudo ufw enable
```

Check status with:
```bash
sudo ufw status
```

> **Do not open 8080 (or 8081/8082).** The backend binds `0.0.0.0`, so the only
> thing keeping it behind nginx is the firewall. Reached directly, a client is
> no longer a trusted proxy's forwarded request, and — by design — is then
> identified by its socket address rather than by any header it sends. Keeping
> the port closed is what makes `X-Real-IP` meaningful in the first place.

## 8. Security Hardening (Recommended)

### Prevent Brute Force Attacks (Fail2Ban)
Even with a strong password, bots will attack port 22. Install `fail2ban` to automatically ban them after too many failed attempts.

```bash
sudo apt install fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```
It works automatically out of the box for SSH.

### Automatic Security Updates (unattended-upgrades)
A server that never updates becomes vulnerable to known exploits within weeks. Install `unattended-upgrades` to apply security patches automatically.

```bash
sudo apt install -y unattended-upgrades
```

Enable the automatic schedule (daily check, daily install):
```bash
sudo tee /etc/apt/apt.conf.d/20auto-upgrades > /dev/null <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
```

The default policy in `/etc/apt/apt.conf.d/50unattended-upgrades` only installs from the `${distro_id}:${distro_codename}-security` archive — i.e. **security updates only**, no feature upgrades that could break Node.js, nginx, or PM2.

**Auto-reboot (enabled on the production VM since 2026-07).** A kernel update only becomes active after a reboot — a patched kernel on disk protects nothing while the old one keeps running. Since the whole boot chain recovers on its own (PM2 resurrects via its systemd unit, nginx is enabled), the production VM reboots itself at night, but only when an update requires it (`/var/run/reboot-required` exists). Configured via a drop-in so the packaged default file stays pristine. The same drop-in also widens the allowed origins to NodeSource, whose Release metadata has a broken `Origin` field — match by `site` instead:

```bash
sudo tee /etc/apt/apt.conf.d/52unattended-upgrades-local > /dev/null <<'EOF'
Unattended-Upgrade::Origins-Pattern:: "site=deb.nodesource.com";
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
EOF
```

If you prefer never rebooting unattended, leave the two reboot lines out — but then check for `/var/run/reboot-required` regularly.

Verify the configuration with a dry run:
```bash
sudo unattended-upgrade --dry-run --debug
```

Check what was actually upgraded later:
```bash
cat /var/log/unattended-upgrades/unattended-upgrades.log
```

### Keeping npm Dependencies Patched

`unattended-upgrades` only covers **apt packages**. The app's npm dependencies are pinned by `package-lock.json`, and `npm ci` (used by `update_server.sh`) installs exactly those pinned versions — a deploy never bumps anything by itself. That is deliberate (reproducible builds), but it means a known vulnerability in a dependency stays on the server until someone acts:

```bash
# check (run in cuevote-server/ and cuevote-client/)
npm audit --omit=dev

# fix within semver ranges, then prove the project still passes
npm audit fix && npm ci

# then, per project:
npm run build          # cuevote-client, cuevote-mcp
npm run lint && npm test   # cuevote-server (it has no build step)
```

Commit the resulting `package-lock.json`, merge, then deploy with `bash update_server.sh` as usual. Run the audit on a schedule (monthly works) and/or enable GitHub Dependabot alerts on the repository, so new advisories reach you instead of waiting to be discovered.

### Use SSH Keys (Best Practice)
For maximum security, disable password login entirely and use SSH keys.
1. Generate a key on your local machine: `ssh-keygen -t ed25519`
2. Copy it to server: `ssh-copy-id user@your-server-ip`
3. Once verified working, disable `PasswordAuthentication` in `/etc/ssh/sshd_config`.

## 9. Remote DJ MCP — public OAuth service (optional)

The **public** "AI DJ" endpoint (`cuevote-mcp/src/http.ts`, served at
`mcp.cuevote.com`) lets any CueVote user connect an AI assistant via OAuth. See
`cuevote-mcp/DESIGN-remote-dj.md`. This is **separate** from the stdio ops MCP.

> ⚠️ **Gate the public flip on the YouTube quota review.** Steps 1–3 stand the
> service up bound to **localhost only** (not reachable from the internet) — safe
> to do anytime. Only Step 4 (nginx vhost) + Step 5 (Cloudflare DNS) actually
> expose it; do those **only once the quota review is green**, since a public
> AI-suggest channel raises YouTube Search-API usage.

**1. Server env** (`cuevote-server/.env`) — then restart the server:
```ini
MCP_SESSION_SECRET=<random>                 # already set if you ran setup-mcp.sh
CUEVOTE_OAUTH_FINALIZE_SECRET=<random>      # NEW; the MCP must use the same value
MCP_INTERNAL_URL=http://127.0.0.1:8082      # where the remote MCP listens
```
```bash
pm2 restart cuevote-server
```

**2. Remote-MCP env** (`cuevote-mcp/.env`):
```ini
CUEVOTE_HTTP_HOST=127.0.0.1
CUEVOTE_HTTP_PORT=8082
CUEVOTE_PUBLIC_URL=https://mcp.cuevote.com
CUEVOTE_HTTP_ALLOWED_HOSTS=mcp.cuevote.com  # DNS-rebinding protection
CUEVOTE_OAUTH_CONSENT_URL=https://cuevote.com/connect-ai
CUEVOTE_OAUTH_FINALIZE_SECRET=<same as server>
CUEVOTE_MINT_SECRET=<= server MCP_SESSION_SECRET>
CUEVOTE_WS_URL=ws://127.0.0.1:8080
CUEVOTE_WS_ORIGIN=https://cuevote.com
# CUEVOTE_OAUTH_DEV_USER must be EMPTY in production (it bypasses login).
```

**3. Run the service under PM2** (localhost-bound; not public yet):
```bash
cd /var/www/cuevote/cuevote-mcp && npm run build   # ensure dist/http.js is current
pm2 start dist/http.js --name cuevote-mcp-dj
pm2 save
curl -fsS http://127.0.0.1:8082/health             # -> {"status":"ok",...}
```
The consent page is already served at `https://cuevote.com/connect-ai` by the
existing SPA (no nginx change needed for it).

**4. nginx vhost — PUBLIC EXPOSURE (quota-gated).** `sudo nano /etc/nginx/sites-available/cuevote-mcp`:
```nginx
server {
    listen 80;
    server_name mcp.cuevote.com;
    location / {
        proxy_pass http://127.0.0.1:8082;
        proxy_http_version 1.1;
        proxy_set_header Host $host;                 # forwards mcp.cuevote.com -> ALLOWED_HOSTS check
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/cuevote-mcp /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl restart nginx
sudo certbot --nginx -d mcp.cuevote.com            # TLS
```

**5. Cloudflare — PUBLIC EXPOSURE (quota-gated).** Add a DNS record for `mcp`
pointing at the VPS and **orange-cloud it** (proxied) so the origin IP stays
hidden, like the apex domain.

**6. Connect.** In an MCP client (Claude, …) add the remote server
`https://mcp.cuevote.com/mcp`; it discovers OAuth via
`/.well-known/oauth-authorization-server`, the user signs in on `/connect-ai`,
and the `cv_*` DJ tools become available. Re-run `pm2 restart cuevote-mcp-dj`
after each deploy that rebuilds the MCP.

---

## 10. Deploying updates (`update_server.sh`)

Routine deploys run from the checkout on the server:

```bash
bash update_server.sh
```

The script is not just "pull and restart" — it refuses to leave a broken
version serving:

| Step | What it does | On failure |
|---|---|---|
| 1 | Records the currently deployed commit, then `git reset --hard origin/main` | aborts before anything is built |
| 2–3 | `npm ci` + client build, `npm ci` for the server | aborts; running server untouched |
| 4 | **`npm test` on the server** | aborts **before** the restart — the running server never sees the new code |
| 5 | `pm2 reload` (falls back to `restart`) | — |
| 5 | `pm2 reload` (falls back to `restart`) | rolls back — a wedged pm2 no longer kills the script before the rollback can run |
| 6 | **Polls `/health` for up to 15 s** | **rolls back** to the recorded commit, rebuilds, restarts and re-checks |
| 7 | Rebuilds and restarts the MCP service | aborts |

Exit codes distinguish the two bad outcomes, so monitoring can tell a recovered
deploy from a dead server:

| Code | Meaning |
|---|---|
| 0 | Deployed and healthy |
| 1 | Deploy failed, **rolled back — the previous version is serving** |
| 2 | Rollback failed too, or there was no rollback target: **the site needs you** |

A rollback restores the server, not the branch: `origin/main` still points at the
bad commit, and the next run of this script will deploy it again. Revert or fix
main before re-running.

Two consequences worth knowing:

* **A failing test blocks the deploy.** That is the point — but it means a red
  test suite means no deploys until it is fixed. Run `npm test` in
  `cuevote-server/` locally before pushing.
* **The rollback needs the commit it recorded in step 1.** In worktree mode the
  script does not own the checkout, so it skips the git steps and therefore has
  no rollback target: an unhealthy deploy there stops with an error and leaves
  the process for you to inspect (`pm2 logs cuevote-server`).

The health check calls `http://127.0.0.1:<PORT>/health` directly (bypassing
nginx). It resolves `PORT` the same way the server does — an exported `PORT`
wins over the file, because `dotenv` does not override an existing variable and
`pm2 --update-env` passes the deployer's environment through — then falls back
to `cuevote-server/.env` and finally to `8080`. Inline comments, quotes,
`export` and spaces around `=` are all handled; anything that is not a plain
number is ignored rather than polled. It needs `curl`, which section 1 already
installs.
