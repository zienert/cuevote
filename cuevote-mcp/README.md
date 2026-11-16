<!--
SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
Copyright (c) 2026 Julian Zienert
-->

# cuevote-mcp

MCP (Model Context Protocol) server for **CueVote**. It runs in **two modes**:

- **stdio — ops console** (`dist/index.js`): for the operator. Read-only insight
  (rooms, users, history, stats) + live moderation (skip, ban, approve, delete,
  GDPR). Runs on the server, driven over SSH from your machine. Architecture: [DESIGN.md](DESIGN.md).
- **HTTP — public AI DJ** (`dist/http.js`): a hosted, OAuth-protected remote MCP
  so **any CueVote user** can connect an AI assistant and control CueVote *as
  themselves* (suggest, vote, now-playing, skip own rooms). Architecture:
  **[DESIGN-remote-dj.md](DESIGN-remote-dj.md)**; deployment: `DEPLOYMENT.md` §9.

Every tool group activates only when its configuration is present — you can run a
pure read-only console without ever touching the live server.

## Tools (gated by configuration)

| Group | Mode | Needs |
|---|---|---|
| **Read-only ops** — `list_rooms`, `get_room`, `find_user`, `platform_stats`, `db_health` | stdio | read access to `cuevote.db` (defaults to the sibling server DB) |
| **Live ops / moderation** — `list_active_rooms`, `get_live_room`, `skip_track`, `ban_video`, `approve_suggestion`, `delete_room`, `gdpr_delete_user`, `run_maintenance`, … | stdio | server admin API + `CUEVOTE_ADMIN_TOKEN` |
| **AI DJ** — `cv_list_rooms`, `cv_join_room`, `cv_now_playing`, `cv_get_queue`, `cv_suggest`, `cv_vote`, `cv_skip`, `cv_play_pause` | stdio (single-user via session token) **or** HTTP (multi-user via OAuth) | a `CUEVOTE_SESSION_TOKEN`, or the public OAuth deploy |

## Install & build

```bash
cd cuevote-mcp
npm install
npm run build
```

## Quick start on the server (both tiers, ~2 commands)

On the host that runs `cuevote-server`, from the repo root:

```bash
./setup-mcp.sh
```

It builds the MCP, enables the admin API (generates `ADMIN_TOKEN` and restarts the
server once), sets the admin keys in `cuevote-mcp/.env` (every other line there
stays), verifies the admin health endpoint, and prints the one line to run on
your Mac — typically:

```bash
claude mcp add cuevote -- ssh -T <user>@cuevote.com node /abs/path/cuevote-mcp/dist/index.js
```

Read-only **and** live-ops are then both active. Deploys rebuild and restart the
MCP through `update_server.sh`, so there is no need to re-run the script; doing
so is safe, as it changes only its own keys in `cuevote-mcp/.env`.

## Configure (manual / local)

The MCP **auto-loads a `.env` placed next to the package** (regardless of cwd, so
it works when launched over SSH). Copy `.env.example`, or pass the same vars via
your MCP client config. The only one needed for read-only use is `CUEVOTE_DB_PATH`
— and it already defaults to the sibling `../cuevote-server/cuevote.db`.

Run `cuevote_diagnostics` first — it reports which capabilities are wired up
without printing any secrets.

### Claude Desktop / Claude Code (stdio)

```jsonc
{
  "mcpServers": {
    "cuevote": {
      "command": "node",
      "args": ["/absolute/path/to/cuevote-mcp/dist/index.js"],
      "env": {
        "CUEVOTE_DB_PATH": "/absolute/path/to/cuevote-server/cuevote.db",
        "CUEVOTE_ADMIN_TOKEN": "…only for live ops…",
        "CUEVOTE_SESSION_TOKEN": "…only for DJ tools…"
      }
    }
  }
}
```

For live ops the MCP process must run **on the server host** (so it can reach the
localhost-only admin API and the DB file). The recommended setup is to launch it
over `ssh` as a stdio command from your dev machine.

## Public AI DJ (HTTP + OAuth)

`dist/http.js` is the **public** remote MCP: it exposes **only** the `cv_*` DJ
tools (never the ops/admin tools), authenticates each user via OAuth 2.1
("Connect with CueVote" → Google login on the `/connect-ai` consent page), and
acts as that user. It binds localhost and sits behind nginx + Cloudflare at
`mcp.cuevote.com`. Stand it up with **`DEPLOYMENT.md` §9** — the public exposure
is gated on the YouTube quota review. Users then add
`https://mcp.cuevote.com/mcp` to their MCP client and sign in.

## Security notes

- The server admin API binds to `127.0.0.1` and requires `ADMIN_TOKEN`. Never
  proxy it publicly.
- The public DJ endpoint exposes **DJ tools only** (no ops/admin), is
  OAuth-protected, and acts strictly as the authenticated user (owner actions
  stay server-enforced). Set `CUEVOTE_HTTP_ALLOWED_HOSTS` and keep
  `CUEVOTE_OAUTH_DEV_USER` empty in production.
- Email (PII) is returned only by the explicit user/GDPR tools, never in lists.
- Destructive tools require `confirm: true` and are written to the audit log.
- The audit log also records the OAuth lifecycle of the public DJ server:
  `oauth_client_registered`, `oauth_consent_requested`, `oauth_consent_granted`,
  `oauth_consent_failed`, `oauth_token_issued`, `oauth_token_revoked`,
  `oauth_finalize_rejected`, and `oauth_dev_bypass`. Client registration is open
  and the client/token stores are in-memory, so without this log a restart
  leaves no way to tell which clients were ever registered. Tokens themselves
  are never logged — only a 12-char SHA-256 prefix, enough to tie an issue to
  its revocation. It rotates at `CUEVOTE_AUDIT_MAX_BYTES`, keeping
  `CUEVOTE_AUDIT_KEEP` files.
- All code is PolyForm Noncommercial licensed, like the rest of CueVote.
