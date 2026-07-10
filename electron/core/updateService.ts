import { createHash, randomUUID } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import type { ReadableStream } from 'node:stream/web'
import { pipeline } from 'node:stream/promises'
import { readJsonFile, writeJsonFile } from './storage.js'
import type { UpdateApplyResult, UpdateCheckResult, UpdatePrepareResult } from './types.js'

const RELEASE_API_URL = 'https://api.github.com/repos/Yifo98/HF_Model_Downloader/releases/latest'
const MAX_REDIRECTS = 5
const MAX_RELEASE_METADATA_BYTES = 2 * 1024 * 1024
const MAX_CHECKSUM_BYTES = 1024 * 1024
const MAX_PACKAGE_BYTES = 20 * 1024 * 1024 * 1024
const SHA256_PATTERN = /^[a-f0-9]{64}$/i
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/

type GitHubAsset = {
  name: string
  size: number
  browser_download_url: string
}

type GitHubRelease = {
  tag_name: string
  name: string | null
  body: string | null
  published_at: string
  html_url: string
  draft: boolean
  prerelease: boolean
  assets: GitHubAsset[]
}

type PreparedUpdate = {
  version: string
  packagePath: string
  packageName: string
  sha256: string
  packageSize: number
  preparedAt: string
}

export type UpdateServiceOptions = {
  currentVersion: string
  platform: NodeJS.Platform
  arch: string
  updatesDir: string
  fetchImpl?: typeof fetch
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAllowedGitHubUrl(value: URL) {
  if (value.protocol !== 'https:' || value.username || value.password) return false
  const hostname = value.hostname.toLocaleLowerCase('en-US')
  return hostname === 'github.com'
    || hostname === 'api.github.com'
    || hostname === 'objects.githubusercontent.com'
    || hostname === 'release-assets.githubusercontent.com'
}

export function assertAllowedUpdateUrl(value: string | URL) {
  const parsed = value instanceof URL ? new URL(value) : new URL(value)
  if (!isAllowedGitHubUrl(parsed)) throw new Error('更新地址不在 GitHub 安全白名单内。')
  return parsed
}

function normalizeVersion(value: string) {
  const match = VERSION_PATTERN.exec(value.trim())
  if (!match) throw new Error('发布版本号不合法。')
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`
}

function compareVersions(left: string, right: string) {
  const leftParts = normalizeVersion(left).split('.').map(Number)
  const rightParts = normalizeVersion(right).split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index]
  }
  return 0
}

function getExpectedPackageName(version: string, platform: NodeJS.Platform, arch: string) {
  if (!/^(?:x64|arm64)$/.test(arch)) throw new Error(`当前 CPU 架构暂不支持自动更新：${arch}`)
  if (platform === 'darwin') return `HF-Model-Downloader-${version}-mac-${arch}-portable.zip`
  if (platform === 'win32') return `HF-Model-Downloader-${version}-windows-${arch}-portable.zip`
  throw new Error(`当前平台暂无免安装更新包：${platform}`)
}

function parseRelease(value: unknown): GitHubRelease {
  if (!isRecord(value) || !Array.isArray(value.assets)) throw new Error('GitHub Release 响应结构不合法。')
  const assets: GitHubAsset[] = value.assets.flatMap((asset) => {
    if (!isRecord(asset)) return []
    const name = typeof asset.name === 'string' ? asset.name : ''
    const size = Number(asset.size)
    const browserDownloadUrl = typeof asset.browser_download_url === 'string' ? asset.browser_download_url : ''
    if (!name || basename(name) !== name || !Number.isSafeInteger(size) || size < 0 || !browserDownloadUrl) return []
    return [{ name, size, browser_download_url: browserDownloadUrl }]
  })
  const tagName = typeof value.tag_name === 'string' ? value.tag_name : ''
  const publishedAt = typeof value.published_at === 'string' ? value.published_at : ''
  const htmlUrl = typeof value.html_url === 'string' ? value.html_url : ''
  if (!tagName || !Number.isFinite(Date.parse(publishedAt)) || !htmlUrl) throw new Error('GitHub Release 缺少可验证的版本信息。')
  assertAllowedUpdateUrl(htmlUrl)
  return {
    tag_name: tagName,
    name: typeof value.name === 'string' ? value.name : null,
    body: typeof value.body === 'string' ? value.body.slice(0, 100_000) : null,
    published_at: publishedAt,
    html_url: htmlUrl,
    draft: value.draft === true,
    prerelease: value.prerelease === true,
    assets,
  }
}

function parseChecksumManifest(value: string, expectedName: string) {
  const matches: string[] = []
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const match = /^([a-f0-9]{64})\s+[ *](.+)$/i.exec(line)
    if (match && match[2] === expectedName) matches.push(match[1].toLocaleLowerCase('en-US'))
  }
  if (matches.length !== 1) throw new Error(`SHA256SUMS.txt 中未找到唯一的 ${expectedName} 校验值。`)
  return matches[0]
}

async function readTextBounded(response: Response, maxBytes: number) {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > maxBytes) throw new Error('更新元数据过大。')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maxBytes) throw new Error('更新元数据过大。')
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

function isInside(rootPath: string, targetPath: string) {
  const nested = relative(rootPath, targetPath)
  return nested === '' || (!nested.startsWith('..') && !isAbsolute(nested))
}

function getSafeExistingPackage(packagePath: string, updatesDir: string) {
  const lexicalRoot = resolve(updatesDir)
  const target = resolve(packagePath)
  if (!isInside(lexicalRoot, target) || target === lexicalRoot || !existsSync(target)) throw new Error('已准备的更新包不存在。')
  const entry = lstatSync(target)
  if (entry.isSymbolicLink() || !entry.isFile()) throw new Error('已准备的更新包不是普通文件。')
  const root = realpathSync.native(lexicalRoot)
  const canonical = realpathSync.native(target)
  if (!isInside(root, canonical)) throw new Error('已准备的更新包越过安全目录。')
  return canonical
}

async function sha256File(filePath: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

export class UpdateService {
  private readonly fetchImpl: typeof fetch
  private readonly metadataFile: string
  private lastCheck: UpdateCheckResult | null = null

  constructor(private readonly options: UpdateServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.metadataFile = join(options.updatesDir, 'prepared-update.json')
    mkdirSync(options.updatesDir, { recursive: true, mode: 0o700 })
  }

  private async fetchAllowed(input: string | URL, init: RequestInit = {}) {
    let current = assertAllowedUpdateUrl(input)
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await this.fetchImpl(current, {
        ...init,
        redirect: 'manual',
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'HF-Model-Downloader-Update-Service',
          'X-GitHub-Api-Version': '2022-11-28',
          ...init.headers,
        },
      })
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        if (!response.ok) throw new Error(`GitHub 更新请求失败（HTTP ${response.status}）。`)
        return response
      }
      if (redirects === MAX_REDIRECTS) throw new Error('GitHub 更新请求重定向次数过多。')
      const location = response.headers.get('location')
      if (!location) throw new Error('GitHub 更新重定向缺少目标地址。')
      current = assertAllowedUpdateUrl(new URL(location, current))
      await response.body?.cancel()
    }
    throw new Error('GitHub 更新请求失败。')
  }

  async checkForUpdates(): Promise<UpdateCheckResult> {
    const response = await this.fetchAllowed(RELEASE_API_URL)
    const release = parseRelease(JSON.parse(await readTextBounded(response, MAX_RELEASE_METADATA_BYTES)) as unknown)
    if (release.draft || release.prerelease) throw new Error('最新 Release 不应为草稿或预发布版本。')
    const latestVersion = normalizeVersion(release.tag_name)
    const currentVersion = normalizeVersion(this.options.currentVersion)
    const updateAvailable = compareVersions(latestVersion, currentVersion) > 0
    const baseResult: UpdateCheckResult = {
      currentVersion,
      latestVersion,
      updateAvailable,
      releaseName: release.name?.trim() || `HF Model Downloader ${latestVersion}`,
      releaseNotes: release.body?.trim() || '该版本暂无更新说明。',
      publishedAt: release.published_at,
      packageSize: 0,
      platform: this.options.platform,
      arch: this.options.arch,
      downloadUrl: '',
      sha256: '',
    }
    if (!updateAvailable) {
      this.lastCheck = baseResult
      return baseResult
    }

    const packageName = getExpectedPackageName(latestVersion, this.options.platform, this.options.arch)
    const packageAsset = release.assets.find((asset) => asset.name === packageName)
    if (!packageAsset || packageAsset.size <= 0 || packageAsset.size > MAX_PACKAGE_BYTES) {
      throw new Error(`Release 缺少当前平台的免安装包：${packageName}`)
    }
    const checksumAsset = release.assets.find((asset) => asset.name === 'SHA256SUMS.txt')
    if (!checksumAsset || checksumAsset.size <= 0 || checksumAsset.size > MAX_CHECKSUM_BYTES) {
      throw new Error('Release 缺少可验证的 SHA256SUMS.txt。')
    }
    const expectedPackageUrl = `https://github.com/Yifo98/HF_Model_Downloader/releases/download/${encodeURIComponent(release.tag_name)}/${packageName}`
    const expectedChecksumUrl = `https://github.com/Yifo98/HF_Model_Downloader/releases/download/${encodeURIComponent(release.tag_name)}/SHA256SUMS.txt`
    if (assertAllowedUpdateUrl(packageAsset.browser_download_url).toString() !== expectedPackageUrl) {
      throw new Error('Release 更新包地址与固定仓库不匹配。')
    }
    if (assertAllowedUpdateUrl(checksumAsset.browser_download_url).toString() !== expectedChecksumUrl) {
      throw new Error('Release 校验文件地址与固定仓库不匹配。')
    }
    const checksumResponse = await this.fetchAllowed(expectedChecksumUrl, { headers: { Accept: 'text/plain' } })
    const sha256 = parseChecksumManifest(await readTextBounded(checksumResponse, MAX_CHECKSUM_BYTES), packageName)
    const result = {
      ...baseResult,
      packageSize: packageAsset.size,
      downloadUrl: expectedPackageUrl,
      sha256,
    }
    this.lastCheck = result
    return result
  }

  async prepareUpdate(): Promise<UpdatePrepareResult> {
    const check = await this.checkForUpdates()
    if (!check.updateAvailable) {
      return { ready: false, verified: false, message: '当前已是最新版本。' }
    }
    if (!check.downloadUrl || !SHA256_PATTERN.test(check.sha256) || check.packageSize <= 0) {
      throw new Error('更新包缺少必需的安全校验信息。')
    }
    const packageName = getExpectedPackageName(check.latestVersion, this.options.platform, this.options.arch)
    const packagePath = join(this.options.updatesDir, packageName)
    if (existsSync(packagePath)) {
      const entry = lstatSync(packagePath)
      if (entry.isSymbolicLink() || !entry.isFile()) throw new Error('更新目录存在不安全的同名路径。')
      if (await sha256File(packagePath) === check.sha256) {
        this.savePrepared({
          version: check.latestVersion,
          packagePath,
          packageName,
          sha256: check.sha256,
          packageSize: check.packageSize,
          preparedAt: new Date().toISOString(),
        })
        return { ready: true, verified: true, packagePath, message: '更新包已存在且 SHA-256 校验通过。' }
      }
      rmSync(packagePath, { force: true })
    }

    const tempPath = `${packagePath}.${randomUUID()}.part`
    const response = await this.fetchAllowed(check.downloadUrl, { headers: { Accept: 'application/octet-stream' } })
    if (!response.body) throw new Error('更新包响应没有文件内容。')
    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength !== check.packageSize) {
      throw new Error('更新包尺寸与 Release 元数据不一致。')
    }

    let received = 0
    const hash = createHash('sha256')
    const verifier = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length
        if (received > check.packageSize) {
          callback(new Error('更新包超出 Release 声明的尺寸。'))
          return
        }
        hash.update(chunk)
        callback(null, chunk)
      },
    })
    try {
      await pipeline(
        Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
        verifier,
        createWriteStream(tempPath, { flags: 'wx', mode: 0o600 }),
      )
      if (received !== check.packageSize) throw new Error('更新包下载不完整。')
      if (hash.digest('hex') !== check.sha256) throw new Error('更新包 SHA-256 校验失败，已拒绝应用。')
      renameSync(tempPath, packagePath)
    } finally {
      if (existsSync(tempPath)) rmSync(tempPath, { force: true })
    }

    this.savePrepared({
      version: check.latestVersion,
      packagePath,
      packageName,
      sha256: check.sha256,
      packageSize: check.packageSize,
      preparedAt: new Date().toISOString(),
    })
    return { ready: true, verified: true, packagePath, message: '更新包已下载，SHA-256 完整性校验通过。' }
  }

  async applyPreparedUpdate(): Promise<UpdateApplyResult> {
    const prepared = this.readPrepared()
    const packagePath = getSafeExistingPackage(prepared.packagePath, this.options.updatesDir)
    const packageEntry = lstatSync(packagePath)
    if (basename(packagePath) !== prepared.packageName
      || packageEntry.size !== prepared.packageSize
      || await sha256File(packagePath) !== prepared.sha256) {
      throw new Error('已准备的更新包复核失败。')
    }
    return {
      started: false,
      requiredManual: true,
      packagePath,
      message: '更新包已再次校验并定位。请退出当前版本后手动解压替换；不会执行附件或请求管理员权限。',
    }
  }

  getLastCheck() {
    return this.lastCheck
  }

  private savePrepared(value: PreparedUpdate) {
    writeJsonFile(this.metadataFile, value)
  }

  private readPrepared() {
    const value = readJsonFile<unknown>(this.metadataFile, null)
    if (!isRecord(value)) throw new Error('尚未准备可应用的更新包。')
    const packagePath = typeof value.packagePath === 'string' ? value.packagePath : ''
    const packageName = typeof value.packageName === 'string' ? value.packageName : ''
    const sha256 = typeof value.sha256 === 'string' ? value.sha256.toLocaleLowerCase('en-US') : ''
    const packageSize = Number(value.packageSize)
    const version = typeof value.version === 'string' ? normalizeVersion(value.version) : ''
    const preparedAt = typeof value.preparedAt === 'string' ? value.preparedAt : ''
    const expectedPackageName = getExpectedPackageName(version, this.options.platform, this.options.arch)
    const expectedPackagePath = resolve(this.options.updatesDir, expectedPackageName)
    if (!packagePath || !isAbsolute(packagePath) || basename(packageName) !== packageName || !SHA256_PATTERN.test(sha256)
      || packageName !== expectedPackageName || resolve(packagePath) !== expectedPackagePath
      || compareVersions(version, this.options.currentVersion) <= 0
      || !Number.isSafeInteger(packageSize) || packageSize <= 0 || !Number.isFinite(Date.parse(preparedAt))) {
      throw new Error('已准备的更新元数据不合法。')
    }
    return { version, packagePath, packageName, sha256, packageSize, preparedAt } satisfies PreparedUpdate
  }
}
