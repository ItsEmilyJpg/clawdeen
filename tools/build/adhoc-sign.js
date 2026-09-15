// Puts a signature back on the bundle, so a downloaded copy opens at all.
//
// Apple silicon refuses to run a binary whose signature does not check out, and the message it
// gives is that the application is damaged, not that it is unsigned. Electron ships ad-hoc signed;
// electron-builder then renames the bundle and adds to it, which invalidates that signature, and
// `identity: null` tells it not to put one back. Built here it still ran, because a file that was
// never downloaded carries no quarantine flag and macOS does not look; the first person to download
// it was told to move it to the bin.
//
// So it is signed again, ad-hoc: no developer account, no notarisation, and a bundle that verifies.
// A downloaded copy is still stopped once, because Gatekeeper asks for notarisation and not for a
// signature; right click and Open no longer answers that on macOS 26, so README says what does.
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  // Verified rather than assumed: a signature that did not take reads exactly like one that did,
  // and the difference only shows up on somebody else's Mac.
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
  console.log(`ad-hoc signed and verified: ${app}`)
}
