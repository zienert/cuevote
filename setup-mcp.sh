#!/usr/bin/env bash
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
# Copyright (c) 2026 Julian Zienert
#
# One-shot setup for the CueVote MCP server on the host that runs cuevote-server.
# Builds the MCP, enables the admin API, and sets the ops MCP's three keys in
# cuevote-mcp/.env. Safe to re-run: it changes only those keys and keeps every
# other line there, the public DJ's settings included. Deploys do not need it;
# update_server.sh rebuilds and restarts the MCP. Run as the user that owns the
# repo and runs PM2.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$ROOT/cuevote-server"
MCP_DIR="$ROOT/cuevote-mcp"
SERVER_ENV="$SERVER_DIR/.env"
MCP_ENV="$MCP_DIR/.env"
PM2_NAME="${PM2_PROCESS_NAME:-cuevote-server}"

# Read a key from an env file safely under `set -o pipefail`: grep -m1 (no head,
# so no SIGPIPE) and `|| true` so a missing key yields an empty string, not a
# pipeline failure that would abort the script.
getenv() { grep -m1 -E "^$1=" "$2" 2>/dev/null | cut -d= -f2- || true; }

# set_key FILE KEY VALUE: the first KEY line (as dotenv reads it: optional
# `export`, spaces around `=`) becomes KEY=VALUE, later duplicates go, and a
# missing key is appended. Every other line stays as it is. The file is
# rewritten in place, so it keeps its owner and mode. VALUE reaches awk through
# the environment, where no character in it means anything.
set_key() {
  local file="$1" key="$2" value="$3" tmp
  tmp="$(mktemp "$file.XXXXXX")"
  if KEY="$key" VALUE="$value" awk '
      BEGIN { k = ENVIRON["KEY"]; v = ENVIRON["VALUE"]; done = 0 }
      $0 ~ ("^[ \t]*(export[ \t]+)?" k "[ \t]*=") {
        if (!done) { print k "=" v; done = 1 }
        next
      }
      { print }
      END { if (!done) print k "=" v }
    ' "$file" > "$tmp" && cat "$tmp" > "$file"; then
    rm -f "$tmp"
  else
    rm -f "$tmp"
    return 1
  fi
}

echo "==> CueVote MCP setup ($ROOT)"
[ -d "$MCP_DIR" ] || { echo "ERROR: $MCP_DIR not found — run this from the repo root."; exit 1; }
[ -f "$SERVER_ENV" ] || { echo "ERROR: $SERVER_ENV not found."; exit 1; }

# 1. Build the MCP. npm ci, not npm install: install may rewrite the tracked
# package-lock.json, and update_server.sh refuses to reset over that.
echo "==> Building cuevote-mcp"
( cd "$MCP_DIR" && npm ci --include=dev && npm run build )

# 2. Ensure ADMIN_TOKEN exists in the server .env (generated once, kept on re-run).
NEED_RESTART=0
if grep -qE '^ADMIN_TOKEN=.+' "$SERVER_ENV"; then
  echo "==> ADMIN_TOKEN already set — keeping it"
else
  echo "==> Generating ADMIN_TOKEN"
  sed -i '/^ADMIN_TOKEN=$/d' "$SERVER_ENV"
  printf '\nADMIN_TOKEN=%s\n' "$(openssl rand -hex 32)" >> "$SERVER_ENV"
  NEED_RESTART=1
fi
ADMIN_TOKEN="$(getenv ADMIN_TOKEN "$SERVER_ENV")"
ADMIN_PORT="$(getenv ADMIN_PORT "$SERVER_ENV")"; ADMIN_PORT="${ADMIN_PORT:-8081}"

# 3. Set the ops MCP's keys in the MCP .env (auto-loaded by config.ts; secrets
#    stay on this host). Only these three lines: the same file holds the public
#    DJ's settings and secrets (DEPLOYMENT.md, section 9), which rewriting the
#    whole file used to delete on every re-run.
echo "==> Setting the admin keys in $MCP_ENV"
umask 077
if [ ! -f "$MCP_ENV" ]; then
  cat > "$MCP_ENV" <<'EOF'
# cuevote-mcp settings — do not commit. setup-mcp.sh sets CUEVOTE_DB_PATH,
# CUEVOTE_ADMIN_URL and CUEVOTE_ADMIN_TOKEN and leaves every other line alone.
# Phase 2 (AI-DJ) — optional: paste a web-app session token to enable cv_* tools.
# CUEVOTE_WS_URL=ws://127.0.0.1:8080
# CUEVOTE_WS_ORIGIN=https://cuevote.com
# CUEVOTE_SESSION_TOKEN=
EOF
fi
set_key "$MCP_ENV" CUEVOTE_DB_PATH "$SERVER_DIR/cuevote.db"
set_key "$MCP_ENV" CUEVOTE_ADMIN_URL "http://127.0.0.1:$ADMIN_PORT"
set_key "$MCP_ENV" CUEVOTE_ADMIN_TOKEN "$ADMIN_TOKEN"
chmod 600 "$MCP_ENV"

# 4. Restart the server only if we just enabled the admin API.
if [ "$NEED_RESTART" = "1" ]; then
  echo "==> Restarting $PM2_NAME to activate the admin API (brief reconnect for live listeners)"
  pm2 restart "$PM2_NAME" >/dev/null
  sleep 2
else
  echo "==> No server restart needed"
fi

# 5. Verify the admin API.
echo "==> Verifying admin API"
if curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" "http://127.0.0.1:$ADMIN_PORT/admin/health" >/dev/null; then
  echo "    OK — admin API healthy on 127.0.0.1:$ADMIN_PORT"
else
  echo "    WARNING: health check failed — inspect 'pm2 logs $PM2_NAME'"
fi

# 6. Print the one line to run on your Mac.
HOSTN="$(hostname -f 2>/dev/null || hostname)"
cat <<EOF

==> Done. Read-only + live-ops are enabled. On your Mac, run once:

    claude mcp add cuevote -- ssh -T <user>@$HOSTN node $MCP_DIR/dist/index.js

Then ask your assistant for e.g. "platform_stats" or "list_active_rooms".
Deploys rebuild the MCP through update_server.sh; there is no need to re-run this.
EOF
