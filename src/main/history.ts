import { app } from 'electron'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

import type { Session, Spell } from '../shared/types'

/**
 * One row per stretch of a state rather than a sample per tick, so a day of the board is a few
 * hundred rows. `node:sqlite` is Node's own, which is why this carries no native dependency.
 */
let db: DatabaseSync | null = null

function open(): DatabaseSync {
  if (db) return db
  db = new DatabaseSync(join(app.getPath('userData'), 'history.db'))
  db.exec(`
    create table if not exists spells (
      id integer primary key,
      session text not null,
      headline text not null,
      word text not null,
      began integer not null,
      ended integer
    );
    create index if not exists spells_open on spells (session, ended);
    create index if not exists spells_began on spells (began);
  `)
  return db
}

/** Closes the stretches that ended and opens the ones that started, by comparing with what is open. */
export function record(sessions: Session[], now: number): void {
  const handle = open()
  const standing = new Map<string, { id: number; word: string }>()
  for (const row of handle
    .prepare('select id, session, word from spells where ended is null')
    .all() as {
    id: number
    session: string
    word: string
  }[]) {
    standing.set(row.session, { id: row.id, word: row.word })
  }

  const close = handle.prepare('update spells set ended = ? where id = ?')
  const start = handle.prepare(
    'insert into spells (session, headline, word, began) values (?, ?, ?, ?)'
  )
  const seen = new Set<string>()

  for (const session of sessions) {
    seen.add(session.id)
    const held = standing.get(session.id)
    const word = session.activity
    if (held?.word === word) continue
    if (held) close.run(Math.round(now), held.id)
    if (word) start.run(session.id, session.headline, word, Math.round(now))
  }
  // A session that fell out of the window keeps no open stretch behind it.
  for (const [id, held] of standing) {
    if (!seen.has(id)) close.run(Math.round(now), held.id)
  }
}

/** What the day went into, most of it first. */
export function today(now: number): Spell[] {
  const since = Math.round(new Date(new Date(now * 1000).setHours(0, 0, 0, 0)).getTime() / 1000)
  const rows = open()
    .prepare(
      `select word, sum(min(coalesce(ended, ?1), ?1) - max(began, ?2)) as seconds
       from spells where coalesce(ended, ?1) > ?2 group by word order by seconds desc`
    )
    .all(Math.round(now), since) as { word: string; seconds: number }[]
  return rows
    .filter((row) => row.seconds > 0)
    .map((row) => ({ word: row.word as Spell['word'], seconds: row.seconds }))
}
