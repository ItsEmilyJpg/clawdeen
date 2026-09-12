#!/usr/bin/env python3
"""
Text that names a command is not one: an issue body, a search pattern, a draft. Both gates that
read a command share this, so the two cannot come to disagree about what a command is.
"""

import json
import re
import sys

BODY = re.compile(r"""<<-?\s*['"]?(\w+)['"]?[^\n]*\n.*?\n\s*\1\b""", re.DOTALL)
QUOTED = re.compile(r"""'[^']*'|"(?:\\.|[^"\\])*\"""")

# A shell handed -c, and eval, run what is quoted after them, so that one argument stays a command.
RUNNER = re.compile(r"""(?:^|[;&|(]|\s)(?:(?:(?:ba|z|k)?sh|dash|env)\s+(?:-[^\s'"]+\s+)*-c|eval)\s+$""")


def without_bodies(command: str) -> str:
    return BODY.sub('', command)


def without_quoted_data(command: str) -> str:
    kept = []
    end = 0

    for quoted in QUOTED.finditer(command):
        stop = quoted.end() if RUNNER.search(command[:quoted.start()]) else quoted.start()
        kept.append(command[end:stop])
        end = quoted.end()

    kept.append(command[end:])

    return ''.join(kept)


def main() -> int:
    payload = json.load(sys.stdin)
    print(without_quoted_data(without_bodies((payload.get('tool_input') or {}).get('command', ''))))

    return 0


if __name__ == '__main__':
    sys.exit(main())
