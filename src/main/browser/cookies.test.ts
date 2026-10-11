import { describe, expect, it } from 'vitest'
import { applyCookies, planCookieMigration, toCdpCookies, type RawCookie } from './cookies'

const secret = 'secret-value'
const sample: RawCookie = {
  name: 'sid',
  value: secret,
  domain: '.example.com',
  path: '/app',
  secure: true,
  httpOnly: true,
  expirationDate: 2_000_000_000,
  sameSite: 'lax',
}

describe('Cookie 迁移', () => {
  it('保留域、路径、有效期和安全属性，并丢掉过期项', () => {
    const mapped = toCdpCookies(
      [
        sample,
        { ...sample, name: 'old', expirationDate: 10 },
        { name: 'session', value: secret, domain: 'example.com', path: '/', session: true, sameSite: 'no_restriction', secure: false },
      ],
      1_000,
    )
    expect(mapped.map((cookie) => cookie.name)).toEqual(['sid', 'session'])
    expect(mapped[0]).toMatchObject({
      domain: '.example.com',
      path: '/app',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
      expires: 2_000_000_000,
    })
    expect(mapped[1]).toMatchObject({ domain: 'example.com', path: '/', secure: true, sameSite: 'None' })
    expect(mapped[1].expires).toBeUndefined()
  })

  it('已有新会话或已经迁移过时不再导入，结果里也不出现 Cookie 内容', () => {
    const existing = planCookieMigration({
      migrated: false,
      profileExists: true,
      migrationOpen: false,
      raw: [sample],
      nowSec: 0,
    })
    const again = planCookieMigration({
      migrated: true,
      profileExists: false,
      migrationOpen: false,
      raw: [sample],
      nowSec: 0,
    })
    expect(existing.action).toBe('keep-existing')
    expect(again.action).toBe('done')
    expect(JSON.stringify(existing)).not.toContain(secret)
    expect(JSON.stringify(again)).not.toContain(secret)
  })

  it('半成品导入可以再试一次，失败信息不会带出内容', async () => {
    const retry = planCookieMigration({
      migrated: false,
      profileExists: true,
      migrationOpen: true,
      raw: [sample],
      nowSec: 0,
    })
    expect(retry.action).toBe('import')
    await expect(applyCookies(retry.action === 'import' ? retry.cookies : [], async () => {
      throw new Error(`写入失败 ${secret}`)
    })).rejects.toThrow('导入登录状态失败')
  })
})
