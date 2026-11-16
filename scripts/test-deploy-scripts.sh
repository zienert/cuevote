#!/usr/bin/env bash
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
# Copyright (c) 2026 Julian Zienert
#
# Sandbox tests for update_server.sh and setup-mcp.sh.
#
# Everything happens in a throw-away directory. A local bare repository plays
# origin; update_server.sh is committed into it from this checkout, and every
# deploy case runs from a fresh clone or worktree of it. setup-mcp.sh runs
# against placeholder .env files. npm, pm2, curl and sleep are stubs first in
# PATH that record their calls and fake the outcome; nginx, ssh and sudo are
# stubs that fail, so a stray call shows up. git is real but stays inside the
# sandbox. No real .env, process, server or network is touched.
#
#   bash scripts/test-deploy-scripts.sh
#   KEEP_SANDBOX=1 bash scripts/test-deploy-scripts.sh       # keep it for a look
#   VERBOSE=1 bash scripts/test-deploy-scripts.sh            # show every run's output
#   UPDATE_SERVER_SH=/path/to/update_server.sh SETUP_MCP_SH=/path/to/setup-mcp.sh \
#     bash scripts/test-deploy-scripts.sh                   # test other versions
set -uo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR PORT CUEVOTE_HTTP_PORT

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
UPDATE_SERVER_SH="${UPDATE_SERVER_SH:-$REPO/update_server.sh}"
SETUP_MCP_SH="${SETUP_MCP_SH:-$REPO/setup-mcp.sh}"

SB="$(mktemp -d "${TMPDIR:-/tmp}/cuevote-deploy-test.XXXXXX")" || exit 1
SB="$(cd "$SB" && pwd -P)"
cleanup() { if [ -n "${KEEP_SANDBOX:-}" ]; then echo "sandbox kept: $SB"; else rm -rf "$SB"; fi; }
trap cleanup EXIT

export GIT_CEILING_DIRECTORIES="$SB" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=sandbox GIT_AUTHOR_EMAIL=sandbox@example.invalid
export GIT_COMMITTER_NAME=sandbox GIT_COMMITTER_EMAIL=sandbox@example.invalid
export SANDBOX="$SB" CALLS="$SB/calls.log" PM2_STATE="$SB/pm2"

# ---- stubs --------------------------------------------------------------------

mkdir -p "$SB/bin" "$PM2_STATE"

cat > "$SB/bin/npm" <<'EOF'
#!/bin/sh
# Marker files at the top of the checkout make a step fail: <project>.CI_FAILS,
# TESTS_FAIL, CLIENT_BUILD_FAILS, MCP_BUILD_FAILS. A build writes the commit it
# came from; an MCP built from a commit with MCP_UNHEALTHY never gets healthy.
top="$(git rev-parse --show-toplevel 2>/dev/null)"
sha="$(git rev-parse --short HEAD 2>/dev/null)"
here="$(basename "$PWD")"
echo "npm $* | $here @ $sha" >> "$CALLS"
has() { [ -f "$top/$1" ]; }
case "${1:-}" in
  ci|install) has "$here.CI_FAILS" && exit 1; exit 0 ;;
  test) has TESTS_FAIL && exit 1; exit 0 ;;
  run) [ "${2:-}" = build ] || exit 0 ;;
  *) exit 0 ;;
esac
out=dist; shift 2
while [ $# -gt 0 ]; do [ "$1" = --outDir ] && out="$2"; shift; done
case "$here" in
  cuevote-client)
    has CLIENT_BUILD_FAILS && exit 1
    rm -rf "$out" && mkdir -p "$out" && echo "client $sha" > "$out/index.html" ;;
  cuevote-mcp)
    has MCP_BUILD_FAILS && exit 1
    health=ok; has MCP_UNHEALTHY && health=UNHEALTHY
    rm -rf "$out" && mkdir -p "$out" && echo "mcp $sha $health" > "$out/http.js" ;;
esac
exit 0
EOF

cat > "$SB/bin/pm2" <<'EOF'
#!/bin/sh
# A process is a directory under $PM2_STATE holding the script it runs (the
# path resolved at start, as with real pm2) and whether that script answers
# /health: not if the file is gone or contains UNHEALTHY. PM2_FAILS at the top
# of the sandbox makes reload and restart fail, PM2_JLIST_GARBAGE spoils jlist.
echo "pm2 $*" >> "$CALLS"
cmd="${1:-}"; [ $# -gt 0 ] && shift
st="$PM2_STATE/${1:-none}"
health() {
  if [ -f "$(cat "$st/exec")" ] && ! grep -q UNHEALTHY "$(cat "$st/exec")"; then echo up; else echo down; fi > "$st/health"
}
case "$cmd" in
  describe) [ -d "$st" ] ;;
  reload|restart) [ -d "$st" ] && [ ! -f "$SANDBOX/PM2_FAILS" ] && health ;;
  delete) [ -d "$st" ] && rm -rf "$st" ;;
  stop) [ -d "$st" ] && echo down > "$st/health" ;;
  start)
    script="$1"; name=""
    while [ $# -gt 0 ]; do [ "$1" = --name ] && name="$2"; shift; done
    st="$PM2_STATE/$name"; mkdir -p "$st"
    echo "$(pwd -P)/$script" > "$st/exec"; health ;;
  jlist)
    [ -f "$SANDBOX/PM2_JLIST_GARBAGE" ] && { echo "not json"; exit 0; }
    sep=""; printf '['
    for d in "$PM2_STATE"/*/; do
      [ -d "$d" ] || continue
      printf '%s{"name":"%s","pm2_env":{"pm_exec_path":"%s"}}' "$sep" "$(basename "$d")" "$(cat "$d/exec")"; sep=","
    done
    printf ']' ;;
  *) : ;;
esac
EOF

cat > "$SB/bin/curl" <<'EOF'
#!/bin/sh
# Answers the health URLs from the pm2 stub's state.
echo "curl $*" >> "$CALLS"
url=""
for a in "$@"; do case "$a" in http://*) url="$a" ;; esac; done
case "$url" in
  *:8080/health) name=cuevote-server ;;
  *:8082/health) name=cuevote-mcp-dj ;;
  *:8081/admin/health) exit 0 ;;
  *) exit 7 ;;
esac
[ "$(cat "$PM2_STATE/$name/health" 2>/dev/null)" = up ] || exit 7
EOF

printf '#!/bin/sh\nexit 0\n' > "$SB/bin/sleep"
for b in nginx ssh sudo; do
  printf '#!/bin/sh\necho "%s $*" >> "$SANDBOX/stray.log"\nexit 1\n' "$b" > "$SB/bin/$b"
done
chmod +x "$SB/bin/"*
export PATH="$SB/bin:$PATH"
for b in npm pm2 curl sleep nginx ssh sudo; do
  [ "$(command -v "$b")" = "$SB/bin/$b" ] || { echo "stub $b is not first in PATH"; exit 1; }
done

# ---- origin -------------------------------------------------------------------

git init -q --bare --initial-branch=main "$SB/origin.git"
git init -q --initial-branch=main "$SB/seed"
seed() { git -C "$SB/seed" "$@"; }
seed remote add origin "$SB/origin.git"
cp "$UPDATE_SERVER_SH" "$SB/seed/update_server.sh"
cp "$REPO/.gitignore" "$SB/seed/.gitignore"
for p in cuevote-client cuevote-server cuevote-mcp; do
  mkdir -p "$SB/seed/$p"
  echo "{\"name\":\"$p\"}" > "$SB/seed/$p/package.json"
  echo '{"lockfileVersion":3}' > "$SB/seed/$p/package-lock.json"
done
echo "// server" > "$SB/seed/cuevote-server/index.js"
echo v1 > "$SB/seed/cuevote-client/app.txt"
seed add -A && seed commit -qm C1 && seed push -q origin main
C1="$(seed rev-parse --short HEAD)"

# new_commit BASE MESSAGE [PATH=CONTENT]...: commits on BASE, makes it
# origin/main and prints its short sha.
new_commit() {
  local base="$1" msg="$2" kv; shift 2
  seed reset -q --hard "$base"
  for kv in "$@"; do
    mkdir -p "$(dirname "$SB/seed/${kv%%=*}")"
    printf '%s\n' "${kv#*=}" > "$SB/seed/${kv%%=*}"
  done
  seed add -A && seed commit -qm "$msg" && seed push -qf origin HEAD:main
  seed rev-parse --short HEAD
}
set_main() { seed push -qf origin "$(seed rev-parse "$1"):refs/heads/main"; }

# deployed NAME: a fresh clone of origin at C1 as the server would have it:
# client and MCP built, server and MCP running under pm2 from it.
deployed() {
  local dir="$SB/$1"
  rm -rf "$dir" "$PM2_STATE" && mkdir -p "$PM2_STATE"
  set_main "$C1"
  git clone -q -b main "$SB/origin.git" "$dir"
  (cd "$dir/cuevote-client" && npm run build) > /dev/null
  (cd "$dir/cuevote-mcp" && npm run build) > /dev/null
  (cd "$dir/cuevote-server" && pm2 start index.js --name cuevote-server) > /dev/null
  (cd "$dir/cuevote-mcp" && pm2 start dist/http.js --name cuevote-mcp-dj) > /dev/null
  : > "$CALLS"
}

# with_worktree: a main checkout at C1 plus a worktree on branch "feature" with
# one commit of its own and an uncommitted edit; origin/main has moved on to a
# commit neither has, so a reset to it would show.
with_worktree() {
  rm -rf "$SB/main" "$SB/wt" "$PM2_STATE" && mkdir -p "$PM2_STATE"
  set_main "$C1"
  git clone -q -b main "$SB/origin.git" "$SB/main"
  git -C "$SB/main" worktree add -q -b feature "$SB/wt" main 2> /dev/null
  echo feature > "$SB/wt/feature.txt"
  git -C "$SB/wt" add feature.txt && git -C "$SB/wt" commit -qm "feature work"
  echo "uncommitted edit" >> "$SB/wt/cuevote-client/app.txt"
  FEATURE="$(git -C "$SB/wt" rev-parse --short HEAD)"
  new_commit "$C1" "C2 on origin" "cuevote-client/app.txt=v2" > /dev/null
  : > "$CALLS"
}

# ---- running and checking -------------------------------------------------------

PASSED=0 FAILED=0 SHOWN=""
OUT="$SB/out.log"

case_() { echo; echo "== $1"; SHOWN=""; }

# run CWD COMMAND...: runs COMMAND from CWD; output in $OUT, exit code in $RC.
run() {
  local cwd="$1"; shift
  (cd "$cwd" && "$@") > "$OUT" 2>&1
  RC=$?
  if [ -n "${VERBOSE:-}" ]; then echo "   --- exit code $RC, output:"; sed 's/^/   | /' "$OUT"; echo "   ---"; fi
}

# check DESCRIPTION TEST...: TEST is a command; on the first failure in a case
# the script's output is shown once.
check() {
  local what="$1"; shift
  if "$@"; then
    PASSED=$((PASSED + 1)); echo "   ok      $what"
  else
    FAILED=$((FAILED + 1)); echo "   FAILED  $what"
    if [ -z "$SHOWN" ]; then
      SHOWN=1; echo "   --- exit code $RC, output:"; sed 's/^/   | /' "$OUT"; echo "   ---"
    fi
  fi
}

is() { [ "$1" = "$2" ]; }
says() { grep -q -- "$1" "$OUT"; }
calls() { grep -cE -- "$1" "$CALLS"; }
head_of() { git -C "$1" rev-parse --short HEAD; }
branch_of() { git -C "$1" symbolic-ref --quiet --short HEAD; }
served() { cat "$1/cuevote-client/dist/index.html" 2> /dev/null; }
served_prev() { cat "$1/cuevote-client/dist.prev/index.html" 2> /dev/null; }
mcp_build() { cat "$1/cuevote-mcp/dist/http.js" 2> /dev/null; }
health_of() { cat "$PM2_STATE/$1/health" 2> /dev/null; }
no_staged() { [ ! -e "$1/cuevote-client/dist.next" ] && [ ! -e "$1/cuevote-mcp/dist.next" ]; }
# after A B: a call matching B comes after the first call matching A.
after() {
  local a b
  a="$(grep -nE -- "$1" "$CALLS" | head -n1 | cut -d: -f1)"
  b="$(grep -nE -- "$2" "$CALLS" | tail -n1 | cut -d: -f1)"
  [ -n "$a" ] && [ -n "$b" ] && [ "$b" -gt "$a" ]
}
RESTARTS='^pm2 (reload|restart|start|delete|stop) '

# ---- INFRA-02: which checkout the script acts on -------------------------------

case_ "worktree script, run from inside the worktree"
with_worktree
run "$SB/wt" bash "$SB/wt/update_server.sh"
check "exit 0" is "$RC" 0
check "worktree mode" says "Worktree mode"
check "branch feature not moved" is "$(git -C "$SB/main" rev-parse --short feature)" "$FEATURE"
check "uncommitted edit kept" grep -q "uncommitted edit" "$SB/wt/cuevote-client/app.txt"
check "the worktree's client was built" is "$(served "$SB/wt")" "client $FEATURE"

case_ "worktree script, run from the main checkout"
with_worktree
run "$SB/main" bash "$SB/wt/update_server.sh"
check "exit 0" is "$RC" 0
check "worktree mode, although the working directory is the main checkout" says "Worktree mode"
check "branch feature not moved" is "$(git -C "$SB/main" rev-parse --short feature)" "$FEATURE"
check "feature commit still checked out" test -f "$SB/wt/feature.txt"
check "uncommitted edit kept" grep -q "uncommitted edit" "$SB/wt/cuevote-client/app.txt"
check "main checkout not moved" is "$(head_of "$SB/main")" "$C1"

case_ "worktree script with the main checkout's GIT_DIR exported"
with_worktree
run "$SB/main" env GIT_DIR="$SB/main/.git" bash "$SB/wt/update_server.sh"
check "worktree mode" says "Worktree mode"
check "branch feature not moved" is "$(git -C "$SB/main" rev-parse --short feature)" "$FEATURE"
check "uncommitted edit kept" grep -q "uncommitted edit" "$SB/wt/cuevote-client/app.txt"
check "main checkout not moved" is "$(head_of "$SB/main")" "$C1"

case_ "main checkout's script, run from outside any repository"
deployed prod
C2="$(new_commit "$C1" C2 "cuevote-client/app.txt=v2")"
mkdir -p "$SB/elsewhere"
run "$SB/elsewhere" bash "$SB/prod/update_server.sh"
check "exit 0" is "$RC" 0
check "deployed origin/main" is "$(head_of "$SB/prod")" "$C2"
check "serves the new client" is "$(served "$SB/prod")" "client $C2"

case_ "a copy of the script outside any checkout"
mkdir -p "$SB/loose" && cp "$UPDATE_SERVER_SH" "$SB/loose/update_server.sh"
: > "$CALLS"
run "$SB/loose" bash "$SB/loose/update_server.sh"
check "exit 3" is "$RC" 3
check "says why" says "not the top of a git checkout"
check "no npm or pm2 call" is "$(calls '^(npm|pm2) ')" 0

case_ "main checkout on another branch"
deployed prod
git -C "$SB/prod" switch -q -c topic
new_commit "$C1" C2 "cuevote-client/app.txt=v2" > /dev/null
run "$SB/prod" bash "$SB/prod/update_server.sh"
check "exit 3" is "$RC" 3
check "says why" says "not on main"
check "still on topic, not moved" is "$(branch_of "$SB/prod") $(head_of "$SB/prod")" "topic $C1"
check "no npm or pm2 call" is "$(calls '^(npm|pm2) ')" 0

case_ "main checkout with an uncommitted change"
deployed prod
echo "hand edit" >> "$SB/prod/cuevote-client/app.txt"
new_commit "$C1" C2 "cuevote-client/app.txt=v2" > /dev/null
run "$SB/prod" bash "$SB/prod/update_server.sh"
check "exit 3" is "$RC" 3
check "names the file" says "cuevote-client/app.txt"
check "edit kept" grep -q "hand edit" "$SB/prod/cuevote-client/app.txt"
check "not moved" is "$(head_of "$SB/prod")" "$C1"
check "no npm or pm2 call" is "$(calls '^(npm|pm2) ')" 0

case_ "main checkout with a commit origin/main does not have"
deployed prod
echo local > "$SB/prod/local.txt"
git -C "$SB/prod" add local.txt && git -C "$SB/prod" commit -qm "local commit"
LOCAL="$(head_of "$SB/prod")"
new_commit "$C1" C2 "cuevote-client/app.txt=v2" > /dev/null
run "$SB/prod" bash "$SB/prod/update_server.sh"
check "exit 3" is "$RC" 3
check "says why" says "origin/main does not"
check "local commit kept" is "$(head_of "$SB/prod")" "$LOCAL"
check "no npm or pm2 call" is "$(calls '^(npm|pm2) ')" 0

# ---- INFRA-01: nothing goes live before the tests pass and the server is up ----

case_ "server tests fail"
deployed prod
new_commit "$C1" "C2 red tests" TESTS_FAIL=1 cuevote-client/app.txt=v2 > /dev/null
run "$SB/prod" bash "$SB/prod/update_server.sh"
check "exit 3 (nothing changed)" is "$RC" 3
check "checkout back on the deployed commit" is "$(head_of "$SB/prod")" "$C1"
check "still serves the deployed client" is "$(served "$SB/prod")" "client $C1"
check "no staged build left behind" no_staged "$SB/prod"
check "nothing restarted" is "$(calls "$RESTARTS")" 0
check "server dependencies not reinstalled (lockfile unchanged)" is "$(calls '^npm ci .* cuevote-server @')" 1

case_ "server tests fail on a commit that changes the server's dependencies"
deployed prod
new_commit "$C1" "C2 red tests, new lockfile" TESTS_FAIL=1 \
  'cuevote-server/package-lock.json={"lockfileVersion":3,"changed":true}' > /dev/null
run "$SB/prod" bash "$SB/prod/update_server.sh"
check "exit 3 (nothing changed)" is "$RC" 3
check "checkout back on the deployed commit" is "$(head_of "$SB/prod")" "$C1"
check "dependencies reinstalled for the deployed commit" is "$(calls "^npm ci .* cuevote-server @ $C1")" 1

case_ "client build fails"
deployed prod
new_commit "$C1" "C2 client does not build" CLIENT_BUILD_FAILS=1 > /dev/null
run "$SB/prod" bash "$SB/prod/update_server.sh"
check "exit 3 (nothing changed)" is "$RC" 3
check "checkout back on the deployed commit" is "$(head_of "$SB/prod")" "$C1"
check "still serves the deployed client" is "$(served "$SB/prod")" "client $C1"
check "nothing restarted" is "$(calls "$RESTARTS")" 0

case_ "MCP build fails"
deployed prod
new_commit "$C1" "C2 MCP does not build" MCP_BUILD_FAILS=1 cuevote-client/app.txt=v2 > /dev/null
run "$SB/prod" bash "$SB/prod/update_server.sh"
check "exit 3 (nothing changed)" is "$RC" 3
check "checkout back on the deployed commit" is "$(head_of "$SB/prod")" "$C1"
check "still serves the deployed client" is "$(served "$SB/prod")" "client $C1"
check "server not reloaded, nothing restarted" is "$(calls "$RESTARTS")" 0
check "MCP keeps its deployed build" is "$(mcp_build "$SB/prod")" "mcp $C1 ok"
check "no staged build left behind" no_staged "$SB/prod"

case_ "everything healthy"
deployed prod
C2="$(new_commit "$C1" "C2 all good" cuevote-client/app.txt=v2)"
run "$SB/prod" bash "$SB/prod/update_server.sh"
check "exit 0" is "$RC" 0
check "deployed origin/main" is "$(head_of "$SB/prod")" "$C2"
check "serves the new client" is "$(served "$SB/prod")" "client $C2"
check "keeps the previous client as dist.prev" is "$(served_prev "$SB/prod")" "client $C1"
check "MCP runs the new build" is "$(mcp_build "$SB/prod")" "mcp $C2 ok"
check "server health checked after its reload" after '^pm2 reload cuevote-server' 'curl .*:8080/health'
check "MCP health checked after its restart" after '^pm2 restart cuevote-mcp-dj' 'curl .*:8082/health'
check "no staged build left behind" no_staged "$SB/prod"

case_ "new server is unhealthy"
deployed prod
new_commit "$C1" "C2 server crashes" cuevote-server/index.js=UNHEALTHY cuevote-client/app.txt=v2 > /dev/null
run "$SB/prod" bash "$SB/prod/update_server.sh"
check "exit 1 (rolled back)" is "$RC" 1
check "checkout back on the deployed commit" is "$(head_of "$SB/prod")" "$C1"
check "the new client never went out" is "$(served "$SB/prod")" "client $C1"
check "server healthy again" is "$(health_of cuevote-server)" up
check "MCP never restarted" is "$(calls '^pm2 (restart|start|delete).*cuevote-mcp-dj')" 0
check "MCP keeps its deployed build" is "$(mcp_build "$SB/prod")" "mcp $C1 ok"
check "no staged build left behind" no_staged "$SB/prod"

case_ "pm2 cannot reload or restart anything"
deployed prod
new_commit "$C1" "C2" cuevote-client/app.txt=v2 > /dev/null
touch "$SB/PM2_FAILS"
run "$SB/prod" bash "$SB/prod/update_server.sh"
rm -f "$SB/PM2_FAILS"
check "exit 2 (needs you)" is "$RC" 2
check "says so" says "Manual intervention required"
check "checkout back on the deployed commit" is "$(head_of "$SB/prod")" "$C1"
check "the new client never went out" is "$(served "$SB/prod")" "client $C1"

case_ "new MCP is unhealthy, the old one was serving"
deployed prod
new_commit "$C1" "C2 MCP crashes" MCP_UNHEALTHY=1 cuevote-client/app.txt=v2 > /dev/null
run "$SB/prod" bash "$SB/prod/update_server.sh"
check "exit 1 (rolled back)" is "$RC" 1
check "checkout back on the deployed commit" is "$(head_of "$SB/prod")" "$C1"
check "client back on the deployed build" is "$(served "$SB/prod")" "client $C1"
check "MCP back on the deployed build" is "$(mcp_build "$SB/prod")" "mcp $C1 ok"
check "server healthy" is "$(health_of cuevote-server)" up
check "MCP healthy again" is "$(health_of cuevote-mcp-dj)" up

case_ "new MCP is unhealthy, and it was not serving before either"
deployed prod
pm2 stop cuevote-mcp-dj > /dev/null
C2="$(new_commit "$C1" "C2 MCP crashes" MCP_UNHEALTHY=1 cuevote-client/app.txt=v2)"
run "$SB/prod" bash "$SB/prod/update_server.sh"
check "exit 4 (partial)" is "$RC" 4
check "says why" says "not serving before"
check "the site stays on the new version" is "$(head_of "$SB/prod") $(served "$SB/prod")" "$C2 client $C2"
check "server healthy" is "$(health_of cuevote-server)" up

case_ "worktree: server tests fail"
with_worktree
touch "$SB/wt/TESTS_FAIL"
run "$SB/wt" bash "$SB/wt/update_server.sh"
check "exit 3 (nothing changed)" is "$RC" 3
check "branch feature not moved" is "$(git -C "$SB/main" rev-parse --short feature)" "$FEATURE"
check "uncommitted edit kept" grep -q "uncommitted edit" "$SB/wt/cuevote-client/app.txt"
check "nothing restarted" is "$(calls "$RESTARTS")" 0

# ---- INFRA-08: pm2 runs each process from the checkout being deployed ----------

# from_main: pm2 runs server and MCP from the main checkout, both healthy.
from_main() {
  (cd "$SB/main/cuevote-mcp" && npm run build) > /dev/null
  (cd "$SB/main/cuevote-server" && pm2 start index.js --name cuevote-server) > /dev/null
  (cd "$SB/main/cuevote-mcp" && pm2 start dist/http.js --name cuevote-mcp-dj) > /dev/null
  : > "$CALLS"
}
exec_of() { cat "$PM2_STATE/$1/exec" 2> /dev/null; }

case_ "worktree deploy while pm2 runs server and MCP from the main checkout"
with_worktree
from_main
run "$SB/wt" bash "$SB/wt/update_server.sh"
check "exit 0" is "$RC" 0
check "says where the server ran from" says "pm2 ran cuevote-server from $SB/main/cuevote-server/index.js"
check "server now runs from the worktree" is "$(exec_of cuevote-server)" "$SB/wt/cuevote-server/index.js"
check "MCP now runs from the worktree" is "$(exec_of cuevote-mcp-dj)" "$SB/wt/cuevote-mcp/dist/http.js"
check "both healthy" is "$(health_of cuevote-server) $(health_of cuevote-mcp-dj)" "up up"

case_ "worktree deploy whose MCP fails while the main checkout's MCP was serving"
with_worktree
from_main
touch "$SB/wt/MCP_UNHEALTHY"
run "$SB/wt" bash "$SB/wt/update_server.sh"
check "exit 4 (partial, nothing to roll back to)" is "$RC" 4
check "says why" says "no rollback target"
check "server runs from the worktree, healthy" is "$(exec_of cuevote-server) $(health_of cuevote-server)" "$SB/wt/cuevote-server/index.js up"

case_ "pm2 runs the server from a checkout that is gone"
deployed prod
pm2 delete cuevote-server > /dev/null
mkdir -p "$SB/gone/cuevote-server" && echo "// server" > "$SB/gone/cuevote-server/index.js"
(cd "$SB/gone/cuevote-server" && pm2 start index.js --name cuevote-server) > /dev/null
rm -rf "$SB/gone"
new_commit "$C1" C2 cuevote-client/app.txt=v2 > /dev/null
: > "$CALLS"
run "$SB/prod" bash "$SB/prod/update_server.sh"
check "exit 0" is "$RC" 0
check "server runs from the deployed checkout" is "$(exec_of cuevote-server)" "$SB/prod/cuevote-server/index.js"

case_ "server checkout that pm2 already runs from"
deployed prod
new_commit "$C1" C2 cuevote-client/app.txt=v2 > /dev/null
run "$SB/prod" bash "$SB/prod/update_server.sh"
check "exit 0" is "$RC" 0
check "server reloaded in place" is "$(calls '^pm2 reload cuevote-server')" 1
check "MCP restarted in place" is "$(calls '^pm2 restart cuevote-mcp-dj')" 1
check "nothing deleted" is "$(calls '^pm2 delete')" 0

case_ "pm2 jlist cannot be read"
deployed prod
new_commit "$C1" C2 cuevote-client/app.txt=v2 > /dev/null
touch "$SB/PM2_JLIST_GARBAGE"
run "$SB/prod" bash "$SB/prod/update_server.sh"
rm -f "$SB/PM2_JLIST_GARBAGE"
check "exit 0" is "$RC" 0
check "says so" says "did not say where"
check "reloaded as before, nothing deleted" is "$(calls '^pm2 reload cuevote-server') $(calls '^pm2 delete')" "1 0"

# ---- INFRA-03: setup-mcp.sh sets its own keys and keeps the rest ---------------

# A directory laid out like the repo, with an & in its path: values have to
# reach the files literally.
SETUP="$SB/setup&co"
OWN_KEYS='^(CUEVOTE_DB_PATH|CUEVOTE_ADMIN_URL|CUEVOTE_ADMIN_TOKEN)='

# with_setup: setup-mcp.sh next to a server .env and an MCP .env as an earlier
# run plus DEPLOYMENT.md, section 9, leave them (placeholder values only).
with_setup() {
  rm -rf "$SETUP" && mkdir -p "$SETUP/cuevote-server" "$SETUP/cuevote-mcp"
  cp "$SETUP_MCP_SH" "$SETUP/setup-mcp.sh"
  echo '{"name":"cuevote-mcp"}' > "$SETUP/cuevote-mcp/package.json"
  cat > "$SETUP/cuevote-server/.env" <<'EOF'
PORT=8080
NODE_ENV=production
ADMIN_TOKEN=PLACEHOLDER_ADMIN_TOKEN
MCP_SESSION_SECRET=PLACEHOLDER_MINT
CUEVOTE_OAUTH_FINALIZE_SECRET=PLACEHOLDER_FINALIZE
MCP_INTERNAL_URL=http://127.0.0.1:8082
EOF
  cat > "$SETUP/cuevote-mcp/.env" <<EOF
# Generated by setup-mcp.sh — do not commit.
CUEVOTE_DB_PATH=$SETUP/cuevote-server/cuevote.db
CUEVOTE_ADMIN_URL=http://127.0.0.1:8081
CUEVOTE_ADMIN_TOKEN=PLACEHOLDER_ADMIN_TOKEN

# Remote DJ (DEPLOYMENT.md, section 9)
NODE_ENV=production
CUEVOTE_HTTP_HOST=127.0.0.1
CUEVOTE_HTTP_PORT=8082
CUEVOTE_PUBLIC_URL=https://mcp.example.invalid
CUEVOTE_HTTP_ALLOWED_HOSTS=mcp.example.invalid
CUEVOTE_OAUTH_CONSENT_URL=https://example.invalid/connect-ai
CUEVOTE_OAUTH_FINALIZE_SECRET=PLACEHOLDER_FINALIZE
CUEVOTE_MINT_SECRET=PLACEHOLDER_MINT
CUEVOTE_WS_URL=ws://127.0.0.1:8080
CUEVOTE_WS_ORIGIN=https://example.invalid
EOF
  chmod 600 "$SETUP/cuevote-mcp/.env"
  cp "$SETUP/cuevote-server/.env" "$SB/server.env.before"
  cp "$SETUP/cuevote-mcp/.env" "$SB/mcp.env.before"
  : > "$CALLS"
}
MCP_ENV_FILE="$SETUP/cuevote-mcp/.env"
keys_of() { grep -oE '^[A-Z_]+=' "$1" | tr -d '=' | sort | tr '\n' ' '; }
mode_of() { ls -l "$1" | cut -c1-10; }
others_of() { grep -vE "$OWN_KEYS" "$1"; }

case_ "setup-mcp.sh re-run where the public DJ is configured"
with_setup
run "$SETUP" bash "$SETUP/setup-mcp.sh"
check "exit 0" is "$RC" 0
check "all 13 keys still there" is "$(keys_of "$MCP_ENV_FILE" | wc -w | tr -d ' ')" 13
check "every other line unchanged" is "$(others_of "$MCP_ENV_FILE")" "$(others_of "$SB/mcp.env.before")"
check "the file is the same byte for byte" cmp -s "$MCP_ENV_FILE" "$SB/mcp.env.before"
check "readable by its owner only" is "$(mode_of "$MCP_ENV_FILE")" "-rw-------"
check "server .env untouched" cmp -s "$SETUP/cuevote-server/.env" "$SB/server.env.before"
check "no server restart" is "$(calls '^pm2 restart')" 0

case_ "setup-mcp.sh first run, no MCP .env yet"
with_setup
rm "$MCP_ENV_FILE"
run "$SETUP" bash "$SETUP/setup-mcp.sh"
check "exit 0" is "$RC" 0
check "its three keys" is "$(keys_of "$MCP_ENV_FILE")" "CUEVOTE_ADMIN_TOKEN CUEVOTE_ADMIN_URL CUEVOTE_DB_PATH "
check "token taken from the server" grep -qxF "CUEVOTE_ADMIN_TOKEN=PLACEHOLDER_ADMIN_TOKEN" "$MCP_ENV_FILE"
check "DB path written literally" grep -qxF "CUEVOTE_DB_PATH=$SETUP/cuevote-server/cuevote.db" "$MCP_ENV_FILE"
check "readable by its owner only" is "$(mode_of "$MCP_ENV_FILE")" "-rw-------"

case_ "setup-mcp.sh where its keys drifted"
with_setup
cat > "$MCP_ENV_FILE" <<'EOF'
CUEVOTE_PUBLIC_URL=https://mcp.example.invalid
export CUEVOTE_ADMIN_URL = http://127.0.0.1:9999
CUEVOTE_ADMIN_TOKEN=OLD_TOKEN
CUEVOTE_MINT_SECRET=PLACEHOLDER_MINT
CUEVOTE_ADMIN_TOKEN=OLDER_TOKEN
EOF
run "$SETUP" bash "$SETUP/setup-mcp.sh"
check "exit 0" is "$RC" 0
check "admin URL corrected where it stood" is "$(sed -n 2p "$MCP_ENV_FILE")" "CUEVOTE_ADMIN_URL=http://127.0.0.1:8081"
check "token corrected where it stood" is "$(sed -n 3p "$MCP_ENV_FILE")" "CUEVOTE_ADMIN_TOKEN=PLACEHOLDER_ADMIN_TOKEN"
check "stale duplicate dropped" is "$(grep -c '^CUEVOTE_ADMIN_TOKEN=' "$MCP_ENV_FILE")" 1
check "other lines kept in place" is "$(sed -n 1p "$MCP_ENV_FILE") $(sed -n 4p "$MCP_ENV_FILE")" \
  "CUEVOTE_PUBLIC_URL=https://mcp.example.invalid CUEVOTE_MINT_SECRET=PLACEHOLDER_MINT"
check "missing DB path appended" is "$(tail -n1 "$MCP_ENV_FILE")" "CUEVOTE_DB_PATH=$SETUP/cuevote-server/cuevote.db"

# ---- summary -------------------------------------------------------------------

echo
if [ -s "$SB/stray.log" ]; then
  FAILED=$((FAILED + 1)); echo "FAILED: nginx, ssh or sudo was called:"; sed 's/^/   | /' "$SB/stray.log"
fi
echo "$PASSED passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
