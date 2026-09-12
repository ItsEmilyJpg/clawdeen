// Draws the application and tray icons, so they are reproducible rather than a binary nobody can
// edit. Run with `npm run icons`; it renders the SVG below in an offscreen window and writes the
// PNGs electron-builder and the tray read.
const { app, BrowserWindow } = require('electron')
const { writeFile, mkdir } = require('node:fs/promises')
const { join } = require('node:path')

const root = join(__dirname, '..', '..')

/** The board seen from far away: rows of sessions, the top one wanting an answer. */
const appIcon = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1b2530"/>
      <stop offset="1" stop-color="#0d1319"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="228" fill="url(#ground)"/>
  <rect x="150" y="252" width="724" height="152" rx="46" fill="#1f2a35"/>
  <rect x="150" y="436" width="724" height="152" rx="46" fill="#1c2630"/>
  <rect x="150" y="620" width="724" height="152" rx="46" fill="#19222b"/>
  <circle cx="238" cy="328" r="40" fill="#f0a17a"/>
  <circle cx="238" cy="512" r="40" fill="#64c39a"/>
  <circle cx="238" cy="696" r="40" fill="#4a5964"/>
  <rect x="318" y="306" width="404" height="44" rx="22" fill="#cfd9e2"/>
  <rect x="318" y="490" width="330" height="44" rx="22" fill="#8b98a4"/>
  <rect x="318" y="674" width="246" height="44" rx="22" fill="#66727d"/>
</svg>`

/** The menu bar wants one colour and the system inverts it, so this is black on nothing. */
const trayIcon = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 36 36">
  <circle cx="6" cy="8" r="3.4" fill="#000"/>
  <circle cx="6" cy="18" r="3.4" fill="#000"/>
  <circle cx="6" cy="28" r="3.4" fill="#000"/>
  <rect x="13" y="5.6" width="22" height="4.8" rx="2.4" fill="#000"/>
  <rect x="13" y="15.6" width="17" height="4.8" rx="2.4" fill="#000"/>
  <rect x="13" y="25.6" width="12" height="4.8" rx="2.4" fill="#000"/>
</svg>`

let sheet = null

/** One window for every icon: a second transparent offscreen window refuses to load at all. */
async function open() {
  sheet = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true }
  })
  const page = join(app.getPath('temp'), 'claude-sessions-icon.html')
  await writeFile(page, '<body style="margin:0;background:transparent"></body>')
  await sheet.loadFile(page)
}

async function draw(svg, size, path) {
  sheet.setContentSize(size, size)
  await sheet.webContents.executeJavaScript(`document.body.innerHTML = ${JSON.stringify(svg)}`)
  // Capturing straight after the write gives the previous frame, or an empty one.
  await new Promise((resolve) => setTimeout(resolve, 250))
  const image = await sheet.webContents.capturePage()
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, image.toPNG())
  console.log(`${path} ${image.getSize().width}×${image.getSize().height}`)
}

app.whenReady().then(async () => {
  await open()
  await draw(appIcon(1024), 1024, join(root, 'build', 'icon.png'))
  await draw(appIcon(512), 512, join(root, 'resources', 'icon.png'))
  await draw(trayIcon(18), 18, join(root, 'resources', 'trayTemplate.png'))
  await draw(trayIcon(36), 36, join(root, 'resources', 'trayTemplate@2x.png'))
  sheet.destroy()
  app.exit(0)
})
