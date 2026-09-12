<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import type { Board, Session, StateWord } from '../../shared/types'
import SessionCard from './components/SessionCard.vue'
import UsageBar from './components/UsageBar.vue'
import { clock, STATE_CLASS, STATE_ORDER } from './words'

const board = ref<Board>({ sessions: [], usage: [], at: 0 })
const filter = ref<StateWord | ''>('')
const search = ref('')
let stop: (() => void) | null = null

function wordsOf(session: Session): StateWord[] {
  return session.activity ? [session.activity, session.state] : [session.state]
}

const counts = computed(() => {
  const tally = new Map<StateWord, number>()
  for (const session of board.value.sessions) {
    for (const word of wordsOf(session)) tally.set(word, (tally.get(word) ?? 0) + 1)
  }
  return STATE_ORDER.filter((word) => tally.has(word)).map((word) => ({
    word,
    count: tally.get(word) ?? 0
  }))
})

const shown = computed(() => {
  const needle = search.value.trim().toLowerCase()
  return board.value.sessions.filter((session) => {
    if (filter.value && !wordsOf(session).includes(filter.value)) return false
    if (!needle) return true
    return [session.headline, session.place, session.issue?.label, session.change?.label]
      .filter((text): text is string => Boolean(text))
      .some((text) => text.toLowerCase().includes(needle))
  })
})

function pick(word: StateWord | ''): void {
  filter.value = filter.value === word ? '' : word
}

onMounted(async () => {
  board.value = await window.api.board()
  stop = window.api.onBoard((next) => {
    board.value = next
  })
})

onUnmounted(() => stop?.())
</script>

<template>
  <div class="shell">
    <header class="drag">
      <h1>Claude session</h1>
      <span class="stamp">{{ board.at ? `naposledy ${clock(board.at)}` : 'načítá se' }}</span>
    </header>

    <UsageBar :windows="board.usage" />

    <nav class="filters">
      <button :class="['chip', { on: filter === '' }]" @click="pick('')">
        vše <b>{{ board.sessions.length }}</b>
      </button>
      <button
        v-for="row in counts"
        :key="row.word"
        :class="['chip', STATE_CLASS[row.word], { on: filter === row.word }]"
        @click="pick(row.word)"
      >
        {{ row.word }} <b>{{ row.count }}</b>
      </button>
      <input v-model="search" class="search" type="search" placeholder="hledat" />
    </nav>

    <ul class="sessions">
      <SessionCard v-for="session in shown" :key="session.id" :session="session" />
      <li v-if="shown.length === 0" class="empty">Nic, co by sedělo.</li>
    </ul>
  </div>
</template>

<style scoped>
.shell {
  max-width: 980px;
  margin: 0 auto;
  padding: 24px 20px 28px;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding-top: 14px;
  margin-bottom: 16px;
}

h1 {
  font-size: 21px;
  letter-spacing: -0.02em;
  margin: 0;
}

.stamp {
  color: var(--ink-muted);
  font-size: 11px;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-bottom: 12px;
}

.filters button {
  cursor: pointer;
}

.filters button b {
  font-weight: 700;
  opacity: 0.65;
  margin-left: 4px;
}

.filters button.on {
  box-shadow: inset 0 0 0 1.5px currentColor;
}

.search {
  margin-left: auto;
  border: 1px solid var(--rule);
  background: var(--surface);
  color: var(--ink);
  border-radius: 9999px;
  padding: 3px 12px;
  font: inherit;
  font-size: 11px;
  width: 150px;
}

.search:focus {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.sessions {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 8px;
}

.empty {
  color: var(--ink-muted);
  padding: 16px 2px;
}
</style>
