<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'

import type { Board, ProjectMark, Session, StateWord, ThemeMode } from '../../shared/types'
import ChatPane from './components/ChatPane.vue'
import SessionCard from './components/SessionCard.vue'
import SessionDetail from './components/SessionDetail.vue'
import UsageBar from './components/UsageBar.vue'
import { clock, inLane, inWords, LANES, STATE_CLASS, STATE_ORDER } from './words'

type Filter = StateWord | 'pinned' | ''

const board = ref<Board>({ sessions: [], usage: [], order: [], today: [], at: 0 })
const filter = ref<Filter>('')
const search = ref('')
const dragged = ref<string | null>(null)
const reading = ref<string | null>(null)
/** Which card is unfolded and where it sat when it was: the sheet opens over its own row. */
const opened = ref<{ id: string; left: number; top: number } | null>(null)
const field = ref<HTMLInputElement | null>(null)
/** Seconds on the clock: a choice like the others, and it outlives the window like the others. */
const ticking = ref(remembered('ticking') === '1')
/** One rule for the whole board: compact by default, everything spelled out when expanded. */
const expanded = ref(remembered('expanded') === '1')
/** Two ways to read the same board: the order she arranged, or the workflow the states make. */
const workflow = ref(remembered('workflow') === '1')
const PROJECT_MARKS: { value: ProjectMark; label: string }[] = [
  { value: 'stripe', label: 'barevný proužek' },
  { value: 'name', label: 'jméno repozitáře' },
  { value: 'none', label: 'nic' }
]

function projectMark(kept: string | null): ProjectMark {
  return PROJECT_MARKS.some((mark) => mark.value === kept) ? (kept as ProjectMark) : 'stripe'
}

const project = ref<ProjectMark>(projectMark(remembered('project')))
const THEMES: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'podle systému' },
  { value: 'light', label: 'světlý' },
  { value: 'dark', label: 'tmavý' }
]

function themeMode(kept: string | null): ThemeMode {
  return THEMES.some((mode) => mode.value === kept) ? (kept as ThemeMode) : 'system'
}

const theme = ref<ThemeMode>(themeMode(remembered('theme')))
const settings = ref(false)
/** The cog and its menu, so a click can be told from a click outside them. */
const cog = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)
/** How far the menu had to be pushed to stay inside the window, in pixels. */
const nudge = ref(0)
/** What the menu keeps between itself and the edge of the window. */
const EDGE = 8
let stop: (() => void) | null = null

function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function keep(key: string, on: boolean): void {
  keepWord(key, on ? '1' : '0')
}

function keepWord(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // A window that cannot remember the choice still honours it for as long as it is open.
  }
}

/** Every word a lane of its own carries, so the last lane knows what is left over. */
const LANED = new Set(LANES.map((lane) => lane.word).filter(Boolean))

/**
 * The workflow board, in lanes: what waits on her first, what is only queueing last. The last lane
 * takes a session with no state and a session whose state has no lane alike, because a word that
 * belongs nowhere took the row off the board entirely.
 */
const lanes = computed(() =>
  LANES.map((lane) => ({
    ...lane,
    sessions: shown.value
      .filter((session) =>
        lane.word ? session.activity === lane.word : !LANED.has(session.activity)
      )
      .sort(inLane(board.value.order))
  })).filter((lane) => lane.sessions.length > 0)
)

function wide(): void {
  expanded.value = !expanded.value
  keep('expanded', expanded.value)
}

function orderBy(state: boolean): void {
  workflow.value = state
  keep('workflow', state)
}

function tick(on: boolean): void {
  ticking.value = on
  keep('ticking', on)
}

// The menu holds more than one choice now, so a choice no longer closes it: she is as likely to be
// there to change two things as one, and the ways out are the cog, escape and a click outside.
function markProject(mark: ProjectMark): void {
  project.value = mark
  keepWord('project', mark)
}

/**
 * The page switches on `color-scheme`, which `system` leaves to the operating system, so her choice
 * is an attribute on the root and nothing else. The window frame is told separately, because the
 * traffic lights are not the page's to draw.
 */
function paint(mode: ThemeMode): void {
  if (mode === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = mode
  void window.api.theme(mode)
}

function wear(mode: ThemeMode): void {
  theme.value = mode
  keepWord('theme', mode)
  paint(mode)
}

// Before the first paint rather than on mount: a window that starts light and turns dark a frame
// later is worse than either.
paint(theme.value)

/**
 * The menu hangs off the cog, and the cog is not always on the right: a narrow window wraps the
 * header and drops it to the second row, where a menu aligned to its right edge starts outside the
 * window. Measured at 420 pixels it began 48 to the left of it. So it is measured once it is drawn
 * and pushed back in.
 */
async function openSettings(): Promise<void> {
  settings.value = !settings.value
  if (!settings.value) return
  nudge.value = 0
  await nextTick()
  const box = menu.value?.getBoundingClientRect()
  if (box && box.left < EDGE) nudge.value = Math.round(EDGE - box.left)
}

/** A click anywhere but inside the menu closes it, which is what a menu that stays open needs. */
function outside(event: MouseEvent): void {
  if (!settings.value) return
  const target = event.target as Node | null
  if (target && !cog.value?.contains(target)) settings.value = false
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

/** A session that has dropped off the board takes its sheet with it rather than freezing it open. */
const unfolded = computed(() =>
  opened.value ? (board.value.sessions.find((one) => one.id === opened.value?.id) ?? null) : null
)

/** The chat is the other pane, not a second layer over this one, so unfolding gives way to it. */
function toTheChat(id: string): void {
  opened.value = null
  reading.value = id
}

/** The board is driven from the keyboard too: the search field is a shortcut away, escape clears it. */
function onKey(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
    event.preventDefault()
    field.value?.focus()
    field.value?.select()
    return
  }
  if (event.key !== 'Escape') return
  // The menu is the innermost thing open, so escape closes it before it reaches anything else.
  if (settings.value) {
    settings.value = false
    return
  }
  if (!reading.value && !opened.value && search.value) search.value = ''
}

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('click', outside)
  board.value = await window.api.board()
  stop = window.api.onBoard((next) => {
    board.value = next
  })
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('click', outside)
  stop?.()
})
</script>

<template>
  <div class="shell">
    <header class="bar drag">
      <h1>Claude session</h1>
      <UsageBar v-if="!expanded" :windows="board.usage" compact />
      <!-- One group, so a window too narrow for the bar wraps the whole of it rather than
           stranding the cog on a row of its own. -->
      <div class="tools">
        <button class="stamp" title="Vteřiny" @click="tick(!ticking)">
          {{ board.at ? `naposledy ${clock(board.at, ticking)}` : 'načítá se' }}
        </button>
        <button class="wider" :title="expanded ? 'Zúžit' : 'Rozšířit'" @click="wide()">
          {{ expanded ? '⌃' : '⌄' }}
        </button>
        <div ref="cog" class="settings">
          <button class="wider" title="Nastavení" @click="openSettings()">⚙</button>
          <div
            v-if="settings"
            ref="menu"
            class="menu"
            :style="{ transform: `translateX(${nudge}px)` }"
          >
            <p class="what">Řazení</p>
            <button :class="['choice', { on: !workflow }]" @click="orderBy(false)">
              jak jsi to nechala
            </button>
            <button :class="['choice', { on: workflow }]" @click="orderBy(true)">
              podle stavu
            </button>
            <p class="what">Čas</p>
            <button :class="['choice', { on: !ticking }]" @click="tick(false)">minuty</button>
            <button :class="['choice', { on: ticking }]" @click="tick(true)">vteřiny</button>
            <p class="what">Vzhled</p>
            <button
              v-for="mode in THEMES"
              :key="mode.value"
              :class="['choice', { on: theme === mode.value }]"
              @click="wear(mode.value)"
            >
              {{ mode.label }}
            </button>
            <p class="what">Projekt na kartě</p>
            <button
              v-for="mark in PROJECT_MARKS"
              :key="mark.value"
              :class="['choice', { on: project === mark.value }]"
              @click="markProject(mark.value)"
            >
              {{ mark.label }}
            </button>
            <p class="what">Vlastní pořadí</p>
            <button class="choice" :disabled="board.order.length === 0" @click="forget()">
              {{ board.order.length > 0 ? 'zapomenout' : 'žádné není' }}
            </button>
          </div>
        </div>
      </div>
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
            laned
            :project="project"
            @peek="reading = session.id"
            @detail="opened = { id: session.id, ...$event }"
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
        :project="project"
        @grab="dragged = session.id"
        @drop="drop(session)"
        @peek="reading = session.id"
        @detail="opened = { id: session.id, ...$event }"
      />
      <li v-if="shown.length === 0" class="empty">Nic, co by sedělo.</li>
    </ul>

    <ChatPane :session="read" @close="reading = null" />

    <SessionDetail
      v-if="unfolded && opened"
      :session="unfolded"
      :left="opened.left"
      :top="opened.top"
      @close="opened = null"
      @chat="toTheChat(unfolded.id)"
    />
  </div>
</template>

<style scoped>
/* Wide enough that a long name is read rather than guessed: the columns beside it are fixed, so
   every pixel a wider window gives goes to the one thing that tells the rows apart. */
.shell {
  max-width: 1400px;
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

.tools {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}

.stamp {
  border: 0;
  background: transparent;
  padding: 0;
  font: inherit;
  color: var(--ink-muted);
  font-size: 11px;
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

.settings {
  position: relative;
}

/* The menu hangs off the bar rather than sitting in it, because the bar has no width to spare. */
.menu {
  position: absolute;
  top: 30px;
  right: 0;
  z-index: 6;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
  min-width: 160px;
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: 10px;
  box-shadow: var(--shadow-card);
}

.menu .what {
  margin: 0 0 4px;
  padding: 0 6px;
  color: var(--faint);
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

/* Every section but the first stands off the choices above it, or the menu reads as one long list. */
.menu .what:not(:first-child) {
  margin-top: 10px;
}

.choice {
  border: 0;
  border-radius: 6px;
  padding: 5px 6px;
  font: inherit;
  font-size: 12px;
  text-align: left;
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
}

.choice:hover {
  background: var(--hover);
}

.choice:disabled {
  color: var(--faint);
  background: transparent;
  cursor: default;
}

.choice.on {
  background: var(--accent-soft);
  color: var(--accent);
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
.lane h2.s-gate,
.lane h2.s-running {
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
