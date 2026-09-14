#!/usr/bin/env python3
"""Which directory a Bash tool call will actually run in.

The hook is told the session's working directory, which is not where the command goes: a call shaped
`cd <worktree> && git commit` runs in the worktree while the hook stands in the main checkout. The
commit gate resolved its repository from the second and so compared the stamp of one tree against
the index of another, refusing a commit that was green and saying the tree had changed.

So the command is read for where it takes itself. The last `cd` before anything else wins, because
`cd a && cd b && git commit` ends in b; a `cd` with no argument or with `-` is left alone, since
neither names a place this can resolve.
"""

import json
import os
import shlex
import sys


def where(payload):
    """The directory the command runs in: what it changes into, or the session's own."""
    cwd = payload.get('cwd') or os.getcwd()
    command = (payload.get('tool_input') or {}).get('command')
    if not isinstance(command, str):
        return cwd
    try:
        tokens = shlex.split(command, comments=False)
    except ValueError:
        # An unbalanced quote is not this gate's business to fix; the session directory still stands.
        return cwd
    found = None
    for at, token in enumerate(tokens):
        if token != 'cd' or at + 1 >= len(tokens):
            continue
        target = tokens[at + 1]
        if target in ('-', '&&', ';', '||'):
            continue
        found = target if os.path.isabs(target) else os.path.join(cwd, target)
    return found or cwd


if __name__ == '__main__':
    try:
        print(where(json.load(sys.stdin)))
    except Exception:
        # A gate that cannot read its input says nothing and lets the caller fall back.
        sys.exit(1)
