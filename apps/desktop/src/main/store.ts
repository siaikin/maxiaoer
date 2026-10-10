import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Account, Post, PublishJob } from '@maxiaoer/core'

interface Data {
  accounts: Account[]
  posts: Post[]
  jobs: PublishJob[]
  /** credentialRef -> safeStorage 加密后的 base64 */
  secrets: Record<string, string>
}

/**
 * 最简单的 JSON 文件存储，放在 userData 下。数据量上来后可换 SQLite（better-sqlite3）。
 */
class Store {
  private file = join(app.getPath('userData'), 'maxiaoer.json')
  data: Data

  constructor() {
    mkdirSync(app.getPath('userData'), { recursive: true })
    try {
      this.data = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch {
      this.data = { accounts: [], posts: [], jobs: [], secrets: {} }
    }
  }

  save() {
    writeFileSync(this.file, JSON.stringify(this.data, null, 2))
  }

  setSecret(ref: string, value: Record<string, string>) {
    this.data.secrets[ref] = safeStorage.encryptString(JSON.stringify(value)).toString('base64')
    this.save()
  }

  getSecret(ref: string): Record<string, string> {
    const raw = this.data.secrets[ref]
    if (!raw) throw new Error('凭据不存在')
    return JSON.parse(safeStorage.decryptString(Buffer.from(raw, 'base64')))
  }
}

let store: Store
export function getStore() {
  store ??= new Store()
  return store
}
