<script setup lang="ts">
import type { UsageWindow } from '../../../shared/types'
import { burnVerdict, clock, inWords } from '../words'

defineProps<{ windows: UsageWindow[] }>()

/** Green, amber or red by whether the window outlives its reset; the bar and the numbers share it. */
function verdict(window: UsageWindow): string {
  return burnVerdict(window.burn, window.left)
}

function burnt(window: UsageWindow): string {
  return window.burn === null ? 'nespálíš nic' : `spálíš za ${inWords(window.burn)}`
}

function rest(window: UsageWindow): string {
  const parts = [`reset za ${inWords(window.left)}, v ${clock(window.resets)}`]
  if (window.pace) parts.push(`tempo ${window.pace.toFixed(1).replace('.', ',')}×`)
  return parts.join(' · ')
}
</script>

<template>
  <section class="usage">
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
