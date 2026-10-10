import type { Account, PublishJob } from '@maxiaoer/core'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { PlatformInfo } from '../../../shared/api'

export const useAppStore = defineStore('app', () => {
  const platforms = ref<PlatformInfo[]>([])
  const accounts = ref<Account[]>([])
  const jobs = ref<PublishJob[]>([])

  async function load() {
    ;[platforms.value, accounts.value, jobs.value] = await Promise.all([
      window.maxiaoer.platforms(),
      window.maxiaoer.accounts.list(),
      window.maxiaoer.publish.jobs(),
    ])
  }

  window.maxiaoer.publish.onUpdate((job) => {
    const i = jobs.value.findIndex((j) => j.id === job.id)
    if (i >= 0) jobs.value[i] = job
    else jobs.value.unshift(job)
  })

  const refreshAccounts = async () => (accounts.value = await window.maxiaoer.accounts.list())

  return { platforms, accounts, jobs, load, refreshAccounts }
})
