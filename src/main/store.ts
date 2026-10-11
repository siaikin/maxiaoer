import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Db } from './db'

let db: Db | undefined

/** SQLite 数据库放在 userData 下；第一次打开时导入旧的 maxiaoer.json */
export function getDb() {
  if (!db) {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    db = new Db(join(dir, 'maxiaoer.db'), join(dir, 'maxiaoer.json'))
  }
  return db
}

export function closeDb() {
  db?.close()
  db = undefined
}
