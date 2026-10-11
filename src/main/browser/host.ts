import { join } from 'node:path'
import { app, session } from 'electron'
import { getDb } from '../store'
import { assertKernel, kernelRoot } from './kernel'
import { partitionFor } from './partition'
import { createBrowserHost } from './session'

function machineTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

let host: ReturnType<typeof createBrowserHost> | undefined

export function initBrowserHost() {
  host = createBrowserHost({
    kernelBinary: () => assertKernel(kernelRoot(app.isPackaged, process.resourcesPath, app.getAppPath())),
    profileDir: (id) => join(app.getPath('userData'), 'browsers', id),
    readCookies: async (id) => session.fromPartition(partitionFor(id)).cookies.get({}),
    isExistingAccount: (id) => !!getDb().getAccount(id),
    timezone: machineTimezone,
  })
}

export function browserHost() {
  if (!host) throw new Error('浏览器尚未初始化')
  return host
}

export function shutdownBrowserHost() {
  return host?.shutdown() ?? Promise.resolve()
}

export function browserHasOpen() {
  return host?.hasOpen() ?? false
}
