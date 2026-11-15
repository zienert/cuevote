#!/usr/bin/env bash
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
# Copyright (c) 2026 Julian Zienert
#
# Sandbox tests for update_server.sh.
#
# Everything happens in a throw-away directory. A local bare repository plays
# origin; the script under test is committed into it from this checkout, and
# every case deploys from a fresh clone or worktree of it. npm, pm2, curl and
# sleep are stubs first in PATH that record their calls and fake the outcome;
# nginx, ssh and sudo are stubs that fail, so a stray call shows up. git is
# real but stays inside the sandbox. No real .env, process, server or network
# is touched.
#
#   bash scripts/test-deploy-scripts.sh
#   KEEP_SANDBOX=1 bash scripts/test-deploy-scripts.sh       # keep it for a look
#   UPDATE_SERVER_SH=/path/to/update_server.sh bash scripts/test-deploy-scripts.sh
set -uo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR PORT CUEVOTE_HTTP_PORT

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
UPDATE_SERVER_SH="${UPDATE_SERVER_SH:-$REPO/update_server.sh}"

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
# of the sandbox makes reload and restart fail.
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

# ---- summary -------------------------------------------------------------------

echo
if [ -s "$SB/stray.log" ]; then
  FAILED=$((FAILED + 1)); echo "FAILED: nginx, ssh or sudo was called:"; sed 's/^/   | /' "$SB/stray.log"
fi
echo "$PASSED passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
