# Claude session

A board of the Claude Code sessions on this Mac: what each one is doing, where its pull request
stands, and what is left of the usage windows. It lives in the menu bar, notifies when a session
starts waiting for an answer, and opens any of them in the Claude app with one click.

## What it reads

Everything is local. Nothing is sent anywhere, and the only network calls are the ones `gh` and
`glab` make for pull requests.

| Source                                                                             | For                                                                                            |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `~/Library/Application Support/Claude/claude-code-sessions/<account>/<org>/*.json` | the sessions, their titles, working copies and pull requests                                   |
| `~/Library/Application Support/Claude/config.json`                                 | which account the sidebar is showing, so the board lists the same one                          |
| `~/.claude/projects/*/<cli session>.jsonl`                                         | what the session is doing: a tool still running, a question nobody answered, a turn that ended |
| `/tmp/claude-<uid>/*/<cli session>/tasks/*.output`                                 | whether a backgrounded command, monitor or agent is still going                                |
| `gh`, `glab`, `git remote`                                                         | the pull request, its checks, conflicts and review                                             |
| `~/.cache/terminal-welcome/claude-usage.json`                                      | the five hour and seven day windows                                                            |

## The words a row can say

**What the session is doing:** `pracuje`, `gate běží`, `gate ve frontě`, `úloha běží`,
`čeká na tebe`. **Where its change stands:** `bez PR`, `koncept`, `konflikt`, `CI běží`,
`CI červené`, `změny žádané`, `k mergi`, `k review`, `sloučené`, `zavřené`. A red CI also names the
job that failed and links to it.

A session waiting on an answer is sorted to the top, its dot turns amber, and the tray counts it.

## Configuration

Both files are optional and live outside this repository, because what they point at is not
everyone's.

`~/.config/claude-sessions/gates.json` — where a long local check registers itself. The lock is
taken before the wait for a free slot and the registry only after it, which is how `gate běží` and
`gate ve frontě` are told apart.

```json
{ "registry": "${TMPDIR}/clawdeen-gates", "lock": "var/check.lock" }
```

`~/.config/claude-sessions/jira.json` — tracker key to base URL, for sessions whose work is not on
GitHub.

```json
{ "ABC": "https://example.atlassian.net/browse/" }
```

## Running it

```bash
npm install
npm run dev          # the window, with reload
npm run build:mac    # an unsigned .app in dist/mac-arm64
```

The build is not signed or notarised, so the first launch is a right click and **Open**.

## What it does not know

The desktop app keeps a pending permission prompt in memory only, so a session held up by one reads
as `pracuje` rather than as waiting. A question asked with `AskUserQuestion` or a plan waiting for
approval is read correctly, because those reach the transcript.

The record format is undocumented and was read off the app; a Claude update can change it.
