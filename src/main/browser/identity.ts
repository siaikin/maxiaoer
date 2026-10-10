import { randomInt } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const SEED_MIN = 10_000
export const SEED_MAX = 99_999

export interface Identity {
  seed: number
  locale: string
  timezone: string
  cookiesMigrated: boolean
  pendingVerify: boolean
}

const fileOf = (dir: string) => join(dir, 'maxiaoer-profile.json')

function valid(data: Partial<Identity>): data is Identity {
  return (
    Number.isInteger(data.seed) &&
    data.seed! >= SEED_MIN &&
    data.seed! <= SEED_MAX &&
    typeof data.locale === 'string' &&
    data.locale.length > 0 &&
    typeof data.timezone === 'string' &&
    data.timezone.length > 0 &&
    typeof data.cookiesMigrated === 'boolean' &&
    typeof data.pendingVerify === 'boolean'
  )
}

/** 首次创建后固定 seed、语言和时区。文件损坏时直接失败，避免悄悄换成另一个身份。 */
export function loadOrCreateIdentity(dir: string, timezone: string): Identity {
  mkdirSync(dir, { recursive: true })
  const file = fileOf(dir)
  if (existsSync(file)) {
    let parsed: Partial<Identity>
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Identity>
    } catch {
      throw new Error('账号浏览器身份无法读取，已停止使用该资料目录，没有重新生成指纹')
    }
    if (!valid(parsed)) throw new Error('账号浏览器身份不完整，已停止使用该资料目录，没有重新生成指纹')
    return parsed
  }
  const identity: Identity = {
    seed: randomInt(SEED_MIN, SEED_MAX + 1),
    locale: 'zh-CN',
    timezone,
    cookiesMigrated: false,
    pendingVerify: false,
  }
  writeIdentity(dir, identity)
  return identity
}

export function writeIdentity(dir: string, identity: Identity) {
  mkdirSync(dir, { recursive: true })
  const file = fileOf(dir)
  writeFileSync(file, JSON.stringify(identity, null, 2))
  writeFileSync(join(dir, '.cloakbrowser-seed'), `${identity.seed}\n`)
}

export function readIdentity(dir: string): Identity | null {
  if (!existsSync(fileOf(dir))) return null
  return loadOrCreateIdentity(dir, 'UTC')
}
