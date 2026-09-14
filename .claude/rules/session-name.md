# The name of a session on this board

The shape of a title is the `update-session-name` skill's, not this file's: read it there. What is
written here is only what is true of this repository, because this repository is where the words in
a title come from.

## The last segment is ours

The state at the end of a title is one of the words in `src/shared/types.ts`, computed off the pull
request by the hook that names sessions, which lives outside this repository, and handed to the
session as text. It is copied,
never chosen, so two sessions in the same place read the same. **A sixth word is not invented for a
title**, and a word the hook did not hand over is left out rather than guessed, exactly as an empty
chip beats a guessed one on the board itself.

Changing the closed list in `src/shared/types.ts` therefore changes what titles are allowed to say.
That is one more place to look at, next to `words.ts`, the tray and the lanes.

## The number comes off the branch, so the branch has to carry it

The hook reads the issue out of the branch name. Two shapes reach it here:

- `feature/14-dots-in-step`, which `/start-issue` writes and `AGENTS.md` asks for
- `feature/issue-14-539a87`, which the Claude app writes when it opens a session on an issue itself

Both are recognised. A branch that carries the number in neither shape leaves the title saying
`bez issue`, which is not a judgement about the work, only about the branch name.

## When it gets named

- `/start-issue` names it when it opens the worktree, so a session never sits in the list as
  `Issue 14`.
- The hook says so when the title stops matching the issue, the pull request or the state.
- Otherwise only when the work has actually moved. A name that changes every ten minutes is a name
  nobody learns to recognise.
