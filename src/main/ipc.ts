import { dialog, ipcMain } from 'electron'
import type { TopicPreset } from '../shared/types'
import { checkAccount, listCollections, loginWithBrowser, openAccount, relogin, removeAccount } from './accounts'
import { getMaterialLibrary, importSelectedFile, materialPreview } from './material-store'
import { adapters, platformInfo } from './platforms'
import { deleteRemote, removeJob, retryTask, startPublish } from './publisher'
import { getDb } from './store'

export function registerIpc() {
  const db = getDb()
  const handle = (channel: string, fn: (...args: any[]) => unknown) => ipcMain.handle(channel, (_, ...args) => fn(...args))

  handle('platforms', () => Object.values(adapters).map(platformInfo))

  handle('accounts:list', () => db.listAccounts())
  handle('accounts:login', loginWithBrowser)
  handle('accounts:relogin', relogin)
  handle('accounts:check', checkAccount)
  handle('accounts:open', openAccount)
  handle('accounts:remove', removeAccount)
  handle('accounts:collections', listCollections)

  const importFiles = async () => {
    const { filePaths } = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'tif', 'tiff', 'avif', 'svg'] }],
    })
    // 顺序导入，避免同时解码多张大图占满内存。
    const materials = []
    for (const file of filePaths) materials.push(await importSelectedFile(file))
    return materials
  }
  handle('posts:pickImages', async () => {
    const materials = await importFiles()
    return Promise.all(materials.map((material) => getMaterialLibrary().resolve(material.id)))
  })
  handle('materials:list', async () => Promise.all((await getMaterialLibrary().list()).map(materialPreview)))
  handle('materials:importFiles', async () => Promise.all((await importFiles()).map(materialPreview)))
  handle('materials:importUrl', async (url: string) => materialPreview(await getMaterialLibrary().importSource({ url })))
  handle('materials:select', async (ids: string[]) => {
    if (!Array.isArray(ids) || ids.length > 50 || !ids.every((id) => typeof id === 'string')) throw new Error('素材选择不正确')
    return Promise.all(ids.map((id) => getMaterialLibrary().resolve(id)))
  })

  handle('publish:start', startPublish)
  handle('publish:jobs', () => db.listJobs())
  handle('publish:retry', retryTask)
  handle('publish:deleteRemote', deleteRemote)
  handle('publish:removeJob', removeJob)

  handle('topicPresets:list', () => db.listTopicPresets())
  handle('topicPresets:save', (preset: TopicPreset) => db.saveTopicPreset(preset))
  handle('topicPresets:remove', (id: string) => db.removeTopicPreset(id))
  handle('topicPresets:reorder', (ids: string[]) => db.reorderTopicPresets(ids))

  handle('prefs:lastSettings', () => db.lastSettings())
  handle('prefs:useLast', () => db.useLast())
  handle('prefs:setUseLast', (accountId: string, value: boolean) => db.setUseLast(accountId, value))
}
