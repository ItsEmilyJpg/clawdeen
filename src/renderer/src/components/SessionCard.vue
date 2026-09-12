<script setup lang="ts">
import { computed } from 'vue'

import type { Session } from '../../../shared/types'
import { ago, stateLabel, STATE_CLASS } from '../words'

const props = defineProps<{ session: Session; dragging: boolean }>()
const emit = defineEmits<{ grab: []; drop: []; peek: [] }>()

const APP_SESSION = 'claude://code/continue?session='
const FAILED_SHOWN = 3

/** Issue first, the change second, and where either is missing the grey word holds its place. */
const chips = computed(() => {
  const session = props.session
  const rows: { label: string; kind: string; url?: string }[] = []
  rows.push(
    session.issue
      ? { label: session.issue.label, kind: 'issue', url: session.issue.url }
      : { label: 'bez issue', kind: STATE_CLASS['bez PR'] }
  )
  rows.push(
    session.change
      ? { label: session.change.label, kind: 'pr', url: session.change.url }
      : { label: stateLabel(session.state, session.change), kind: STATE_CLASS[session.state] }
  )
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
    <div class="title">{{ session.headline }}</div>
    <div class="chips">
      <a
        v-for="(chip, index) in chips"
        :key="index"
        :class="['chip', chip.kind]"
        @click="chip.url && open(chip.url)"
      >
        {{ chip.label }}
      </a>
    </div>
    <button class="peek" title="Přečíst chat" @click.stop="emit('peek')">chat</button>
    <div class="meta">{{ session.place }} · {{ ago(session.last) }}</div>
  </li>
</template>

<style scoped>
.card {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: 12px;
  box-shadow: var(--shadow-card);
  padding: 12px 14px 12px 34px;
}

/* What she pinned in Claude, marked where it does not compete with the state colours. */
.card.pinned {
  border-left: 3px solid var(--accent);
  padding-left: 32px;
}

.card.dragging {
  opacity: 0.5;
}

/* Reading the conversation is the one thing the card does besides opening the session. */
.peek {
  position: absolute;
  top: 10px;
  right: 10px;
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

.card:hover {
  background: var(--hover);
}

.card::before {
  content: '';
  position: absolute;
  left: 14px;
  top: 18px;
  width: 8px;
  height: 8px;
  border-radius: 9999px;
  background: var(--faint);
}

.card.active::before {
  background: var(--ok);
}

.card.s-working::before {
  background: var(--ok);
}

.card.s-waiting::before {
  background: var(--warn);
}

.card.s-gate::before,
.card.s-task::before {
  background: var(--info);
}

/* The whole card opens the session; the labels sit above it and keep their own links. */
.open {
  position: absolute;
  inset: 0;
  border: 0;
  padding: 0;
  background: transparent;
  border-radius: 12px;
  cursor: pointer;
}

.title {
  position: relative;
  pointer-events: none;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
}

.chips {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0 4px;
}

.meta {
  position: relative;
  pointer-events: none;
  color: var(--ink-muted);
  font-size: 11px;
}
</style>
