import { app } from 'electron'
import { execFile } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { once } from 'node:events'
import { promisify } from 'node:util'

import type { Update } from '../shared/types'

const run = promisify(execFile)

/**
 * Written down rather than read off `package.json`, which is inside the asar at runtime and would
 * have to be bundled to be asked. Moving the repository means changing this line.
 */
const REPO = 'ItsEmilyJpg/clawdeen'
const LATEST = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASES = `https://github.com/${REPO}/releases`
/** Exported so the About panel and the settings row say the same address this asks. */
export const REPO_URL = `https://github.com/${REPO}`
/** Unauthenticated, so the answer has to be small and the wait has to end. */
const ASK_TIMEOUT = 10_000
const FETCH_TIMEOUT = 300_000
/** What the old bundle is renamed to while the new one takes its place, and swept at the next start. */
const RETIRED = '.clawdeen-replaced-'
const STAGING = '.clawdeen-update-'

interface Asset {
  name: string
  browser_download_url: string
}

interface Release {
  tag_name: string
  html_url: string
  draft: boolean
  prerelease: boolean
  assets: Asset[]
}

/** Three numbers and nothing else. A tag carrying a suffix is not offered rather than guessed at. */
export function versionParts(text: string): [number, number, number] | undefined {
  const found = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text.trim())
  return found ? [Number(found[1]), Number(found[2]), Number(found[3])] : undefined
}

/** True only when `latest` is genuinely ahead; an unreadable version on either side is never ahead. */
export function newer(latest: string, current: string): boolean {
  const there = versionParts(latest)
  const here = versionParts(current)
  if (!there || !here) return false
  for (let at = 0; at < 3; at++) {
    if (there[at] !== here[at]) return there[at] > here[at]
  }
  return false
}

/**
 * The asset built for this machine's architecture. Matched on the suffix the release workflow
 * writes, so a release that ever carries two of them hands each machine its own.
 */
export function assetFor(assets: Asset[], arch: string): string | undefined {
  return assets.find((one) => one.name.endsWith(`-${arch}.zip`))?.browser_download_url
}

/** The release that would replace this one, or null when there is none and when the ask fails. */
export function offered(release: Release, current: string, arch: string): Update | null {
  if (release.draft || release.prerelease) return null
  const latest = release.tag_name.replace(/^v/, '')
  if (!newer(latest, current)) return null
  const url = assetFor(release.assets, arch)
  if (!url) return null
  return { current, latest, url, page: release.html_url || RELEASES, stage: 'offered' }
}

export async function check(): Promise<Update | null> {
  try {
    const answer = await fetch(LATEST, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': `Clawdeen/${app.getVersion()}`
      },
      signal: AbortSignal.timeout(ASK_TIMEOUT)
    })
    if (!answer.ok) {
      console.warn(`update check: GitHub answered ${answer.status}`)
      return null
    }
    return offered((await answer.json()) as Release, app.getVersion(), process.arch)
  } catch (error) {
    console.warn(`update check: ${(error as Error).message}`)
    return null
  }
}

/** The `.app` this process is running out of, refused when the path is not one. */
function bundle(): string {
  const found = resolve(app.getPath('exe'), '..', '..', '..')
  if (!found.endsWith('.app')) throw new Error(`Not running out of a bundle: ${found}`)
  return found
}

/**
 * The bundles a previous update left behind. A running bundle cannot delete itself, so the one it
 * replaced is renamed out of the way and removed here, by the process that came after it.
 */
export async function sweepReplaced(): Promise<void> {
  if (!app.isPackaged) return
  try {
    const beside = dirname(bundle())
    for (const name of await readdir(beside)) {
      if (name.startsWith(RETIRED) || name.startsWith(STAGING)) {
        await rm(join(beside, name), { recursive: true, force: true })
      }
    }
  } catch (error) {
    console.warn(`update sweep: ${(error as Error).message}`)
  }
}

async function download(url: string, to: string): Promise<void> {
  const answer = await fetch(url, {
    headers: { 'user-agent': `Clawdeen/${app.getVersion()}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT)
  })
  if (!answer.ok || !answer.body) throw new Error(`Download answered ${answer.status}`)
  // Read chunk by chunk rather than into a buffer: the bundle is over a hundred megabytes, and a
  // menu bar application has no business holding that in memory to write it straight back out.
  const file = createWriteStream(to)
  const reader = answer.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!file.write(value)) await once(file, 'drain')
    }
    file.end()
    await once(file, 'finish')
  } finally {
    reader.releaseLock()
    file.destroy()
  }
}

/** The `CFBundleIdentifier` a bundle on disk carries, which no Electron API hands back. */
async function identifierOf(at: string): Promise<string> {
  const { stdout } = await run('defaults', [
    'read',
    join(at, 'Contents', 'Info'),
    'CFBundleIdentifier'
  ])
  return stdout.trim()
}

/**
 * What macOS will ask of the bundle before it runs it, asked here instead while there is still
 * somebody to tell. The signature is ad-hoc, so this proves the download is whole and signed, not
 * who signed it; the identifier is checked as well, because a verified bundle can still be the
 * wrong application.
 */
async function vetted(candidate: string, expected: string): Promise<void> {
  // A file this process wrote carries no quarantine flag, but an archive can carry one on its
  // contents, and a quarantined bundle is the one macOS calls damaged.
  await run('xattr', ['-dr', 'com.apple.quarantine', candidate]).catch(() => undefined)
  await run('codesign', ['--verify', '--deep', '--strict', candidate])
  const identifier = await identifierOf(candidate)
  if (identifier !== expected) {
    throw new Error(`The downloaded bundle is ${identifier}, not ${expected}`)
  }
}

/**
 * Puts the downloaded bundle where this one is and restarts into it.
 *
 * Squirrel, which is what `electron-updater` drives, checks a new bundle against the running one's
 * designated requirement. Ad-hoc signing makes that requirement a `cdhash` of one exact build, so
 * no later build can ever satisfy it and that route is closed until there is a Developer ID. This
 * does the same job by hand: fetch, verify, swap, relaunch.
 *
 * The staging directory sits beside the bundle rather than in the temporary folder, so the move
 * into place is a rename within one directory and never a copy across a volume that could be
 * interrupted half way.
 */
export async function install(from: string): Promise<void> {
  if (!app.isPackaged) throw new Error('A development run has no bundle to replace.')
  const live = bundle()
  const beside = dirname(live)
  const stage = await mkdtemp(join(beside, STAGING))
  try {
    const archive = join(stage, 'update.zip')
    await download(from, archive)
    const opened = join(stage, 'opened')
    // ditto rather than unzip: it is what the release workflow packed with, and it keeps the
    // symlinks and the metadata a bundle stops opening without.
    await run('ditto', ['-x', '-k', archive, opened])
    const inside = (await readdir(opened)).find((name) => name.endsWith('.app'))
    if (!inside) throw new Error('The archive holds no application bundle')
    const candidate = join(opened, inside)
    // Read off the running bundle rather than written here, so it cannot drift from the identifier
    // `electron-builder.yml` actually builds with.
    await vetted(candidate, await identifierOf(live))

    const retired = join(beside, `${RETIRED}${Date.now()}`)
    await rename(live, retired)
    try {
      await rename(candidate, live)
    } catch (error) {
      // Nothing is worse than a board that is gone: the old bundle goes back before this is reported.
      await rename(retired, live)
      throw error
    }
    await rm(stage, { recursive: true, force: true })
    app.relaunch()
    app.quit()
  } catch (error) {
    await rm(stage, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}
