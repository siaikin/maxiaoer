import { app } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { listCollections } from '../accounts'
import { getMaterialLibrary } from '../material-store'
import { adapters, platformInfo } from '../platforms'
import { retryTask, startPublish } from '../publisher'
import { getDb } from '../store'
import { startMcpServer } from './server'
import { PublishingService } from './service'
import { createPublishingMcp } from './tools'

export async function startLocalMcp() {
  if (process.env.MXE_MCP === '0') return undefined
  const materials = getMaterialLibrary()
  const service = new PublishingService({ db: getDb(), materials, platforms: () => Object.values(adapters).map(platformInfo), startPublish, retryTask })
  // 测试数据目录的连接信息不覆盖日常使用中的实例。
  const connectionPath = process.env.MAXIAOER_CONNECTION_FILE
    ?? (!app.isPackaged && process.env.MXE_USER_DATA ? join(app.getPath('userData'), 'mcp.json') : join(homedir(), '.maxiaoer', 'mcp.json'))
  return startMcpServer({
    createServer: () => createPublishingMcp(service, listCollections),
    importImage: (bytes, filename) => materials.importBytes(bytes, filename),
    connectionPath,
  })
}
