import { dialog, ipcMain } from 'electron'
import { normalizeTopics } from '../shared/validate'
import { checkAccount, listCollections, loginWithBrowser, openAccount, relogin, removeAccount } from './accounts'
import { adapters, platformInfo } from './platforms'
import { deleteRemote, removeJob, retryTask, startPublish } from './publisher'
import { getStore } from './store'

export function registerIpc() {
  const store = getStore()
  const handle = (channel: string, fn: (...args: any[]) => unknown) => ipcMain.handle(channel, (_, ...args) => fn(...args))

  handle('platforms', () => Object.values(adapters).map(platformInfo))

  handle('accounts:list', () => store.data.accounts)
  handle('accounts:login', loginWithBrowser)
  handle('accounts:relogin', relogin)
  handle('accounts:check', checkAccount)
  handle('accounts:open', openAccount)
  handle('accounts:remove', removeAccount)
  handle('accounts:collections', listCollections)

  handle('posts:pickImages', async () => {
    const { filePaths } = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
    })
    return filePaths
  })

  handle('publish:start', startPublish)
  handle('publish:jobs', () => store.data.jobs)
  handle('publish:retry', retryTask)
  handle('publish:deleteRemote', deleteRemote)
  handle('publish:removeJob', removeJob)

  handle('prefs:commonTopics', () => store.data.commonTopics)
  handle('prefs:setCommonTopics', (topics: string[]) => {
    store.data.commonTopics = normalizeTopics(topics)
    store.save()
  })
  handle('prefs:lastSettings', () => store.data.lastSettings)
  handle('prefs:useLast', () => store.data.useLast)
  handle('prefs:setUseLast', (accountId: string, value: boolean) => {
    store.data.useLast[accountId] = value
    store.save()
  })
}
