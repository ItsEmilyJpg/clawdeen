<script setup lang="ts">
import type { UsageWindow } from '../../../shared/types'
import { clock, inWords } from '../words'

defineProps<{ windows: UsageWindow[] }>()

function fill(used: number): string {
  if (used >= 85) return 'danger'
  return used >= 60 ? 'warn' : ''
}

function note(window: UsageWindow): string {
  const parts = [`reset v ${clock(window.resets)}, za ${inWords(window.left)}`]
  if (window.pace) parts.push(`tempo ${window.pace.toFixed(1).replace('.', ',')}×`)
  if (window.stale) parts.push(`údaj starý ${inWords(window.stale)}`)
  return parts.join(' · ')
}
</script>

<template>
  <section class="usage">
    <div v-for="window in windows" :key="window.key" class="gauge">
      <div class="head">
        <span>{{ window.label }}</span>
        <b>{{ Math.round(window.used) }} %</b>
      </div>
      <span class="bar"
        ><i :class="fill(window.used)" :style="{ width: `${Math.min(100, window.used)}%` }"
      /></span>
      <div class="meta">{{ note(window) }}</div>
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

.meta {
  color: var(--ink-muted);
  font-size: 11px;
}
</style>
