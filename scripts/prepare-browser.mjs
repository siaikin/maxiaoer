import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pins = JSON.parse(readFileSync(join(root, 'resources/cloakbrowser/pins.json'), 'utf8'))

function hostPlatform() {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'darwin-arm64'
  if (process.platform === 'win32' && process.arch === 'x64') return 'windows-x64'
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64'
  return null
}

const requested = process.argv.find((_, index) => process.argv[index - 1] === '--platform')
const key = requested ?? hostPlatform()
if (!key || !pins.platforms[key]) {
  console.error(`当前系统 ${process.platform} ${process.arch} 没有对应的指纹浏览器内核。支持 macOS ARM64、Windows x64、Linux x64。`)
  process.exit(1)
}
if (requested && requested !== hostPlatform()) {
  console.error(`请在 ${requested} 对应的系统上准备内核。本机是 ${hostPlatform() ?? `${process.platform} ${process.arch}`}。`)
  process.exit(1)
}

const pin = pins.platforms[key]
const dest = join(root, 'resources/cloakbrowser/bundled')
const cache = join(root, 'resources/cloakbrowser/cache')
const archivePath = join(cache, pin.archive)
const binaryRelative = key === 'darwin-arm64' ? 'Chromium.app/Contents/MacOS/Chromium' : key === 'windows-x64' ? 'chrome.exe' : 'chrome'
const binaryPath = join(dest, binaryRelative)
const expectedVersion = `${key} ${pin.version}`

if (existsSync(binaryPath) && existsSync(join(dest, 'VERSION')) && readFileSync(join(dest, 'VERSION'), 'utf8').trim() === expectedVersion) {
  console.log(`指纹浏览器内核已就绪：${binaryPath}`)
  process.exit(0)
}

mkdirSync(cache, { recursive: true })
const url = `${pins.channel}/download/chromium-v${pin.version}/${pin.archive}`
if (!existsSync(archivePath) || (await sha256(archivePath)) !== pin.sha256) {
  console.log(`正在从官方发布下载 ${pin.archive}`)
  const response = await fetch(url, { headers: { 'user-agent': 'maxiaoer-prepare' }, redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`下载失败 ${response.status}：${url}`)
  await pipeline(response.body, createWriteStream(archivePath))
}
const actual = await sha256(archivePath)
if (actual !== pin.sha256) {
  rmSync(archivePath, { force: true })
  throw new Error(`校验失败：${pin.archive} 实际 ${actual}，期望 ${pin.sha256}`)
}

const staging = join(cache, 'staging')
rmSync(staging, { recursive: true, force: true })
mkdirSync(staging)
const extracted = spawnSync('tar', ['-xf', archivePath, '-C', staging], { stdio: 'inherit' })
if (extracted.status !== 0) throw new Error('解压指纹浏览器内核失败')

const found = key === 'darwin-arm64' ? findNamed(staging, 'Chromium.app', true) : findNamed(staging, binaryRelative, false)
if (!found) throw new Error(`压缩包里没有 ${binaryRelative}`)
rmSync(dest, { recursive: true, force: true })
const moved = spawnSync('mv', [dirname(found), dest], { stdio: 'inherit' })
if (moved.status !== 0 || !existsSync(binaryPath)) throw new Error(`内核没有放到预期路径：${binaryPath}`)
if (process.platform !== 'win32') spawnSync('chmod', ['755', binaryPath], { stdio: 'inherit' })
if (process.platform === 'darwin') spawnSync('xattr', ['-cr', dest], { stdio: 'inherit' })

writeFileSync(join(dest, 'VERSION'), `${expectedVersion}\n`)
const license = join(root, 'resources/cloakbrowser/BINARY-LICENSE.md')
if (!existsSync(license)) throw new Error('缺少 resources/cloakbrowser/BINARY-LICENSE.md')
writeFileSync(join(dest, 'BINARY-LICENSE.md'), readFileSync(license))
console.log(`指纹浏览器内核已准备：${binaryPath}`)
console.log('二进制许可只覆盖个人或组织内部使用。对外分发安装包前，需要另行取得授权。')

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
  })
}

function findNamed(dir, name, directory) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stats = statSync(path)
    if (entry === name && stats.isDirectory() === directory) return path
    if (stats.isDirectory() && !entry.endsWith('.app')) {
      const hit = findNamed(path, name, directory)
      if (hit) return hit
    }
  }
  return null
}
