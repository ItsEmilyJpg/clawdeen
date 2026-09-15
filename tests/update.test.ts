import { describe, expect, it } from 'vitest'

import { assetFor, newer, offered, versionParts } from '../src/main/update'

/** The shape of the release the workflow publishes, cut down to the fields that are read. */
function release(
  tag: string,
  assets: string[] = [`Clawdeen-${tag.replace(/^v/, '')}-arm64.zip`],
  extra: { draft?: boolean; prerelease?: boolean } = {}
): Parameters<typeof offered>[0] {
  return {
    tag_name: tag,
    html_url: `https://github.com/ItsEmilyJpg/clawdeen/releases/tag/${tag}`,
    draft: extra.draft ?? false,
    prerelease: extra.prerelease ?? false,
    assets: assets.map((name) => ({
      name,
      browser_download_url: `https://example.invalid/${name}`
    }))
  }
}

describe('versionParts', () => {
  it('reads the three numbers, with or without the tag letter', () => {
    expect(versionParts('1.2.3')).toEqual([1, 2, 3])
    expect(versionParts('v1.2.3')).toEqual([1, 2, 3])
    expect(versionParts(' 10.0.11 ')).toEqual([10, 0, 11])
  })

  it('refuses anything that is not exactly three numbers', () => {
    expect(versionParts('1.2')).toBeUndefined()
    expect(versionParts('1.2.3-beta.1')).toBeUndefined()
    expect(versionParts('nightly')).toBeUndefined()
  })
})

describe('newer', () => {
  it('compares the numbers rather than the text', () => {
    // The text comparison every hand-rolled updater gets wrong: '1.0.10' sorts before '1.0.9'.
    expect(newer('1.0.10', '1.0.9')).toBe(true)
    expect(newer('1.0.9', '1.0.10')).toBe(false)
    expect(newer('2.0.0', '1.99.99')).toBe(true)
    expect(newer('1.1.0', '1.0.99')).toBe(true)
  })

  it('is false for the same version and for anything it cannot read', () => {
    expect(newer('1.0.4', '1.0.4')).toBe(false)
    expect(newer('1.0.5-rc.1', '1.0.4')).toBe(false)
    expect(newer('1.0.5', 'unknown')).toBe(false)
  })
})

describe('assetFor', () => {
  it('picks the archive built for this architecture', () => {
    const assets = [
      { name: 'Clawdeen-1.0.5-x64.zip', browser_download_url: 'x' },
      { name: 'Clawdeen-1.0.5-arm64.zip', browser_download_url: 'a' }
    ]
    expect(assetFor(assets, 'arm64')).toBe('a')
    expect(assetFor(assets, 'x64')).toBe('x')
  })

  it('offers nothing rather than the wrong one when its architecture is missing', () => {
    expect(
      assetFor([{ name: 'Clawdeen-1.0.5-arm64.zip', browser_download_url: 'a' }], 'x64')
    ).toBeUndefined()
  })
})

describe('offered', () => {
  it('offers a newer release with an archive for this machine', () => {
    expect(offered(release('v1.0.5'), '1.0.4', 'arm64')).toEqual({
      current: '1.0.4',
      latest: '1.0.5',
      url: 'https://example.invalid/Clawdeen-1.0.5-arm64.zip',
      page: 'https://github.com/ItsEmilyJpg/clawdeen/releases/tag/v1.0.5',
      stage: 'offered'
    })
  })

  it('offers nothing when the release is not ahead of what is running', () => {
    expect(offered(release('v1.0.4'), '1.0.4', 'arm64')).toBeNull()
    expect(offered(release('v1.0.3'), '1.0.4', 'arm64')).toBeNull()
  })

  it('offers nothing for a draft or a prerelease', () => {
    expect(offered(release('v1.0.5', undefined, { draft: true }), '1.0.4', 'arm64')).toBeNull()
    expect(offered(release('v1.0.5', undefined, { prerelease: true }), '1.0.4', 'arm64')).toBeNull()
  })

  it('offers nothing when the release carries no archive this machine can run', () => {
    expect(offered(release('v1.0.5', ['Clawdeen-1.0.5-x64.zip']), '1.0.4', 'arm64')).toBeNull()
    expect(offered(release('v1.0.5', []), '1.0.4', 'arm64')).toBeNull()
  })
})
