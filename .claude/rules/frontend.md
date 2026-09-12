---
paths:
  - "src/renderer/**"
---

# The window

The renderer draws a board and nothing else. It never reads a file, runs a command or knows a path:
everything arrives over `window.api`, and anything it needs that is not there is a change in the
main process first. That is not a style rule, it is what keeps the disk out of a page.

## Vue

Composition API with `<script setup lang="ts">`, `defineProps` typed against `src/shared/types.ts`,
scoped styles in the component they belong to. No component library: what the board needs is a card,
a chip and a bar, and all three are twenty lines of CSS. A `computed` for anything the template
would otherwise work out, so the template stays readable at a glance.

## Colours and words

**Colours are tokens** in `src/renderer/src/assets/main.css`, never values in a component, and each
one is defined for both themes in the same place. The tokens come from the other project's design
system on purpose, so the two read alike.

**The state words are a closed list** in `src/shared/types.ts`, and every one of them has a class in
`words.ts`, a colour in the tray and a place in the lanes. Adding a word means adding it in all
four; a word the history still holds but the code no longer knows must not throw, because the
database outlives the vocabulary.

## What the board must not do

- **Never render a state it cannot stand behind.** An empty chip is honest, a guessed one is not.
- **Never block on the main process.** Everything over `window.api` is awaited and the board draws
  whatever it already has; a slow `gh` call must not leave an empty window.
- `v-html` only over text that was escaped in the same function, and the escaping is what is read
  first in review.
- No animation except the one dot that says a session is working, and that one honours
  `prefers-reduced-motion`.

## Reading it back

The window answers over the debugger: build, run with `--remote-debugging-port=9222`, and ask
`window.api.board()` or the DOM what it says. A screenshot proves the layout; the debugger proves
the state. Neither is optional when a row changed.
