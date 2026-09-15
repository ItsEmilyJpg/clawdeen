#!/usr/bin/env python3
"""PreToolUse gate on outward-facing gh commands: nothing is posted the developer has not seen.

Runs on every Bash call and stays silent unless the command writes to GitHub through gh: a
comment, a review, a pull request or issue, a description or title change (`gh api` with POST,
PUT or PATCH; `gh pr create|edit|comment|review`; `gh issue create|edit|comment`). Reads stay
untouched.

The check is mechanical evidence that a person approved the text: the body being posted has to
appear in an assistant message written BEFORE the developer's last input (a typed message, an
AskUserQuestion answer, or a button in the app they pressed themselves). Draft shown, developer
replied, then post; anything else is blocked. The body is read from `--body-file <file>`,
`--input <file>`, `-F body=@<file>`, `$(cat <file>)` or an inline literal; when it cannot be
resolved, the command is blocked with the recipe to make it checkable.

Actions a person takes themselves are refused outright, no override: merge, close, reopen,
approve, dispatching a workflow (production deploys that way), any DELETE, and anything under
`gh release`, `gh repo`, `gh secret`, `gh variable` or `gh ruleset` that writes. A metadata-only
change with no text (labels, reviewers, draft state) blocks once and goes through on the identical
repeat, the same channel the commit gate uses for warnings.

Exit 2 blocks the command and the reason on stderr reaches the agent.
"""

import hashlib
import json
import os
import re
import shlex
import sys
import tempfile

# The stripper lives with the rest of the gate's machinery, and a hook is not on its path.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'tools', 'gate'))

import command as shared  # noqa: E402
from trailers import first_trailer  # noqa: E402

ASK_TOOL = 'AskUserQuestion'
# command position includes the inside of a function body, a subshell, a loop or a branch, so a
# wrapper like `post(){ gh ...; }` cannot hide the call from the gate
GH_SEGMENT = re.compile(r'(?:^|&&|\|\||;|\||[{(]|\bthen\b|\bdo\b|\belse\b|\$\()\s*gh\s+([^&|;}]*)')
# only the heredoc half of the shared stripper: a quoted argument here is the text being posted
REFUSED_API_PATHS = re.compile(r'/(merge|dispatches|approvals?)\b')
REFUSED_PR_ACTIONS = ('merge', 'close', 'reopen', 'lock', 'unlock', 'delete')
REFUSED_ISSUE_ACTIONS = ('close', 'reopen', 'delete', 'transfer', 'lock', 'unlock', 'pin', 'unpin')
BODY_PR_ACTIONS = ('create', 'edit', 'comment', 'review')
BODY_ISSUE_ACTIONS = ('create', 'edit', 'comment')
# these always carry text, so a body the gate cannot read is a block, never a metadata warning
ALWAYS_TEXT = ('pr create', 'pr comment', 'pr review', 'issue create', 'issue comment')
METADATA_ACTIONS = ('ready',)
REFUSED_COMMANDS = ('release', 'repo', 'secret', 'variable', 'ruleset', 'ssh-key', 'gpg-key', 'workflow')
READ_ACTIONS = ('list', 'view', 'get', 'status', 'download', 'clone')
BODY_KEYS = ('body', 'description', 'title', 'note', 'message', 'name')
INLINE_FLAGS = ('--body', '-b', '--title', '-t')
FILE_FLAGS = ('--body-file',)
FIELD_FLAGS = ('-f', '--raw-field', '-F', '--field')
CAT_FILE = re.compile(r'\$\(\s*(?:cat|<)\s+([^)\s]+)\s*\)')
INPUT_FILE = re.compile(r'--input[=\s]+([^\s]+)')
BODY_FILE = re.compile(r'--body-file[=\s]+([^\s]+)')
AT_FILE = re.compile(r'=@([^\s\'"]+)')
# backticks are how the chat marks an exact text, and a title is short enough that it never gets a
# line of its own: without this, `**Title:** `Call it 1.0.2`` read as prose and the title never counted
CODE_SPAN = re.compile(r'`([^`\n]+)`')
# a harness row arrives as a user turn nobody typed: a task notification, a session reminder.
# Matching the shape rather than a list also catches the next one.
HARNESS_ROW = re.compile(r'^<([a-z][a-z0-9-]*)>')
# a button in the app writes that same shape and pressing it is the developer's own input. Named
# one by one, so a tag nobody has seen yet goes on blocking rather than starting to approve.
DEVELOPER_ROW = ('create-pr-command',)
MIN_EVIDENCE = 20


def tokens_of(text):
    try:
        return shlex.split(text)
    except ValueError:
        return text.split()


def refused_field(key, value):
    """A field that approves, closes or reopens is the developer's click whatever carries it."""
    return (key == 'event' and str(value).upper() == 'APPROVE') or (key == 'state' and str(value).lower() in ('closed', 'open'))


def classify_api(toks, segment):
    method = None
    path = ''
    has_fields = False
    refused = False
    i = 1
    while i < len(toks):
        t = toks[i]
        if t in ('--method', '-X') and i + 1 < len(toks):
            method = toks[i + 1].upper()
            i += 2
            continue
        if t.startswith('--method=') or t.startswith('-X'):
            method = t.split('=', 1)[1].upper() if '=' in t else t[2:].upper()
        elif t in FIELD_FLAGS or t == '--input' or t.startswith(('--input=', '--field=', '--raw-field=')):
            has_fields = True
            if t in FIELD_FLAGS and i + 1 < len(toks) and '=' in toks[i + 1]:
                key, value = toks[i + 1].split('=', 1)
                refused = refused or refused_field(key, value)
        elif not t.startswith('-') and not path:
            path = t
        i += 1
    # a GraphQL mutation can merge, approve, resolve or post without a path the gate could read,
    # so every mutation is refused and writes go through REST
    if path == 'graphql':
        return ('refuse', 'gh api graphql mutation') if re.search(r'\bmutation\b', segment) else ('ignore', '')
    # gh api switches to POST by itself when a field or an input file is given
    if method is None:
        method = 'POST' if has_fields else 'GET'
    if method in ('GET', 'HEAD'):
        return 'ignore', ''
    if method == 'DELETE' or REFUSED_API_PATHS.search(path) or refused:
        return 'refuse', 'gh api %s %s' % (method, path)
    if method in ('POST', 'PUT', 'PATCH'):
        return 'body', 'gh api %s %s' % (method, path)
    return 'ignore', ''


def classify(segment):
    """Returns ('ignore' | 'refuse' | 'body' | 'metadata', description)."""
    toks = tokens_of(segment)
    if not toks:
        return 'ignore', ''
    cmd = toks[0]
    if cmd == 'api':
        return classify_api(toks, segment)
    action = toks[1] if len(toks) > 1 else ''
    if cmd == 'pr':
        if action in REFUSED_PR_ACTIONS or (action == 'review' and any(t in ('--approve', '-a') for t in toks)):
            return 'refuse', 'gh pr %s' % action
        if action in BODY_PR_ACTIONS:
            return 'body', 'gh pr %s' % action
        if action in METADATA_ACTIONS:
            return 'metadata', 'gh pr %s' % action
        return 'ignore', ''
    if cmd == 'issue':
        if action in REFUSED_ISSUE_ACTIONS:
            return 'refuse', 'gh issue %s' % action
        if action in BODY_ISSUE_ACTIONS:
            return 'body', 'gh issue %s' % action
        return 'ignore', ''
    if cmd == 'label' and action in ('create', 'edit', 'delete', 'clone'):
        return 'metadata', 'gh label %s' % action
    if cmd in REFUSED_COMMANDS and action and action not in READ_ACTIONS:
        return 'refuse', 'gh %s %s' % (cmd, action)
    if cmd == 'run' and action == 'delete':
        return 'refuse', 'gh run delete'
    return 'ignore', ''


def read_file(cwd, path):
    path = os.path.expanduser(path.strip('\'"'))
    if not os.path.isabs(path):
        path = os.path.join(cwd or '.', path)
    try:
        with open(path, encoding='utf-8') as fh:
            return fh.read()
    except OSError:
        return None


class Hidden(Exception):
    """A text the gate cannot read: a variable, stdin, a file that is not there."""


class Refused(Exception):
    """A JSON document that approves, closes or reopens: the developer's own click."""


def bodies_from_json(text):
    """Every text a JSON document posts: the body itself and, for a review, each inline comment."""
    try:
        data = json.loads(text)
    except ValueError:
        return [text]
    if not isinstance(data, dict):
        return []
    if any(refused_field(key, value) for key, value in data.items()):
        raise Refused()
    bodies = [data[key] for key in BODY_KEYS if isinstance(data.get(key), str) and data[key].strip()]
    for comment in data.get('comments') or []:
        if isinstance(comment, dict) and isinstance(comment.get('body'), str) and comment['body'].strip():
            bodies.append(comment['body'])
    return bodies


def file_text(cwd, path):
    if path.strip('\'"') == '-':
        raise Hidden()
    text = read_file(cwd, path)
    if text is None:
        raise Hidden()
    return text


def resolve_bodies(command, cwd):
    """Every text about to be posted, or None when the command hides one behind a variable or stdin.

    All of them, not the first: a title beside a body file is text posted under the developer's
    name too.
    """
    bodies = []
    try:
        for m in BODY_FILE.finditer(command):
            bodies.append(file_text(cwd, m.group(1)))
        for m in INPUT_FILE.finditer(command):
            bodies += bodies_from_json(file_text(cwd, m.group(1)))
        for m in AT_FILE.finditer(command):
            bodies.append(file_text(cwd, m.group(1)))
        for m in CAT_FILE.finditer(command):
            bodies.append(file_text(cwd, m.group(1)))
        toks = tokens_of(command)
        is_api = 'api' in toks[:2]
        for i, t in enumerate(toks):
            value = None
            if is_api and t in FIELD_FLAGS and i + 1 < len(toks) and '=' in toks[i + 1]:
                key, value = toks[i + 1].split('=', 1)
                if key not in BODY_KEYS or value.startswith('@'):
                    value = None
            elif not is_api and t == '-F' and i + 1 < len(toks):
                bodies.append(file_text(cwd, toks[i + 1]))
            elif t in INLINE_FLAGS and i + 1 < len(toks):
                value = toks[i + 1]
            elif t.startswith(('--body=', '--title=')):
                value = t.split('=', 1)[1]
            if value is None:
                continue
            if '$' in value:
                raise Hidden()
            bodies.append(value)
    except Hidden:
        return None
    return bodies or None


def normalise(text):
    return re.sub(r'[^0-9a-zA-Zá-žÁ-Ž]+', ' ', text).strip().lower()


def rows_of(path):
    try:
        with open(path, encoding='utf-8') as fh:
            for raw in fh:
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    yield json.loads(raw)
                except ValueError:
                    continue
    except OSError:
        return


def typed_by_a_person(text):
    text = (text or '').strip()
    if not text:
        return False
    row = HARNESS_ROW.match(text)
    return row is None or row.group(1) in DEVELOPER_ROW


def is_human_input(row, ask_ids):
    message = row.get('message') or {}
    if row.get('type') != 'user' and message.get('role') != 'user':
        return False
    content = message.get('content')
    if isinstance(content, str):
        return typed_by_a_person(content)
    if not isinstance(content, list):
        return False
    results = [c for c in content if isinstance(c, dict) and c.get('type') == 'tool_result']
    if results:
        return any(r.get('tool_use_id') in ask_ids for r in results)
    return any(isinstance(c, dict) and c.get('type') == 'text' and typed_by_a_person(c.get('text'))
               for c in content)


def shown_lines(text):
    """Every line of an assistant message, and every inline code span as a line of its own."""
    for line in text.splitlines():
        yield line
        for span in CODE_SPAN.findall(line):
            yield span


def input_kind(row):
    """How the developer spoke, so a refusal can say which turn it measured against."""
    content = (row.get('message') or {}).get('content')
    if isinstance(content, list):
        if any(isinstance(c, dict) and c.get('type') == 'tool_result' for c in content):
            return 'an %s answer' % ASK_TOOL
        for c in content:
            if isinstance(c, dict) and c.get('type') == 'text':
                tag = HARNESS_ROW.match((c.get('text') or '').strip())
                if tag:
                    return 'a <%s> they pressed' % tag.group(1)
    return 'a typed message'


class Evidence:
    """What the developer was shown before their last input, and where the gate read it.

    The reading is carried rather than recomputed so a refusal can name the file, the rows and the
    turn it measured against: four refusals in a row were spent guessing at exactly that.
    """

    def __init__(self, path):
        self.path = path
        self.rows = 0
        self.lines = []
        self.seen = ''
        self.last_input = None
        self.last_input_kind = ''

    def where(self):
        if not self.rows:
            return 'no transcript was available to the gate'
        at = ('the developer\'s last input at row %d (%s)' % (self.last_input, self.last_input_kind)
              if self.last_input is not None else 'no input from the developer')
        return '%d characters over %d rows of %s, up to %s' % (len(self.seen), self.rows, self.path, at)


def read_evidence(transcript):
    """Assistant text written before the developer's most recent input, one normalised line each."""
    evidence = Evidence(transcript)
    ask_ids = set()
    shown = []
    approved = []
    for index, row in enumerate(rows_of(transcript)):
        evidence.rows = index + 1
        message = row.get('message') or {}
        if row.get('type') == 'assistant' or message.get('role') == 'assistant':
            content = message.get('content')
            if isinstance(content, str):
                shown.append(content)
            elif isinstance(content, list):
                for c in content:
                    if not isinstance(c, dict):
                        continue
                    if c.get('type') == 'text':
                        shown.append(c.get('text', ''))
                    elif c.get('type') == 'tool_use' and c.get('name') == ASK_TOOL:
                        ask_ids.add(c.get('id'))
            continue
        if is_human_input(row, ask_ids):
            approved = list(shown)
            evidence.last_input = index
            evidence.last_input_kind = input_kind(row)
    evidence.lines = [normalise(line) for text in approved for line in shown_lines(text)]
    # the same string was_shown searches, so a count printed in a refusal and a count taken by hand
    # cannot disagree and send someone hunting for a message that was never missing
    evidence.seen = ' '.join(line for line in evidence.lines if line)
    return evidence


def was_shown(body, evidence):
    text = normalise(body)
    if not text:
        return False
    # a short reply ("Done.") would match inside any sentence, so it has to have been a line of
    # its own in the chat, or marked as exact with backticks
    if len(text) < MIN_EVIDENCE:
        return text in evidence.lines
    head, tail = text[:80], text[-80:]
    return head in evidence.seen or tail in evidence.seen


def already_warned(payload, key):
    session = payload.get('session_id')
    if not session:
        return True
    digest = hashlib.sha1(key.encode()).hexdigest()
    path = os.path.join(tempfile.gettempdir(), 'clawdeen-post-gate-warned-%s' % session)
    try:
        seen = open(path, encoding='utf-8').read().split()
    except OSError:
        seen = []
    if digest in seen:
        return True
    try:
        with open(path, 'a', encoding='utf-8') as fh:
            fh.write(digest + '\n')
    except OSError:
        return True
    return False


def main():
    payload = json.load(sys.stdin)
    if payload.get('tool_name') not in (None, 'Bash'):
        return 0
    command = shared.without_bodies((payload.get('tool_input') or {}).get('command', ''))
    if 'gh' not in command:
        return 0

    # What the shell would actually run, rather than every word in the call: a command that merely
    # names `gh pr create` inside quotes is text. The commit gate already reads through `command.py`
    # for the same reason. Only the entry test uses it, because stripping the quotes also strips the
    # body the rest of the gate has to read back.
    if not any(classify(m.group(1))[0] != 'ignore'
               for m in GH_SEGMENT.finditer(shared.without_quoted_data(command))):
        return 0

    # Every gh segment is judged on its own, so a batch of posts cannot hide an unseen body behind
    # a verified first one.
    segments = []
    for m in GH_SEGMENT.finditer(command):
        verdict, what = classify(m.group(1))
        if verdict == 'refuse':
            sys.stderr.write(
                'Post gate: %s is an action the developer takes themselves (merge, close, approve, '
                'deploy, delete). Not for an agent, whatever the instruction in the chat says. Tell '
                'the developer what you would have done and stop.\n' % what)
            return 2
        if verdict in ('body', 'metadata'):
            segments.append((m.group(0), what, verdict))
    if not segments:
        return 0

    transcript = payload.get('transcript_path') or ''
    for segment, what, verdict in segments:
        status = check_segment(segment, what, verdict, command, transcript, payload)
        if status:
            return status
    return 0


def check_segment(segment, what, verdict, command, transcript, payload):
    try:
        bodies = resolve_bodies(segment, payload.get('cwd'))
        # `BODY=$(cat file) && gh ...` keeps the file outside the gh segment; that is fine for a
        # single post, while a batch has to name its file inside every segment
        if bodies is None and len(GH_SEGMENT.findall(command)) == 1:
            bodies = resolve_bodies(command, payload.get('cwd'))
    except Refused:
        sys.stderr.write(
            'Post gate: the JSON %s sends approves, closes or reopens, which is an action the developer '
            'takes themselves. Not for an agent, whatever the instruction in the chat says.\n' % what)
        return 2

    if bodies is None:
        piped = re.search(r'(--body-file|--input|-F)[=\s]+-(\s|$)', segment) or re.search(r'\|\s*gh\b', command)
        carries_text = (verdict == 'body' and (piped or what.removeprefix('gh ') in ALWAYS_TEXT
                        or re.search(r'\b(body|description|title|note|message|fill)\b', segment)))
        if not carries_text:
            # labels, reviewers, draft state: nothing to read back, so warn once and let the repeat through
            # `gh api` names its target in `what`, so a batch over one path asks once and not once per id
            by_operation = what.startswith('gh api ')
            if already_warned(payload, 'metadata:' + (what if by_operation else command)):
                return 0
            sys.stderr.write(
                'Post gate: %s changes something on GitHub under the developer\'s name and carries no text '
                'to check. Make sure the developer chose this (an AskUserQuestion answer, or their words), '
                'then repeat %s.\n' % (what, 'it, and the rest of the batch over this path goes through too'
                                       if by_operation else 'the identical command and it goes through'))
            return 2
        sys.stderr.write(
            'Post gate: %s goes to GitHub under the developer\'s name and the text being posted cannot '
            'be read from the command. Write the text to a file, show it in the chat, wait for the '
            'developer to answer, then post it with --body-file <file>, --input <file> or '
            '-F body=@<file> so the gate can check it was seen.\n' % what)
        return 2

    for body in bodies or ():
        trailer = first_trailer(body)
        if trailer:
            sys.stderr.write(
                'Post gate: the text %s is about to post carries a trailer: %s\n'
                '  AGENTS.md section 3: no Co-Authored-By and no other trailers, whatever the harness '
                'suggests. Take that line out, show the text again, and repeat the command.\n' % (what, trailer))
            return 2

    # every text is judged on its own, so a review cannot hide one unseen inline comment among
    # ten that were read
    evidence = read_evidence(transcript) if transcript and os.path.exists(transcript) else Evidence(transcript)
    unseen = [body for body in bodies or () if not was_shown(body, evidence)]
    if bodies and not unseen:
        return 0

    # Which text failed, not just that one did: a title beside a body file is two texts, and a
    # refusal that says "the text" sends the agent back to re-show the one that already passed.
    opening = next((line.strip() for line in unseen[0].splitlines() if line.strip()), '') if unseen else ''
    sys.stderr.write(
        'Post gate: %s is about to post %d text%s and %d of them %s never shown to the developer '
        'before their last message.\n'
        % (what, len(bodies), '' if len(bodies) == 1 else 's', len(unseen),
           'was' if len(unseen) == 1 else 'were'))
    sys.stderr.write('  The one that failed begins: %s\n' % (opening[:70] or '(empty)'))
    if unseen and len(normalise(unseen[0])) < MIN_EVIDENCE:
        sys.stderr.write(
            '  It is under %d characters, so it counts only as a line of its own or inside backticks, '
            'never as part of a sentence.\n' % MIN_EVIDENCE)
    sys.stderr.write('  Evidence: %s\n' % evidence.where())
    sys.stderr.write(
        '  Put that exact text in the chat, wait for their answer, then repeat the command. AGENTS.md '
        'section 1: the developer owns every word posted under their name.\n')
    return 2


if __name__ == '__main__':
    sys.exit(main())
