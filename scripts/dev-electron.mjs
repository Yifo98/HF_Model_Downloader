import { spawn } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const devServerCandidates = ['http://127.0.0.1:5173/', 'http://localhost:5173/']

async function waitForRenderer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    for (const candidate of devServerCandidates) {
      try {
        const response = await fetch(candidate, { method: 'GET' })
        if (response.ok) return candidate
      } catch {
        // Keep polling.
      }
    }
    await delay(500)
  }

  throw new Error(`Renderer did not become reachable: ${devServerCandidates.join(', ')}`)
}

async function resolveElectronCommand() {
  const localBin = process.platform === 'win32'
    ? join(process.cwd(), 'node_modules', '.bin', 'electron.cmd')
    : join(process.cwd(), 'node_modules', '.bin', 'electron')

  await access(localBin, constants.F_OK)
  return localBin
}

const devServerUrl = await waitForRenderer()
const electronCommand = await resolveElectronCommand()

const child = spawn(electronCommand, ['.'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: devServerUrl,
  },
})

child.on('exit', (code) => {
  process.exit(code ?? 0)
})
