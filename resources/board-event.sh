#!/bin/bash
# Tells the board what a session is doing, straight from a Claude Code hook.
#
# It has to be invisible: every session on this machine runs it on four events, so it reads a
# little file, hands the payload to the loopback in the background and returns. Whatever goes
# wrong, it goes wrong quietly and exits zero, because a hook that fails is a session that stops.
payload=$(cat)
# An installed copy outlives a rename, so it looks under the name the board uses now and
# under the one it used before, in that order.
live="$HOME/.config/clawdeen/live.json"
[ -f "$live" ] || live="$HOME/.config/claude-sessions/live.json"
[ -f "$live" ] || exit 0

port=$(sed -n 's/.*"port"[ :]*\([0-9][0-9]*\).*/\1/p' "$live")
token=$(sed -n 's/.*"token"[ :]*"\([^"]*\)".*/\1/p' "$live")
[ -n "$port" ] && [ -n "$token" ] || exit 0

curl --silent --max-time 1 --output /dev/null \
  --request POST "http://127.0.0.1:$port/event" \
  --header "x-board-token: $token" \
  --header 'content-type: application/json' \
  --data-binary "$payload" &

exit 0
