<script setup lang="ts">
import type { UsageWindow } from '../../../shared/types'
import { burnVerdict, clock, inWords } from '../words'

defineProps<{ windows: UsageWindow[]; compact?: boolean }>()

/** Green, amber or red by whether the window outlives its reset; the bar and the numbers share it. */
function verdict(window: UsageWindow): string {
  return burnVerdict(window.burn, window.left)
}

function burnt(window: UsageWindow): string {
  return window.burn === null ? 'nespálíš nic' : `spálíš za ${inWords(window.burn)}`
}

/** When the window comes back, which is the number the burn is read against. */
function until(window: UsageWindow): string {
  return `reset za ${inWords(window.left)}`
}

function rest(window: UsageWindow): string {
  const parts = [`${until(window)}, v ${clock(window.resets)}`]
  if (window.pace) parts.push(`tempo ${window.pace.toFixed(1).replace('.', ',')}×`)
  return parts.join(' · ')
}
</script>

<template>
  <!-- Compact is the default: the two windows ride in the bar as one line each. -->
  <div v-if="compact" class="meters">
    <span v-for="window in windows" :key="window.key" class="meter" :title="rest(window)">
      <span>{{ window.short }}</span>
      <b :class="verdict(window)">{{ Math.round(window.used) }} %</b>
      <span class="track"
        ><i :class="verdict(window)" :style="{ width: `${Math.min(100, window.used)}%` }"
      /></span>
      <!-- Both numbers, because one of them alone decides nothing: what it lasts, against the reset. -->
      <span class="sentence">
        <span :class="['burnt', verdict(window)]">{{ burnt(window) }}</span> ·
        {{ until(window) }}
      </span>
    </span>
  </div>

  <section v-else class="usage">
    <div v-for="window in windows" :key="window.key" class="gauge">
      <div class="head">
        <span>{{ window.label }}</span>
        <b :class="verdict(window)">{{ Math.round(window.used) }} %</b>
      </div>
      <span class="bar"
        ><i :class="verdict(window)" :style="{ width: `${Math.min(100, window.used)}%` }"
      /></span>
      <div class="meta">
        <span :class="verdict(window)">{{ burnt(window) }}</span> · {{ rest(window) }}
      </div>
    </div>
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
