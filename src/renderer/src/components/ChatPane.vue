<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import type { Call, Line, Session } from '../../../shared/types'
import { clock, say, toolCount } from '../words'

const props = defineProps<{ session: Session | null }>()
const emit = defineEmits<{ close: [] }>()

const lines = ref<Line[]>([])
const loading = ref(false)
const talk = ref<HTMLElement | null>(null)

/** A conversation is read from its end, so the pane opens where the last thing was said. */
async function toTheEnd(): Promise<void> {
  await nextTick()
  if (talk.value) talk.value.scrollTop = talk.value.scrollHeight
}

/** Reading further up is hers to keep: only a pane already at the end follows what arrives. */
function wasAtTheEnd(): boolean {
  const talking = talk.value
  if (!talking) return true
  return talking.scrollHeight - talking.scrollTop - talking.clientHeight < 40
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

// Which session is being read, not the object it arrives in: the board hands the pane a new object
// every sweep, and watching that had the pane empty itself and load again every fifteen seconds.
watch(
  () => props.session?.cli ?? null,
  async (cli) => {
    lines.value = []
    if (!cli) return
    loading.value = true
    lines.value = await window.api.chat(cli)
    loading.value = false
    await toTheEnd()
  },
  { immediate: true }
)

/** A conversation that has moved is read again in place, so nothing blinks and nothing scrolls away. */
watch(
  () => props.session?.last ?? null,
  async (last, before) => {
    const cli = props.session?.cli
    if (!cli || last === null || before === null || last === before) return
    const atTheEnd = wasAtTheEnd()
    lines.value = await window.api.chat(cli)
    if (atTheEnd) await toTheEnd()
  }
)

function open(url: string): void {
  void window.api.open(url)
}

/** What the fold says while it is closed. */
function named(calls: Call[]): string {
  const count = calls.length
  return toolCount(count)
}

/** The little of Markdown a conversation actually uses, escaped first so nothing can be injected. */
function rendered(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
}
</script>

<template>
  <aside v-if="session" class="pane">
    <header>
      <div class="who">
        <div class="title">{{ session.headline }}</div>
        <div class="meta">{{ session.place }}</div>
      </div>
      <button class="close" :title="say('close')" @click="emit('close')">×</button>
    </header>

    <div ref="talk" class="talk">
      <p v-if="loading" class="empty">{{ say('reading') }}</p>
      <p v-else-if="lines.length === 0" class="empty">{{ say('nothingToRead') }}</p>
      <div v-for="(line, index) in lines" :key="index" :class="['line', line.role]">
        <!-- eslint-disable-next-line vue/no-v-html -- escaped in rendered() above -->
        <div v-if="line.text" class="text" v-html="rendered(line.text)"></div>
        <details v-if="line.tools.length > 0" class="tools">
          <summary>{{ named(line.tools) }}</summary>
          <div v-for="(call, at) in line.tools" :key="at" class="call">
            <span class="name">{{ call.name }}</span>
            <span v-if="call.about" class="about">{{ call.about }}</span>
          </div>
        </details>
        <div class="when">{{ line.at ? clock(line.at) : '' }}</div>
      </div>
    </div>

    <footer>
      <button class="chip pr" @click="open('claude://code/continue?session=' + session.id)">
        {{ say('openInClaude') }}
      </button>
    </footer>
  </aside>
</template>

<style scoped>
.pane {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(460px, 50vw);
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-left: 1px solid var(--rule);
  box-shadow: var(--shadow-card);
}

header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 14px 10px;
  border-bottom: 1px solid var(--rule);
}

.who {
  min-width: 0;
}

.title {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.meta,
.when {
  color: var(--ink-muted);
  font-size: 11px;
}

.close {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: var(--ink-muted);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.talk {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px 16px;
  display: grid;
  gap: 10px;
  align-content: start;
}

.line {
  border-radius: 10px;
  padding: 8px 10px;
  background: var(--ground);
}

.line.user {
  background: var(--accent-soft);
}

.text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.text :deep(code) {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
  background: var(--muted-soft);
  border-radius: 4px;
  padding: 0 4px;
}

.tools {
  margin-top: 4px;
  color: var(--ink-muted);
  font-size: 11px;
  font-family: var(--font-mono, ui-monospace, monospace);
}

.tools summary {
  cursor: pointer;
  list-style: none;
}

.tools summary::before {
  content: '▸ ';
}

.tools[open] summary::before {
  content: '▾ ';
}

.call {
  display: flex;
  gap: 6px;
  margin-top: 3px;
  padding-left: 12px;
}

.call .name {
  flex: none;
  color: var(--ink);
}

.call .about {
  min-width: 0;
  overflow-wrap: anywhere;
}

.empty {
  color: var(--ink-muted);
}

footer {
  padding: 10px 14px 14px;
  border-top: 1px solid var(--rule);
}

footer .chip {
  cursor: pointer;
}
</style>
