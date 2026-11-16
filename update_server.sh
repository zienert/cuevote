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

# ---- Health checks ----

# The port a process actually listens on, for polling its /health.
#
# Resolution has to match the process's, not approximate it. The server reads
# `process.env.PORT || 8080` after dotenv, the MCP `CUEVOTE_HTTP_PORT || 8082`,
# and dotenv does NOT override a variable that is already set — and
# `pm2 --update-env` hands the deployer's environment to the process. So an
# exported variable wins over the file, exactly as it does for the process.
#
# The file parse also has to survive what people actually write. Keeping
# everything after the first '=' turned `PORT=8080  # http port` into
# `8080#httpport`, which curl reads as a fragment and requests `/` instead of
# `/health` — failing every attempt and rolling back a healthy deploy.
#
# env_port VARIABLE ENV_FILE DEFAULT
env_port() {
    local var="$1" file="$2" default="$3" line="" value=""
    if [ -n "${!var}" ]; then
        echo "${!var}"
        return
    fi

    if [ -f "$file" ]; then
        # Accept an optional `export`, and spaces around `=`, like dotenv does.
        line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${var}[[:space:]]*=" "$file" | tail -n1)"
    fi

    if [ -n "$line" ]; then
        value="${line#*=}"
        value="${value%%#*}"                                    # drop a trailing comment
        value="$(echo "$value" | tr -d '[:space:]"'"'"'')"      # drop spaces and quotes
    fi

    # Anything that is not a plain port number is not something to poll.
    case "$value" in
        ''|*[!0-9]*) echo "$default" ;;
        *)           echo "$value" ;;
    esac
}

server_port() { env_port PORT "$SERVER_DIR/.env" 8080; }
mcp_port()    { env_port CUEVOTE_HTTP_PORT "$MCP_DIR/.env" 8082; }

# Polls a /health endpoint until it answers or the budget runs out. pm2 reload
# returns as soon as it has signalled the process, not when the new one is
# serving, so a single immediate curl would race the restart.
#
# wait_for_health LABEL PORT
wait_for_health() {
    local label="$1" port="$2"
    local attempts=15
    local i=1
    while [ "$i" -le "$attempts" ]; do
        if curl -fsS --max-time 2 "http://127.0.0.1:${port}/health" > /dev/null 2>&1; then
            echo "  -> ${label} health check passed on port ${port} (attempt ${i}/${attempts})."
            return 0
        fi
        sleep 1
        i=$((i + 1))
    done
    echo "  -> ${label} health check FAILED on port ${port} after ${attempts}s."
    return 1
}

server_healthy() { wait_for_health Server "$(server_port)"; }
mcp_healthy()    { wait_for_health MCP "$(mcp_port)"; }

# One look, no waiting: is the MCP serving right now?
mcp_answers() {
    curl -fsS --max-time 2 "http://127.0.0.1:$(mcp_port)/health" > /dev/null 2>&1
}

# ---- Processes ----

# The script pm2 runs the process NAME from, as pm2 recorded it; nothing if
# that cannot be read. jlist prints one line of JSON, possibly after notices.
pm2_exec_path() {
    pm2 jlist 2> /dev/null | node -e '
        let s = "";
        process.stdin.on("data", (d) => (s += d)).on("end", () => {
            const line = s.split("\n").reverse().find((l) => l.trim().startsWith("["));
            try {
                const p = JSON.parse(line).find((p) => p.name === process.argv[1]);
                if (p && p.pm2_env && p.pm2_env.pm_exec_path) console.log(p.pm2_env.pm_exec_path);
            } catch {}
        });' "$1" 2> /dev/null
}

# same_file A B: both exist and are the same file, symlinks resolved.
same_file() {
    local a b
    [ -e "$1" ] && [ -e "$2" ] || return 1
    a="$(cd "$(dirname "$1")" && pwd -P)/$(basename "$1")"
    b="$(cd "$(dirname "$2")" && pwd -P)/$(basename "$2")"
    [ "$a" = "$b" ]
}

# pm2_up NAME DIR SCRIPT VERB: makes pm2 run NAME from DIR/SCRIPT. Reloads or
# restarts it (VERB) when it already runs from there, starts it when pm2 does
# not know it yet.
#
# pm2 reload and restart re-run the script path recorded when the process was
# first started, and every checkout uses the same process names. In a worktree
# they restarted whichever checkout had started the process first: the deploy
# reported this worktree healthy while another checkout's code answered. A
# process that runs from anywhere else is deleted and started again from here.
pm2_up() {
    local name="$1" dir="$2" script="$3" verb="$4" running
    if pm2 describe "$name" > /dev/null 2>&1; then
        running="$(pm2_exec_path "$name")"
        if [ -z "$running" ]; then
            echo "  -> pm2 did not say where $name runs from; leaving it there."
        fi
        if [ -z "$running" ] || same_file "$running" "$dir/$script"; then
            pm2 "$verb" "$name" --update-env || pm2 restart "$name" --update-env
            return
        fi
        echo "  -> pm2 ran $name from $running;"
        echo "     starting it from $dir/$script instead."
        pm2 delete "$name" > /dev/null || return 1
    else
        echo "  -> $name is not in pm2 yet; starting it from $dir/$script."
    fi
    (cd "$dir" && pm2 start "$script" --name "$name" --update-env) || return 1
    pm2 save || echo "  -> Warning: pm2 save failed; $name will not come back after a reboot."
}

# ---- Staged builds ----

# Nothing a build writes may be live before the tests have passed and the new
# server is healthy. nginx serves the client straight from cuevote-client/dist,
# and pm2 starts the MCP from cuevote-mcp/dist; a restart, a crash or the
# nightly reboot would pick up whatever is there. So both build into dist.next,
# and publish swaps that in only once the server is up, keeping the build it
# replaces as dist.prev for the rollback.

# publish DIR: DIR/dist.next becomes DIR/dist, the old DIR/dist DIR/dist.prev.
publish() {
    local d="$1"
    rm -rf "$d/dist.prev" || return 1
    if [ -d "$d/dist" ]; then
        mv "$d/dist" "$d/dist.prev" || return 1
    fi
    mv "$d/dist.next" "$d/dist"
}

# unpublish DIR: undoes publish, however far it got. Without a dist.prev (a
# first deploy) the new build stays, as there is nothing older to serve.
unpublish() {
    local d="$1"
    if [ -d "$d/dist.next" ] && [ -d "$d/dist" ]; then
        rm -rf "$d/dist.next"           # it never got as far as moving dist
        return
    fi
    [ -d "$d/dist.prev" ] || return 0
    rm -rf "$d/dist" "$d/dist.next" && mv "$d/dist.prev" "$d/dist"
}

# npm ci works in place, so the server's and the MCP's node_modules belong to
# the new commit as soon as their install has run. The running processes have
# theirs loaded already, but a restart would load what is on disk. Going back
# to PREV_SHA therefore reinstalls wherever this run changed them: the install
# failed halfway, or the commit changed the lockfile.
#
# restore_deps DIR STATE   (STATE: untouched, failed or installed)
restore_deps() {
    local dir="$1" state="$2" rel="${1#"$ROOT_DIR"/}"
    case "$state" in
        untouched) return 0 ;;
        installed)
            if git -C "$ROOT_DIR" diff --quiet "$PREV_SHA" "$NEW_SHA" -- "$rel/package.json" "$rel/package-lock.json"; then
                return 0
            fi ;;
    esac
    echo "  -> Reinstalling $rel dependencies of ${PREV_SHA}..."
    (cd "$dir" && npm ci --silent)
}

# Puts the checkout back on PREV_SHA, dependencies included.
restore_checkout() {
    git -C "$ROOT_DIR" reset -q --hard "$PREV_SHA" || return 1
    restore_deps "$SERVER_DIR" "$SERVER_DEPS" || return 1
    restore_deps "$MCP_DIR" "$MCP_DEPS"
}

# ---- Outcomes ----
#
# Exit codes of an update (DEPLOYMENT.md, section 10):
#   0  deployed and healthy
#   1  failed after going live, rolled back: the previous version is serving
#   2  needs you now: the server is down, or what is serving is unknown
#   3  stopped before anything went live: nothing changed
#   4  partial: the site is up, the MCP is not

# Every planned exit of an update goes through finish. The EXIT trap turns any
# other (a command failing under set -e, Ctrl-C) into 2: nobody can say what
# is serving then.
finish() {
    UPDATE_DONE=true
    exit "$1"
}

on_update_exit() {
    local rc=$?
    if [ "$UPDATE_DONE" != true ] && [ "$rc" -ne 0 ]; then
        echo "Error: update_server.sh stopped unexpectedly (exit ${rc}). What is serving now is unknown."
        exit 2
    fi
}

# A step before anything went live failed: drop the staged builds and, in the
# server checkout, go back to PREV_SHA, so that a later restart runs what runs
# now. Exit 3, or 2 when the checkout cannot be put back.
abort_unchanged() {
    echo ""
    echo "Error: $1"
    rm -rf "$CLIENT_DIR/dist.next" "$MCP_DIR/dist.next"
    if [ -z "$PREV_SHA" ]; then
        echo "==== Nothing went live: the running processes and the served client are untouched. ===="
        finish 3
    fi
    if restore_checkout; then
        echo "==== Nothing went live, and the checkout is back on ${PREV_SHA}. ===="
        finish 3
    fi
    echo "Error: nothing went live, but the checkout could not be put back on ${PREV_SHA};"
    echo "       a restart would run something else. Recover manually: git reset --hard ${PREV_SHA},"
    echo "       then npm ci in cuevote-server and cuevote-mcp."
    finish 2
}

# Something failed after the new version went live. Puts every part back on
# PREV_SHA and checks that each comes back. Exit 1, or 2 when the server does
# not come back, or 4 when only the MCP does not.
roll_back() {
    echo ""
    echo "!!!! Deployment failed after going live — rolling back to ${PREV_SHA} !!!!"
    if ! restore_checkout \
        || { [ "$CLIENT_PUBLISHED" = true ] && ! unpublish "$CLIENT_DIR"; } \
        || { [ "$MCP_PUBLISHED" = true ] && ! unpublish "$MCP_DIR"; }; then
        echo "Error: could not put everything back on ${PREV_SHA}; what is served now is unverified."
        echo "       Recover manually: git reset --hard ${PREV_SHA} && bash update_server.sh start"
        finish 2
    fi
    rm -rf "$CLIENT_DIR/dist.next" "$MCP_DIR/dist.next"
    echo "  -> Code, client and MCP build are back on ${PREV_SHA}; restarting."

    if ! pm2_up "$PM2_PROCESS_NAME" "$SERVER_DIR" index.js reload || ! server_healthy; then
        echo "Error: the previous version is unhealthy too. Manual intervention required."
        echo "       Logs: pm2 logs ${PM2_PROCESS_NAME}"
        finish 2
    fi
    if [ "$MCP_RESTARTED" = true ]; then
        if ! pm2_up "$PM2_MCP_NAME" "$MCP_DIR" dist/http.js restart || ! mcp_healthy; then
            echo "==== Rolled back to ${PREV_SHA}: the site serves the previous version, but the MCP did not come back. ===="
            echo "     Logs: pm2 logs ${PM2_MCP_NAME}"
            finish 4
        fi
    fi
    echo "==== Rolled back to ${PREV_SHA}. The previous version is serving again. ===="
    echo "     NOTE: origin/main still points at the bad commit. Running this"
    echo "     script again will redeploy it — fix or revert main first."
    finish 1
}

# A step from the server restart onwards failed.
fail_live() {
    echo "Error: $1"
    if [ -n "$PREV_SHA" ]; then
        roll_back
    fi
    echo "Error: no rollback target (worktree mode). Logs: pm2 logs ${PM2_PROCESS_NAME}"
    finish 2
}

# The new MCP did not come up after everything else went live. If it was
# serving before, this deploy broke it: roll everything back. If it was not,
# a rollback would not bring it back either, and the site need not wait for it.
mcp_failed() {
    echo "Error: the new MCP is not healthy."
    if [ "$MCP_WAS_HEALTHY" = true ] && [ -n "$PREV_SHA" ]; then
        roll_back
    fi
    if [ "$MCP_WAS_HEALTHY" = true ]; then
        echo "==== Partial: the site runs this worktree; the MCP is down and there is no rollback target (worktree mode). ===="
    else
        echo "==== Partial: the site runs the new version; the MCP is down, and it was not serving before this deploy either. ===="
    fi
    echo "     Logs: pm2 logs ${PM2_MCP_NAME}"
    finish 4
}

# ---- Subcommands ----

do_update() {
    echo "==== CueVote Server — Update & Restart ===="
    trap on_update_exit EXIT

    PREV_SHA="" NEW_SHA=""
    SERVER_DEPS=untouched MCP_DEPS=untouched
    CLIENT_PUBLISHED=false MCP_PUBLISHED=false MCP_RESTARTED=false MCP_WAS_HEALTHY=false

    if ! command -v pm2 &> /dev/null; then
        echo "Error: pm2 is not installed or not in PATH."
        finish 3
    fi
    if ! command -v curl &> /dev/null; then
        echo "Error: curl is not installed or not in PATH (needed for the health check)."
        finish 3
    fi

    detect_checkout || finish 3

    local mcp=false
    [ -f "$MCP_DIR/package.json" ] && mcp=true

    # 1. Sync to latest remote main
    # PREV_SHA is captured *before* the reset — it is the only handle on the
    # version that was known to work, and `git reset --hard` destroys the tree.
    if [ "$IS_WORKTREE" = true ]; then
        echo "[1/8] Skipping git (worktree mode — the worktree is deployed as it is)"
    else
        echo "[1/8] Updating code from git (reset to origin/main)..."
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
            finish 3
        fi
        if ! git -C "$ROOT_DIR" fetch origin; then
            echo "Error: git fetch failed. Nothing was changed."
            finish 3
        fi
        ahead="$(git -C "$ROOT_DIR" rev-list --count origin/main..HEAD)" || ahead="?"
        if [ "$ahead" != 0 ]; then
            echo "Error: main has ${ahead} commit(s) that origin/main does not; the reset would drop them."
            echo "       Push them or move them to a branch, then run again. Nothing was changed."
            finish 3
        fi
        if ! git -C "$ROOT_DIR" reset --hard origin/main; then
            abort_unchanged "git reset --hard origin/main failed."
        fi
        NEW_SHA="$(git -C "$ROOT_DIR" rev-parse HEAD)"
        echo "  -> Now deploying:      ${NEW_SHA}"
    fi

    # 2.-4. Build and test. None of it is live yet: the client and the MCP
    #       build into dist.next, and nothing is restarted. A failure here
    #       leaves what runs and what is served as it was (exit 3).
    echo "[2/8] Building client (into dist.next; the served dist stays as it is)..."
    rm -rf "$CLIENT_DIR/dist.next"
    echo "  -> Installing client dependencies..."
    (cd "$CLIENT_DIR" && npm ci --silent) || abort_unchanged "client dependency install failed."
    echo "  -> Building client..."
    (cd "$CLIENT_DIR" && npm run build -- --outDir dist.next) || abort_unchanged "client build failed."
    echo "  -> Client build successful."

    # The MCP's dist is gitignored, so a pull never carries the build, and npm
    # ci must keep devDependencies because the build runs tsc. It builds before
    # anything restarts, so a broken MCP stops the whole deploy.
    echo "[3/8] Building MCP (into dist.next)..."
    if [ "$mcp" = true ]; then
        rm -rf "$MCP_DIR/dist.next"
        echo "  -> Installing MCP dependencies..."
        MCP_DEPS=failed
        (cd "$MCP_DIR" && npm ci --silent) || abort_unchanged "MCP dependency install failed."
        MCP_DEPS=installed
        echo "  -> Building MCP..."
        (cd "$MCP_DIR" && npm run build -- --outDir dist.next) || abort_unchanged "MCP build failed."
        echo "  -> MCP build successful."
    else
        echo "  -> No $MCP_DIR/package.json found — skipping."
    fi

    echo "[4/8] Installing server dependencies and running the tests..."
    SERVER_DEPS=failed
    (cd "$SERVER_DIR" && npm ci --silent) || abort_unchanged "server dependency install failed."
    SERVER_DEPS=installed
    (cd "$SERVER_DIR" && npm test) || abort_unchanged "server tests failed."
    echo "  -> Tests passed."

    # Whether the MCP serves right now decides what its failure later means.
    if [ "$mcp" = true ] && mcp_answers; then
        MCP_WAS_HEALTHY=true
    fi

    # 5. Restart the server. From here on the new version is live, and a
    #    failure rolls everything back to PREV_SHA.
    #    A wedged pm2 (reload and restart both failing) used to end the script
    #    under `set -e` before the rollback could run; pm2_up is tested in a
    #    condition, where `set -e` stands down.
    echo "[5/8] Restarting server..."
    if ! pm2_up "$PM2_PROCESS_NAME" "$SERVER_DIR" index.js reload; then
        fail_live "pm2 could not reload or restart ${PM2_PROCESS_NAME}."
    fi

    # 6. Verify the process that came back actually serves traffic. Without this
    #    a crash-looping deploy still reported success.
    echo "[6/8] Verifying server health..."
    server_healthy || fail_live "the new server is unhealthy."

    # 7. Only now does the new client go out: the tests passed and the server
    #    it talks to is up.
    echo "[7/8] Publishing client..."
    CLIENT_PUBLISHED=true
    publish "$CLIENT_DIR" || fail_live "could not swap the new client in."
    echo "  -> Serving the new client (the previous build is kept as dist.prev)."

    # 8. The MCP goes out last and has to come up healthy.
    if [ "$mcp" = true ]; then
        echo "[8/8] Publishing and restarting MCP..."
        MCP_PUBLISHED=true
        publish "$MCP_DIR" || fail_live "could not swap the new MCP build in."
        MCP_RESTARTED=true
        if ! pm2_up "$PM2_MCP_NAME" "$MCP_DIR" dist/http.js restart || ! mcp_healthy; then
            mcp_failed
        fi
    else
        echo "[8/8] No MCP — skipping."
    fi

    echo "==== Update Completed Successfully ===="
    echo "Run 'pm2 logs $PM2_PROCESS_NAME' or 'pm2 logs $PM2_MCP_NAME' to see output."
    finish 0
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
