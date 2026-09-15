<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import type { Change, Session, Tokens } from '../../../shared/types'
import {
  ago,
  clock,
  day,
  inWords,
  prClass,
  say,
  stateWord,
  STATE_CLASS,
  tokenCount
} from '../words'

const props = defineProps<{ session: Session; left: number; top: number }>()
const emit = defineEmits<{ close: []; chat: [] }>()

const APP_SESSION = 'claude://code/continue?session='
const MARGIN = 16
const WIDTH = 560
/** Under this the sheet would open as a sliver at the foot of the window, so it opens upwards. */
const LEAST = 340

/** What a hook last said, in the words the rest of the board already uses. */
const HEARD_KEYS = {
  working: 'heardWorking',
  asking: 'heardAsking',
  ended: 'heardEnded'
} as const

function heardAs(word: string): string {
  return word in HEARD_KEYS ? say(HEARD_KEYS[word as keyof typeof HEARD_KEYS]) : word
}

/** GitHub's review decision, which the row only ever shows folded into one state word. */
const REVIEW_KEYS = {
  APPROVED: 'reviewApproved',
  CHANGES_REQUESTED: 'reviewChanges',
  REVIEW_REQUIRED: 'reviewRequired',
  COMMENTED: 'reviewCommented'
} as const

function reviewAs(word: string): string {
  return word in REVIEW_KEYS ? say(REVIEW_KEYS[word as keyof typeof REVIEW_KEYS]) : word
}

const sheet = ref<HTMLElement | null>(null)
const window_ = ref({ wide: window.innerWidth, tall: window.innerHeight })
/** How tall the sheet turned out, once it has been laid out and can be asked rather than guessed. */
const grew = ref(LEAST)

function measure(): void {
  window_.value = { wide: window.innerWidth, tall: window.innerHeight }
  if (sheet.value) grew.value = sheet.value.offsetHeight
}

/**
 * The sheet opens over the row it belongs to rather than in the middle of the screen, so the eye
 * does not have to find it again. It is laid over the board and never in it: nothing below moves.
 *
 * It slides up only by as much as it needs: a row low in the window would otherwise open a sheet
 * two lines tall with everything else behind a scrollbar, while the space above it went unused.
 */
const box = computed(() => {
  const { wide, tall } = window_.value
  const width = Math.min(WIDTH, wide - MARGIN * 2)
  const left = Math.min(Math.max(props.left, MARGIN), Math.max(MARGIN, wide - width - MARGIN))
  const room = tall - MARGIN * 2
  const top = Math.max(MARGIN, Math.min(props.top, tall - MARGIN - Math.min(grew.value, room)))
  return { left, top, width, tall: room }
})

const dot = computed(() => (props.session.activity ? STATE_CLASS[props.session.activity] : ''))

/** The repository, which `place` carries in front of the worktree it also names. */
const marks = computed(() => {
  const session = props.session
  return [
    session.pinned ? say('markPinned') : null,
    session.focused ? say('markFocused') : null,
    session.active ? say('markActive') : null
  ].filter((mark): mark is string => mark !== null)
})

/** How long a stretch has run, said as both a length and a time, where its start is known at all. */
function lasting(from: number | null): string | null {
  if (from === null) return null
  return `${inWords(Date.now() / 1000 - from)} · ${say('since', clock(from))}`
}

/** How long the session has been on whatever it is on, where the start of it is known at all. */
const going = computed(() => lasting(props.session.since))

/** How long it has stood in the state it is in, which is what holds a lane still and nothing says. */
const standingSince = computed(() => lasting(props.session.entered))

/** When the app opened the session, as a time and a day, since a session can outlive the day. */
const openedAt = computed(() => {
  const opened = props.session.opened
  return opened === null ? null : `${clock(opened)} · ${day(opened)}`
})

/** How long it has been going since then, which the last movement says nothing about. */
const alive = computed(() => {
  const opened = props.session.opened
  return opened === null ? null : inWords(Date.now() / 1000 - opened)
})

/** The four ways a token is paid for, in the order a turn spends them. */
const TOKEN_ROWS = [
  ['fieldSent', 'input'],
  ['fieldCacheWrite', 'cacheWrite'],
  ['fieldCacheRead', 'cacheRead'],
  ['fieldOutput', 'output']
] as const

/** The exact count, for the tooltip, where the row itself rounds. */
function exact(count: number): string {
  return count.toLocaleString(say('clock'))
}

/** The agents' side on one line: it is a footnote to the session's own spend, not a second table. */
function onOneLine(tokens: Tokens): string {
  return TOKEN_ROWS.map(([label, key]) => `${say(label)} ${tokenCount(tokens[key])}`).join(' · ')
}

/** Open, a draft, merged or closed: the pull request's own state, said rather than only coloured. */
function standing(change: Change): string {
  if (change.state === 'merged') return stateWord('merged')
  if (!change.open) return stateWord('closed')
  return stateWord(change.draft ? 'draft' : 'open')
}

/** How far the run got, which the row only says for the one change it stands on, and only in part. */
function checks(change: Change): string | null {
  const run = change.progress
  if (run.total === 0) return null
  const parts = [say('checksDone', `${run.done}/${run.total}`)]
  if (run.failed > 0) parts.push(say('checksFailed', run.failed))
  if (run.done < run.total && run.since) {
    parts.push(say('checksRunning', inWords(Date.now() / 1000 - run.since)))
  } else if (run.until) {
    parts.push(say('checksFinished', ago(run.until)))
  }
  return parts.join(' · ')
}

/**
 * Where a closing issue lives, worked out from the pull request beside it. Only GitHub fills
 * `issues` at all, so a url that does not read as a pull request leaves the number unlinked rather
 * than pointed somewhere invented.
 */
function issueUrl(change: Change, number: number): string | undefined {
  const at = change.url.lastIndexOf('/pull/')
  return at === -1 ? undefined : `${change.url.slice(0, at)}/issues/${number}`
}

function open(url: string): void {
  void window.api.open(url)
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', measure)
  // Measured before the browser paints, so the sheet is placed once rather than seen to move.
  measure()
  // The sheet takes the focus itself rather than handing it to the close button, which would put a
  // focus ring on the first thing the eye lands on. Escape and the tab order work from here.
  sheet.value?.focus()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', measure)
})
</script>

<template>
  <div class="over" @click="emit('close')">
    <section
      ref="sheet"
      class="sheet"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      :style="{
        left: box.left + 'px',
        top: box.top + 'px',
        width: box.width + 'px',
        maxHeight: box.tall + 'px'
      }"
      @click.stop
    >
      <header>
        <span :class="['bead', dot]" />
        <div class="who">
          <h2>{{ session.headline }}</h2>
          <p class="where">{{ session.place }}</p>
          <p v-if="marks.length > 0" class="marks">
            <span v-for="mark in marks" :key="mark" class="mark">{{ mark }}</span>
          </p>
        </div>
        <button class="close" :title="say('close')" @click="emit('close')">×</button>
      </header>

      <div class="body">
        <section class="block">
          <h3>{{ say('blockState') }}</h3>
          <dl>
            <dt>{{ say('fieldState') }}</dt>
            <dd>
              <span :class="['chip', STATE_CLASS[session.state]]">{{
                stateWord(session.state)
              }}</span>
            </dd>

            <template v-if="session.activity">
              <dt>{{ say('fieldDoing') }}</dt>
              <dd>
                <span :class="['chip', STATE_CLASS[session.activity]]">{{
                  stateWord(session.activity)
                }}</span>
              </dd>
            </template>

            <template v-if="session.about">
              <dt>{{ say('fieldWaitingOn') }}</dt>
              <dd>{{ session.about }}</dd>
            </template>

            <template v-if="going">
              <dt>{{ say('fieldLasts') }}</dt>
              <dd>{{ going }}</dd>
            </template>

            <template v-if="standingSince">
              <dt>{{ say('fieldInState') }}</dt>
              <dd>{{ standingSince }}</dd>
            </template>

            <template v-if="session.extra">
              <dt>{{ say('fieldBeside') }}</dt>
              <dd>
                <span :class="['chip', STATE_CLASS[session.extra]]">{{
                  stateWord(session.extra)
                }}</span>
              </dd>
            </template>

            <!-- Silence is worth saying out loud: it means the files answered, not the hooks. -->
            <dt>{{ say('fieldHooks') }}</dt>
            <dd :class="{ none: !session.heard }">
              {{ session.heard ? heardAs(session.heard) : say('nothingHeard') }}
            </dd>

            <!--
              The name the session carries in Claude, which the board trims down to the heading
              above. It is worth having in full, and it is worth being said to be the session's own
              word rather than the board's: a title still saying `bez PR` over a merged change is
              the session being out of date, not the board disagreeing with itself.
            -->
            <template v-if="session.title !== session.headline">
              <dt>{{ say('fieldName') }}</dt>
              <dd class="said">{{ session.title }}</dd>
            </template>

            <dt>{{ say('fieldMovement') }}</dt>
            <dd>
              {{ session.last ? `${ago(session.last)} · ${clock(session.last)}` : say('unknown') }}
            </dd>

            <!-- A record without `createdAt` says so rather than borrowing the last movement. -->
            <dt>{{ say('fieldOpened') }}</dt>
            <dd :class="{ none: !openedAt }">{{ openedAt ?? say('unknown') }}</dd>

            <template v-if="alive">
              <dt>{{ say('fieldAlive') }}</dt>
              <dd>{{ alive }}</dd>
            </template>
          </dl>
        </section>

        <section v-if="session.issue" class="block">
          <h3>{{ say('blockIssue') }}</h3>
          <a class="chip issue" :href="session.issue.url" @click.prevent="open(session.issue!.url)">
            {{ session.issue.label }}
          </a>
        </section>

        <section v-if="session.changes.length > 0" class="block">
          <h3>{{ session.changes.length === 1 ? say('prOne') : say('prMany') }}</h3>
          <article v-for="change in session.changes" :key="change.url" class="change">
            <div class="top">
              <a
                :class="['chip', 'pr', prClass(change, session)]"
                :href="change.url"
                @click.prevent="open(change.url)"
              >
                {{ change.label }}
              </a>
              <span class="word">{{ standing(change) }}</span>
              <span v-if="change === session.change" class="on">{{ say('standsOn') }}</span>
            </div>
            <dl>
              <template v-if="change.branch">
                <dt>{{ say('fieldBranch') }}</dt>
                <dd class="mono">{{ change.branch }}</dd>
              </template>

              <template v-if="change.conflict">
                <dt>{{ stateWord('conflict') }}</dt>
                <dd>
                  <span class="chip s-conflict">{{ say('cannotMerge') }}</span>
                </dd>
              </template>

              <template v-if="change.review">
                <dt>{{ say('fieldReview') }}</dt>
                <dd>{{ reviewAs(change.review) }}</dd>
              </template>

              <template v-if="checks(change)">
                <dt>{{ say('fieldChecks') }}</dt>
                <dd>
                  <a
                    v-if="change.checks"
                    :class="['chip', STATE_CLASS[change.checks]]"
                    :href="change.url + '/checks'"
                    @click.prevent="open(change.url + '/checks')"
                    >{{ stateWord(change.checks) }}</a
                  >
                  {{ checks(change) }}
                </dd>
              </template>

              <!-- Every one of them, where the row stops at three and says nothing about the rest. -->
              <template v-if="change.failed.length > 0">
                <dt>{{ say('fieldFailed') }}</dt>
                <dd class="jobs">
                  <a
                    v-for="job in change.failed"
                    :key="job.label + job.url"
                    :class="['chip', 'job']"
                    :href="job.url || undefined"
                    @click.prevent="job.url && open(job.url)"
                  >
                    {{ job.label }}
                  </a>
                </dd>
              </template>

              <template v-if="change.issues.length > 0">
                <dt>{{ say('fieldCloses') }}</dt>
                <dd class="jobs">
                  <a
                    v-for="number in change.issues"
                    :key="number"
                    class="chip issue"
                    :href="issueUrl(change, number)"
                    @click.prevent="
                      issueUrl(change, number) && open(issueUrl(change, number) as string)
                    "
                    >#{{ number }}</a
                  >
                </dd>
              </template>
            </dl>
          </article>
        </section>

        <section class="block">
          <h3>{{ say('blockRun') }}</h3>
          <dl>
            <!-- An unreadable transcript is not zero tokens, so every row says it is not known. -->
            <template v-for="[label, key] in TOKEN_ROWS" :key="key">
              <dt>{{ say(label) }}</dt>
              <dd v-if="session.burned" class="count" :title="exact(session.burned.own[key])">
                {{ tokenCount(session.burned.own[key]) }}
              </dd>
              <dd v-else class="none">{{ say('unknown') }}</dd>
            </template>

            <template v-if="session.burned?.agents">
              <dt>{{ say('fieldAgents') }}</dt>
              <dd>{{ onOneLine(session.burned.agents) }}</dd>
            </template>

            <dt>{{ say('fieldModel') }}</dt>
            <dd :class="['mono', { none: !session.model }]">
              {{ session.model ?? say('unknown') }}
            </dd>

            <dt>{{ say('fieldEffort') }}</dt>
            <dd :class="{ none: !session.effort }">{{ session.effort ?? say('unknown') }}</dd>

            <template v-if="session.copy">
              <dt>{{ say('fieldCopy') }}</dt>
              <dd class="mono pick">{{ session.copy }}</dd>
            </template>

            <template v-if="session.branch">
              <dt>{{ say('fieldBranch') }}</dt>
              <dd class="mono pick">{{ session.branch }}</dd>
            </template>
          </dl>
        </section>

        <section class="block">
          <h3>{{ say('blockIdentity') }}</h3>
          <dl>
            <dt>{{ say('fieldSession') }}</dt>
            <dd class="mono pick">{{ session.id }}</dd>
            <dt>{{ say('fieldCli') }}</dt>
            <dd :class="['mono', 'pick', { none: !session.cli }]">
              {{ session.cli || say('unknown') }}
            </dd>
          </dl>
        </section>
      </div>

      <footer>
        <button class="chip pr" @click="open(APP_SESSION + session.id)">
          {{ say('openInClaude') }}
        </button>
        <button class="chip" @click="emit('chat')">{{ say('readChat') }}</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
/*
 * The board keeps its shape: the sheet is laid over it, nothing below it reflows, and the backdrop
 * is light enough that the row it came from is still where she left it.
 */
.over {
  position: fixed;
  inset: 0;
  z-index: 20;
  background: var(--veil);
}

.sheet {
  position: fixed;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: 12px;
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 14px 12px;
  border-bottom: 1px solid var(--rule);
}

/* The same bead the card draws, so the sheet reads as that row rather than as another window. */
.bead {
  flex: none;
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 9999px;
  box-shadow: inset 0 0 0 1.5px var(--faint);
}

.bead.s-working,
.bead.s-mergeable {
  background: var(--ok);
  box-shadow: none;
}

.bead.s-waiting,
.bead.s-draft,
.bead.s-changes {
  background: var(--warn);
  box-shadow: none;
}

.bead.s-gate,
.bead.s-task,
.bead.s-running {
  background: var(--info);
  box-shadow: none;
}

.bead.s-queued {
  background: var(--faint);
  box-shadow: none;
}

.who {
  min-width: 0;
  flex: 1;
}

h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
}

.where {
  margin: 2px 0 0;
  color: var(--ink-muted);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.marks {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin: 7px 0 0;
}

.mark {
  border-radius: 9999px;
  padding: 1px 8px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  background: var(--accent-soft);
  color: var(--accent);
}

.close {
  flex: none;
  border: 0;
  background: transparent;
  color: var(--ink-muted);
  font-size: 20px;
  line-height: 1;
  padding: 0 2px;
  cursor: pointer;
}

.close:hover {
  color: var(--ink);
}

/* Everything past the header scrolls, so a session with six pull requests still opens in place. */
.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 14px 14px;
}

.block {
  padding-top: 12px;
}

.block + .block {
  border-top: 1px solid var(--rule);
  margin-top: 12px;
}

h3 {
  margin: 0 0 8px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--faint);
}

/* Two columns, the label narrow and quiet, so the values line up and read straight down. */
dl {
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr);
  align-items: baseline;
  gap: 6px 12px;
  margin: 0;
}

dt {
  color: var(--ink-muted);
  font-size: 11px;
}

dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

/* What could not be read is greyed rather than dressed up as an answer. */
.none {
  color: var(--faint);
}

/* Quoted, because it is what the session calls itself and not what the board worked out. */
.said {
  color: var(--ink-muted);
}

.mono {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
}

/* Figures of equal width, so the four counts line up by their units. */
.count {
  font-variant-numeric: tabular-nums;
}

/* An id is only worth showing if it can be taken, and the sheet is otherwise unselectable chrome. */
.pick {
  user-select: text;
  cursor: text;
}

.change {
  border: 1px solid var(--rule);
  border-radius: 10px;
  padding: 9px 10px;
  background: var(--ground);
}

.change + .change {
  margin-top: 8px;
}

.top {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}

.word {
  color: var(--ink-muted);
  font-size: 11px;
}

/* Which of several pull requests the row's state was taken from, since the rest only look alike. */
.on {
  color: var(--faint);
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.jobs {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

a.chip {
  cursor: pointer;
}

footer {
  display: flex;
  gap: 8px;
  padding: 11px 14px;
  border-top: 1px solid var(--rule);
  background: var(--surface);
}

footer .chip {
  cursor: pointer;
}
</style>
