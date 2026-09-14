<script setup lang="ts">
import { computed, ref } from 'vue'

import type { ProjectMark, Session } from '../../../shared/types'
import {
  ago,
  inWords,
  prClass,
  repoColour,
  say,
  stateLabel,
  stateWord,
  STATE_CLASS
} from '../words'

const props = defineProps<{
  session: Session
  dragging: boolean
  project: ProjectMark
  /** Whether the session open in the app is marked at all; off until she asks for it in the menu. */
  markFocus: boolean
  laned?: boolean
}>()
const emit = defineEmits<{
  grab: []
  drop: []
  peek: []
  detail: [spot: { left: number; top: number }]
}>()

const APP_SESSION = 'claude://code/continue?session='
const FAILED_SHOWN = 3
const TOO_LONG = 600
const CARRIED = new Set(['merged', 'closed', 'open', 'draft'])

/**
 * The sheet opens over the row it belongs to, so the row says where it is: the card is measured at
 * the moment of the click, because the board reorders itself underneath between sweeps.
 */
function expand(event: MouseEvent): void {
  const card = (event.currentTarget as HTMLElement).closest('.card')
  if (!card) return
  const at = card.getBoundingClientRect()
  emit('detail', { left: at.left, top: at.top })
}

/** Issue first, the change second, and where either is missing the grey word holds its place. */
const named = computed(() => {
  const session = props.session
  return [
    session.issue
      ? { label: session.issue.label, kind: 'issue', url: session.issue.url }
      : { label: say('noIssue'), kind: `${STATE_CLASS['no-pr']} spare` },
    ...(session.changes.length > 0
      ? session.changes.map((change) => ({
          label: change.label,
          kind: `pr ${prClass(change, session)}`,
          url: change.url
        }))
      : [{ label: stateWord(session.state), kind: `${STATE_CLASS[session.state]} spare` }])
  ]
})

/** Where the session and its change stand: the column on the right, or the tail of the one line. */
const standing = computed(() => {
  const session = props.session
  const rows: { label: string; kind: string; url?: string }[] = []
  // In a lane the heading is that word already, and the dot beside the row says it a third time, so
  // the chip is kept only where it carries something the lane cannot: how long, or what it waits on.
  if (session.activity) {
    const about = session.about ? ` · ${session.about}` : ''
    // How long says something about a task, and nothing at all about how long she has been the one
    // holding it up, so it only rides with the task states.
    const timed = session.since && session.activity !== 'waiting-for-you'
    const on = timed ? ` · ${inWords(Date.now() / 1000 - (session.since as number))}` : ''
    // A task that has been on for longer than this is not progress any more, it is a thing to look at.
    const hot = timed && Date.now() / 1000 - (session.since as number) > TOO_LONG ? ' hot' : ''
    const word = stateWord(session.activity)
    const label = word + about + on
    if (!props.laned || label !== word) {
      rows.push({ label, kind: STATE_CLASS[session.activity] + hot })
    }
  }
  if (session.extra) {
    rows.push({ label: stateWord(session.extra), kind: STATE_CLASS[session.extra] })
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

/** A row has no chip for the issue, so the number in front of the title is the only way to it. */
const markUrl = computed(() => props.session.issue?.url ?? props.session.change?.url ?? undefined)

/** The repository, which `place` carries in front of the worktree it also names. */
const repo = computed(() => props.session.place.split(' · ')[0] ?? '')

const dot = computed(() => (props.session.activity ? STATE_CLASS[props.session.activity] : ''))

const card = ref<HTMLLIElement | null>(null)

/**
 * Every beating dot on one clock. A CSS animation is timed from the moment it starts on its own
 * element, so dots that started at different moments beat out of step, and a delay computed off the
 * wall clock cannot close that: it is measured from the same private start. Moving the start onto
 * the document timeline, which every card on the page shares, is what lines them up.
 *
 * It hangs off `animationstart` because that is the one moment the alignment can be lost, and the
 * board restarts a beat for reasons the card cannot see: measured in the running window, a working
 * card had its animation begin again with neither a mount nor a change of state behind it.
 *
 * `subtree` is not optional here. The dot is a pseudo-element, and without it `getAnimations()`
 * returns nothing at all. Under `prefers-reduced-motion` there is no animation and no event either,
 * so nothing in here brings one back.
 */
function alignBeat(): void {
  const beat = card.value
    ?.getAnimations({ subtree: true })
    .find((a): a is CSSAnimation => a instanceof CSSAnimation && a.animationName.startsWith('beat'))
  if (beat) beat.startTime = 0
}

function open(url: string): void {
  void window.api.open(url)
}
</script>

<template>
  <li
    :class="[
      'card',
      dot,
      {
        active: session.active,
        pinned: session.pinned,
        focused: markFocus && session.focused,
        dragging
      }
    ]"
    ref="card"
    draggable="true"
    @animationstart="alignBeat"
    @dragstart="emit('grab')"
    @dragover.prevent
    @drop.prevent="emit('drop')"
  >
    <button class="open" :title="session.title" @click="open(APP_SESSION + session.id)" />
    <span
      v-if="project === 'stripe' && repo"
      class="stripe"
      :style="{ background: repoColour(repo) }"
      :title="repo"
    />
    <div class="left">
      <div class="title">
        <span v-if="project === 'name' && repo" class="repo">{{ repo }}</span>
        <a v-if="mark" class="number" :href="markUrl" @click.prevent="markUrl && open(markUrl)">{{
          mark
        }}</a
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
    <div class="acts">
      <button class="act" :title="say('cardDetail')" @click.stop="expand">detail</button>
      <button class="act" :title="say('readChat')" @click.stop="emit('peek')">chat</button>
    </div>
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

/* And what waits on her, in the colour of that state, so it is found without reading a word. */
.card.s-waiting {
  border-left: 3px solid var(--warn);
}

/* The session open in Claude, ringed rather than striped, because the stripe is already spoken for. */
.card.focused {
  border-color: var(--accent);
  box-shadow:
    var(--shadow-card),
    inset 0 0 0 1px var(--accent);
}

/*
 * Which project the card belongs to, down the right edge because the left one already carries what
 * she pinned and what waits on her. The name is in the tooltip, since a colour alone says nothing.
 */
.stripe {
  position: absolute;
  top: 8px;
  bottom: 8px;
  right: 0;
  width: 3px;
  border-radius: 3px 0 0 3px;
}

.repo {
  color: var(--faint);
  font-weight: 400;
  margin-right: 7px;
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
  text-decoration: none;
}

/* The title lets the card underneath have the click; the number keeps it where it leads somewhere. */
.number[href] {
  pointer-events: auto;
}

.number[href]:hover {
  color: var(--ink);
  text-decoration: underline;
}

/*
 * The row of chips has to sit above the card button for a link on it to be clickable, and that lifts
 * the whole box with it: the empty half of a 260 pixel column, the gaps between the chips, the strip
 * under a wrapped line. Measured in the running window that was a quarter of the card swallowing the
 * click and opening nothing. So the box is transparent and only a chip that leads somewhere takes
 * the click back; a chip with nowhere to go is a label, and the click on it belongs to the card.
 */
.chips {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  pointer-events: none;
}

.chip[href] {
  pointer-events: auto;
}

.meta {
  position: relative;
  pointer-events: none;
  color: var(--ink-muted);
  font-size: 11px;
}

/* The two things the card does besides opening the session: unfold what it knows, and read the chat. */
.acts {
  position: absolute;
  display: flex;
  gap: 4px;
  /* They belong to the row under the cursor, and the width they took on every other row belongs to
     the name. The keyboard still finds them, because focus counts as being there. */
  opacity: 0;
  transition: opacity 0.15s ease;
  /* The gap between the two, and the box around them while they are invisible, belong to the card. */
  pointer-events: none;
}

.act {
  pointer-events: auto;
  border: 0;
  border-radius: 9999px;
  padding: 2px 9px;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  background: var(--muted-soft);
  color: var(--ink-muted);
  cursor: pointer;
}

.act:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

.card:hover .acts,
.acts:focus-within {
  opacity: 1;
}

/*
 * The default is one line a session, laid out in columns so the board can be read straight down:
 * what it is, what it is on, where it stands, when it last moved. Every column ends in an ellipsis
 * rather than wrapping, because a row that grows a second line is no longer a row.
 */
.sessions.compact .card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px minmax(0, 260px) minmax(0, 170px);
  align-items: center;
  column-gap: 14px;
  padding: 8px 104px 8px 30px;
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

.sessions.compact .acts {
  top: 50%;
  right: 10px;
  transform: translateY(-50%);
}

/*
 * A narrow window drops what it can spare, and what it can spare is never the name: first where the
 * worktree is, then the words that only say something is absent, then the issue and the change, and
 * last the two controls. At 420 pixels the name used to be three letters and an ellipsis
 * while a state nobody had to read kept 240 of the 380.
 */
@media (max-width: 1000px) {
  .sessions.compact .card {
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 240px);
  }

  .sessions.compact .meta,
  .sessions.compact .chip.spare {
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

@media (max-width: 560px) {
  .sessions.compact .card {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  /* The state is allowed under half the row and not a pixel more; the rest is the name. */
  .sessions.compact .right .chips {
    max-width: 42vw;
  }
}

@media (max-width: 460px) {
  .sessions.compact .card {
    padding-right: 12px;
  }

  .sessions.compact .acts {
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
  /* The strip on the right is the controls', so the states column never runs underneath them. */
  padding: 12px 114px 12px 34px;
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

.sessions.expanded .acts {
  top: 10px;
  right: 10px;
}
</style>
