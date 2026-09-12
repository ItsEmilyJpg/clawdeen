<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import type { Board, Session, StateWord } from '../../shared/types'
import ChatPane from './components/ChatPane.vue'
import SessionCard from './components/SessionCard.vue'
import UsageBar from './components/UsageBar.vue'
import { clock, inWords, LANES, STATE_CLASS, STATE_ORDER } from './words'

type Filter = StateWord | 'pinned' | ''

const board = ref<Board>({ sessions: [], usage: [], order: [], today: [], at: 0 })
const filter = ref<Filter>('')
const search = ref('')
const dragged = ref<string | null>(null)
const reading = ref<string | null>(null)
const field = ref<HTMLInputElement | null>(null)
const ticking = ref(false)
/** One rule for the whole board: compact by default, everything spelled out when expanded. */
const expanded = ref(remembered('expanded') === '1')
/** Two ways to read the same board: the order she arranged, or the workflow the states make. */
const workflow = ref(remembered('workflow') === '1')
let stop: (() => void) | null = null

function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function keep(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0')
  } catch {
    // A window that cannot remember the choice still honours it for as long as it is open.
  }
}

/** The workflow board, in lanes: what waits on her first, what is only queueing last. */
const lanes = computed(() =>
  LANES.map((lane) => ({
    ...lane,
    sessions: shown.value.filter((session) =>
      lane.word ? session.activity === lane.word : session.activity === null
    )
  })).filter((lane) => lane.sessions.length > 0)
)

function wide(): void {
  expanded.value = !expanded.value
  keep('expanded', expanded.value)
}

function lanesOrList(): void {
  workflow.value = !workflow.value
  keep('workflow', workflow.value)
}

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

const pinned = computed(() => board.value.sessions.filter((session) => session.pinned).length)

const shown = computed(() => {
  const needle = search.value.trim().toLowerCase()
  return board.value.sessions.filter((session) => {
    if (filter.value === 'pinned' && !session.pinned) return false
    if (filter.value && filter.value !== 'pinned' && !wordsOf(session).includes(filter.value)) {
      return false
    }
    if (!needle) return true
    return [session.headline, session.place, session.issue?.label, session.change?.label]
      .filter((text): text is string => Boolean(text))
      .some((text) => text.toLowerCase().includes(needle))
  })
})

function pick(word: Filter): void {
  filter.value = filter.value === word ? '' : word
}

/** Dropping writes the whole visible order, so what she arranged is what she gets back. */
function drop(onto: Session): void {
  const held = dragged.value
  dragged.value = null
  if (!held || held === onto.id) return
  const ids = board.value.sessions.map((session) => session.id)
  const from = ids.indexOf(held)
  const to = ids.indexOf(onto.id)
  if (from === -1 || to === -1) return
  ids.splice(to, 0, ...ids.splice(from, 1))
  board.value = { ...board.value, sessions: ids.map((id) => byId(id)!), order: ids }
  void window.api.order(ids)
}

function byId(id: string): Session | undefined {
  return board.value.sessions.find((session) => session.id === id)
}

function forget(): void {
  board.value = { ...board.value, order: [] }
  void window.api.order([])
}

const read = computed(
  () => board.value.sessions.find((session) => session.id === reading.value) ?? null
)

/** The board is driven from the keyboard too: the search field is a shortcut away, escape clears it. */
function onKey(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
    event.preventDefault()
    field.value?.focus()
    field.value?.select()
    return
  }
  if (event.key === 'Escape' && !reading.value && search.value) {
    search.value = ''
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  board.value = await window.api.board()
  stop = window.api.onBoard((next) => {
    board.value = next
  })
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  stop?.()
})
</script>

<template>
  <div class="shell">
    <header class="bar drag">
      <h1>Claude session</h1>
      <UsageBar v-if="!expanded" :windows="board.usage" compact />
      <button class="stamp" title="Vteřiny" @click="ticking = !ticking">
        {{ board.at ? `naposledy ${clock(board.at, ticking)}` : 'načítá se' }}
      </button>
      <button
        class="wider"
        :title="workflow ? 'Seřadit, jak jsi to nechala' : 'Seřadit podle stavu'"
        @click="lanesOrList()"
      >
        {{ workflow ? '≡' : '⑃' }}
      </button>
      <button class="wider" :title="expanded ? 'Zúžit' : 'Rozšířit'" @click="wide()">
        {{ expanded ? '⌃' : '⌄' }}
      </button>
    </header>

    <UsageBar v-if="expanded" :windows="board.usage" />

    <p v-if="board.today.length > 0" class="today">
      <span class="what">dnes</span>
      <span
        v-for="spell in board.today"
        :key="spell.word"
        :class="['chip', STATE_CLASS[spell.word]]"
      >
        {{ spell.word }} {{ inWords(spell.seconds) }}
      </span>
    </p>

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
      <button
        v-if="pinned > 0"
        :class="['chip', 'pin', { on: filter === 'pinned' }]"
        @click="pick('pinned')"
      >
        připnuté <b>{{ pinned }}</b>
      </button>
      <button v-if="board.order.length > 0" class="chip undo" @click="forget()">
        vlastní pořadí ×
      </button>
      <input ref="field" v-model="search" class="search" type="search" placeholder="hledat  ⌘F" />
    </nav>

    <template v-if="workflow">
      <section v-for="lane in lanes" :key="lane.title" class="lane">
        <h2 :class="lane.word ? STATE_CLASS[lane.word] : ''">
          {{ lane.title }} <b>{{ lane.sessions.length }}</b>
        </h2>
        <ul :class="['sessions', expanded ? 'expanded' : 'compact']">
          <SessionCard
            v-for="session in lane.sessions"
            :key="session.id"
            :session="session"
            :dragging="false"
            @peek="reading = session.id"
          />
        </ul>
      </section>
      <p v-if="lanes.length === 0" class="empty">Nic, co by sedělo.</p>
    </template>

    <ul v-else :class="['sessions', expanded ? 'expanded' : 'compact']">
      <SessionCard
        v-for="session in shown"
        :key="session.id"
        :session="session"
        :dragging="dragged === session.id"
        @grab="dragged = session.id"
        @drop="drop(session)"
        @peek="reading = session.id"
      />
      <li v-if="shown.length === 0" class="empty">Nic, co by sedělo.</li>
    </ul>

    <ChatPane :session="read" @close="reading = null" />
  </div>
</template>

<style scoped>
.shell {
  max-width: 980px;
  margin: 0 auto;
  padding: 0 20px 28px;
}

/*
 * The window has no title bar of its own, so this strip is it: tall enough to grab, sticky so it
 * stays grabbable however far the board is scrolled, and indented past the traffic lights.
 */
.bar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  /* A rail down the side of the screen is half the width of a window, so the bar gives way. */
  flex-wrap: wrap;
  row-gap: 4px;
  column-gap: 18px;
  min-height: 52px;
  padding-top: 8px;
  padding-bottom: 8px;
  margin: 0 -20px 14px;
  padding-right: 20px;
  padding-left: 88px;
  background: var(--ground);
  border-bottom: 1px solid var(--rule);
}

h1 {
  font-size: 17px;
  letter-spacing: -0.01em;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.stamp {
  border: 0;
  background: transparent;
  padding: 0;
  font: inherit;
  color: var(--ink-muted);
  font-size: 11px;
  margin-left: auto;
  white-space: nowrap;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}

.today {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 0 0 12px;
}

.today .what {
  color: var(--ink-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-right: 2px;
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

.sessions.compact {
  gap: 5px;
}

.wider {
  border: 0;
  border-radius: 9999px;
  width: 24px;
  height: 24px;
  font: inherit;
  font-size: 13px;
  line-height: 1;
  background: var(--muted-soft);
  color: var(--ink-muted);
  cursor: pointer;
}

.empty {
  color: var(--ink-muted);
  padding: 16px 2px;
}

.lane + .lane {
  margin-top: 16px;
}

.lane h2.s-waiting {
  color: var(--warn);
}

.lane h2.s-working {
  color: var(--ok);
}

.lane h2.s-task,
.lane h2.s-gate {
  color: var(--info);
}

.lane h2 {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0 0 6px 2px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-muted);
  background: none;
}

.lane h2 b {
  opacity: 0.6;
}
</style>
