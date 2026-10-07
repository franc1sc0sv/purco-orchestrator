set -euo pipefail

ROOT="/Users/franciscohernandez/projects/purco-projects/purco-orchestrator"
TEST_NAME='(^|[./-])(test|spec)\.[cm]?[jt]sx?$|-test\.[cm]?[jt]sx?$|(^|/)(tests?|__tests__|e2e)/'

payload="$(cat)"
tool="$(printf '%s' "$payload" | jq -r '.tool_name // empty')"
cwd="$(printf '%s' "$payload" | jq -r '.cwd // empty')"

refuse() {
  jq -n --arg reason "$1" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $reason}}'
  exit 0
}

REASON="purco-orchestrator has a no-tests rule: never write, add, extend or edit test files in this repository. Verify with npm run check and npm run build -w purco-dashboard. If a change breaks an existing test file, stop and ask the user."

case "$tool" in
  Write|Edit|MultiEdit|NotebookEdit)
    target="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')"
    [ -z "$target" ] && exit 0
    case "$target" in
      /*) full="$target" ;;
      *) full="${cwd%/}/$target" ;;
    esac
    case "$full" in
      "$ROOT"/*) ;;
      *) exit 0 ;;
    esac
    relative="${full#"$ROOT"/}"
    case "$relative" in
      node_modules/*|*/node_modules/*) exit 0 ;;
    esac
    if printf '%s' "$relative" | grep -Eq "$TEST_NAME"; then
      refuse "$REASON ($relative)"
    fi
    ;;
  Bash)
    command="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty')"
    case "$cwd/$command" in
      *purco-orchestrator*) ;;
      *) exit 0 ;;
    esac
    path='["'"'"']?[A-Za-z0-9_./~-]*(([.-](test|spec))\.[cm]?[jt]sx?|/(tests?|__tests__|e2e)/[A-Za-z0-9_./-]+)'
    writes=(
      "(^|[^0-9&])>>?[[:space:]]*$path"
      "tee([[:space:]]+-a)?[[:space:]]+$path"
      "(sed[[:space:]]+-i|perl[[:space:]]+-p?i)[^|;&]*$path"
      "(^|[[:space:];&|])(cp|mv|touch)[[:space:]][^|;&]*$path[[:space:]]*($|[;&|)])"
      "(writeFileSync|appendFileSync|createWriteStream)\\([^)]*$path"
    )
    for pattern in "${writes[@]}"; do
      if printf '%s' "$command" | grep -Eq "$pattern"; then
        refuse "$REASON"
      fi
    done
    ;;
esac
exit 0
