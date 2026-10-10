<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PublishJob, PublishTask } from '../../../shared/types'
import AccountAvatar from '../components/AccountAvatar.vue'
import { errorText, localFileUrl, useAppState } from '../composables/useAppState'

const { jobs, accounts, platformMap, refreshJobs } = useAppState()
const toast = useToast()

const statusMeta: Record<PublishTask['status'], { label: string; color: 'neutral' | 'info' | 'success' | 'error' | 'warning' }> = {
  pending: { label: '等待中', color: 'neutral' },
  running: { label: '发布中', color: 'info' },
  success: { label: '已发布', color: 'success' },
  failed: { label: '失败', color: 'error' },
  deleting: { label: '删除中', color: 'warning' },
  deleted: { label: '已删除', color: 'neutral' },
}

const accountOf = (t: PublishTask) => accounts.value.find((a) => a.id === t.accountId)
const canDelete = (t: PublishTask) => t.status === 'success' && platformMap.value[t.platform]?.canDelete

/** 删除确认：可以是单个任务，也可以是一次发布里所有已发布的作品 */
const confirm = ref<{ job: PublishJob; tasks: PublishTask[] } | null>(null)
const confirmOpen = computed({ get: () => !!confirm.value, set: (v) => !v && (confirm.value = null) })
const deleting = ref(false)

async function confirmDelete() {
  if (!confirm.value) return
  const { job, tasks } = confirm.value
  deleting.value = true
  const results = await Promise.allSettled(tasks.map((t) => window.maxiaoer.publish.deleteRemote(job.id, t.id)))
  deleting.value = false
  confirm.value = null
  const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
  if (failed.length) toast.add({ title: `${failed.length} 个删除失败`, description: errorText(failed[0].reason), color: 'error' })
  else toast.add({ title: '已从平台删除', color: 'success' })
}

const retry = (job: PublishJob, t: PublishTask) => window.maxiaoer.publish.retry(job.id, t.id)

async function removeJob(job: PublishJob) {
  await window.maxiaoer.publish.removeJob(job.id)
  await refreshJobs()
}

function jobActions(job: PublishJob) {
  const deletable = job.tasks.filter(canDelete)
  return [
    [
      {
        label: `从平台删除已发布（${deletable.length}）`,
        icon: 'i-lucide-trash-2',
        color: 'error' as const,
        disabled: !deletable.length,
        onSelect: () => (confirm.value = { job, tasks: deletable }),
      },
      { label: '删除这条记录', icon: 'i-lucide-eraser', onSelect: () => removeJob(job) },
    ],
  ]
}
</script>

<template>
  <UEmpty v-if="!jobs.length" icon="i-lucide-inbox" title="还没有发布记录" :actions="[{ label: '去发布', to: '/publish' }]" />
  <div class="space-y-3">
    <UCard v-for="job in jobs" :key="job.id" :ui="{ header: 'p-3 sm:px-4', body: 'p-0 sm:p-0' }">
      <template #header>
        <div class="flex items-center gap-3">
          <img v-if="job.cover" :src="localFileUrl(job.cover)" class="size-10 rounded object-cover" />
          <div class="min-w-0 flex-1">
            <div class="truncate font-medium">{{ job.title || '（无标题）' }}</div>
            <div class="text-xs text-muted">
              {{ new Date(job.scheduledAt ?? job.createdAt).toLocaleString('zh-CN') }}
              <UBadge v-if="job.scheduledAt" label="定时" size="sm" variant="subtle" class="ml-1" />
            </div>
          </div>
          <UDropdownMenu :items="jobActions(job)">
            <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" />
          </UDropdownMenu>
        </div>
      </template>
      <ul class="divide-y divide-default">
        <li v-for="t in job.tasks" :key="t.id" class="flex items-center gap-3 px-4 py-2.5 text-sm">
          <template v-if="accountOf(t)">
            <AccountAvatar :account="accountOf(t)!" size="sm" />
            <span class="w-40 truncate">{{ accountOf(t)!.nickname }}</span>
          </template>
          <span v-else class="w-48 text-muted">账号已删除</span>
          <UBadge :color="statusMeta[t.status].color" variant="subtle" :label="t.progress ?? statusMeta[t.status].label" />
          <UTooltip v-if="t.error" :text="t.error">
            <span class="truncate text-error text-xs max-w-80">{{ t.error }}</span>
          </UTooltip>
          <div class="ml-auto flex gap-1">
            <UButton v-if="t.url && t.status === 'success'" :to="t.url" target="_blank" size="xs" variant="ghost" icon="i-lucide-external-link" label="查看" />
            <UButton v-if="t.status === 'failed'" size="xs" variant="ghost" icon="i-lucide-rotate-cw" label="重试" @click="retry(job, t)" />
            <UButton
              v-if="canDelete(t)"
              size="xs"
              variant="ghost"
              color="error"
              icon="i-lucide-trash-2"
              label="删除"
              @click="confirm = { job, tasks: [t] }"
            />
          </div>
        </li>
      </ul>
    </UCard>
  </div>

  <UModal v-model:open="confirmOpen" title="从平台删除" :description="`将在平台上删除 ${confirm?.tasks.length ?? 0} 个已发布的作品，删除后无法恢复。`">
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" label="取消" @click="confirm = null" />
        <UButton color="error" label="确认删除" :loading="deleting" @click="confirmDelete" />
      </div>
    </template>
  </UModal>
</template>
