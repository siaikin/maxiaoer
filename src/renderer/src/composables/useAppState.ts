import { computed, ref } from 'vue'
import type { Account, PlatformId, PlatformInfo, PublishJob } from '../../../shared/types'
import { toLocalFileUrl } from '../../../shared/localFile'

// 全局状态：模块级单例，所有页面共用
const platforms = ref<PlatformInfo[]>([])
const accounts = ref<Account[]>([])
const jobs = ref<PublishJob[]>([])
const commonTopics = ref<string[]>([])
let loaded: Promise<void> | undefined

export const localFileUrl = toLocalFileUrl

export function useAppState() {
  loaded ??= (async () => {
    ;[platforms.value, accounts.value, jobs.value, commonTopics.value] = await Promise.all([
      window.maxiaoer.platforms(),
      window.maxiaoer.accounts.list(),
      window.maxiaoer.publish.jobs(),
      window.maxiaoer.prefs.commonTopics(),
    ])
    window.maxiaoer.publish.onUpdate((job) => {
      const i = jobs.value.findIndex((j) => j.id === job.id)
      if (i >= 0) jobs.value[i] = job
      else jobs.value.unshift(job)
    })
  })()

  const platformMap = computed(() => Object.fromEntries(platforms.value.map((p) => [p.id, p])) as Record<PlatformId, PlatformInfo>)

  return {
    ready: loaded,
    platforms,
    platformMap,
    accounts,
    jobs,
    commonTopics,
    refreshAccounts: async () => (accounts.value = await window.maxiaoer.accounts.list()),
    refreshJobs: async () => (jobs.value = await window.maxiaoer.publish.jobs()),
    async saveCommonTopics(topics: string[]) {
      await window.maxiaoer.prefs.setCommonTopics([...topics])
      commonTopics.value = await window.maxiaoer.prefs.commonTopics()
    },
  }
}

/** IPC 只能传可结构化克隆的对象，先去掉响应式代理 */
export const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v))

export const errorText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
