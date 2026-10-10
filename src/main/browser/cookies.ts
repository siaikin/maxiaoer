/** Electron session.cookies 里用到的字段。迁移时不打印 name 以外的调试信息，更不打印 value。 */
export interface RawCookie {
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  session?: boolean
  /** Unix 秒 */
  expirationDate?: number
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
}

export interface CdpCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
  expires?: number
}

export type MigrationPlan = { action: 'done' } | { action: 'keep-existing' } | { action: 'import'; cookies: CdpCookie[] }

const sameSiteOf = (value: RawCookie['sameSite']): CdpCookie['sameSite'] | undefined => {
  if (value === 'strict') return 'Strict'
  if (value === 'lax') return 'Lax'
  if (value === 'no_restriction') return 'None'
  return undefined
}

/** 丢掉已过期的条目，保留域、路径、有效期、Secure / HttpOnly / SameSite。 */
export function toCdpCookies(cookies: RawCookie[], nowSec: number): CdpCookie[] {
  const mapped: CdpCookie[] = []
  for (const cookie of cookies) {
    if (!cookie.name || !cookie.domain) continue
    const session = cookie.session || cookie.expirationDate == null
    if (!session && cookie.expirationDate! <= nowSec) continue
    const sameSite = sameSiteOf(cookie.sameSite)
    mapped.push({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path || '/',
      secure: sameSite === 'None' ? true : !!cookie.secure,
      httpOnly: !!cookie.httpOnly,
      ...(sameSite ? { sameSite } : {}),
      ...(!session ? { expires: cookie.expirationDate } : {}),
    })
  }
  return mapped
}

/**
 * 已迁移过，或新内核目录里已经有会话时，不再导入。
 * profileExists 为真且 migrationOpen 为真，说明上次导入写到一半，允许再写一次，不把半成品当成用户会话。
 */
export function planCookieMigration(input: {
  migrated: boolean
  profileExists: boolean
  migrationOpen: boolean
  raw: RawCookie[]
  nowSec: number
}): MigrationPlan {
  if (input.migrated) return { action: 'done' }
  if (input.profileExists && !input.migrationOpen) return { action: 'keep-existing' }
  return { action: 'import', cookies: toCdpCookies(input.raw, input.nowSec) }
}

export async function applyCookies(cookies: CdpCookie[], send: (method: string, params: CdpCookie) => Promise<unknown>) {
  let imported = 0
  for (const cookie of cookies) {
    try {
      await send('Network.setCookie', cookie)
      imported++
    } catch {
      // 失败原因可能含 Cookie 内容，不向外带出
    }
  }
  if (cookies.length > 0 && imported === 0) throw new Error('导入登录状态失败')
  return { imported }
}
