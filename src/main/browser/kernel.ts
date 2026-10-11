import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pins from '../../../resources/cloakbrowser/pins.json'

export const KERNEL_PLATFORMS = ['darwin-arm64', 'windows-x64', 'linux-x64'] as const
export type KernelPlatform = (typeof KERNEL_PLATFORMS)[number]

const LABELS: Record<KernelPlatform, string> = {
  'darwin-arm64': 'macOS ARM64',
  'windows-x64': 'Windows x64',
  'linux-x64': 'Linux x64',
}

export function platformKey(platform = process.platform, arch = process.arch): KernelPlatform | null {
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64'
  if (platform === 'win32' && arch === 'x64') return 'windows-x64'
  if (platform === 'linux' && arch === 'x64') return 'linux-x64'
  return null
}

export function requirePlatformKey(platform = process.platform, arch = process.arch): KernelPlatform {
  const key = platformKey(platform, arch)
  if (!key) {
    throw new Error(`当前系统 ${platform} ${arch} 没有对应的指纹浏览器内核。支持 macOS ARM64、Windows x64、Linux x64。`)
  }
  return key
}

export function binaryRelative(key: KernelPlatform): string {
  if (key === 'darwin-arm64') return 'Chromium.app/Contents/MacOS/Chromium'
  if (key === 'windows-x64') return 'chrome.exe'
  return 'chrome'
}

export function kernelPin(key: KernelPlatform) {
  return pins.platforms[key]
}

/** 安装包内是 Resources/cloakbrowser，开发时是仓库里 prepare 脚本解压出的目录。 */
export function kernelRoot(packaged: boolean, resourcesPath: string, appPath: string) {
  return packaged ? join(resourcesPath, 'cloakbrowser') : join(appPath, 'resources/cloakbrowser/bundled')
}

export function assertKernel(root: string, platform = process.platform, arch = process.arch): string {
  const key = requirePlatformKey(platform, arch)
  const pin = kernelPin(key)
  const binary = join(root, binaryRelative(key))
  const versionPath = join(root, 'VERSION')
  const expected = `${key} ${pin.version}`
  if (!existsSync(binary)) {
    throw new Error(
      `未找到 ${LABELS[key]} 指纹浏览器内核（${binary}）。请先运行 pnpm browser:prepare。运行时不会下载，也不会改用本机 Chrome。`,
    )
  }
  const actual = existsSync(versionPath) ? readFileSync(versionPath, 'utf8').trim() : ''
  if (actual !== expected) {
    throw new Error(`指纹浏览器内核版本不匹配（当前 ${actual || '未知'}，需要 ${expected}）。请重新运行 pnpm browser:prepare。`)
  }
  return binary
}
