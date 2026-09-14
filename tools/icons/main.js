// Draws the application and tray icons, so they are reproducible rather than a binary nobody can
// edit. Run with `npm run icons`; it renders the SVG below in an offscreen window and writes the
// PNGs electron-builder and the tray read.
const { app, BrowserWindow } = require('electron')
const { writeFile, mkdir } = require('node:fs/promises')
const { join } = require('node:path')

const root = join(__dirname, '..', '..')

/**
 * One claw mark: widest where the claw bit, tapering to a point where it left. Two curves from tip
 * to tip, so nothing is stroked and the shape stays the same at every size.
 */
const claw = (x, lean, long, fill) => `
  <path fill="${fill}"
        transform="translate(${x} 0) rotate(${lean} 512 512)
                   translate(512 512) scale(1 ${long}) translate(-512 -512)"
        d="M470 214
           C 592 384 620 610 578 838
           C 520 606 442 392 470 214 Z"/>`

/**
 * Three claw marks across the ground, leaning as one strike rather than standing side by side, and
 * in the colours a row uses for what wants an answer, what is running and what is only sitting.
 */
const appIcon = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1b2530"/>
      <stop offset="1" stop-color="#0d1319"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="228" fill="url(#ground)"/>
  <g transform="rotate(-24 512 512)">
    ${claw(-170, -9, 0.84, '#f0a17a')}
    ${claw(0, 0, 1, '#64c39a')}
    ${claw(170, 9, 0.9, '#7c8b98')}
  </g>
</svg>`

/** The menu bar wants one colour and the system inverts it, so this is black on nothing. */
const trayIcon = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 36 36">
  <g fill="#000" transform="rotate(-24 18 18)">
    <path transform="translate(-6.5 0) rotate(-9 18 18)"
          d="M16.5 7.5 C20.8 13.5 21.8 21.4 20.3 29.5 C18.3 21.3 15.5 13.8 16.5 7.5 Z"/>
    <path d="M16.5 7.5 C20.8 13.5 21.8 21.4 20.3 29.5 C18.3 21.3 15.5 13.8 16.5 7.5 Z"/>
    <path transform="translate(6.5 0) rotate(9 18 18)"
          d="M16.5 7.5 C20.8 13.5 21.8 21.4 20.3 29.5 C18.3 21.3 15.5 13.8 16.5 7.5 Z"/>
  </g>
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
  const page = join(app.getPath('temp'), 'clawdeen-icon.html')
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
