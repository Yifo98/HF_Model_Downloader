const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const projectRoot = join(__dirname, '..')
const sourceFile = join(projectRoot, 'assets', 'branding', 'github-sol-card.html')
const outputFile = join(projectRoot, 'assets', 'github-sol-card.png')
const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('force-device-scale-factor', '1')

async function renderCard() {
  const window = new BrowserWindow({
    width: 1600,
    height: 640,
    show: false,
    useContentSize: true,
    backgroundColor: '#f6f3fb',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  await window.loadFile(sourceFile)
  await window.webContents.executeJavaScript(`
    document.querySelector('#release-version').textContent = ${JSON.stringify(`RELEASE ${packageJson.version}`)};
    document.fonts.ready;
  `)
  const image = await window.webContents.capturePage({ x: 0, y: 0, width: 1600, height: 640 })
  const size = image.getSize()
  if (size.width !== 1600 || size.height !== 640) {
    throw new Error(`Unexpected brand card size: ${size.width}x${size.height}`)
  }
  writeFileSync(outputFile, image.toPNG())
  window.destroy()
  app.quit()
}

app.whenReady().then(renderCard).catch((error) => {
  console.error(error)
  app.exit(1)
})

app.on('window-all-closed', () => app.quit())
