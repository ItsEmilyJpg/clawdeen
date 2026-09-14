<script setup lang="ts">
import { computed } from 'vue'

import type { Spend, UsageWindow } from '../../../shared/types'
import { burnVerdict, clock, decimal, doubtsOf, inWords, money, say } from '../words'

const props = defineProps<{
  windows: UsageWindow[]
  spend?: Spend | null
  compact?: boolean
}>()

/**
 * What the credits have cost, or nothing.
 *
 * The amount alone, because the amount is all the endpoint stands behind: it says what has been
 * spent, never that this stretch of work is what spent it. A window at 100 per cent is not what
 * puts this on the board, and nothing here is drawn from one.
 */
const spent = computed(() =>
  props.spend ? money(props.spend.used, props.spend.currency, props.spend.decimals) : null
)

/** Old numbers fade together: the badge was read out of the same answer as the gauges beside it. */
const spendDoubted = computed(() => props.windows.some((window) => doubtsOf(window).length > 0))

/**
 * The doubt belongs to the one file both windows were read from, not to either of them, so it is
 * said once for the whole bar. Twice it is an account address wide enough to push the gauges off.
 */
const doubt = computed(() => {
  const doubted = props.windows.find((window) => doubtsOf(window).length > 0)
  return doubted ? doubtsOf(doubted).join(' · ') : ''
})

/** Green, amber or red by whether the window outlives its reset; the bar and the numbers share it. */
function verdict(window: UsageWindow): string {
  return burnVerdict(window.burn, window.left)
}

function burnt(window: UsageWindow): string {
  return window.burn === null ? say('burnsNothing') : say('burnsIn', inWords(window.burn))
}

/** When the window comes back, which is the number the burn is read against. */
function until(window: UsageWindow): string {
  return say('resetsIn', inWords(window.left))
}

function rest(window: UsageWindow): string {
  return `${until(window)}, ${say('atTime', clock(window.resets))}`
}

/**
 * How fast she is spending against how fast the window refills: one is even, and above one is the
 * number that says a window will not last. It reads as a number of its own rather than as the tail
 * of a sentence, because it is the one figure here that does not depend on when the reset is.
 */
function paced(window: UsageWindow): string | null {
  return window.pace ? say('pace', decimal(window.pace, 1)) : null
}

/** Old numbers are dimmed rather than recoloured: the colour already means how fast they burn. */
function doubted(window: UsageWindow): boolean {
  return doubtsOf(window).length > 0
}
</script>

<template>
  <!-- Compact is the default: the two windows ride in the bar as one line each. -->
  <div v-if="compact" class="meters">
    <span
      v-for="window in windows"
      :key="window.key"
      class="meter"
      :class="{ doubted: doubted(window) }"
      :title="rest(window)"
    >
      <span>{{ window.short }}</span>
      <b :class="verdict(window)">{{ Math.round(window.used) }} %</b>
      <span class="track"
        ><i :class="verdict(window)" :style="{ width: `${Math.min(100, window.used)}%` }"
      /></span>
      <!-- Both numbers, because one of them alone decides nothing: what it lasts, against the reset. -->
      <!-- A doubted window says neither: what it burns is arithmetic on a number that stopped moving. -->
      <!-- The pace rides with what it explains: what the window lasts is arithmetic on it, and a
           number over one is what says she is spending faster than the window refills. -->
      <span v-if="!doubted(window)" class="sentence">
        <span :class="['burnt', verdict(window)]">{{ burnt(window) }}</span>
        <template v-if="paced(window)"
          >{{ ' · ' }}<span class="pace">{{ paced(window) }}</span></template
        >{{ ' · ' }}{{ until(window) }}
      </span>
    </span>
    <!-- After the windows: it is the one figure here the plan does not cover, so it reads last. -->
    <span
      v-if="spent"
      class="credits"
      :class="{ doubted: spendDoubted }"
      :title="say('creditsLong', spent)"
      >{{ say('credits', spent) }}</span
    >
    <span v-if="doubt" class="doubt">{{ doubt }}</span>
  </div>

  <section v-else class="usage">
    <div
      v-for="window in windows"
      :key="window.key"
      class="gauge"
      :class="{ doubted: doubted(window) }"
    >
      <div class="head">
        <span>{{ window.label }}</span>
        <span class="figures">
          <b v-if="paced(window)" :class="['rate', verdict(window)]">{{ paced(window) }}</b>
          <b :class="verdict(window)">{{ Math.round(window.used) }} %</b>
        </span>
      </div>
      <span class="bar"
        ><i :class="verdict(window)" :style="{ width: `${Math.min(100, window.used)}%` }"
      /></span>
      <div class="meta">
        <template v-if="!doubted(window)"
          ><span :class="verdict(window)">{{ burnt(window) }}</span> · </template
        >{{ rest(window) }}
      </div>
    </div>
    <p v-if="spent" class="credits" :class="{ doubted: spendDoubted }">
      {{ say('creditsLong', spent) }}
    </p>
    <p v-if="doubt" class="doubt">{{ doubt }}</p>
  </section>
</template>

<style scoped>
/* In the bar it is part of the sentence, so it is said quietly; in the gauge it is a figure. */
.pace {
  color: var(--ink-muted);
}

.figures {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

/* Beside the percentage rather than under it: what she is spending, and how fast, read together. */
.rate {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
}

.meters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 18px;
  white-space: nowrap;
}

/*
 * The little bar goes first and the sentence last, because the bar only draws the percentage that
 * stands beside it, while the sentence carries the one thing the gauge is for: what it lasts,
 * against when it comes back.
 */
@media (max-width: 1000px) {
  .meter .track {
    display: none;
  }
}

@media (max-width: 560px) {
  .meter .sentence {
    display: none;
  }
}

.meter {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--ink-muted);
}

.meter b {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}

.meter .track {
  width: 84px;
  height: 5px;
  border-radius: 9999px;
  background: var(--muted-soft);
}

.meter .track i {
  display: block;
  height: 100%;
  border-radius: 9999px;
  background: var(--ok);
}

.meter .track i.warn {
  background: var(--warn);
}

.meter .track i.danger {
  background: var(--danger);
}

/*
 * A doubted window keeps its place and its number, because the number is still the last thing that
 * was true. It only stops looking like a reading taken now: the bar fades and the sentence beside it
 * says what is wrong instead of what the number burns.
 */
.meter.doubted b,
.meter.doubted .track,
.gauge.doubted .head b,
.gauge.doubted .bar {
  opacity: 0.55;
}

/*
 * A figure, not an alarm. The colours in this bar all mean how fast a window of the plan burns, and
 * money spent outside the plan is not a fourth shade of that scale, so the badge is set off by its
 * ground instead. `--warn` here would also be the second orange thing in a header that already says
 * `neobnoveno:` in it.
 */
.credits {
  padding: 1px 7px;
  border-radius: 9999px;
  background: var(--muted-soft);
  color: var(--ink-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.credits.doubted {
  opacity: 0.55;
}

.usage .credits {
  grid-column: 1 / -1;
  justify-self: start;
  margin: 0;
}

/* Said once for the bar, so it may be as long as an address and still wrap rather than push. */
.meters .doubt,
.usage .doubt {
  font-size: 11px;
  color: var(--warn);
  white-space: normal;
}

.usage .doubt {
  grid-column: 1 / -1;
  margin: 0;
}

.meter b.ok,
.meter span.ok {
  color: var(--ok);
}

.meter b.warn,
.meter span.warn {
  color: var(--warn);
}

.meter b.danger,
.meter span.danger {
  color: var(--danger);
}

.usage {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  margin-bottom: 14px;
}

.gauge {
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: 12px;
  padding: 10px 12px;
}

.head {
  display: flex;
  justify-content: space-between;
  font-weight: 600;
}

.head b {
  font-variant-numeric: tabular-nums;
}

.bar {
  display: block;
  height: 6px;
  margin: 7px 0 5px;
  border-radius: 9999px;
  background: var(--muted-soft);
}

.bar i {
  display: block;
  height: 100%;
  border-radius: 9999px;
  background: var(--ok);
  transition: width 0.3s ease;
}

.bar i.warn {
  background: var(--warn);
}

.bar i.danger {
  background: var(--danger);
}

.head b.ok,
.meta .ok {
  color: var(--ok);
}

.head b.warn,
.meta .warn {
  color: var(--warn);
}

.head b.danger,
.meta .danger {
  color: var(--danger);
}

.meta {
  color: var(--ink-muted);
  font-size: 11px;
}
</style>
