#!/bin/bash

# exit immediately if a command exits with a non-zero status
set -e

# Configuration
#
# do_update walks into cuevote-client and cuevote-server as it goes, so helpers
# that resolve paths relative to the working directory are correct or broken
# depending on which step called them. Everything is anchored to the directory
# this script lives in instead.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$ROOT_DIR/cuevote-server"
CLIENT_DIR="$ROOT_DIR/cuevote-client"
MCP_DIR="$ROOT_DIR/cuevote-mcp"
PM2_PROCESS_NAME="cuevote-server"
PM2_MCP_NAME="cuevote-mcp-dj"

# git must act on the checkout this script lives in. A GIT_DIR or GIT_WORK_TREE
# inherited from a hook or another tool would aim the reset below at a
# different repository.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR

# ---- Checkout detection ----

# What this script may do to the code depends on the checkout it lives in, so
# that is what it asks, never the caller's working directory. Asking the
# working directory made `cd <main checkout> && <worktree>/update_server.sh`
# take the worktree for the server checkout and reset its branch to
# origin/main, uncommitted work included.
#
#   worktree  a linked git worktree (local testing): deploy the tree as it is
#             and leave git alone.
#   server    the main checkout, on main: fetch and reset to origin/main.
#
# Anything else (no checkout, the main checkout on another branch) is refused
# before anything changes.
detect_checkout() {
    local top git_dir common_dir
    top="$(cd "$ROOT_DIR" && git rev-parse --show-toplevel 2>/dev/null)" || top=""
    if [ -z "$top" ] || [ "$(cd "$top" && pwd -P)" != "$(cd "$ROOT_DIR" && pwd -P)" ]; then
        echo "Error: $ROOT_DIR is not the top of a git checkout."
        echo "       update_server.sh deploys the checkout it lives in. Nothing was changed."
        return 1
    fi
    git_dir="$(cd "$ROOT_DIR" && cd "$(git rev-parse --git-dir)" && pwd -P)" || return 1
    common_dir="$(cd "$ROOT_DIR" && cd "$(git rev-parse --git-common-dir)" && pwd -P)" || return 1
    BRANCH="$(git -C "$ROOT_DIR" symbolic-ref --quiet --short HEAD)" || BRANCH=""

    # A linked worktree keeps its own git dir under the common one.
    if [ "$git_dir" != "$common_dir" ]; then
        IS_WORKTREE=true
        echo "  ┌─ Worktree mode ─────────────────────────────"
        echo "  │ Worktree:  $(basename "$ROOT_DIR")"
        echo "  │ Branch:    ${BRANCH:-(detached HEAD)}"
        echo "  └─────────────────────────────────────────────"
        return 0
    fi

    IS_WORKTREE=false
    if [ "$BRANCH" != "main" ]; then
        echo "Error: $ROOT_DIR is on ${BRANCH:+branch }${BRANCH:-a detached HEAD}, not on main."
        echo "       A deploy resets this checkout to origin/main and would take that"
        echo "       branch with it. Switch back to main, or test the branch from a"
        echo "       worktree. Nothing was changed."
        return 1
    fi
}

# ---- Health check ----

# The server's own /health endpoint, on the port it actually listens on.
#
# Resolution has to match the server's, not approximate it. index.js reads
# `process.env.PORT || 8080` after dotenv, and dotenv does NOT override a
# variable that is already set — and `pm2 --update-env` hands the deployer's
# environment to the process. So an exported PORT wins over the file, exactly
# as it does for the server.
#
# The file parse also has to survive what people actually write. Keeping
# everything after the first '=' turned `PORT=8080  # http port` into
# `8080#httpport`, which curl reads as a fragment and requests `/` instead of
# `/health` — failing every attempt and rolling back a healthy deploy.
server_port() {
    if [ -n "$PORT" ]; then
        echo "$PORT"
        return
    fi

    local line="" value=""
    if [ -f "$SERVER_DIR/.env" ]; then
        # Accept an optional `export`, and spaces around `=`, like dotenv does.
        line="$(grep -E '^[[:space:]]*(export[[:space:]]+)?PORT[[:space:]]*=' "$SERVER_DIR/.env" | tail -n1)"
    fi

    if [ -n "$line" ]; then
        value="${line#*=}"
        value="${value%%#*}"                                    # drop a trailing comment
        value="$(echo "$value" | tr -d '[:space:]"'"'"'')"      # drop spaces and quotes
    fi

    # Anything that is not a plain port number is not something to poll.
    case "$value" in
        ''|*[!0-9]*) echo 8080 ;;
        *)           echo "$value" ;;
    esac
}

# Polls /health until it answers or the budget runs out. pm2 reload returns as
# soon as it has signalled the process, not when the new one is serving, so a
# single immediate curl would race the restart.
wait_for_health() {
    local port
    port="$(server_port)"
    local attempts=15
    local i=1
    while [ "$i" -le "$attempts" ]; do
        if curl -fsS --max-time 2 "http://127.0.0.1:${port}/health" > /dev/null 2>&1; then
            echo "  -> Health check passed on port ${port} (attempt ${i}/${attempts})."
            return 0
        fi
        sleep 1
        i=$((i + 1))
    done
    echo "  -> Health check FAILED on port ${port} after ${attempts}s."
    return 1
}

# Puts the working tree back on the previously deployed commit and restarts from
# it. Only meaningful outside worktree mode, where this script owns the checkout.
rollback_to() {
    local sha="$1"
    echo ""
    echo "!!!! Deployment unhealthy — rolling back to ${sha} !!!!"

    if ! git -C "$ROOT_DIR" reset --hard "$sha"; then
        echo "Error: rollback checkout failed. The server is running unverified code."
        echo "       Recover manually: git reset --hard ${sha} && bash update_server.sh start"
        return 2
    fi

    (cd "$CLIENT_DIR" && npm ci --silent && npm run build) || {
        echo "Error: client rebuild during rollback failed."
        return 2
    }
    (cd "$SERVER_DIR" && npm ci --silent) || {
        echo "Error: server dependency install during rollback failed."
        return 2
    }

    pm2 reload "$PM2_PROCESS_NAME" --update-env || pm2 restart "$PM2_PROCESS_NAME" --update-env

    if wait_for_health; then
        echo "==== Rolled back to ${sha}. The previous version is serving again. ===="
        echo "     NOTE: origin/main still points at the bad commit. Running this"
        echo "     script again will redeploy it — fix or revert main first."
        return 1
    fi

    echo "Error: the rollback target is unhealthy too. Manual intervention required."
    echo "       Logs: pm2 logs ${PM2_PROCESS_NAME}"
    return 2
}

# ---- Subcommands ----

do_update() {
    echo "==== CueVote Server — Update & Restart ===="

    # Exit 3: stopped before anything was changed (DEPLOYMENT.md, section 10).
    if ! command -v pm2 &> /dev/null; then
        echo "Error: pm2 is not installed or not in PATH."
        exit 3
    fi
    if ! command -v curl &> /dev/null; then
        echo "Error: curl is not installed or not in PATH (needed for the health check)."
        exit 3
    fi

    detect_checkout || exit 3

    # 1. Sync to latest remote main
    # PREV_SHA is captured *before* the reset — it is the only handle on the
    # version that was known to work, and `git reset --hard` destroys the tree.
    PREV_SHA=""
    if [ "$IS_WORKTREE" = true ]; then
        echo "[1/7] Skipping git (worktree mode — the worktree is deployed as it is)"
    else
        echo "[1/7] Updating code from git (reset to origin/main)..."
        PREV_SHA="$(git -C "$ROOT_DIR" rev-parse HEAD)"
        echo "  -> Currently deployed: ${PREV_SHA}"

        # The reset throws away whatever this checkout has that origin/main
        # lacks. On the server that is nothing; anywhere else it is someone's
        # work, so refuse instead.
        local changes ahead
        changes="$(git -C "$ROOT_DIR" status --porcelain --untracked-files=no)" || changes="(git status failed)"
        if [ -n "$changes" ]; then
            echo "Error: the checkout has uncommitted changes that the reset would discard:"
            printf '%s\n' "$changes" | sed 's/^/         /'
            echo "       Commit or discard them, then run again. Nothing was changed."
            exit 3
        fi
        if ! git -C "$ROOT_DIR" fetch origin; then
            echo "Error: git fetch failed. Nothing was changed."
            exit 3
        fi
        ahead="$(git -C "$ROOT_DIR" rev-list --count origin/main..HEAD)" || ahead="?"
        if [ "$ahead" != 0 ]; then
            echo "Error: main has ${ahead} commit(s) that origin/main does not; the reset would drop them."
            echo "       Push them or move them to a branch, then run again. Nothing was changed."
            exit 3
        fi
        if ! git -C "$ROOT_DIR" reset --hard origin/main; then
            echo "Error: git reset --hard origin/main failed."
            exit 1
        fi
        echo "  -> Now deploying:      $(git -C "$ROOT_DIR" rev-parse HEAD)"
    fi

    # 2. Update Client (Frontend)
    echo "[2/7] Updating Client (Frontend)..."
    cd "$CLIENT_DIR"

    echo "  -> Installing client dependencies..."
    npm ci --silent

    echo "  -> Building client..."
    if ! npm run build; then
        echo "Error: Client build failed."
        exit 1
    fi
    echo "  -> Client build successful."

    cd "$ROOT_DIR"

    # 3. Update Server (Backend)
    echo "[3/7] Updating Server (Backend)..."
    cd "$SERVER_DIR"

    echo "  -> Installing server dependencies..."
    npm ci --silent

    # 4. Test the new code before it touches the running process. Everything up
    #    to here is reversible by doing nothing; the reload below is not.
    echo "[4/7] Running server tests..."
    if ! npm test; then
        echo ""
        echo "Error: server tests failed. Aborting BEFORE restart — the running server is untouched."
        if [ -n "$PREV_SHA" ]; then
            echo "       The working tree is on the new code; restore it with:"
            echo "       git reset --hard ${PREV_SHA}"
        fi
        exit 1
    fi
    echo "  -> Tests passed."

    # 5. Restart Server Process
    echo "[5/7] Restarting Server Process..."
    if pm2 describe "$PM2_PROCESS_NAME" > /dev/null 2>&1; then
        echo "  -> Process found, attempting reload..."
        # Both failing is a failing list, which `set -e` treats as fatal — so the
        # script used to exit right here, skipping the health check and the whole
        # rollback, in precisely the case they exist for (a wedged pm2). Testing
        # the list puts it in a condition context, where `set -e` stands down.
        if ! { pm2 reload "$PM2_PROCESS_NAME" --update-env || pm2 restart "$PM2_PROCESS_NAME" --update-env; }; then
            echo "  -> pm2 could not reload or restart the process."
            if [ -n "$PREV_SHA" ]; then
                rollback_to "$PREV_SHA"
                exit $?
            fi
            echo "Error: no rollback target available (worktree mode). Logs: pm2 logs $PM2_PROCESS_NAME"
            exit 2
        fi
    else
        echo "  -> Process not found in PM2, starting new instance..."
        pm2 start index.js --name "$PM2_PROCESS_NAME" --update-env
        pm2 save
    fi

    cd "$ROOT_DIR"

    # 6. Verify the process that came back actually serves traffic. Without this
    #    a crash-looping deploy still reported success.
    echo "[6/7] Verifying server health..."
    if ! wait_for_health; then
        if [ -n "$PREV_SHA" ]; then
            # 1 = the deploy failed but the previous version is serving again.
            # 2 = the rollback failed too and the site is down. Monitoring can
            #     tell those apart; a single exit 1 for both could not.
            rollback_to "$PREV_SHA"
            exit $?
        fi
        echo "Error: server is unhealthy and no rollback target is available (worktree mode)."
        echo "       Logs: pm2 logs ${PM2_PROCESS_NAME}"
        exit 2
    fi

    # 7. Update MCP (DJ tools server)
    # Needs its own block: its dist/ is gitignored, so a pull never carries the
    # build, and npm ci must keep devDependencies because the build runs tsc.
    echo "[7/7] Updating MCP (DJ tools)..."
    if [ ! -f "$MCP_DIR/package.json" ]; then
        echo "  -> No $MCP_DIR/package.json found — skipping."
    else
        cd "$MCP_DIR"

        echo "  -> Installing MCP dependencies..."
        npm ci --silent

        echo "  -> Building MCP..."
        if ! npm run build; then
            echo "Error: MCP build failed."
            exit 1
        fi

        if pm2 describe "$PM2_MCP_NAME" > /dev/null 2>&1; then
            echo "  -> Process found, restarting..."
            pm2 restart "$PM2_MCP_NAME" --update-env
        else
            echo "  -> Process not found in PM2, starting new instance..."
            pm2 start dist/http.js --name "$PM2_MCP_NAME" --update-env
            pm2 save
        fi

        cd "$ROOT_DIR"
    fi

    echo "==== Update Completed Successfully ===="
    echo "Run 'pm2 logs $PM2_PROCESS_NAME' or 'pm2 logs $PM2_MCP_NAME' to see output."
}

do_start() {
    echo "==== CueVote Server — Start ===="

    if ! command -v pm2 &> /dev/null; then
        echo "Error: pm2 is not installed or not in PATH."
        exit 1
    fi

    # npm ci, not npm install: install may rewrite package-lock.json, and an
    # update refuses to reset over a modified tracked file.
    if [ -f "$CLIENT_DIR/package.json" ] && [ ! -d "$CLIENT_DIR/node_modules" ]; then
        echo "Installing client dependencies..."
        cd "$CLIENT_DIR" && npm ci --silent && cd ..
    fi
    if [ -f "$SERVER_DIR/package.json" ] && [ ! -d "$SERVER_DIR/node_modules" ]; then
        echo "Installing server dependencies..."
        cd "$SERVER_DIR" && npm ci --silent && cd ..
    fi

    cd "$SERVER_DIR"

    if pm2 describe "$PM2_PROCESS_NAME" > /dev/null 2>&1; then
        echo "Process already exists, restarting clean..."
        pm2 delete "$PM2_PROCESS_NAME"
    fi
    echo "Starting instance..."
    pm2 start index.js --name "$PM2_PROCESS_NAME" --update-env
    pm2 save

    cd "$ROOT_DIR"

    echo "==== Server Started ===="
    echo "Run 'pm2 logs $PM2_PROCESS_NAME' to see output."
}

do_stop() {
    echo "==== CueVote Server — Stop ===="

    if ! command -v pm2 &> /dev/null; then
        echo "Error: pm2 is not installed or not in PATH."
        exit 1
    fi

    if pm2 describe "$PM2_PROCESS_NAME" > /dev/null 2>&1; then
        pm2 stop "$PM2_PROCESS_NAME"
        pm2 delete "$PM2_PROCESS_NAME"
        echo "Server stopped and removed from PM2."
    else
        echo "Process '$PM2_PROCESS_NAME' not found in PM2 — nothing to stop."
    fi
}

do_status() {
    if ! command -v pm2 &> /dev/null; then
        echo "Error: pm2 is not installed or not in PATH."
        exit 1
    fi
    pm2 status
}

show_usage() {
    echo "Usage: bash update_server.sh [command]"
    echo ""
    echo "Commands:"
    echo "  (no command)   Update code from GitHub, build client + MCP, restart both processes"
    echo "  start          Start the server (without pulling updates)"
    echo "  stop           Stop the server"
    echo "  status         Show PM2 process status"
    echo "  help           Show this help message"
}

# ---- Main ----

case "${1:-update}" in
    update)   do_update   ;;
    start)    do_start    ;;
    stop)     do_stop     ;;
    status)   do_status   ;;
    help|-h|--help)  show_usage ;;
    *)
        echo "Unknown command: $1"
        show_usage
        exit 1
        ;;
esac
