import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertAllowedUpdateUrl, UpdateService } from './updateService.js'

const VERSION = '5.6.1'
const PACKAGE_NAME = `HF-Model-Downloader-${VERSION}-mac-arm64-portable.zip`
const PACKAGE_URL = `https://github.com/Yifo98/HF_Model_Downloader/releases/download/v${VERSION}/${PACKAGE_NAME}`
const CHECKSUM_URL = `https://github.com/Yifo98/HF_Model_Downloader/releases/download/v${VERSION}/SHA256SUMS.txt`

function inputUrl(input: string | URL | Request) {
  return typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
}

function buildRelease(payload: Buffer, sha256: string) {
  const checksum = `${sha256}  ${PACKAGE_NAME}\n`
  return {
    release: {
      tag_name: `v${VERSION}`,
      name: `HF Model Downloader ${VERSION}`,
      body: '- safer update workflow',
      published_at: '2026-07-10T00:00:00Z',
      html_url: `https://github.com/Yifo98/HF_Model_Downloader/releases/tag/v${VERSION}`,
      draft: false,
      prerelease: false,
      assets: [
        { name: PACKAGE_NAME, size: payload.length, browser_download_url: PACKAGE_URL },
        { name: 'SHA256SUMS.txt', size: Buffer.byteLength(checksum), browser_download_url: CHECKSUM_URL },
      ],
    },
    checksum,
  }
}

function createFetch(payload: Buffer, checksumOverride?: string) {
  const sha256 = createHash('sha256').update(payload).digest('hex')
  const metadata = buildRelease(payload, checksumOverride ?? sha256)
  return async (input: string | URL | Request) => {
    const url = inputUrl(input)
    if (url === 'https://api.github.com/repos/Yifo98/HF_Model_Downloader/releases/latest') {
      return new Response(JSON.stringify(metadata.release), { status: 200 })
    }
    if (url === CHECKSUM_URL) return new Response(metadata.checksum, { status: 200 })
    if (url === PACKAGE_URL) {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://release-assets.githubusercontent.com/signed/package' },
      })
    }
    if (url === 'https://release-assets.githubusercontent.com/signed/package') {
      return new Response(payload, { status: 200, headers: { 'content-length': String(payload.length) } })
    }
    return new Response('not found', { status: 404 })
  }
}

test('update service selects the exact portable package and verifies it before manual handoff', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hf-updates-'))
  const payload = Buffer.from('portable update payload')
  try {
    const service = new UpdateService({
      currentVersion: '5.6.0',
      platform: 'darwin',
      arch: 'arm64',
      updatesDir: root,
      fetchImpl: createFetch(payload) as typeof fetch,
    })
    const check = await service.checkForUpdates()
    assert.equal(check.updateAvailable, true)
    assert.equal(check.downloadUrl, PACKAGE_URL)
    assert.equal(check.packageSize, payload.length)
    assert.equal(check.sha256, createHash('sha256').update(payload).digest('hex'))
    assert.match(check.releaseNotes, /safer update workflow/)

    const prepared = await service.prepareUpdate()
    assert.equal(prepared.ready, true)
    assert.equal(prepared.verified, true)
    assert.equal(existsSync(prepared.packagePath!), true)

    const apply = await service.applyPreparedUpdate()
    assert.equal(apply.started, false)
    assert.equal(apply.requiredManual, true)
    assert.equal(apply.packagePath, realpathSync.native(prepared.packagePath!))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('update service refuses a package whose bytes do not match SHA256SUMS', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hf-updates-bad-hash-'))
  try {
    const service = new UpdateService({
      currentVersion: '5.6.0',
      platform: 'darwin',
      arch: 'arm64',
      updatesDir: root,
      fetchImpl: createFetch(Buffer.from('tampered'), '0'.repeat(64)) as typeof fetch,
    })
    await assert.rejects(service.prepareUpdate(), /SHA-256/)
    assert.equal(existsSync(join(root, PACKAGE_NAME)), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('only fixed HTTPS GitHub hosts are valid update and redirect targets', () => {
  assert.equal(assertAllowedUpdateUrl('https://github.com/Yifo98/HF_Model_Downloader').hostname, 'github.com')
  assert.equal(assertAllowedUpdateUrl('https://release-assets.githubusercontent.com/signed/package').hostname, 'release-assets.githubusercontent.com')
  assert.throws(() => assertAllowedUpdateUrl('http://github.com/Yifo98/HF_Model_Downloader'))
  assert.throws(() => assertAllowedUpdateUrl('https://github.com.evil.example/package'))
  assert.throws(() => assertAllowedUpdateUrl('https://raw.githubusercontent.com/Yifo98/HF_Model_Downloader/main/package.zip'))
  assert.throws(() => assertAllowedUpdateUrl('https://example.com/package'))
})

test('forged prepared metadata cannot redirect apply to an unexpected attachment', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hf-updates-forged-name-'))
  try {
    const payload = Buffer.from('portable update payload')
    const sha256 = createHash('sha256').update(payload).digest('hex')
    const attachmentPath = join(root, 'arbitrary-local.exe')
    writeFileSync(attachmentPath, payload)
    const service = new UpdateService({
      currentVersion: '5.6.0',
      platform: 'darwin',
      arch: 'arm64',
      updatesDir: root,
      fetchImpl: createFetch(payload) as typeof fetch,
    })
    writeFileSync(join(root, 'prepared-update.json'), JSON.stringify({
      version: VERSION,
      packagePath: attachmentPath,
      packageName: 'arbitrary-local.exe',
      sha256,
      packageSize: payload.length,
      preparedAt: '2026-07-10T00:00:00Z',
    }))
    await assert.rejects(service.applyPreparedUpdate(), /不合法/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('prepared update cannot escape through a symbolic link', {
  skip: process.platform === 'win32',
}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'hf-updates-symlink-'))
  const outsideRoot = mkdtempSync(join(tmpdir(), 'hf-updates-outside-'))
  try {
    const payload = Buffer.from('portable update payload')
    const sha256 = createHash('sha256').update(payload).digest('hex')
    const outsidePath = join(outsideRoot, PACKAGE_NAME)
    const expectedPath = join(root, PACKAGE_NAME)
    writeFileSync(outsidePath, payload)
    symlinkSync(outsidePath, expectedPath)
    const service = new UpdateService({
      currentVersion: '5.6.0',
      platform: 'darwin',
      arch: 'arm64',
      updatesDir: root,
      fetchImpl: createFetch(payload) as typeof fetch,
    })
    writeFileSync(join(root, 'prepared-update.json'), JSON.stringify({
      version: VERSION,
      packagePath: expectedPath,
      packageName: PACKAGE_NAME,
      sha256,
      packageSize: payload.length,
      preparedAt: '2026-07-10T00:00:00Z',
    }))
    await assert.rejects(service.applyPreparedUpdate(), /不是普通文件/)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outsideRoot, { recursive: true, force: true })
  }
})

test('prepared update size is revalidated before handoff', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hf-updates-size-'))
  try {
    const payload = Buffer.from('portable update payload')
    const packagePath = join(root, PACKAGE_NAME)
    writeFileSync(packagePath, payload)
    const service = new UpdateService({
      currentVersion: '5.6.0',
      platform: 'darwin',
      arch: 'arm64',
      updatesDir: root,
      fetchImpl: createFetch(payload) as typeof fetch,
    })
    writeFileSync(join(root, 'prepared-update.json'), JSON.stringify({
      version: VERSION,
      packagePath,
      packageName: PACKAGE_NAME,
      sha256: createHash('sha256').update(payload).digest('hex'),
      packageSize: payload.length + 1,
      preparedAt: '2026-07-10T00:00:00Z',
    }))
    await assert.rejects(service.applyPreparedUpdate(), /复核失败/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
