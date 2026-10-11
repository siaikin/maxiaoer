import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Account } from '../../shared/types'
import { loadOrCreateIdentity } from './identity'
import { assertKernel, kernelPin, platformKey, requirePlatformKey } from './kernel'
import { mergeRelogin, IdentityMismatchError } from './relogin'

describe('账号身份', () => {
  it('重启后保留 seed、语言和首次时区', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mxe-id-'))
    const created = loadOrCreateIdentity(dir, 'Asia/Shanghai')
    const again = loadOrCreateIdentity(dir, 'Europe/London')
    expect(again).toEqual(created)
    expect(again.locale).toBe('zh-CN')
    expect(again.timezone).toBe('Asia/Shanghai')
    const other = loadOrCreateIdentity(mkdtempSync(join(tmpdir(), 'mxe-id-')), 'Asia/Shanghai')
    expect(other.seed).not.toBe(created.seed)
  })

  it('重新登录保留账号 id，身份不一致时拒绝', () => {
    const account: Account = {
      id: 'account-1',
      platform: 'xiaohongshu',
      nickname: '原来的',
      uid: 'uid-1',
      status: 'expired',
      createdAt: 1,
    }
    const next = mergeRelogin(account, { nickname: '新昵称', uid: 'uid-1', avatar: 'a.png' })
    expect(next.id).toBe('account-1')
    expect(next.nickname).toBe('新昵称')
    expect(next.status).toBe('active')
    expect(() => mergeRelogin(account, { nickname: '别人', uid: 'uid-2' })).toThrow(IdentityMismatchError)
    expect(account.id).toBe('account-1')
  })

  it('缺少内核或不支持的架构会明确失败', () => {
    expect(platformKey('darwin', 'x64')).toBeNull()
    expect(() => requirePlatformKey('linux', 'arm64')).toThrow(/没有对应的指纹浏览器内核/)
    const dir = mkdtempSync(join(tmpdir(), 'mxe-kernel-'))
    expect(() => assertKernel(dir, 'darwin', 'arm64')).toThrow(/不会下载/)
    const binary = join(dir, 'Chromium.app/Contents/MacOS')
    mkdirSync(binary, { recursive: true })
    writeFileSync(join(binary, 'Chromium'), '')
    writeFileSync(join(dir, 'VERSION'), 'darwin-arm64 0\n')
    expect(() => assertKernel(dir, 'darwin', 'arm64')).toThrow(kernelPin('darwin-arm64').version)
  })
})
