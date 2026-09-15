#!/usr/bin/env python3
"""What the post gate makes of a gh command, case by case.

Two readings are held here, each with a canary that plants the fault it guards against: which
DELETE is metadata and which is the developer's own click (#60), and whether the text of a `gh api`
call is found when something stands in front of `gh` (#61). The first half is also run through the
hook itself, because "warns once, passes on the repeat" is a property of the process, not of one
function.

Run it with `python3 tools/gate/post_test.py`; `npm run check` does.
"""

import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from types import ModuleType

HOOK = Path(__file__).resolve().parent.parent.parent / '.claude' / 'hooks' / 'check-post.py'


def load() -> ModuleType:
    spec = importlib.util.spec_from_file_location('check_post', HOOK)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


gate = load()

VERDICTS: list[tuple[str, str, str]] = [
    # (what it is, the command, the verdict expected)
    (
        'a label off one issue is metadata',
        'gh api -X DELETE repos/o/r/issues/917/labels/x',
        'metadata',
    ),
    (
        'the label name arrives quoted and encoded, as a name with a space has to',
        'gh api -X DELETE "repos/o/r/issues/917/labels/status%3A%20todo"',
        'metadata',
    ),
    (
        'a requested reviewer off a pull request is metadata',
        'gh api --method DELETE repos/o/r/pulls/5/requested_reviewers -f "reviewers[]=someone"',
        'metadata',
    ),
    (
        'putting a label on stays what it was',
        'gh api -X POST repos/o/r/issues/917/labels -f "labels[]=x"',
        'body',
    ),
    (
        'a label deleted from the repository is not a label taken off an issue',
        'gh api -X DELETE repos/o/r/labels/bug',
        'refuse',
    ),
    (
        'a branch is refused',
        'gh api -X DELETE repos/o/r/git/refs/heads/main',
        'refuse',
    ),
    (
        'a comment is refused',
        'gh api -X DELETE repos/o/r/issues/comments/9',
        'refuse',
    ),
    (
        'a release is refused',
        'gh api -X DELETE repos/o/r/releases/3',
        'refuse',
    ),
    (
        'a path that only starts like a label is refused',
        'gh api -X DELETE repos/o/r/issues/917/labels/x/y',
        'refuse',
    ),
]


def verdict_of(command: str) -> str:
    """The verdict the gate reaches for the first gh call in the command, the way `main` finds it."""
    match = gate.GH_SEGMENT.search(command)
    return 'none' if match is None else gate.classify(match.group(1))[0]


def verdicts() -> list[str]:
    wrong = []
    for what, command, want in VERDICTS:
        got = verdict_of(command)
        if got != want:
            wrong.append(f'  {what}\n    {command}\n    wanted {want}, got {got}')
    return wrong


def body_cases(room: Path) -> list[tuple[str, str, int]]:
    """(what it is, the command, how many texts the gate must find); 0 means it must call them hidden."""
    body = room / 'body.md'
    body.write_text('A body the gate has to find, whatever stands in front of gh.\n', encoding='utf8')
    return [
        ('a gh api call that opens the command', f'gh api -X PATCH repos/o/r/issues/1 -F body=@{body}', 1),
        ('after a cd', f'cd /x && gh api -X PATCH repos/o/r/issues/1 -F body=@{body}', 1),
        ('after a semicolon', f'true; gh api -X PATCH repos/o/r/issues/1 -F body=@{body}', 1),
        ('an inline field after a cd', 'cd /x && gh api -X PATCH repos/o/r/issues/1 -f body=inline-text', 1),
        ('gh issue edit after a cd, which was always read', f'cd /x && gh issue edit 1 --body-file {body}', 1),
        ('a file that is not there is still hidden', f'cd /x && gh api -X PATCH repos/o/r/issues/1 -F body=@{room}/gone.md', 0),
        ('a variable is still hidden', 'cd /x && gh api -X PATCH repos/o/r/issues/1 -f body=$BODY', 0),
    ]


def bodies() -> list[str]:
    wrong = []
    with tempfile.TemporaryDirectory() as room:
        for what, command, want in body_cases(Path(room)):
            segment = gate.GH_SEGMENT.search(command)
            found = None if segment is None else gate.resolve_bodies(segment.group(0), room)
            got = 0 if found is None else len(found)
            if got != want:
                wrong.append(f'  {what}\n    {command}\n    wanted {want} text(s), got {got}')
    return wrong


def run_hook(command: str, session: str, room: str) -> subprocess.CompletedProcess[str]:
    payload = {'tool_name': 'Bash', 'tool_input': {'command': command}, 'session_id': session, 'cwd': room}
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env={**os.environ, 'TMPDIR': room},
        check=False,
    )


def through_the_hook() -> list[str]:
    """The acceptance of #60 as the developer meets it: one warning, then the identical call passes."""
    wrong = []
    with tempfile.TemporaryDirectory() as room:
        session = str(uuid.uuid4())
        command = 'gh api -X DELETE "repos/o/r/issues/917/labels/status%3A%20todo"'
        first = run_hook(command, session, room)
        second = run_hook(command, session, room)
        if first.returncode != 2 or 'carries no text' not in first.stderr:
            wrong.append(f'  a label off warns first\n    got {first.returncode}: {first.stderr.strip()}')
        if second.returncode != 0:
            wrong.append(f'  a label off passes on the repeat\n    got {second.returncode}: {second.stderr.strip()}')

        refused = run_hook('gh api -X DELETE repos/o/r/labels/bug', session, room)
        again = run_hook('gh api -X DELETE repos/o/r/labels/bug', session, room)
        if refused.returncode != 2 or again.returncode != 2 or 'takes themselves' not in again.stderr:
            wrong.append(f'  a repository label is refused every time\n    got {refused.returncode}, then {again.returncode}')
    return wrong


def canaries() -> list[str]:
    """
    Proof the cases bite: each fix is taken back out and its cases have to fail. Without this a
    gate that called every DELETE metadata, or found a body in everything, would pass them.
    """
    wrong = []
    kept_paths = gate.METADATA_DELETE_PATHS
    gate.METADATA_DELETE_PATHS = re.compile(r'(?!)')
    try:
        if not verdicts():
            wrong.append('  the verdicts pass with no DELETE taken for metadata, so they prove nothing')
    finally:
        gate.METADATA_DELETE_PATHS = kept_paths

    kept_words = gate.gh_words
    gate.gh_words = lambda toks: toks
    try:
        if not bodies():
            wrong.append('  the bodies are found with the separator read as the first word, so they prove nothing')
    finally:
        gate.gh_words = kept_words
    return wrong


def main() -> int:
    wrong = verdicts() + bodies() + through_the_hook() + canaries()
    if wrong:
        print('post: refused or read the wrong thing:', file=sys.stderr)
        print('\n'.join(wrong), file=sys.stderr)
        return 1

    with tempfile.TemporaryDirectory() as room:
        count = len(VERDICTS) + len(body_cases(Path(room)))
    print(f'post: clean, {count} cases, the hook run twice and the canaries that prove they bite')
    return 0


if __name__ == '__main__':
    sys.exit(main())
