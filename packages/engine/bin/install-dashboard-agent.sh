set -eu

LABEL="com.purco.dashboard"
SOURCE="$(cd "$(dirname "$0")/.." && pwd)/launchd/$LABEL.plist"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

if [ "${1:-}" = "uninstall" ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$TARGET"
  echo "purco dashboard agent removed"
  exit 0
fi

plutil -lint "$SOURCE" >/dev/null
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
lsof -ti :4317 -sTCP:LISTEN | xargs kill 2>/dev/null || true
cp "$SOURCE" "$TARGET"
launchctl bootstrap "$DOMAIN" "$TARGET"
sleep 2
if lsof -ti :4317 -sTCP:LISTEN >/dev/null; then
  echo "purco dashboard agent running: http://localhost:4317"
else
  echo "the agent is loaded but port 4317 is not listening; see ~/Library/Logs/purco-dashboard.log"
  exit 1
fi
