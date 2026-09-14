# Clawdeen

A board of the Claude Code sessions on this Mac: what each one is doing, where its pull request
stands, and what is left of the usage windows. It lives in the menu bar, notifies when a session
starts waiting for an answer, and opens any of them in the Claude app with one click.

## What it reads

Everything is local. Nothing is sent anywhere, and the only network calls are the ones `gh` and
`glab` make for pull requests.

| Source                                                                             | For                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `~/Library/Application Support/Claude/claude-code-sessions/<account>/<org>/*.json` | the sessions, their titles, working copies, pull requests, and which one is open in the app                                                                                                                                                                        |
| `~/Library/Application Support/Claude/config.json`                                 | which account the sidebar is showing, so the board lists the same one                                                                                                                                                               |
| `~/.claude/projects/*/<cli session>.jsonl`                                         | what the session is doing: a tool still running, a question nobody answered, a turn that ended; and which working copy its own commands name, which is where the repository is read from when the session was opened somewhere else |
| `/tmp/claude-<uid>/*/<cli session>/tasks/*.output`                                 | whether a backgrounded command, monitor or agent is still going                                                                                                                                                                     |
| `gh`, `glab`, `git remote`                                                         | the pull request, its checks, conflicts and review                                                                                                                                                                                  |
| `api.anthropic.com/api/oauth/usage`, with the token Claude Code keeps in the Keychain | the five hour and seven day windows. The token is read, never renewed: renewing it rotates the refresh token and would log the CLI out. An expired one leaves the windows on the last reading, with its age said out loud |

## What it keeps

Its own data lives in the application's `userData` directory and nothing else is written anywhere:
`order.json` for the order cards were dragged into, `window.json` for where the window was,
`usage.json` for the last reading of the windows that came back, and
`history.db`, a SQLite with one row per stretch of a state. The database is opened with Node's own
`node:sqlite`, which is why this carries no native dependency; Node still calls it experimental and
says so on every start.

## The words a row can say

The board speaks English or Czech, whichever the Mac is in, and the language is a choice in the
settings that outlives the window. The words below are the English ones.

**What the session is doing:** `working`, `gate running`, `gate queued`, `task running`,
`task queued` (a monitor, or a backgrounded command that has written nothing for five minutes),
`waiting for you`. **Where its change stands:** `no PR`, `draft`, `conflict`, `CI running`,
`CI red`, `changes requested`, `ready to merge`, `in review`, `merged`, `closed`. A red CI also
names the job that failed and links to it.

A session waiting on an answer is sorted to the top, its dot turns amber, and the tray counts it.
While a set of checks is running the word carries how many are done and how long it has been going;
once the run is over it says how long ago it finished.

The gauges say how long each usage window lasts at the pace so far, against the reset it is measured
by: `spent in 1 h 49 min · resets in 4 h 25 min`, both of them in the bar at the top as well as in
the gauges. The numbers and the bar are green while the window outlives its reset, amber within a
tenth of it, red when it runs out first.

What Claude pins is pinned here, marked with an accent down the side of the card. The session open
in the Claude app is ringed in the same colour, read off the record the app stamps when a card is
focused, which says which session is open rather than whether she is looking at it. Cards can be
dragged into any order, which is then hers until the `own order ×` chip gives it back. The
strip under the gauges says what the day went into, summed across every session.

**Which project a card is on** is a stripe down its right edge, in a colour the repository's name
picks out of a fixed palette; the name itself is in the card's tooltip, because a colour says
nothing on its own. The `⚙` menu in the bar swaps that for the name in grey in front of the title,
or turns it off, and remembers the choice.

**Reading the conversation:** the `chat` button on a card opens the transcript beside the board,
read only and with the harness blocks stripped. The tool calls sit behind a fold that names each one
and the one argument saying what it was on; what a tool answered is never carried at all. A sweep of
the board does not reload the pane, so nothing blinks and the reading keeps its place. Escape closes
it.

## Configuration

Both files are optional and live outside this repository, because what they point at is not
everyone's. They live in `~/.config/clawdeen/`, and an install made before the board was called
Clawdeen is read from `~/.config/claude-sessions/` where that directory is the one that exists.

`~/.config/clawdeen/gates.json` — where a long local check registers itself. The lock is taken
before the wait for a free slot and the registry only after it, which is how `gate running` and
`gate queued` are told apart.

```json
{ "registry": "${TMPDIR}/clawdeen-gates", "lock": "var/check.lock" }
```

`~/.config/clawdeen/jira.json` — tracker key to base URL, for sessions whose work is not on
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
