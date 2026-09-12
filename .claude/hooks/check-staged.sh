#!/usr/bin/env bash
# The commit gate: a commit is allowed only over a tree the check has proved green.
#
# `npm run check` stamps the tree it read. A commit over any other tree is refused, so a change made
# after the check cannot ride along untested.
set -uo pipefail

input=$(cat)
case "$input" in
  *'git commit'*) ;;
  *) exit 0 ;;
esac

cd "$(dirname "$0")/../.." || exit 0
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
