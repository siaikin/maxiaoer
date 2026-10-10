import { dialog, ipcMain } from 'electron'
import type { Post } from '@maxiaoer/core'
import { adapters } from '@maxiaoer/adapters'
import type { PlatformInfo } from '../shared/api'
import { addWithCredentials, checkAccount, loginWithBrowser, openAccount, removeAccount } from './accounts'
import { retryTask, startPublish } from './publisher'
import { getStore } from './store'

export function registerIpc() {
  ipcMain.handle('platforms', (): PlatformInfo[] =>
    Object.values(adapters).map((a) => ({
      id: a.id,
      name: a.name,
      mode: a.mode,
      limits: a.limits,
      credentialFields: a.mode === 'api' ? a.credentialFields : undefined,
    })),
  )

  ipcMain.handle('accounts:list', () => getStore().data.accounts)
  ipcMain.handle('accounts:login', (_, platform) => loginWithBrowser(platform))
  ipcMain.handle('accounts:addWithCredentials', (_, platform, credentials) => addWithCredentials(platform, credentials))
  ipcMain.handle('accounts:check', (_, id) => checkAccount(id))
  ipcMain.handle('accounts:open', (_, id) => openAccount(id))
  ipcMain.handle('accounts:remove', (_, id) => removeAccount(id))

  ipcMain.handle('posts:save', (_, post: Post) => {
    const store = getStore()
    const i = store.data.posts.findIndex((p) => p.id === post.id)
    if (i >= 0) store.data.posts[i] = post
    else store.data.posts.push(post)
    store.save()
    return post
  })
  ipcMain.handle('posts:pickImages', async () => {
    const { filePaths } = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
    })
    return filePaths
  })

  ipcMain.handle('publish:start', (_, post, accountIds, scheduledAt) => startPublish(post, accountIds, scheduledAt))
  ipcMain.handle('publish:jobs', () => getStore().data.jobs)
  ipcMain.handle('publish:retry', (_, jobId, taskId) => retryTask(jobId, taskId))
}
