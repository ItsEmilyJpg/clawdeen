#!/usr/bin/env python3
"""What the commit gate reads off a command, case by case.

The gate is the one thing here nobody runs by hand, so a hole in it is silent until a commit it
should have refused has already landed. Both halves are asserted: a message the gate must read
whole, and one it must refuse to guess at.

Run it with `python3 tools/gate/message_test.py`; `npm run check` does.
"""

import shlex
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import message  # noqa: E402


def read(command: str) -> tuple[str, str | None]:
    """The message and the refusal the gate would come to for this command."""
    words = message.commit_words(shlex.split(message.marked(command)))
    return ('', None) if words is None else message.message_of(words)


CASES: list[tuple[str, str, str | None]] = [
    # (what it is, the command, the message expected — or None where it must be refused)
    (
        'a code span in single quotes is text, because the shell reads none of it',
        "git commit -m 'the heading wore `.s-hold`'",
        'the heading wore `.s-hold`',
    ),
    (
        'a dollar in single quotes is text for the same reason',
        "git commit -m 'costs $5, and $HOME is not read'",
        'costs $5, and $HOME is not read',
    ),
    (
        'a substitution in double quotes is not text, and never was',
        'git commit -m "ran as $(whoami)"',
        None,
    ),
    (
        'a backtick in double quotes is the old substitution and still one',
        'git commit -m "ran as `whoami`"',
        None,
    ),
    (
        'a variable in double quotes is worked out before git sees it',
        'git commit -m "on $BRANCH"',
        None,
    ),
    (
        'a braced variable too',
        'git commit -m "on ${BRANCH}"',
        None,
    ),
    (
        # What the shell hands git is `costs $5`. `shlex` keeps the backslash in double quotes where
        # bash drops it, so the gate reads one character the commit will not carry. It is left as it
        # is: the reading is only ever searched for trailers, and no trailer carries a backslash.
        'an escaped dollar is not an expansion, so the message is read rather than refused',
        'git commit -m "costs \\$5"',
        'costs \\$5',
    ),
    (
        'a bare dollar expands nothing, so it is text',
        'git commit -m "costs 5$"',
        'costs 5$',
    ),
    (
        'an expansion elsewhere in the command is not part of the message',
        'cd "$(pwd)" && git commit -m \'plain text\'',
        'plain text',
    ),
    (
        'two -m are one message, joined the way git joins them',
        "git commit -m 'title' -m 'body'",
        'title\n\nbody',
    ),
    (
        'a message on stdin is a message the gate never sees',
        'git commit -F -',
        None,
    ),
    (
        'a path the shell works out is a path the gate cannot follow',
        'git commit -F "$HOME/msg.txt"',
        None,
    ),
    (
        'a command that commits nothing has nothing to read',
        "git log -1 --format='%s'",
        '',
    ),
]


def cases() -> list[str]:
    """Every case that did not come out as it should, said in full."""
    wrong: list[str] = []

    for what, command, want in CASES:
        text, refused = read(command)
        got = None if refused else text
        if got != want:
            wrong.append(f'  {what}\n    {command}\n    wanted {want!r}, got {got!r} ({refused})')

    return wrong


def file_case() -> list[str]:
    """A -F file is read whole, so no character in it can break the parse. That is what it is for."""
    body = 'Say it plainly\n\nThe heading wore `.s-hold` and $HOME is not read here either.\n'
    with tempfile.TemporaryDirectory() as room:
        path = Path(room) / 'msg.txt'
        path.write_text(body, encoding='utf8')
        text, refused = read(f'git commit -F {path}')
        if refused or text != body:
            return [f'  a -F file is read whole\n    wanted the file back, got {text!r} ({refused})']
    return []


def canary() -> list[str]:
    """
    Proof the reading is doing any work at all: a fault planted in `expands` has to be caught by
    the cases above. Without it a function that answered False to everything would pass them.
    """
    kept = message.expands
    message.expands = lambda command, at: False
    try:
        if not cases():
            return ['  the cases pass with expansion detection disabled, so they prove nothing']
    finally:
        message.expands = kept
    return []


def main() -> int:
    wrong = cases() + file_case() + canary()
    if wrong:
        print('message: refused or read the wrong thing:', file=sys.stderr)
        print('\n'.join(wrong), file=sys.stderr)
        return 1

    print(f'message: clean, {len(CASES) + 1} cases and the canary that proves they bite')
    return 0


if __name__ == '__main__':
    sys.exit(main())
