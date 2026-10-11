import { contextBridge, ipcRenderer } from 'electron'
import type { MaxiaoerApi } from '../shared/api'
import type { PublishJob } from '../shared/types'

const invoke = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const api: MaxiaoerApi = {
  platforms: invoke('platforms'),
  accounts: {
    list: invoke('accounts:list'),
    login: invoke('accounts:login'),
    relogin: invoke('accounts:relogin'),
    check: invoke('accounts:check'),
    open: invoke('accounts:open'),
    remove: invoke('accounts:remove'),
    collections: invoke('accounts:collections'),
  },
  posts: { pickImages: invoke('posts:pickImages') },
  publish: {
    start: invoke('publish:start'),
    jobs: invoke('publish:jobs'),
    retry: invoke('publish:retry'),
    deleteRemote: invoke('publish:deleteRemote'),
    removeJob: invoke('publish:removeJob'),
    onUpdate: (cb) => {
      const listener = (_: unknown, job: PublishJob) => cb(job)
      ipcRenderer.on('publish:update', listener)
      return () => ipcRenderer.off('publish:update', listener)
    },
  },
  topicPresets: {
    list: invoke('topicPresets:list'),
    save: invoke('topicPresets:save'),
    remove: invoke('topicPresets:remove'),
    reorder: invoke('topicPresets:reorder'),
  },
  prefs: {
    lastSettings: invoke('prefs:lastSettings'),
    useLast: invoke('prefs:useLast'),
    setUseLast: invoke('prefs:setUseLast'),
  },
}

contextBridge.exposeInMainWorld('maxiaoer', api)
