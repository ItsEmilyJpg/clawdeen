<script setup lang="ts">
import { computed } from 'vue'

import type { UsageWindow } from '../../../shared/types'
import { burnVerdict, clock, decimal, doubtsOf, inWords, say } from '../words'

const props = defineProps<{ windows: UsageWindow[]; compact?: boolean }>()

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
  const parts = [`${until(window)}, ${say('atTime', clock(window.resets))}`]
  if (window.pace) parts.push(say('pace', decimal(window.pace, 1)))
  return parts.join(' · ')
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
      <span v-if="!doubted(window)" class="sentence">
        <span :class="['burnt', verdict(window)]">{{ burnt(window) }}</span> ·
        {{ until(window) }}
      </span>
    </span>
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
        <b :class="verdict(window)">{{ Math.round(window.used) }} %</b>
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
    <p v-if="doubt" class="doubt">{{ doubt }}</p>
  </section>
</template>

<style scoped>
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
