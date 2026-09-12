#!/usr/bin/env node
// Records the tree the check just proved, so the commit gate can tell whether it still holds.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const tree = execFileSync('git', ['write-tree'], { encoding: 'utf8' }).trim()
mkdirSync('var', { recursive: true })
writeFileSync('var/check-stamp', tree)
console.log(`check: green over ${tree}`)
