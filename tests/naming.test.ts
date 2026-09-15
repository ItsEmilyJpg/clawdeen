import { afterEach, describe, expect, it } from 'vitest'

import { markTitle } from '../src/main/naming'
import { setLocale } from '../src/shared/i18n'

afterEach(() => setLocale('en'))

describe('markTitle', () => {
  it('says in the name of the session that it is parked', () => {
    setLocale('cs')
    expect(markTitle('bez issue · board · sbalení lane · bez PR', true)).toBe(
      'ODLOŽENO - bez issue · board · sbalení lane · bez PR'
    )
  })

  it('marks it in the language the window speaks', () => {
    setLocale('en')
    expect(markTitle('no issue · board', true)).toBe('ON HOLD - no issue · board')
  })

  it('does not stack the mark on a name that already carries it', () => {
    setLocale('cs')
    expect(markTitle(markTitle('název', true), true)).toBe('ODLOŽENO - název')
  })

  it('takes off a mark left by the other language', () => {
    setLocale('cs')
    expect(markTitle('ON HOLD - název', true)).toBe('ODLOŽENO - název')
    setLocale('en')
    expect(markTitle('ODLOŽENO - název', false)).toBe('název')
  })

  it('recognises the mark she writes by hand, accents or none', () => {
    setLocale('cs')
    expect(markTitle('ODLOZENO - #14 · k review', true)).toBe('ODLOŽENO - #14 · k review')
    expect(markTitle('ODLOZENO - #14 · k review', false)).toBe('#14 · k review')
  })

  it('leaves a name that was never marked alone when it comes off hold', () => {
    setLocale('cs')
    expect(markTitle('název', false)).toBe('název')
  })

  it('leaves a name that only mentions the word alone', () => {
    setLocale('cs')
    expect(markTitle('proč je ODLOŽENO tak dlouho', false)).toBe('proč je ODLOŽENO tak dlouho')
  })
})
