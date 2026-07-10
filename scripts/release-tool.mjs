import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
const appVersion = packageJson.version
const forbiddenSegments = new Set([
  '.env',
  '.ds_store',
  '__macosx',
  'cache',
  'caches',
  'cookies',
  'cookies.json',
  'downloads',
  'electron-session',
  'electron-user-data',
  'hf_model_downloader_data',
  'history',
  'history.json',
  'logs',
  'preferences.json',
  'session',
  'token',
  'user-data',
])

function fail(message) {
  throw new Error(message)
}

function assertAbsoluteDirectory(value, label) {
  if (!value || !isAbsolute(value)) {
    fail(`${label} must be an absolute path.`)
  }
  return resolve(value)
}

function isInside(parent, candidate) {
  const offset = relative(parent, candidate)
  return offset === '' || (!offset.startsWith(`..${sep}`) && offset !== '..' && !isAbsolute(offset))
}

async function walk(root, current = root, output = []) {
  const entries = await readdir(current, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = join(current, entry.name)
    output.push(entryPath)
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      await walk(root, entryPath, output)
    }
  }
  return output
}

async function verifyStage(stageDirectory) {
  const root = assertAbsoluteDirectory(stageDirectory, 'Stage directory')
  const rootStat = await stat(root)
  if (!rootStat.isDirectory()) fail(`Stage directory does not exist: ${root}`)

  const entries = await walk(root)
  for (const entryPath of entries) {
    const entryRelativePath = relative(root, entryPath)
    const segments = entryRelativePath.toLowerCase().split(sep)
    const blockedSegment = segments.find((segment) => forbiddenSegments.has(segment))
    if (blockedSegment) {
      fail(`Release stage contains a forbidden path segment: ${entryRelativePath}`)
    }

    if (segments.some((segment) => segment.endsWith('.log') || segment.endsWith('.map'))) {
      fail(`Release stage contains a log or source-map file: ${entryRelativePath}`)
    }

    const metadata = await lstat(entryPath)
    if (metadata.isSymbolicLink()) {
      const resolvedTarget = await realpath(entryPath)
      if (!isInside(root, resolvedTarget)) {
        fail(`Release stage contains an escaping symbolic link: ${entryRelativePath}`)
      }
    }
  }

  console.log(`Release stage verified: ${root}`)
}

function isDownloadArtifact(fileName) {
  return /^HF-Model-Downloader-\d+\.\d+\.\d+-.+\.zip$/i.test(fileName)
}

async function digest(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

async function finalize(versionDirectory) {
  const outputDirectory = assertAbsoluteDirectory(versionDirectory, 'Version directory')
  await mkdir(outputDirectory, { recursive: true })

  const expectedSuffix = `${sep}${appVersion}`
  if (!outputDirectory.endsWith(expectedSuffix)) {
    fail(`Version directory must end with ${expectedSuffix}: ${outputDirectory}`)
  }

  const notesSource = join(projectRoot, 'docs', 'releases', `${appVersion}.md`)
  await copyFile(notesSource, join(outputDirectory, 'RELEASE-NOTES.md'))

  const entries = await readdir(outputDirectory, { withFileTypes: true })
  const artifacts = entries
    .filter((entry) => entry.isFile() && isDownloadArtifact(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'en'))

  if (artifacts.length === 0) {
    fail(`No portable release artifacts found in ${outputDirectory}`)
  }

  const checksumLines = []
  for (const artifact of artifacts) {
    const artifactPath = join(outputDirectory, artifact)
    const artifactStat = await stat(artifactPath)
    if (artifactStat.size < 20 * 1024 * 1024) {
      fail(`Portable artifact is unexpectedly small: ${artifact}`)
    }
    checksumLines.push(`${await digest(artifactPath)}  ${artifact}`)
  }

  await writeFile(join(outputDirectory, 'SHA256SUMS.txt'), `${checksumLines.join('\n')}\n`, 'utf8')
  console.log(`Release metadata updated for ${artifacts.length} artifact(s): ${outputDirectory}`)
}

async function verifyChecksums(versionDirectory) {
  const outputDirectory = assertAbsoluteDirectory(versionDirectory, 'Version directory')
  const checksumPath = join(outputDirectory, 'SHA256SUMS.txt')
  const lines = (await readFile(checksumPath, 'utf8')).trim().split(/\r?\n/).filter(Boolean)
  if (lines.length === 0) fail('SHA256SUMS.txt is empty.')

  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/)
    if (!match) fail(`Malformed checksum line: ${line}`)
    const [, expected, fileName] = match
    if (basename(fileName) !== fileName || !isDownloadArtifact(fileName)) {
      fail(`Unsafe or unexpected checksum filename: ${fileName}`)
    }
    const actual = await digest(join(outputDirectory, fileName))
    if (actual !== expected) fail(`Checksum mismatch: ${fileName}`)
  }

  console.log(`Verified ${lines.length} release checksum(s): ${checksumPath}`)
}

const [command, argument] = process.argv.slice(2)

switch (command) {
  case 'verify-stage':
    await verifyStage(argument)
    break
  case 'finalize':
    await finalize(argument)
    break
  case 'verify-checksums':
    await verifyChecksums(argument)
    break
  default:
    fail('Usage: node scripts/release-tool.mjs <verify-stage|finalize|verify-checksums> <absolute-path>')
}
