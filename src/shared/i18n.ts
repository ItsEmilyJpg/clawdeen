import type { Locale, StateWord } from './types'

export type { Locale }

/**
 * Two languages, and the words on the board are looked up rather than typed into the code.
 *
 * The state words used to be Czech string literals doing double duty as identifiers: they were the
 * keys of the type, the text on the chip and the rows in the history database all at once, so the
 * board could not say anything in another language without changing what it had already written
 * down. `StateWord` is now a key and everything readable lives here.
 */
export const LOCALES: Locale[] = ['en', 'cs']

/** Anything that is not Czech gets English: one translated language, not a guess at twenty. */
export function localeOf(tag: string): Locale {
  return tag.toLowerCase().startsWith('cs') ? 'cs' : 'en'
}

let chosen: Locale = 'en'

export function setLocale(locale: Locale): void {
  chosen = locale
}

export function locale(): Locale {
  return chosen
}

const STATE_LABELS: Record<Locale, Record<StateWord, string>> = {
  en: {
    working: 'working',
    'gate-running': 'gate running',
    'gate-queued': 'gate queued',
    'task-running': 'task running',
    'task-queued': 'task queued',
    'waiting-for-you': 'waiting for you',
    'waiting-for-ci': 'waiting for CI',
    'waiting-for-issue': 'waiting for issue',
    'waiting-for-other': 'waiting for other',
    'no-pr': 'no PR',
    draft: 'draft',
    conflict: 'conflict',
    'ci-running': 'CI running',
    'ci-red': 'CI red',
    'changes-requested': 'changes requested',
    mergeable: 'ready to merge',
    'in-review': 'in review',
    open: 'open',
    merged: 'merged',
    closed: 'closed'
  },
  cs: {
    working: 'pracuje',
    'gate-running': 'gate běží',
    'gate-queued': 'gate ve frontě',
    'task-running': 'úloha běží',
    'task-queued': 'úloha čeká',
    'waiting-for-you': 'čeká na tebe',
    'waiting-for-ci': 'čeká na CI',
    'waiting-for-issue': 'čeká na issue',
    'waiting-for-other': 'čeká na jiné',
    'no-pr': 'bez PR',
    draft: 'koncept',
    conflict: 'konflikt',
    'ci-running': 'CI běží',
    'ci-red': 'CI červené',
    'changes-requested': 'změny žádané',
    mergeable: 'k mergi',
    'in-review': 'k review',
    open: 'otevřené',
    merged: 'merged',
    closed: 'zavřené'
  }
}

/**
 * What the history already holds. Every stretch written before the states became keys is a Czech
 * word in a database that outlives the vocabulary, so it is read back through this rather than
 * shown raw or dropped.
 */
const LEGACY: Record<string, StateWord> = {
  pracuje: 'working',
  'gate běží': 'gate-running',
  'gate ve frontě': 'gate-queued',
  'úloha běží': 'task-running',
  'úloha čeká': 'task-queued',
  'čeká na tebe': 'waiting-for-you',
  'čeká na CI': 'waiting-for-ci',
  'čeká na issue': 'waiting-for-issue',
  'čeká na jiné': 'waiting-for-other',
  'bez PR': 'no-pr',
  koncept: 'draft',
  konflikt: 'conflict',
  'CI běží': 'ci-running',
  'CI červené': 'ci-red',
  'změny žádané': 'changes-requested',
  'k mergi': 'mergeable',
  'k review': 'in-review',
  otevřené: 'open',
  merged: 'merged',
  zavřené: 'closed'
}

/** A word off the database as a key, or null where it is neither a key nor one of the old words. */
export function asStateWord(word: string): StateWord | null {
  if (word in STATE_LABELS.en) return word as StateWord
  return LEGACY[word] ?? null
}

/**
 * Every word a session title could end with, in any language and from any version.
 *
 * A title is written by whatever named the session, which is not this application and does not
 * follow its language: the hook that names them writes Czech. So stripping the state off a title
 * has to know all of them at once, and this is deliberately not the display language.
 */
export function everyStateWord(): string[] {
  return [
    ...Object.keys(STATE_LABELS.en),
    ...Object.values(STATE_LABELS.en),
    ...Object.values(STATE_LABELS.cs),
    ...Object.keys(LEGACY)
  ]
}

/**
 * The word on the chip. A state the labels do not know is handed back as it stands rather than
 * throwing: the board must draw whatever the history holds, and an unknown word is still honest.
 */
export function stateWord(state: StateWord): string {
  const table: Record<string, string | undefined> = STATE_LABELS[chosen]
  return table[state] ?? state
}

/** The key of a phrase, so a table elsewhere can hold one and still be checked against this list. */
export type PhraseKey = keyof Phrases

interface Phrases {
  justNow: string
  agoMinutes: string
  agoHours: string
  agoDays: string
  seconds: string
  minutes: string
  hours: string
  days: string
  clock: string
  otherLane: string
  noIssue: string
  stale: string
  notRefreshed: string
  account: string
  resetsIn: string
  burnsNothing: string
  burnsIn: string
  noSessions: string
  openBoard: string
  reportState: string
  startAtLogin: string
  quit: string
  wireQuestion: string
  wireDetail: string
  wireConnect: string
  wireLeave: string
  wireDone: string
  wireBackup: string
  wireFailed: string
  waitingTitle: string
  heardWorking: string
  heardAsking: string
  heardEnded: string
  reviewApproved: string
  reviewChanges: string
  reviewRequired: string
  reviewCommented: string
  markPinned: string
  markFocused: string
  markActive: string
  since: string
  checksDone: string
  checksFailed: string
  checksRunning: string
  checksFinished: string
  close: string
  fieldDoing: string
  fieldWaitingOn: string
  fieldLasts: string
  fieldName: string
  fieldBranch: string
  fieldCloses: string
  nothingHeard: string
  unknown: string
  standsOn: string
  openInClaude: string
  readChat: string
  blockState: string
  blockIssue: string
  blockIdentity: string
  fieldState: string
  fieldInState: string
  fieldBeside: string
  fieldHooks: string
  fieldMovement: string
  fieldReview: string
  fieldChecks: string
  fieldFailed: string
  fieldSession: string
  fieldCli: string
  cannotMerge: string
  cardDetail: string
  secondsTitle: string
  narrow: string
  widen: string
  settingsTitle: string
  groupSorting: string
  groupTime: string
  groupAppearance: string
  groupProject: string
  groupActiveWindow: string
  groupOwnOrder: string
  choiceMinutes: string
  choiceSeconds: string
  choiceStripe: string
  choiceRepoName: string
  choiceNone: string
  choiceSystem: string
  choiceLight: string
  choiceDark: string
  choiceHighlight: string
  choiceUnmarked: string
  focusWarning: string
  forget: string
  noOrder: string
  today: string
  all: string
  searchPlaceholder: string
  nothingMatches: string
  lastAt: string
  loading: string
  reading: string
  nothingToRead: string
  prOne: string
  prMany: string
  orderAsLeft: string
  orderByState: string
  choiceNothing: string
  groupLanguage: string
  langEnglish: string
  langCzech: string
  untitled: string
  windowFiveHour: string
  windowSevenDay: string
  pinnedCount: string
  ownOrderUndo: string
  atTime: string
  pace: string
  noKeychainLogin: string
  keychainUnreadable: string
  tokenExpired: string
  usageStatus: string
  usageEmpty: string
  groupProjects: string
  dragProjects: string
  pulseLive: string
  pulseSlow: string
  pulseDead: string
  hiddenCount: string
  hiddenWaiting: string
  showingAll: string
}

const PHRASES: Record<Locale, Phrases> = {
  en: {
    justNow: 'just now',
    agoMinutes: '{n} min ago',
    agoHours: '{n} h ago',
    agoDays: '{n} d ago',
    seconds: 's',
    minutes: 'min',
    hours: 'h',
    days: 'd',
    clock: 'en-GB',
    otherLane: 'other',
    noIssue: 'no issue',
    stale: 'read {n} ago',
    notRefreshed: 'not refreshed: {n}',
    account: 'account {n}',
    resetsIn: 'resets in {n}',
    burnsNothing: 'spends nothing',
    burnsIn: 'spent in {n}',
    noSessions: 'No session in the last seven days',
    openBoard: 'Open the board',
    reportState: 'Report state from Claude hooks',
    startAtLogin: 'Start at login',
    quit: 'Quit',
    wireQuestion: 'Report session state to the board?',
    wireDetail:
      'A hook is added to ~/.claude/settings.json that posts to the loopback on every event, ' +
      'saying what the session is doing. Whatever is there now is kept beside it as ' +
      'settings.json.before-board. Sessions already running pick it up after /hooks or a restart.',
    wireConnect: 'Connect',
    wireLeave: 'Leave it',
    wireDone: 'The hooks are connected.',
    wireBackup: 'Backup: {n}',
    wireFailed: 'It did not work',
    waitingTitle: 'Waiting for you',
    heardWorking: 'working',
    heardAsking: 'asking',
    heardEnded: 'ended',
    reviewApproved: 'approved',
    reviewChanges: 'changes requested',
    reviewRequired: 'review required',
    reviewCommented: 'commented',
    markPinned: 'pinned',
    markFocused: 'open in Claude',
    markActive: 'moving right now',
    since: 'since {n}',
    checksDone: '{n} done',
    checksFailed: '{n} failed',
    checksRunning: 'running {n}',
    checksFinished: 'finished {n}',
    close: 'Close',
    fieldDoing: 'doing',
    fieldWaitingOn: 'waiting on',
    fieldLasts: 'lasts',
    fieldName: 'name',
    fieldBranch: 'branch',
    fieldCloses: 'closes',
    nothingHeard: 'nothing heard',
    unknown: 'not known',
    standsOn: 'stands on it',
    openInClaude: 'Open in Claude',
    readChat: 'Read the chat',
    blockState: 'State',
    blockIssue: 'Issue',
    blockIdentity: 'Identity',
    fieldState: 'state',
    fieldInState: 'in state',
    fieldBeside: 'beside it',
    fieldHooks: 'hooks',
    fieldMovement: 'movement',
    fieldReview: 'review',
    fieldChecks: 'checks',
    fieldFailed: 'failed',
    fieldSession: 'session',
    fieldCli: 'cli',
    cannotMerge: 'cannot be merged',
    cardDetail: 'Everything known about the session',
    secondsTitle: 'Seconds',
    narrow: 'Narrow',
    widen: 'Widen',
    settingsTitle: 'Settings',
    groupSorting: 'Sorting',
    groupTime: 'Time',
    groupAppearance: 'Appearance',
    groupProject: 'Project on the card',
    groupActiveWindow: 'Active window',
    groupOwnOrder: 'Own order',
    choiceMinutes: 'minutes',
    choiceSeconds: 'seconds',
    choiceStripe: 'stripe',
    choiceRepoName: 'name',
    choiceNone: 'neither',
    choiceSystem: 'system',
    choiceLight: 'light',
    choiceDark: 'dark',
    choiceHighlight: 'outline',
    choiceUnmarked: 'no mark',
    focusWarning:
      'The app writes its focus with a delay, so the outline sits on the wrong card for a moment.',
    forget: 'forget it',
    noOrder: 'none yet',
    today: 'today',
    all: 'all',
    searchPlaceholder: 'search  ⌘F',
    nothingMatches: 'Nothing matches.',
    lastAt: 'last {n}',
    loading: 'loading',
    reading: 'Reading…',
    nothingToRead: 'Nothing can be read from this session.',
    prOne: 'Pull request',
    prMany: 'Pull requests',
    orderAsLeft: 'as left',
    orderByState: 'by state',
    choiceNothing: 'nothing',
    groupLanguage: 'Language',
    langEnglish: 'English',
    langCzech: 'Czech',
    untitled: '(untitled)',
    windowFiveHour: '5 hours',
    windowSevenDay: '7 days',
    pinnedCount: 'pinned',
    ownOrderUndo: 'own order ×',
    atTime: 'at {n}',
    pace: 'pace {n}×',
    noKeychainLogin: 'the Keychain holds no login, `claude /login` helps',
    keychainUnreadable: 'the login in the Keychain cannot be read',
    tokenExpired: 'the token expired, the renewal is left to Claude Code',
    usageStatus: 'usage answered {n}',
    usageEmpty: 'usage returned no window',
    groupProjects: 'Projects',
    dragProjects: 'Click to switch a repository off, drag to put it where you want it',
    pulseLive: 'read {n} ago, still being read',
    pulseSlow: 'read {n} ago, a sweep has been missed',
    pulseDead: 'read {n} ago and not since: what stands here is old',
    hiddenCount: '{n} hidden',
    hiddenWaiting: '{n} waiting',
    showingAll: 'showing all'
  },
  cs: {
    justNow: 'právě teď',
    agoMinutes: 'před {n} min',
    agoHours: 'před {n} h',
    agoDays: 'před {n} d',
    seconds: 's',
    minutes: 'min',
    hours: 'h',
    days: 'd',
    clock: 'cs-CZ',
    otherLane: 'ostatní',
    noIssue: 'bez issue',
    stale: 'stav před {n}',
    notRefreshed: 'neobnoveno: {n}',
    account: 'účet {n}',
    resetsIn: 'reset za {n}',
    burnsNothing: 'nespálíš nic',
    burnsIn: 'spálíš za {n}',
    noSessions: 'Žádná session za posledních sedm dní',
    openBoard: 'Otevřít přehled',
    reportState: 'Hlásit stav z Claude hooků',
    startAtLogin: 'Spouštět po přihlášení',
    quit: 'Ukončit',
    wireQuestion: 'Zapojit stav ze session do desky?',
    wireDetail:
      'Přidá se hook do ~/.claude/settings.json, který při každé události pošle na loopback, co ' +
      'session dělá. Co tam je teď, se uloží vedle jako settings.json.before-board. Session, ' +
      'které už běží, ho načtou po /hooks nebo po restartu.',
    wireConnect: 'Zapojit',
    wireLeave: 'Nechat být',
    wireDone: 'Hooky jsou zapojené.',
    wireBackup: 'Záloha: {n}',
    wireFailed: 'Nešlo to',
    waitingTitle: 'Čeká na tebe',
    heardWorking: 'pracuje',
    heardAsking: 'ptá se',
    heardEnded: 'skončila',
    reviewApproved: 'schváleno',
    reviewChanges: 'změny žádané',
    reviewRequired: 'čeká na review',
    reviewCommented: 'okomentováno',
    markPinned: 'připnutá',
    markFocused: 'otevřená v Claude',
    markActive: 'právě se hýbe',
    since: 'od {n}',
    checksDone: '{n} hotovo',
    checksFailed: '{n} spadlo',
    checksRunning: 'běží {n}',
    checksFinished: 'doběhlo {n}',
    close: 'Zavřít',
    fieldDoing: 'dělá',
    fieldWaitingOn: 'čeká na',
    fieldLasts: 'trvá',
    fieldName: 'název',
    fieldBranch: 'větev',
    fieldCloses: 'zavírá',
    nothingHeard: 'nic neslyšeno',
    unknown: 'neví se',
    standsOn: 'stojí na něm',
    openInClaude: 'Otevřít v Claude',
    readChat: 'Přečíst chat',
    blockState: 'Stav',
    blockIssue: 'Issue',
    blockIdentity: 'Identita',
    fieldState: 'stav',
    fieldInState: 've stavu',
    fieldBeside: 'vedle toho',
    fieldHooks: 'hooky',
    fieldMovement: 'pohyb',
    fieldReview: 'review',
    fieldChecks: 'checky',
    fieldFailed: 'spadlo',
    fieldSession: 'session',
    fieldCli: 'cli',
    cannotMerge: 'nejde zmergovat',
    cardDetail: 'Vše, co se o session ví',
    secondsTitle: 'Vteřiny',
    narrow: 'Zúžit',
    widen: 'Rozšířit',
    settingsTitle: 'Nastavení',
    groupSorting: 'Řazení',
    groupTime: 'Čas',
    groupAppearance: 'Vzhled',
    groupProject: 'Projekt na kartě',
    groupActiveWindow: 'Aktivní okno',
    groupOwnOrder: 'Vlastní pořadí',
    choiceMinutes: 'minuty',
    choiceSeconds: 'vteřiny',
    choiceStripe: 'proužek',
    choiceRepoName: 'jméno',
    choiceNone: 'ani jedno',
    choiceSystem: 'systém',
    choiceLight: 'světlý',
    choiceDark: 'tmavý',
    choiceHighlight: 'zvýraznit',
    choiceUnmarked: 'neoznačovat',
    focusWarning:
      'Appka svůj focus zapisuje se zpožděním, takže rámeček chvíli sedí na cizí kartě.',
    forget: 'zapomenout',
    noOrder: 'žádné není',
    today: 'dnes',
    all: 'vše',
    searchPlaceholder: 'hledat  ⌘F',
    nothingMatches: 'Nic, co by sedělo.',
    lastAt: 'naposledy {n}',
    loading: 'načítá se',
    reading: 'Čte se…',
    nothingToRead: 'Z téhle session se nedá nic přečíst.',
    prOne: 'Pull request',
    prMany: 'Pull requesty',
    orderAsLeft: 'jak jsi nechala',
    orderByState: 'podle stavu',
    choiceNothing: 'nic',
    groupLanguage: 'Jazyk',
    langEnglish: 'anglicky',
    langCzech: 'česky',
    untitled: '(bez názvu)',
    windowFiveHour: '5 hodin',
    windowSevenDay: '7 dní',
    pinnedCount: 'připnuté',
    ownOrderUndo: 'vlastní pořadí ×',
    atTime: 'v {n}',
    pace: 'tempo {n}×',
    noKeychainLogin: 'Keychain nemá přihlášení, pomůže `claude /login`',
    keychainUnreadable: 'přihlášení v Keychainu se nedá přečíst',
    tokenExpired: 'token vypršel, obnovu nechávám Claude Code',
    usageStatus: 'usage odpovědělo {n}',
    usageEmpty: 'usage nevrátilo žádné okno',
    groupProjects: 'Projekty',
    dragProjects: 'Kliknutím repozitář vypneš, přetažením ho přesuneš',
    pulseLive: 'načteno před {n}, čte se dál',
    pulseSlow: 'načteno před {n}, jedno čtení vypadlo',
    pulseDead: 'načteno před {n} a od té doby ne: co je tu vidět, je staré',
    hiddenCount: 'skrytých {n}',
    hiddenWaiting: '{n} čeká',
    showingAll: 'zobrazeno vše'
  }
}

/** One phrase in the current language, with `{n}` filled in where it carries a value. */
export function say(key: keyof Phrases, value?: string | number): string {
  const phrase = PHRASES[chosen][key]
  return value === undefined ? phrase : phrase.replace('{n}', String(value))
}

/** A decimal, pointed the way the language points it. */
export function decimal(value: number, places: number): string {
  const said = value.toFixed(places)
  return chosen === 'cs' ? said.replace('.', ',') : said
}

/** How many tools a turn called. Czech counts in three, English in two, so this is not a phrase. */
export function toolCount(count: number): string {
  if (chosen === 'cs') {
    const word = count === 1 ? 'nástroj' : count < 5 ? 'nástroje' : 'nástrojů'
    return `${count} ${word}`
  }
  return `${count} tool${count === 1 ? '' : 's'}`
}
