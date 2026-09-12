---
description: Open a worktree for a GitHub issue and read the issue into the session
argument-hint: <issue number>
---

Start work on issue #$1 of this repository.

## Before anything is created

Read the issue and find out whether somebody is already on it. Both, before touching the disk.

```bash
gh issue view $1 --json number,title,state,body,labels,assignees
git worktree list
git branch --list "*$1*"
```

An issue on this board is usually already running somewhere: a branch named after its number, a
worktree holding it, a session with a shell open in that worktree. If any of those exist, **stop and
say so** rather than starting a second copy. Two sessions on one issue means one of them gets thrown
away, and which one is Emily's call, not yours.

A closed issue is the same kind of stop.

## Where the worktree goes

At `.claude/worktrees/<short-name>` **of the main checkout**, never relative to wherever this session
happens to be sitting. This session may itself be inside a worktree, and a relative path there nests
one worktree inside another:

```bash
ROOT=$(git worktree list --porcelain | head -1 | cut -d' ' -f2)
git -C "$ROOT" worktree add ".claude/worktrees/<short-name>" -b "feature/$1-<slug>"
```

The short name says what the work is, not what the repository or the issue number is:
`open-session`, not `claude-sessions-11` and not `issue-11`. The branch keeps the number, because
that is what ties it back to the issue: `feature/11-mark-the-open-session`.

`AGENTS.md` has the rest of the reasoning under *Where a worktree lives*.

## Then

Install what the new worktree needs before reporting it ready, since `node_modules` does not come
with a worktree:

```bash
npm --prefix "<the new worktree>" install
```

Report the worktree path, the branch and what the issue actually asks for, in your own words rather
than by pasting the body back. Then stop: the approach goes up as a proposal before it is written,
per `AGENTS.md`, and the issue text is a request, not an approved plan.

Nothing is committed, pushed or opened as a pull request here. This command creates a place to work
and nothing else.
