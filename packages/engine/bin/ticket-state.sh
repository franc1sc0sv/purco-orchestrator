#!/usr/bin/env bash
set -uo pipefail

GAF="/Users/franciscohernandez/projects/purco-projects/general-access-files"
PHASES="wt intake grill plan build test verify static review ship respond"

die() {
  echo "ticket-state: $1" >&2
  exit 1
}

command -v jq >/dev/null || die "jq is required"

root=$(git rev-parse --show-toplevel 2>/dev/null) || die "not inside a git repository"
branch=$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null)

cmd="probe"
case "${1:-}" in
  probe | json | set | init)
    cmd="$1"
    shift
    ;;
esac

ticket=""
args=()
for a in "$@"; do
  if printf '%s' "$a" | grep -qiE '^(purco-)?[0-9]{3,}$'; then
    ticket="PURCO-$(printf '%s' "$a" | grep -oE '[0-9]{3,}')"
  else
    args+=("$a")
  fi
done

if [ -z "$ticket" ]; then
  n=$(printf '%s' "$branch" | grep -oiE 'purco[-_/]?[0-9]{3,}' | grep -oE '[0-9]{3,}' | head -1)
  [ -n "$n" ] && ticket="PURCO-$n"
fi
if [ -z "$ticket" ]; then
  ticket=$(basename "$root" | grep -oE 'PURCO-[0-9]{3,}' | head -1)
fi
[ -n "$ticket" ] || die "no ticket found in branch '$branch' or dir '$(basename "$root")' — pass one explicitly"

if ! printf '%s' "$branch" | grep -qiE "purco[-_/]?${ticket#PURCO-}(\$|[^0-9])"; then
  wt=$(git -C "$root" worktree list --porcelain 2>/dev/null |
    awk '/^worktree /{w=$2} /^branch /{print w"\t"$2}' |
    grep -iE "purco[-_/]?${ticket#PURCO-}([^0-9]|\$)" | head -1 | cut -f1)
  if [ -n "$wt" ] && [ -d "$wt" ]; then
    root="$wt"
    branch=$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null)
  fi
fi

pack="$GAF/$ticket"
state="$pack/.ticket-state.json"

ensure_state() {
  mkdir -p "$pack"
  [ -f "$state" ] || printf '{"ticket":"%s","phases":{}}\n' "$ticket" >"$state"
}

if [ "$cmd" = "init" ]; then
  ensure_state
  echo "$pack"
  exit 0
fi

if [ "$cmd" = "set" ]; then
  phase="${args[0]:-}"
  status="${args[1]:-done}"
  note="${args[2]:-}"
  ctx="${args[3]:-${TICKET_CTX:-session:${CLAUDE_CODE_SESSION_ID:-unknown}}}"
  printf '%s\n' "$PHASES" | tr ' ' '\n' | grep -qx "$phase" || die "unknown phase '$phase' (one of: $PHASES)"
  ensure_state
  tmp=$(mktemp)
  jq --arg p "$phase" --arg s "$status" --arg n "$note" --arg c "$ctx" \
    --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '.phases[$p] = {status:$s, note:$n, ctx:$c, at:$t}' "$state" >"$tmp" && mv "$tmp" "$state"
  echo "$ticket $phase=$status ctx=$ctx"
  exit 0
fi

is_worktree="no"
[ "$(git -C "$root" rev-parse --git-dir)" != "$(git -C "$root" rev-parse --git-common-dir)" ] && is_worktree="yes"

pr_json=$(gh pr list --head "$branch" --state all --limit 1 \
  --json number,title,url,isDraft,state,baseRefName,reviewDecision 2>/dev/null || echo '[]')
pr_number=$(printf '%s' "$pr_json" | jq -r '.[0].number // empty')
pr_base=$(printf '%s' "$pr_json" | jq -r '.[0].baseRefName // empty')

base="${pr_base:-dev}"
git -C "$root" rev-parse --verify --quiet "origin/$base" >/dev/null 2>&1 || base="dev"

count() { git -C "$root" rev-list --count "$1" 2>/dev/null || echo 0; }
ahead=$(count "origin/$base..HEAD")
behind=$(count "HEAD..origin/$base")
dirty=$(git -C "$root" status --porcelain 2>/dev/null | grep -c . || true)
last=$(git -C "$root" log -1 --format='%h %s (%ar)' 2>/dev/null)
diff_names=$(git -C "$root" diff --name-only "origin/$base...HEAD" 2>/dev/null || true)
changed=$(printf '%s' "$diff_names" | grep -c . || true)
tests_changed=$(printf '%s' "$diff_names" | grep -cE '(\.test\.ts|(^|/)tests?/|e2e)' || true)
flags_touched=$(printf '%s' "$diff_names" | grep -c 'feature-flags' || true)

pack_files=0
[ -d "$pack" ] && pack_files=$(find "$pack" -maxdepth 1 -type f ! -name '.*' | grep -c . || true)

JUDGING_PHASES="test verify review"

isolation_report() {
  local bctx breach=0 p pctx
  if [ ! -f "$state" ]; then
    echo "  n/a      build has not run yet"
    return 0
  fi
  bctx=$(jq -r '.phases.build.ctx // ""' "$state")
  if [ -z "$bctx" ]; then
    echo "  n/a      build has not run yet"
    return 0
  fi
  for p in $JUDGING_PHASES; do
    pctx=$(jq -r --arg p "$p" '.phases[$p].ctx // ""' "$state")
    if [ -n "$bctx" ] && [ "$pctx" = "$bctx" ]; then
      printf '  BREACH   %-7s shared a context with build (%s)\n' "$p" "$bctx"
      breach=1
    fi
  done
  [ "$breach" = "0" ] && echo "  clean    no judging phase shared a context with build"
  return 0
}

isolation_breaches() {
  [ -f "$state" ] || {
    echo 0
    return
  }
  local bctx n=0 p pctx
  bctx=$(jq -r '.phases.build.ctx // ""' "$state")
  for p in $JUDGING_PHASES; do
    pctx=$(jq -r --arg p "$p" '.phases[$p].ctx // ""' "$state")
    [ -n "$bctx" ] && [ "$pctx" = "$bctx" ] && n=$((n + 1))
  done
  echo "$n"
}

current_ctx() { echo "session:${CLAUDE_CODE_SESSION_ID:-unknown}"; }

next_phase() {
  [ -f "$state" ] || {
    echo "intake"
    return
  }
  for p in $PHASES; do
    s=$(jq -r --arg p "$p" '.phases[$p].status // "-"' "$state")
    [ "$p" = "wt" ] && [ "$s" = "-" ] && [ "$is_worktree" = "yes" ] && continue
    case "$s" in
      done | skipped) continue ;;
      *)
        echo "$p"
        return
        ;;
    esac
  done
  echo "complete"
}

if [ "$cmd" = "json" ]; then
  jq -n \
    --arg ticket "$ticket" --arg branch "$branch" --arg root "$root" --arg base "$base" \
    --arg worktree "$is_worktree" --arg pack "$pack" --arg next "$(next_phase)" \
    --argjson pr "$pr_json" --arg last "$last" \
    --argjson ahead "${ahead:-0}" --argjson behind "${behind:-0}" --argjson dirty "${dirty:-0}" \
    --argjson changed "${changed:-0}" --argjson tests "${tests_changed:-0}" \
    --argjson packfiles "${pack_files:-0}" --argjson flags "${flags_touched:-0}" \
    --argjson st "$(cat "$state" 2>/dev/null || echo '{}')" \
    --arg ctx "$(current_ctx)" --argjson breaches "$(isolation_breaches)" \
    '{ticket:$ticket, branch:$branch, root:$root, base:$base, isWorktree:$worktree,
      contextPack:$pack, contextPackFiles:$packfiles, nextPhase:$next,
      pr:($pr[0] // null), lastCommit:$last,
      git:{ahead:$ahead, behind:$behind, dirty:$dirty, changedFiles:$changed,
           testFilesTouched:$tests, featureFlagsTouched:$flags},
      isolation:{currentCtx:$ctx, breaches:$breaches},
      state:$st}'
  exit 0
fi

echo "TICKET      $ticket"
echo "branch      $branch"
echo "root        $root  (worktree: $is_worktree)"
echo "base        origin/$base — ahead $ahead, behind $behind"
echo "tree        $dirty uncommitted · $changed changed vs base · $tests_changed test files touched"
[ "${flags_touched:-0}" -gt 0 ] && echo "flags       feature-flags touched in this branch — test flag ON and OFF"
echo "last commit $last"
if [ -n "$pr_number" ]; then
  printf 'PR          #%s [%s%s] base=%s review=%s\n            %s\n' \
    "$pr_number" \
    "$(printf '%s' "$pr_json" | jq -r '.[0].state')" \
    "$(printf '%s' "$pr_json" | jq -r 'if .[0].isDraft then " draft" else "" end')" \
    "$pr_base" \
    "$(printf '%s' "$pr_json" | jq -r '.[0].reviewDecision // "none"')" \
    "$(printf '%s' "$pr_json" | jq -r '.[0].url')"
else
  echo "PR          none for this branch"
fi
echo "pack        $pack ($pack_files files)"
echo "phases"
if [ -f "$state" ]; then
  for p in $PHASES; do
    s=$(jq -r --arg p "$p" '.phases[$p].status // "-"' "$state")
    [ "$s" = "-" ] && continue
    n=$(jq -r --arg p "$p" '.phases[$p].note // ""' "$state")
    c=$(jq -r --arg p "$p" '.phases[$p].ctx // "-"' "$state")
    printf '  %-8s %-10s %-34s %s\n' "$p" "$s" "${c:0:34}" "$n"
  done
else
  echo "  (nothing recorded yet)"
fi
echo "isolation"
isolation_report
echo "this ctx    $(current_ctx)"
echo "NEXT        $(next_phase)"
