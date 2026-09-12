#!/usr/bin/env python3
"""The one reading of AGENTS.md section 3: no Co-Authored-By and no other trailer.

Two gates ask it, the commit gate about a commit message and the post gate about a pull request
description or a comment, so the pattern lives once rather than drifting in two copies. The
optional word in front is what makes the harness's emoji line match as well.
"""

import re
import sys

LINE = re.compile(r'^(?:\S+\s+)?(?:[A-Za-z-]+-[Bb]y:\s|Generated with\b)')


def first_trailer(text):
    """The first trailer line in `text`, stripped, or None."""
    for line in text.splitlines():
        stripped = line.strip()
        if LINE.match(stripped):
            return stripped
    return None


if __name__ == '__main__':
    found = first_trailer(sys.stdin.read())
    if found:
        print(found)
