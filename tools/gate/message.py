#!/usr/bin/env python3
"""The message a `git commit` carries, as far as the gate can read it off the command.

The commit gate asks `trailers.py` about this text the same way the post gate asks it about a pull
request body, so the one rule keeps one reading. A message the gate cannot read is not a message it
has approved: it says which part is out of reach and the commit waits until the text is in the
command. That is the hole the rule sat in before, where `-F -` with a heredoc put a trailer into two
commits nobody had refused.

Prints the message on stdout and exits 0, says what is out of reach on stderr and exits 3, and
prints nothing at all where the command commits nothing.
"""

import json
import shlex
import sys

# Where a command ends and the next one begins, as `shlex` hands the tokens over.
BREAK = (';', '&&', '||', '|', '&')
# `git` itself takes these before the subcommand, and some of them take a value of their own.
GIT_VALUE = ('-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path')
MESSAGE_FLAGS = ('--message',)
FILE_FLAGS = ('--file',)
# What the shell would work out for itself, and the gate reads the command rather than running it.
BLIND = ('$(', '${', '`')


def commit_words(tokens: list[str]) -> list[str] | None:
    """The arguments of the first `git commit` in the command, or None where it commits nothing."""
    for at, token in enumerate(tokens):
        if token != 'git':
            continue
        rest = tokens[at + 1 :]
        while rest and rest[0].startswith('-'):
            rest = rest[2:] if rest[0] in GIT_VALUE else rest[1:]
        if not rest or rest[0] != 'commit':
            continue
        words: list[str] = []
        for word in rest[1:]:
            if word in BREAK:
                break
            words.append(word)
        return words
    return None


def carried(word: str, letter: str, long_flags: tuple[str, ...]) -> str | None:
    """
    What this argument gives that flag: its value, or an empty string where the value is the next
    argument, or None where the argument is not that flag at all. One reading covers `--message=x`,
    `-m x`, `-mx` and the cluster `-am x`, which are the same flag written four ways.
    """
    flag, sep, value = word.partition('=')
    if flag in long_flags:
        return value if sep else ''
    if word.startswith('--') or not word.startswith('-'):
        return None
    _, sep, tail = word[1:].partition(letter)
    return tail if sep else None


def file_text(path: str) -> tuple[str | None, str | None]:
    """What a `--file` names, or why it cannot be had."""
    if path == '-':
        return None, 'the message arrives on stdin, where the gate never sees it'
    if any(mark in path for mark in BLIND):
        return None, f'the shell works out the path {path}, so the gate cannot follow it'
    try:
        with open(path, encoding='utf8') as handle:
            return handle.read(), None
    except OSError as error:
        return None, f'{path}: {error.strerror}'


def message_of(words: list[str]) -> tuple[str, str | None]:
    """Every piece of message those arguments carry, or the first piece that is out of reach."""
    texts: list[str] = []
    expect: str | None = None

    for word in words:
        if expect == 'text':
            texts.append(word)
            expect = None
            continue
        if expect == 'file':
            text, blind = file_text(word)
            if blind:
                return '', blind
            texts.append(text or '')
            expect = None
            continue

        written = carried(word, 'm', MESSAGE_FLAGS)
        if written is not None:
            if written:
                texts.append(written)
            else:
                expect = 'text'
            continue

        named = carried(word, 'F', FILE_FLAGS)
        if named is not None:
            if not named:
                expect = 'file'
                continue
            text, blind = file_text(named)
            if blind:
                return '', blind
            texts.append(text or '')

    joined = '\n\n'.join(texts)
    if any(mark in joined for mark in BLIND):
        return '', 'the shell works out part of the message, so the gate cannot read it'
    return joined, None


def main() -> int:
    payload = json.load(sys.stdin)
    command = (payload.get('tool_input') or {}).get('command', '')
    try:
        tokens = shlex.split(command)
    except ValueError:
        tokens = command.split()

    words = commit_words(tokens)
    if words is None:
        return 0

    text, blind = message_of(words)
    if blind:
        print(blind, file=sys.stderr)
        return 3

    print(text)
    return 0


if __name__ == '__main__':
    sys.exit(main())
