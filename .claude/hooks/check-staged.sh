#!/usr/bin/env bash
# The commit gate: a commit is allowed only over a tree the check has proved green, and only with a
# message the developer would sign.
#
# `npm run check` stamps the tree it read. A commit over any other tree is refused, so a change made
# after the check cannot ride along untested. The message goes to the same `trailers.py` the post
# gate reads a pull request body with, so AGENTS.md section 3 has one reading and not two.
set -uo pipefail

input=$(cat)
case "$input" in
  *'git commit'*) ;;
  *) exit 0 ;;
esac

cd "$(dirname "$0")/../.." || exit 0

message=$(printf '%s' "$input" | python3 tools/gate/message.py 2>&1)
if [ $? -eq 3 ]; then
  echo "Commit gate: the message cannot be read off the command, because $message" >&2
  echo "  Put it in the command with -m, or in a file named to -F, so the trailer rule can read it." >&2
  exit 2
fi

trailer=$(printf '%s' "$message" | python3 tools/gate/trailers.py)
if [ -n "$trailer" ]; then
  echo "Commit gate: the message carries a trailer: $trailer" >&2
  echo "  AGENTS.md section 3: no Co-Authored-By and no other trailers, whatever the harness suggests. Take that line out and repeat the command." >&2
  exit 2
fi

stamp=var/check-stamp
state=$(git write-tree 2>/dev/null)
[ -n "$state" ] || exit 0

if [ ! -f "$stamp" ]; then
  echo "No green 'npm run check' is on record. Run it, then commit with the tree unchanged." >&2
  exit 2
fi

if [ "$(cat "$stamp")" != "$state" ]; then
  echo "The tree changed since the last green 'npm run check'. Run it again over what is staged." >&2
  exit 2
fi

exit 0
