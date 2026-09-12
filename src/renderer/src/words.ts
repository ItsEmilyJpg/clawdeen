import type { StateWord } from '../../shared/types'

export { ago, clock, inWords } from '../../shared/words'

/** One class per word, the same names the stylesheet colours. */
export const STATE_CLASS: { [key in StateWord]: string } = {
  pracuje: 's-working',
  'gate běží': 's-gate',
  'gate ve frontě': 's-queued',
  'úloha běží': 's-task',
  'čeká na tebe': 's-waiting',
  'bez PR': 's-none',
  koncept: 's-draft',
  konflikt: 's-conflict',
  'CI běží': 's-running',
  'CI červené': 's-failing',
  'změny žádané': 's-changes',
  'k mergi': 's-mergeable',
  'k review': 's-review',
  otevřené: 's-review',
  sloučené: 's-merged',
  zavřené: 's-closed'
}

/** The order the filter bar counts them in: what a session is doing first, where its change stands after. */
export const STATE_ORDER = Object.keys(STATE_CLASS) as StateWord[]
