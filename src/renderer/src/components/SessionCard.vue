<script setup lang="ts">
import { computed } from 'vue'

import type { Session } from '../../../shared/types'
import { ago, stateLabel, STATE_CLASS } from '../words'

const props = defineProps<{ session: Session; dragging: boolean }>()
const emit = defineEmits<{ grab: []; drop: []; peek: [] }>()

const APP_SESSION = 'claude://code/continue?session='
const FAILED_SHOWN = 3

/** Issue first, the change second, and where either is missing the grey word holds its place. */
const named = computed(() => {
  const session = props.session
  return [
    session.issue
      ? { label: session.issue.label, kind: 'issue', url: session.issue.url }
      : { label: 'bez issue', kind: STATE_CLASS['bez PR'] },
    session.change
      ? { label: session.change.label, kind: 'pr', url: session.change.url }
      : { label: session.state, kind: STATE_CLASS[session.state] }
  ]
})

/** Where the session and its change stand: the column on the right, or the tail of the one line. */
const standing = computed(() => {
  const session = props.session
  const rows: { label: string; kind: string; url?: string }[] = []
  if (session.activity) rows.push({ label: session.activity, kind: STATE_CLASS[session.activity] })
  if (session.change) {
    rows.push({
      label: stateLabel(session.state, session.change),
      kind: STATE_CLASS[session.state]
    })
  }
  for (const job of (session.change?.failed ?? []).slice(0, FAILED_SHOWN)) {
    rows.push({ label: job.label, kind: 'job', url: job.url || undefined })
  }
  return rows
})

const dot = computed(() => (props.session.activity ? STATE_CLASS[props.session.activity] : ''))

function open(url: string): void {
  void window.api.open(url)
}
</script>

<template>
  <li
    :class="['card', dot, { active: session.active, pinned: session.pinned, dragging }]"
    draggable="true"
    @dragstart="emit('grab')"
    @dragover.prevent
    @drop.prevent="emit('drop')"
  >
    <button class="open" :title="session.title" @click="open(APP_SESSION + session.id)" />
    <div class="left">
      <div class="title">
        <span v-if="session.issue" class="number">{{ session.issue.token }}</span
        >{{ session.headline }}
      </div>
      <div class="chips">
        <a
          v-for="(chip, index) in named"
          :key="index"
          :class="['chip', chip.kind]"
          @click="chip.url && open(chip.url)"
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
          @click="chip.url && open(chip.url)"
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

.sessions.compact .card.pinned {
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

.sessions.expanded .card.pinned {
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
