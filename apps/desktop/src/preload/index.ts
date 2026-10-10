import { contextBridge, ipcRenderer } from 'electron'
import type { PublishJob } from '@maxiaoer/core'
import type { MaxiaoerApi } from '../shared/api'

const api: MaxiaoerApi = {
  platforms: () => ipcRenderer.invoke('platforms'),
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    login: (platform) => ipcRenderer.invoke('accounts:login', platform),
    addWithCredentials: (platform, credentials) => ipcRenderer.invoke('accounts:addWithCredentials', platform, credentials),
    check: (id) => ipcRenderer.invoke('accounts:check', id),
    open: (id) => ipcRenderer.invoke('accounts:open', id),
    remove: (id) => ipcRenderer.invoke('accounts:remove', id),
  },
  posts: {
    save: (post) => ipcRenderer.invoke('posts:save', post),
    pickImages: () => ipcRenderer.invoke('posts:pickImages'),
  },
  publish: {
    start: (post, accountIds, scheduledAt) => ipcRenderer.invoke('publish:start', post, accountIds, scheduledAt),
    jobs: () => ipcRenderer.invoke('publish:jobs'),
    retry: (jobId, taskId) => ipcRenderer.invoke('publish:retry', jobId, taskId),
    onUpdate: (cb) => {
      const listener = (_: unknown, job: PublishJob) => cb(job)
      ipcRenderer.on('publish:update', listener)
      return () => ipcRenderer.off('publish:update', listener)
    },
  },
}

contextBridge.exposeInMainWorld('maxiaoer', api)
