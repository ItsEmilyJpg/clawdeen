<script setup lang="ts">
import { computed } from 'vue'

import type { Change, Session } from '../../../shared/types'
import { ago, inWords, stateLabel, STATE_CLASS } from '../words'

const props = defineProps<{ session: Session; dragging: boolean }>()
const emit = defineEmits<{ grab: []; drop: []; peek: [] }>()

const APP_SESSION = 'claude://code/continue?session='
const FAILED_SHOWN = 3
const TOO_LONG = 600
const CARRIED = new Set(['merged', 'zavřené', 'otevřené', 'koncept'])

/** The colour of a pull request is its own state: open, merged, closed or still a draft. */
function howItStands(change: Change, session: Session): string {
  if (change.state === 'merged') return 'pr-merged'
  if (!change.open) return 'pr-closed'
  if (change.draft) return 'pr-draft'
  const red =
    change === session.change && (session.state === 'CI červené' || session.state === 'konflikt')
  return red ? 'pr-red' : 'pr-open'
}

/** Issue first, the change second, and where either is missing the grey word holds its place. */
const named = computed(() => {
  const session = props.session
  return [
    session.issue
      ? { label: session.issue.label, kind: 'issue', url: session.issue.url }
      : { label: 'bez issue', kind: STATE_CLASS['bez PR'] },
    ...(session.changes.length > 0
      ? session.changes.map((change) => ({
          label: change.label,
          kind: `pr ${howItStands(change, session)}`,
          url: change.url
        }))
      : [{ label: session.state, kind: STATE_CLASS[session.state] }])
  ]
})

/** Where the session and its change stand: the column on the right, or the tail of the one line. */
const standing = computed(() => {
  const session = props.session
  const rows: { label: string; kind: string; url?: string }[] = []
  if (session.activity) {
    const about = session.about ? ` · ${session.about}` : ''
    // How long says something about a task, and nothing at all about how long she has been the one
    // holding it up, so it only rides with the task states.
    const timed = session.since && session.activity !== 'čeká na tebe'
    const on = timed ? ` · ${inWords(Date.now() / 1000 - (session.since as number))}` : ''
    // A task that has been on for longer than this is not progress any more, it is a thing to look at.
    const hot = timed && Date.now() / 1000 - (session.since as number) > TOO_LONG ? ' hot' : ''
    rows.push({ label: session.activity + about + on, kind: STATE_CLASS[session.activity] + hot })
  }
  if (session.extra) {
    rows.push({ label: session.extra, kind: STATE_CLASS[session.extra] })
  }
  // Where the word only repeats what the pull request chip already says in its colour, it goes.
  if (session.change && !CARRIED.has(session.state)) {
    // A state that came out of a run links to that run; the others say enough on their own.
    const checks = session.state.startsWith('CI ') ? `${session.change.url}/checks` : undefined
    rows.push({
      label: stateLabel(session.state, session.change),
      kind: STATE_CLASS[session.state],
      url: checks
    })
  }
  for (const job of (session.change?.failed ?? []).slice(0, FAILED_SHOWN)) {
    rows.push({ label: job.label, kind: 'job', url: job.url || undefined })
  }
  return rows
})

/**
 * The number the Claude sidebar shows in front of the title. Usually the issue; where the title
 * names the pull request itself, that number, because matching the two lists is the whole point.
 */
const mark = computed(
  () => props.session.issue?.token ?? props.session.change?.token.replace('PR ', '') ?? null
)

const dot = computed(() => (props.session.activity ? STATE_CLASS[props.session.activity] : ''))

/** How long one beat of the dot lasts, in step with the `beat` keyframes below. */
const BEAT = 1800

/**
 * Every beating dot on one clock. A CSS animation starts when its element does, so cards that
 * appeared at different moments beat out of step; a negative delay off the epoch puts them all on
 * the same grid. It is read again whenever the state changes, which is when the animation restarts.
 */
const phase = computed(() => (dot.value === 's-working' ? `-${Date.now() % BEAT}ms` : '0ms'))

function open(url: string): void {
  void window.api.open(url)
}
</script>

<template>
  <li
    :class="['card', dot, { active: session.active, pinned: session.pinned, dragging }]"
    :style="{ '--beat-phase': phase }"
    draggable="true"
    @dragstart="emit('grab')"
    @dragover.prevent
    @drop.prevent="emit('drop')"
  >
    <button class="open" :title="session.title" @click="open(APP_SESSION + session.id)" />
    <div class="left">
      <div class="title">
        <span v-if="mark" class="number">{{ mark }}</span
        >{{ session.headline }}
      </div>
      <div class="chips">
        <a
          v-for="(chip, index) in named"
          :key="index"
          :class="['chip', chip.kind]"
          :href="chip.url"
          @click.prevent="chip.url && open(chip.url)"
        >
          {{ chip.label }}
        </a>
      </div>
    </div>
    <div class="right">
      <div class="chips">
        <a
          v-for="(chip, index) in standing"
          :key="index"
          :class="['chip', chip.kind]"
          :href="chip.url"
          @click.prevent="chip.url && open(chip.url)"
        >
          {{ chip.label }}
        </a>
      </div>
      <div class="meta">{{ session.place }} · {{ ago(session.last) }}</div>
    </div>
    <button class="peek" title="Přečíst chat" @click.stop="emit('peek')">chat</button>
  </li>
</template>

<style scoped>
.card {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: 10px;
  box-shadow: var(--shadow-card);
}

.card:hover {
  background: var(--hover);
}

/*
 * The Claude sidebar draws a session as a ring while nothing is happening and fills it in when
 * something is, so the board says the same: hollow is quiet, filled is a session doing something.
 */
.card::before {
  content: '';
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 9999px;
  background: transparent;
  box-shadow: inset 0 0 0 1.5px var(--faint);
}

.card.s-working::before,
.card.s-waiting::before,
.card.s-gate::before,
.card.s-queued::before,
.card.s-task::before {
  box-shadow: none;
}

/* The one thing that moves on the board: a session that is working right now. */
.card.s-working::before {
  background: var(--ok);
  animation: beat 1.8s ease-in-out infinite;
  animation-delay: var(--beat-phase, 0ms);
}

@keyframes beat {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.3;
  }
}

@media (prefers-reduced-motion: reduce) {
  .card.s-working::before {
    animation: none;
  }
}

.card.s-queued::before {
  background: var(--faint);
}

.card.s-waiting::before {
  background: var(--warn);
}

.card.s-gate::before,
.card.s-task::before {
  background: var(--info);
}

/* What she pinned in Claude, marked where it does not compete with the state colours. */
.card.pinned {
  border-left: 3px solid var(--accent);
}

/* And what waits on her, in the colour of that state, so it is found without reading a word. */
.card.s-waiting {
  border-left: 3px solid var(--warn);
}

.card.dragging {
  opacity: 0.5;
}

/* The whole card opens the session; the labels sit above it and keep their own links. */
.open {
  position: absolute;
  inset: 0;
  border: 0;
  padding: 0;
  background: transparent;
  border-radius: 10px;
  cursor: pointer;
}

.title {
  position: relative;
  pointer-events: none;
  font-weight: 600;
  letter-spacing: -0.01em;
}

/* The number the Claude sidebar shows, so a row can be matched to the session over there. */
.number {
  color: var(--ink-muted);
  margin-right: 6px;
}

.chips {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.meta {
  position: relative;
  pointer-events: none;
  color: var(--ink-muted);
  font-size: 11px;
}

/* Reading the conversation is the one thing the card does besides opening the session. */
.peek {
  position: absolute;
  border: 0;
  border-radius: 9999px;
  padding: 2px 9px;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  background: var(--muted-soft);
  color: var(--ink-muted);
  cursor: pointer;
  /* Visible enough to be found, quiet enough not to compete with the labels. */
  opacity: 0.45;
  transition: opacity 0.15s ease;
}

.card:hover .peek,
.peek:focus-visible {
  opacity: 1;
}

/*
 * The default is one line a session, laid out in columns so the board can be read straight down:
 * what it is, what it is on, where it stands, when it last moved. Every column ends in an ellipsis
 * rather than wrapping, because a row that grows a second line is no longer a row.
 */
.sessions.compact .card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px minmax(0, 260px) 170px;
  align-items: center;
  column-gap: 14px;
  padding: 8px 56px 8px 30px;
}

.sessions.compact .card::before {
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
}

.sessions.compact .card.pinned,
.sessions.compact .card.s-waiting {
  padding-left: 28px;
}

.sessions.compact .left {
  display: contents;
}

.sessions.compact .title {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.sessions.compact .right {
  display: contents;
}

/* The number is in the title here, so the chip that repeats it goes. */
.sessions.compact .chips .issue {
  display: none;
}

.sessions.compact .chips {
  flex-wrap: nowrap;
  overflow: hidden;
  min-width: 0;
}

.sessions.compact .meta {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: right;
  direction: rtl;
}

.sessions.compact .peek {
  top: 50%;
  right: 10px;
  transform: translateY(-50%);
}

/* A narrow window drops what it can spare: where the worktree is, and then the issue and the change. */
@media (max-width: 860px) {
  .sessions.compact .card {
    grid-template-columns: minmax(0, 1fr) 150px minmax(0, 240px);
  }

  .sessions.compact .meta {
    display: none;
  }
}

@media (max-width: 680px) {
  .sessions.compact .card {
    grid-template-columns: minmax(0, 1fr) minmax(0, 240px);
  }

  .sessions.compact .left .chips {
    display: none;
  }
}

/* Expanded: the same card with the states in a column of their own, which reads down the board. */
.sessions.expanded .card {
  display: grid;
  grid-template-columns: 1fr auto;
  column-gap: 16px;
  align-items: start;
  border-radius: 12px;
  padding: 12px 14px 12px 34px;
}

.sessions.expanded .card::before {
  left: 14px;
  top: 18px;
}

.sessions.expanded .card.pinned,
.sessions.expanded .card.s-waiting {
  padding-left: 32px;
}

.sessions.expanded .open {
  border-radius: 12px;
}

.sessions.expanded .title {
  font-size: 15px;
  overflow-wrap: anywhere;
}

/* Expanded has room for the issue as a label of its own, which is a link as well as a number. */
.sessions.expanded .number {
  display: none;
}

.sessions.expanded .left .chips {
  margin-top: 6px;
}

.sessions.expanded .right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 5px;
  text-align: right;
}

.sessions.expanded .right .chips {
  justify-content: flex-end;
}

.sessions.expanded .peek {
  top: 10px;
  right: 10px;
}

.sessions.expanded .card:hover .peek {
  opacity: 1;
}
</style>
