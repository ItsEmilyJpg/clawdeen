#!/usr/bin/env node
/**
 * Refuses a tree that carries a name from outside this project.
 *
 * The repository is public, so a private repository name, a tracker key or a personal host reaching
 * a commit is not untidiness, it is disclosure, and git keeps it after the fix.
 *
 * The vocabulary is deliberately NOT in here. A gate that forbids a word has to spell that word out,
 * so a list kept in the repository publishes exactly what it was built to keep back: the first
 * version of this file carried a real mailbox, a real ticket number and two real hostnames straight
 * into a public commit. The list lives beside the application's own configuration instead, outside
 * every checkout, and `private-names.example.json` shows its shape with invented values.
 *
 * Every entry carries a canary, and the gate proves each pattern against its own canary before it
 * reports a clean tree. A regex that silently stopped matching would otherwise read exactly like a
 * repository with nothing to hide.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join, relative } from 'node:path'

/** The same two directories the application reads, newest name first. */
const LISTS = [
  join(homedir(), '.config/clawdeen/private-names.json'),
  join(homedir(), '.config/claude-sessions/private-names.json')
]

/** Nothing here can be read as text, so the gate says so rather than counting it as clean. */
const OPAQUE = new Set(['.png', '.icns', '.ico', '.jpg', '.jpeg', '.gif', '.pdf', '.woff2'])

const root = process.cwd()
const self = relative(root, new URL(import.meta.url).pathname)

/**
 * The vocabulary, or null where nobody has written one. Null is not the same as an empty list: the
 * first means the gate is guarding nothing and has to say so, the second is a deliberate choice.
 */
function vocabulary() {
  for (const path of LISTS) {
    if (!existsSync(path)) continue
    let entries
    try {
      entries = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      console.error(`private-names: ${path} cannot be read: ${error.message}`)
      process.exit(2)
    }
    if (!Array.isArray(entries)) {
      console.error(`private-names: ${path} is not a list of entries`)
      process.exit(2)
    }
    return {
      path,
      entries: entries.map((entry) => ({
        name: entry.name,
        canary: entry.canary,
        pattern: new RegExp(entry.pattern, entry.flags ?? '')
      }))
    }
  }
  return null
}

function tracked() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  return out.split('\0').filter(Boolean)
}

/** A pattern that cannot catch its own canary is broken, and a broken gate passes everything. */
function provePatterns(entries) {
  const broken = entries.filter((entry) => !entry.pattern.test(entry.canary))
  if (broken.length === 0) return
  for (const entry of broken) {
    console.error(`private-names: pattern "${entry.name}" no longer matches its own canary`)
  }
  process.exit(2)
}

function scan(entries) {
  const hits = []
  const unread = []
  for (const file of tracked()) {
    // The gate reads the forbidden words into itself, so scanning it would always fail.
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
      for (const entry of entries) {
        if (entry.pattern.test(line)) hits.push({ file, line: index + 1, name: entry.name })
      }
    })
  }
  return { hits, unread }
}

const list = vocabulary()

// Said as loudly as a failure and still green: a check that refused every fresh clone would be
// deleted within the week, and a check that says nothing at all would be trusted for what it is not.
if (list === null) {
  console.log('private-names: NO LIST CONFIGURED, so nothing at all is being checked.')
  console.log(`  Write one at ${LISTS[0]}`)
  console.log('  tools/gate/private-names.example.json shows the shape.')
  process.exit(0)
}

provePatterns(list.entries)
const { hits, unread } = scan(list.entries)

if (unread.length > 0) {
  console.log(`private-names: ${unread.length} file(s) not readable as text, judge these by eye:`)
  for (const file of unread) console.log(`  ${file}`)
}

if (hits.length > 0) {
  console.error(`private-names: ${hits.length} name(s) that must not go public:`)
  for (const hit of hits) console.error(`  ${hit.file}:${hit.line}  ${hit.name}`)
  process.exit(1)
}

console.log(
  `private-names: clean, ${list.entries.length} patterns each proved against its canary (${list.path})`
)
