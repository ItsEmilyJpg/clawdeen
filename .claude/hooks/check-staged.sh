#!/usr/bin/env bash
# The commit gate: a commit is allowed only over a tree the check has proved green, and only with a
# message the developer would sign.
#
# `npm run check` stamps the tree it read. A commit over any other tree is refused, so a change made
# after the check cannot ride along untested. The message goes to the same `trailers.py` the post
# gate reads a pull request body with, so AGENTS.md section 3 has one reading and not two.
set -uo pipefail

input=$(cat)
gates="$(dirname "$0")/../../tools/gate"

# What the shell would actually run, rather than every word in the call. A commit message that talks
# about staging is text, not a command, and reading the payload raw refused commits for describing
# what they did. `command.py` is what both gates already use to tell the two apart; where it cannot
# answer, the whole payload stands in, because a gate that reads nothing must not wave things past.
command=$(printf '%s' "$input" | python3 "$gates/command.py" 2>/dev/null)
[ -n "$command" ] || command=$input

case "$command" in
  *'git commit'*) ;;
  *) exit 0 ;;
esac

# Staging and committing in one call defeats the stamp entirely. This hook runs before the command,
# so it reads the tree as it stood before any staging in that same call had happened, and the check
# then proves a tree nobody is committing. Found by planting a change and watching it land.
case "$command" in
  *'git add'*|*'commit -a'*|*'commit --all'*|*'commit -am'*)
    echo "Commit gate: this call stages and commits at once, and the gate runs before it." >&2
    echo "  It would read the tree as it stood before the staging, and prove the wrong one." >&2
    echo "  Stage, run 'npm run check', then commit, as three separate calls." >&2
    exit 2
    ;;
esac

# Where the command actually goes, which is not where the hook is standing. A session working in a
# worktree is handed the main checkout as its directory, so without this the gate compared the stamp
# of one tree against the index of another and refused a commit that was green.
here=$(printf '%s' "$input" | python3 "$gates/where.py" 2>/dev/null)
root=$(git -C "${here:-.}" rev-parse --show-toplevel 2>/dev/null) || root="$(dirname "$0")/../.."
cd "$root" || exit 0

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
