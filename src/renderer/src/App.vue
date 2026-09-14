<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'

import { hiddenTally, movedProject, visible } from '../../shared/projects'
import type { Board, Locale, ProjectMark, Session, StateWord, ThemeMode } from '../../shared/types'
import ChatPane from './components/ChatPane.vue'
import SessionCard from './components/SessionCard.vue'
import SessionDetail from './components/SessionDetail.vue'
import UsageBar from './components/UsageBar.vue'
import {
  clock,
  inLane,
  inWords,
  LANE_WORDS,
  laneRows,
  refreshVerdict,
  say,
  setLocale,
  stateWord,
  STATE_CLASS,
  STATE_ORDER
} from './words'

type Filter = StateWord | 'pinned' | ''

const board = ref<Board>({
  sessions: [],
  usage: [],
  spend: null,
  order: [],
  today: [],
  at: 0,
  locale: 'en',
  projects: [],
  projectOrder: [],
  hidden: []
})
/** Set while she is looking behind the filter, so a glance costs nothing and settles nothing. */
const revealing = ref(false)
const filter = ref<Filter>('')
const search = ref('')
const dragged = ref<string | null>(null)
const reading = ref<string | null>(null)
/** Which card is unfolded and where it sat when it was: the sheet opens over its own row. */
const opened = ref<{ id: string; left: number; top: number } | null>(null)
/**
 * Which row has its menu open, by session rather than by row.
 *
 * The row cannot hold this. A board lands roughly four hundred milliseconds after any session on
 * the machine writes a line, and the row it draws is reordered, in workflow moved between lanes and
 * there rebuilt from nothing. Held in the row, the menu went with it: measured in the running
 * window, open, then gone inside the next sweep without the mouse having moved.
 */
const acting = ref<string | null>(null)

/** One menu at a time, and the dot that opened it closes it again. */
function toggleActs(id: string): void {
  acting.value = acting.value === id ? null : id
}
const field = ref<HTMLInputElement | null>(null)
/** Seconds on the clock: a choice like the others, and it outlives the window like the others. */
const ticking = ref(remembered('ticking') === '1')
/**
 * Whether the header spells the usage windows out. It used to unfold the cards as well, and an
 * unfolded card said nothing a row does not: the same words, over three lines instead of one.
 */
const expanded = ref(remembered('expanded') === '1')
/**
 * Two ways to read the same board: the order she arranged, or the workflow the states make. The
 * workflow is the default, so an unopened board already answers what is waiting and what is not.
 */
const workflow = ref(remembered('workflow') !== '0')
/**
 * Whether the card of the session open in the app is outlined. Off unless she has asked for it:
 * the app writes its focus one to three and a half seconds after the click, so the outline sits on
 * the wrong card for that long, and a mark that is wrong some of the time is worse than none.
 */
const markFocus = ref(remembered('markFocus') === '1')
const MARK_VALUES: ProjectMark[] = ['stripe', 'name', 'none']
const MARK_KEYS = { stripe: 'choiceStripe', name: 'choiceRepoName', none: 'choiceNothing' } as const
// Read rather than stored, because the language can change under a window that is already open.
const projectMarks = computed(() =>
  MARK_VALUES.map((value) => ({ value, label: say(MARK_KEYS[value]) }))
)

function projectMark(kept: string | null): ProjectMark {
  // The name rather than the stripe: a colour has to be learned, a name is read straight off.
  return MARK_VALUES.some((value) => value === kept) ? (kept as ProjectMark) : 'name'
}

const project = ref<ProjectMark>(projectMark(remembered('project')))
/**
 * Which columns a row draws. Every one of them is on until she switches it off, because a board
 * that hides something by default hides it from someone who never learns it was there.
 *
 * They are kept in the page rather than with the repositories: what a row shows is about this
 * window, and the tray and the notifications have no columns to speak of.
 */
const COLUMN_KEYS = ['tags', 'doing', 'state', 'meta'] as const
type ColumnKey = (typeof COLUMN_KEYS)[number]
const COLUMN_LABELS = {
  tags: 'columnTags',
  doing: 'columnDoing',
  state: 'columnState',
  meta: 'columnMeta'
} as const
const columns = ref<ColumnKey[]>(COLUMN_KEYS.filter((key) => remembered(`column-${key}`) !== '0'))
const columnRow = computed(() =>
  COLUMN_KEYS.map((key) => ({
    key,
    label: say(COLUMN_LABELS[key]),
    on: columns.value.includes(key)
  }))
)

function showColumn(key: ColumnKey, on: boolean): void {
  columns.value = on
    ? [...COLUMN_KEYS.filter((one) => one === key || columns.value.includes(one))]
    : columns.value.filter((one) => one !== key)
  keep(`column-${key}`, on)
}

/** The classes a switched-off column leaves on the list, which is where the grid reads them. */
const columnClass = computed(() =>
  COLUMN_KEYS.filter((key) => !columns.value.includes(key)).map((key) => `no-${key}`)
)
const THEME_VALUES: ThemeMode[] = ['system', 'light', 'dark']
const THEME_KEYS = { system: 'choiceSystem', light: 'choiceLight', dark: 'choiceDark' } as const
const themes = computed(() =>
  THEME_VALUES.map((value) => ({ value, label: say(THEME_KEYS[value]) }))
)

function themeMode(kept: string | null): ThemeMode {
  return THEME_VALUES.some((value) => value === kept) ? (kept as ThemeMode) : 'system'
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
const LANED = new Set(LANE_WORDS.filter(Boolean))

/**
 * The workflow board, in lanes: what waits on her first, what is only queueing last. The last lane
 * takes a session with no state and a session whose state has no lane alike, because a word that
 * belongs nowhere took the row off the board entirely.
 */
const lanes = computed(() =>
  laneRows()
    .map((lane) => ({
      ...lane,
      sessions: shown.value
        .filter((session) =>
          lane.word ? session.activity === lane.word : !LANED.has(session.activity)
        )
        .sort(inLane(board.value.order, board.value.projectOrder))
    }))
    .filter((lane) => lane.sessions.length > 0)
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

function markFocusing(on: boolean): void {
  markFocus.value = on
  keep('markFocus', on)
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

/**
 * The language is the one choice the page does not keep itself: the tray and the menus are drawn by
 * the main process in the same language, so it is settled there and comes back with the next board.
 */
function speak(next: Locale): void {
  void window.api.locale(next)
}

/** Switching a repository off hides it here and changes nothing about the tray or the ringing. */
function showProject(project: string, shown: boolean): void {
  void window.api.hide(project, shown)
}

/** Which repository is being dragged in the settings, so the one under the hand can say so. */
const heldProject = ref<string | null>(null)

/**
 * Dropping one repository onto another writes the whole list, and the lanes read the same list.
 *
 * The board is moved here rather than waited for: the main process answers with a new one, but a
 * menu that only reorders once the disk has replied feels like it did not take the drag.
 */
function dropProject(onto: string): void {
  const held = heldProject.value
  heldProject.value = null
  if (!held || held === onto) return
  const names = movedProject(board.value.projects, held, onto)
  if (names === board.value.projects) return
  board.value = { ...board.value, projects: names, projectOrder: names }
  void window.api.projects(names)
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
  // The dot and the two entries under it stop their own clicks, so whatever reaches the window is
  // somewhere else on the board, and somewhere else is what closes a row's menu.
  acting.value = null
  if (!settings.value) return
  const target = event.target as Node | null
  if (target && !cog.value?.contains(target)) settings.value = false
}

/**
 * The wall clock, ticking on its own rather than with the board.
 *
 * A board that has stopped being read stops sending anything at all, so nothing else on the page
 * would move again either: the moment it printed would sit there looking current. This is what
 * lets the window notice the silence.
 */
const now = ref(Date.now() / 1000)
let clockTick: ReturnType<typeof setInterval> | null = null

/** Green while the board is being swept, amber once a sweep has been missed, red when they stop. */
const pulse = computed(() => (board.value.at ? refreshVerdict(board.value.at, now.value) : ''))

const PULSE_KEYS = { ok: 'pulseLive', warn: 'pulseSlow', danger: 'pulseDead' } as const

/** What the time says when it is asked: when it was read, and whether it is still being read. */
const stampTitle = computed(() => {
  const seconds = say('secondsTitle')
  if (!pulse.value) return seconds
  return `${say(PULSE_KEYS[pulse.value], inWords(now.value - board.value.at))} · ${seconds}`
})

function wordsOf(session: Session): StateWord[] {
  return session.activity ? [session.activity, session.state] : [session.state]
}

/**
 * What the window has to work with: everything, less the repositories switched off, unless she is
 * looking behind the filter right now. Every count on the board reads this rather than the board
 * itself, so the chips, the lanes and the search all agree about what is there.
 */
const pool = computed(() =>
  revealing.value ? board.value.sessions : visible(board.value.sessions, board.value.hidden)
)

/** What is behind the filter, which the board says out loud rather than leaving as a gap. */
const behind = computed(() => hiddenTally(board.value.sessions, board.value.hidden))

const counts = computed(() => {
  const tally = new Map<StateWord, number>()
  for (const session of pool.value) {
    for (const word of wordsOf(session)) tally.set(word, (tally.get(word) ?? 0) + 1)
  }
  return STATE_ORDER.filter((word) => tally.has(word)).map((word) => ({
    word,
    count: tally.get(word) ?? 0
  }))
})

const pinned = computed(() => pool.value.filter((session) => session.pinned).length)

const shown = computed(() => {
  const needle = search.value.trim().toLowerCase()
  return pool.value.filter((session) => {
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
  acting.value = null
  reading.value = id
}

/** What the menu was opened for is now on the screen, so the menu itself has nothing left to say. */
function unfold(id: string, spot: { left: number; top: number }): void {
  acting.value = null
  opened.value = { id, ...spot }
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
  if (acting.value) {
    acting.value = null
    return
  }
  if (settings.value) {
    settings.value = false
    return
  }
  if (!reading.value && !opened.value && search.value) search.value = ''
}

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('click', outside)
  // Five seconds: the colour it decides only changes at 45 and 90, so this is as often as it can
  // matter, and the page redraws one dot rather than a board.
  clockTick = setInterval(() => (now.value = Date.now() / 1000), 5000)
  const first = await window.api.board()
  // The language comes with the board: the page keeps no settings of its own, and every word it
  // draws is looked up at render time, so setting it before the assignment is what the view sees.
  setLocale(first.locale)
  board.value = first
  stop = window.api.onBoard((next) => {
    setLocale(next.locale)
    board.value = next
    // A board that has just arrived is green this instant, not at the next tick of the clock.
    now.value = Date.now() / 1000
  })
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('click', outside)
  if (clockTick) clearInterval(clockTick)
  stop?.()
})
</script>

<template>
  <div class="shell">
    <header class="bar drag">
      <h1>Clawdeen</h1>
      <UsageBar v-if="!expanded" :windows="board.usage" :spend="board.spend" compact />
      <!-- One group, so a window too narrow for the bar wraps the whole of it rather than
           stranding the cog on a row of its own. -->
      <div class="tools">
        <!-- The dot of a card, on the one number that says when all the others were read: green
             while the board is still being swept, red once it has stopped. -->
        <button class="stamp" :title="stampTitle" @click="tick(!ticking)">
          <span v-if="pulse" :class="['pulse', pulse]" />
          {{ board.at ? say('lastAt', clock(board.at, ticking)) : say('loading') }}
        </button>
        <button class="wider" :title="expanded ? say('narrow') : say('widen')" @click="wide()">
          {{ expanded ? '⌃' : '⌄' }}
        </button>
        <div ref="cog" class="settings">
          <button class="wider" :title="say('settingsTitle')" @click="openSettings()">⚙</button>
          <div
            v-if="settings"
            ref="menu"
            class="menu"
            :style="{ transform: `translateX(${nudge}px)` }"
          >
            <p class="head">{{ say('settingsTitle') }}</p>

            <div class="row">
              <span class="label">{{ say('groupSorting') }}</span>
              <div class="seg">
                <button :class="['seg-item', { on: workflow }]" @click="orderBy(true)">
                  {{ say('orderByState') }}
                </button>
                <button :class="['seg-item', { on: !workflow }]" @click="orderBy(false)">
                  {{ say('orderAsLeft') }}
                </button>
              </div>
            </div>

            <div v-if="board.projects.length > 1" class="row stacked">
              <span class="label">{{ say('groupProjects') }}</span>
              <!-- A click switches a repository off, a drag moves it: the same button does both, so
                   the order she reads them in is the order the lanes put their cards in. -->
              <div class="projects" :title="say('dragProjects')">
                <button
                  v-for="name in board.projects"
                  :key="name"
                  :class="[
                    'seg-item',
                    { on: !board.hidden.includes(name), dragging: heldProject === name }
                  ]"
                  draggable="true"
                  @click="showProject(name, board.hidden.includes(name))"
                  @dragstart="heldProject = name"
                  @dragend="heldProject = null"
                  @dragover.prevent
                  @drop.prevent="dropProject(name)"
                >
                  {{ name }}
                </button>
              </div>
            </div>

            <div class="row stacked">
              <span class="label">{{ say('groupColumns') }}</span>
              <div class="projects">
                <button
                  v-for="column in columnRow"
                  :key="column.key"
                  :class="['seg-item', { on: column.on }]"
                  @click="showColumn(column.key, !column.on)"
                >
                  {{ column.label }}
                </button>
              </div>
            </div>

            <div class="row">
              <span class="label">{{ say('groupProject') }}</span>
              <div class="seg">
                <button
                  v-for="mark in projectMarks"
                  :key="mark.value"
                  :class="['seg-item', { on: project === mark.value }]"
                  @click="markProject(mark.value)"
                >
                  {{ mark.label }}
                </button>
              </div>
            </div>

            <div class="row">
              <span class="label">{{ say('groupAppearance') }}</span>
              <div class="seg">
                <button
                  v-for="mode in themes"
                  :key="mode.value"
                  :class="['seg-item', { on: theme === mode.value }]"
                  @click="wear(mode.value)"
                >
                  {{ mode.label }}
                </button>
              </div>
            </div>

            <div class="row">
              <span class="label">{{ say('groupTime') }}</span>
              <div class="seg">
                <button :class="['seg-item', { on: !ticking }]" @click="tick(false)">
                  {{ say('choiceMinutes') }}
                </button>
                <button :class="['seg-item', { on: ticking }]" @click="tick(true)">
                  {{ say('choiceSeconds') }}
                </button>
              </div>
            </div>

            <div class="row">
              <span class="label">{{ say('groupLanguage') }}</span>
              <div class="seg">
                <button :class="['seg-item', { on: board.locale === 'en' }]" @click="speak('en')">
                  {{ say('langEnglish') }}
                </button>
                <button :class="['seg-item', { on: board.locale === 'cs' }]" @click="speak('cs')">
                  {{ say('langCzech') }}
                </button>
              </div>
            </div>

            <div class="row" :title="say('focusWarning')">
              <span class="label">
                {{ say('groupActiveWindow') }} <span class="beta">beta</span>
              </span>
              <div class="seg">
                <button :class="['seg-item', { on: markFocus }]" @click="markFocusing(true)">
                  {{ say('choiceHighlight') }}
                </button>
                <button :class="['seg-item', { on: !markFocus }]" @click="markFocusing(false)">
                  {{ say('choiceUnmarked') }}
                </button>
              </div>
            </div>

            <div class="row last">
              <span class="label">{{ say('groupOwnOrder') }}</span>
              <button class="plain" :disabled="board.order.length === 0" @click="forget()">
                {{ board.order.length > 0 ? say('forget') : say('noOrder') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>

    <UsageBar v-if="expanded" :windows="board.usage" :spend="board.spend" />

    <p v-if="board.today.length > 0" class="today">
      <span class="what">{{ say('today') }}</span>
      <span
        v-for="spell in board.today"
        :key="spell.word"
        :class="['chip', STATE_CLASS[spell.word]]"
      >
        {{ stateWord(spell.word) }} {{ inWords(spell.seconds) }}
      </span>
    </p>

    <nav class="filters">
      <button :class="['chip', { on: filter === '' }]" @click="pick('')">
        {{ say('all') }} <b>{{ pool.length }}</b>
      </button>
      <button
        v-for="row in counts"
        :key="row.word"
        :class="['chip', STATE_CLASS[row.word], { on: filter === row.word }]"
        @click="pick(row.word)"
      >
        {{ stateWord(row.word) }} <b>{{ row.count }}</b>
      </button>
      <button
        v-if="pinned > 0"
        :class="['chip', 'pin', { on: filter === 'pinned' }]"
        @click="pick('pinned')"
      >
        {{ say('pinnedCount') }} <b>{{ pinned }}</b>
      </button>
      <button v-if="board.order.length > 0" class="chip undo" @click="forget()">
        {{ say('ownOrderUndo') }}
      </button>
      <!-- A hidden repository is not a silent one: what is behind the filter is said here, and what
           is waiting inside it is said first, because that is the thing hiding could have cost. -->
      <button
        v-if="behind.count > 0"
        :class="['chip', 'behind', { waiting: behind.waiting > 0, on: revealing }]"
        @click="revealing = !revealing"
      >
        <template v-if="revealing">{{ say('showingAll') }}</template>
        <template v-else>
          {{ say('hiddenCount', behind.count)
          }}<template v-if="behind.waiting > 0">
            · {{ say('hiddenWaiting', behind.waiting) }}</template
          >
        </template>
      </button>
      <input
        ref="field"
        v-model="search"
        class="search"
        type="search"
        :placeholder="say('searchPlaceholder')"
      />
    </nav>

    <template v-if="workflow">
      <section v-for="lane in lanes" :key="lane.title" class="lane">
        <h2 :class="lane.word ? STATE_CLASS[lane.word] : ''">
          {{ lane.title }} <b>{{ lane.sessions.length }}</b>
        </h2>
        <ul :class="['sessions', 'compact', columnClass]">
          <SessionCard
            v-for="session in lane.sessions"
            :key="session.id"
            :session="session"
            :dragging="false"
            laned
            :project="project"
            :mark-focus="markFocus"
            :acting="acting === session.id"
            @acts="toggleActs(session.id)"
            @peek="toTheChat(session.id)"
            @detail="unfold(session.id, $event)"
          />
        </ul>
      </section>
      <p v-if="lanes.length === 0" class="empty">{{ say('nothingMatches') }}</p>
    </template>

    <ul v-else :class="['sessions', 'compact', columnClass]">
      <SessionCard
        v-for="session in shown"
        :key="session.id"
        :session="session"
        :dragging="dragged === session.id"
        :project="project"
        :mark-focus="markFocus"
        :acting="acting === session.id"
        @grab="dragged = session.id"
        @drop="drop(session)"
        @acts="toggleActs(session.id)"
        @peek="toTheChat(session.id)"
        @detail="unfold(session.id, $event)"
      />
      <li v-if="shown.length === 0" class="empty">{{ say('nothingMatches') }}</li>
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
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

/* The same dot a card carries, at the size the header can hold. */
.pulse {
  width: 7px;
  height: 7px;
  border-radius: 9999px;
  flex: none;
}

.pulse.ok {
  background: var(--ok);
}

.pulse.warn {
  background: var(--warn);
}

.pulse.danger {
  background: var(--danger);
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
  min-width: 320px;
  padding: 6px;
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: 12px;
  box-shadow: var(--shadow-card);
}

.menu .head {
  margin: 0;
  padding: 6px 8px 10px;
  color: var(--faint);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

/* Label on the left, the control on the right: the eye runs down one column of labels, and a
   choice is never read as a heading the way it was when both were buttons in one stack. */
.menu .row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 8px;
}

.menu .row + .row {
  border-top: 1px solid var(--rule);
}

.menu .label {
  color: var(--ink-muted);
  font-size: 12px;
  white-space: nowrap;
}

/* Beside the label rather than on a choice: it is the whole setting that is not finished. */
.menu .beta {
  margin-left: 5px;
  padding: 0 4px;
  border: 1px solid var(--warn);
  border-radius: 4px;
  color: var(--warn);
  font-size: 9px;
  letter-spacing: 0.06em;
}

/* One sunken track holding the choices, so which of them is on is read without comparing colours. */
.seg {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  background: var(--hover);
  border-radius: 8px;
}

.seg-item {
  border: 0;
  border-radius: 6px;
  padding: 4px 9px;
  font: inherit;
  font-size: 11.5px;
  white-space: nowrap;
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
}

.seg-item:hover {
  color: var(--ink);
}

.seg-item.on {
  background: var(--accent-soft);
  color: var(--accent);
}

/* The one row that does something rather than choosing, so it reads as a button and not as a state. */
.plain {
  border: 1px solid var(--rule);
  border-radius: 7px;
  padding: 4px 10px;
  font: inherit;
  font-size: 11.5px;
  white-space: nowrap;
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
}

.plain:hover:not(:disabled) {
  background: var(--hover);
  color: var(--ink);
}

.plain:disabled {
  color: var(--faint);
  cursor: default;
}

/* The label sits above rather than beside it: a machine with eight repositories would otherwise
   push the list into a column two characters wide. */
.menu .row.stacked {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.projects {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 2px;
  background: var(--hover);
  border-radius: 8px;
}

/* The same half opacity a dragged card carries, so the two drags read as the one gesture. */
.projects .seg-item.dragging {
  opacity: 0.5;
}

/* Amber only while something waits behind the filter: the rest of the time it is a quiet count. */
.chip.behind {
  border: 1px dashed var(--rule);
  background: transparent;
  color: var(--ink-muted);
}

.chip.behind.waiting {
  border-color: var(--warn);
  color: var(--warn);
}

.chip.behind.on {
  border-style: solid;
  background: var(--accent-soft);
  border-color: transparent;
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
