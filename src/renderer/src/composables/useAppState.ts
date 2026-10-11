import { computed, ref } from 'vue'
import type { Account, PlatformId, PlatformInfo, PublishJob, TopicPreset } from '../../../shared/types'
import { toLocalFileUrl } from '../../../shared/localFile'

// 全局状态：模块级单例，所有页面共用
const platforms = ref<PlatformInfo[]>([])
const accounts = ref<Account[]>([])
const jobs = ref<PublishJob[]>([])
const topicPresets = ref<TopicPreset[]>([])
let loaded: Promise<void> | undefined

export const localFileUrl = toLocalFileUrl

export function useAppState() {
  loaded ??= (async () => {
    ;[platforms.value, accounts.value, jobs.value, topicPresets.value] = await Promise.all([
      window.maxiaoer.platforms(),
      window.maxiaoer.accounts.list(),
      window.maxiaoer.publish.jobs(),
      window.maxiaoer.topicPresets.list(),
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
    topicPresets,
    refreshAccounts: async () => (accounts.value = await window.maxiaoer.accounts.list()),
    refreshJobs: async () => (jobs.value = await window.maxiaoer.publish.jobs()),
    async saveTopicPreset(preset: TopicPreset) {
      await window.maxiaoer.topicPresets.save(plain(preset))
      topicPresets.value = await window.maxiaoer.topicPresets.list()
    },
    async removeTopicPreset(id: string) {
      await window.maxiaoer.topicPresets.remove(id)
      topicPresets.value = await window.maxiaoer.topicPresets.list()
    },
    async reorderTopicPresets(ids: string[]) {
      await window.maxiaoer.topicPresets.reorder([...ids])
      topicPresets.value = await window.maxiaoer.topicPresets.list()
    },
  }
}

/** IPC 只能传可结构化克隆的对象，先去掉响应式代理 */
export const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v))

export const errorText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
