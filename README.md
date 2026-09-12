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

## What it keeps

Its own data lives in the application's `userData` directory and nothing else is written anywhere:
`order.json` for the order cards were dragged into, `window.json` for where the window was, and
`history.db`, a SQLite with one row per stretch of a state. The database is opened with Node's own
`node:sqlite`, which is why this carries no native dependency; Node still calls it experimental and
says so on every start.

## The words a row can say

**What the session is doing:** `pracuje`, `gate běží`, `gate ve frontě`, `úloha běží`,
`úloha čeká` (a monitor, or a backgrounded command that has written nothing for five minutes),
`čeká na tebe`. **Where its change stands:** `bez PR`, `koncept`, `konflikt`, `CI běží`,
`CI červené`, `změny žádané`, `k mergi`, `k review`, `merged`, `zavřené`. A red CI also names the
job that failed and links to it.

A session waiting on an answer is sorted to the top, its dot turns amber, and the tray counts it.
While a set of checks is running the word carries how many are done and how long it has been going;
once the run is over it says how long ago it finished.

The gauges say how long each usage window lasts at the pace so far, and the numbers and the bar are
green while it outlives its reset, amber within a tenth of it, red when it runs out first.

What Claude pins is pinned here, marked with an accent down the side of the card. Cards can be
dragged into any order, which is then hers until the `vlastní pořadí ×` chip gives it back. The
strip under the gauges says what the day went into, summed across every session.

**Reading the conversation:** the `chat` button on a card opens the transcript beside the board,
read only, the tool calls named rather than unfolded and the harness blocks stripped. Escape closes
it.

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
npm run icons        # redraws the application and tray icons from the SVG in tools/icons
npm run build:mac    # an unsigned .app in dist/mac-arm64
npm test             # the reading rules: what a turn is, what is still running, what the checks say
```

The build is not signed or notarised, so the first launch is a right click and **Open**.

## What it does not know

The desktop app keeps a pending permission prompt in memory only, so a session held up by one reads
as `pracuje` rather than as waiting. A question asked with `AskUserQuestion` or a plan waiting for
approval is read correctly, because those reach the transcript.

The record format is undocumented and was read off the app; a Claude update can change it.
