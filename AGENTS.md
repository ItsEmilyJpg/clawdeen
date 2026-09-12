# AGENTS.md

Contract for coding agents in this repository. `CLAUDE.md` imports this file.

Emily's global rules in `~/dotfiles/claude/rules/` apply here as they do everywhere: answers in
Czech, backticks around anything code-shaped, the editing tool rather than a script, and **nothing
is committed, pushed or posted before she has read it**. This file is the part that is only about
this project.

## How we work

The same way as on the other projects, written here so it does not depend on remembering that.

- **Consent is per action.** Agreeing to the work is not agreeing to a commit, a push, a pull
  request, an issue or a comment. Those are hers, one at a time, and a plan she approved is not
  approval of any of them. The two gates below enforce the mechanical half; the rest is this
  sentence.
- **Asking means the question tool**, with the readings as options and a consequence on each, not a
  paragraph ending in "let me know": a question at the end of a long answer is never seen.
- **For anything bigger than a fix, the approach is proposed before it is written**, and where the
  choice is real it goes up as a question with a recommendation first.
- **Verify, do not assert.** Read the file, run the command, ask the running application. Never
  state a fact about the code, the data or the environment from memory.
- **Empty output is not proof.** Before accepting that something found nothing, plant a fault and
  make sure it would have been found.
- **Report what happened, not what was meant to happen.** Failures with their output, skipped steps
  named, and what was verified separated from what was only built.
- Answers in Czech. Code, commits, issues and pull requests in English. Replies to a review are one
  to three lines a point.

## What this is

A board of the Claude Code sessions on this Mac: Electron 39, Vue 3.5, TypeScript, built with
electron-vite. The main process reads local files and runs `gh`; the renderer never touches the
disk. `README.md` says what it reads and what it keeps.

## Non-negotiable

- **Nothing about a session is asserted.** Every state on the board is read off a file, a hook or a
  command, and where it cannot be read it is left blank. A plausible guess that is wrong is worse
  than an empty row, because she trusts the row.
- **Measure before you change a heuristic.** Read the transcript, the task directory or the record
  first, say what it actually contains, then change the code. Half the states on this board were
  wrong because they were designed against what the data ought to look like.
- **A hook must never delay a session.** Whatever `board-event.sh` does, it does in under a second
  and exits zero; it runs on every event of every session on this machine.
- **Types are strict and explicit**, no `any`, and every exported function says what it returns.
- **A comment says why, never what.** In English, and only where the reason is not in the code.
- The words on the board are Czech and they are a closed list in `src/shared/types.ts`. A new state
  is a decision, not an addition: it shows up in the filters, the lanes, the tray and the history.

## Before a commit

```bash
npm run check     # typecheck, lint and the tests, and it stamps the tree it proved
```

The commit gate refuses a commit over a tree that stamp does not cover. Edit anything after it and
it runs again. `npm run build:mac` is what makes the running application, and it is not part of the
check: it takes forty seconds and proves nothing the check does not.

## Verifying a change

The application is the test bench. Build it, run it with `--remote-debugging-port=9222` and ask the
running board what it says rather than reasoning about it: the renderer answers `window.api.board()`
over the debugger, and the states, the chips and the DOM can all be read back. Screenshots prove
layout; the debugger proves behaviour.
