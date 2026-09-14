#!/usr/bin/env node
/**
 * Refuses a tree that carries a name from outside this project.
 *
 * The repository is public, so a private repository name, a tracker key or a personal host reaching
 * a commit is not untidiness, it is disclosure, and git keeps it after the fix. The list below is
 * the whole vocabulary the gate knows: add to it rather than trusting anyone to remember.
 *
 * Every entry carries a canary, and the gate proves each pattern against its own canary before it
 * reports a clean tree. A regex that silently stopped matching would otherwise read exactly like a
 * repository with nothing to hide.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { extname, relative } from 'node:path'

/** Names that must never appear in a tracked file, each with a string it has to catch. */
const FORBIDDEN = [
  { name: 'vellum', pattern: /vellum/i, canary: 'Vellum' },
  { name: 'singlecase', pattern: /singlecase/i, canary: 'SingleCase' },
  { name: 'tracker key', pattern: /\bSIN-\d+/i, canary: 'SIN-19957' },
  { name: 'private host', pattern: /[\w-]+\.hadik\.cz/i, canary: 'finance.dev.hadik.cz' },
  { name: 'personal mailbox', pattern: /hadikcze|@singlecase\.cz/i, canary: 'hadikcze@gmail.com' },
  { name: 'home directory', pattern: /\/Users\/hadik\b/, canary: '/Users/hadik/dev' },
  { name: 'private platform', pattern: /dokploy|coolify/i, canary: 'dokploy.dev.hadik.cz' }
]

/** Nothing here can be read as text, so the gate says so rather than counting it as clean. */
const OPAQUE = new Set(['.png', '.icns', '.ico', '.jpg', '.jpeg', '.gif', '.pdf', '.woff2'])

const root = process.cwd()
const self = relative(root, new URL(import.meta.url).pathname)

function tracked() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  return out.split('\0').filter(Boolean)
}

/** A pattern that cannot catch its own canary is broken, and a broken gate passes everything. */
function provePatterns() {
  const broken = FORBIDDEN.filter((entry) => !entry.pattern.test(entry.canary))
  if (broken.length === 0) return
  for (const entry of broken) {
    console.error(`private-names: pattern "${entry.name}" no longer matches its own canary`)
  }
  process.exit(2)
}

function scan() {
  const hits = []
  const unread = []
  for (const file of tracked()) {
    // The gate spells the forbidden words out, so scanning it would always fail.
    if (file === self) continue
    // Still tracked but already deleted: naming it as unread would ask for an eye on nothing.
    if (!existsSync(file)) continue
    if (OPAQUE.has(extname(file).toLowerCase())) {
      unread.push(file)
      continue
    }
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      unread.push(file)
      continue
    }
    text.split('\n').forEach((line, index) => {
      for (const entry of FORBIDDEN) {
        if (entry.pattern.test(line)) hits.push({ file, line: index + 1, name: entry.name })
      }
    })
  }
  return { hits, unread }
}

provePatterns()
const { hits, unread } = scan()

if (unread.length > 0) {
  console.log(`private-names: ${unread.length} file(s) not readable as text, judge these by eye:`)
  for (const file of unread) console.log(`  ${file}`)
}

if (hits.length > 0) {
  console.error(`private-names: ${hits.length} name(s) that must not go public:`)
  for (const hit of hits) console.error(`  ${hit.file}:${hit.line}  ${hit.name}`)
  process.exit(1)
}

console.log(`private-names: clean, ${FORBIDDEN.length} patterns each proved against its canary`)
