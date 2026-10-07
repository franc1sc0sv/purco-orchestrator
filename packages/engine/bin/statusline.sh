#!/usr/bin/env bash
dir="$HOME/.purco-dashboard"
input="$(cat)"
line="$(printf '%s' "$input" | jq -r '
  def pct: if . == null then empty else (. | round | tostring) + "%" end;
  [ .model.display_name // empty,
    (.rate_limits.five_hour.used_percentage | pct | if . then "session " + . else empty end),
    (.rate_limits.seven_day.used_percentage | pct | if . then "week " + . else empty end)
  ] | join(" · ")' 2>/dev/null)"
if mkdir -p "$dir" 2>/dev/null; then
  tmp="$dir/limits-statusline.json.$$"
  if printf '%s' "$input" | jq -c --argjson at "$(( $(date +%s) * 1000 ))" \
    'select(.rate_limits != null) | {at: $at, model: .model.display_name, rate_limits: .rate_limits}' \
    >"$tmp" 2>/dev/null && [ -s "$tmp" ]; then
    mv "$tmp" "$dir/limits-statusline.json" 2>/dev/null
  fi
  rm -f "$tmp" 2>/dev/null
fi
printf '%s\n' "$line"
exit 0
