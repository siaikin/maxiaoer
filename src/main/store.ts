import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Account, Collection, Post, PublishJob, SettingValues } from '../shared/types'

interface Data {
  accounts: Account[]
  posts: Post[]
  jobs: PublishJob[]
  commonTopics: string[]
  /** accountId -> 上次发布用的配置 */
  lastSettings: Record<string, SettingValues>
  /** accountId -> 是否启用“使用上次选择”，默认启用 */
  useLast: Record<string, boolean>
  /** accountId -> 合集缓存 */
  collections: Record<string, { items: Collection[]; fetchedAt: number }>
}

const empty = (): Data => ({ accounts: [], posts: [], jobs: [], commonTopics: [], lastSettings: {}, useLast: {}, collections: {} })

/** JSON 文件存储，放在 userData 下 */
class Store {
  private file = join(app.getPath('userData'), 'maxiaoer.json')
  data: Data

  constructor() {
    mkdirSync(app.getPath('userData'), { recursive: true })
    try {
      this.data = { ...empty(), ...JSON.parse(readFileSync(this.file, 'utf8')) }
    } catch {
      this.data = empty()
    }
  }

  save() {
    writeFileSync(this.file, JSON.stringify(this.data, null, 2))
  }
}

let store: Store
export function getStore() {
  store ??= new Store()
  return store
}
