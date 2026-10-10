<script setup lang="ts">
import type { PublishJob, PublishTask } from '@maxiaoer/core'
import { NButton, NCard, NDataTable, NEmpty, NSpace, NTag, NTooltip, type DataTableColumns } from 'naive-ui'
import { h } from 'vue'
import AccountAvatar from '../components/AccountAvatar.vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()

const statusTag: Record<PublishTask['status'], { label: string; type: 'default' | 'info' | 'success' | 'error' | 'warning' }> = {
  pending: { label: '等待中', type: 'default' },
  running: { label: '发布中', type: 'info' },
  success: { label: '成功', type: 'success' },
  failed: { label: '失败', type: 'error' },
  cancelled: { label: '已取消', type: 'warning' },
}

const taskColumns = (job: PublishJob): DataTableColumns<PublishTask> => [
  {
    title: '账号',
    key: 'account',
    render: (t) => {
      const account = store.accounts.find((a) => a.id === t.accountId)
      return account ? h(NSpace, { align: 'center' }, () => [h(AccountAvatar, { account, size: 24 }), account.nickname]) : '已删除'
    },
  },
  {
    title: '状态',
    key: 'status',
    render: (t) => {
      const tag = h(NTag, { size: 'small', type: statusTag[t.status].type }, () => t.progress ?? statusTag[t.status].label)
      return t.error ? h(NTooltip, null, { trigger: () => tag, default: () => t.error }) : tag
    },
  },
  {
    title: '操作',
    key: 'actions',
    render: (t) =>
      h(NSpace, null, () => [
        t.url && h(NButton, { size: 'small', text: true, tag: 'a', href: t.url, target: '_blank' }, () => '查看作品'),
        t.status === 'failed' && h(NButton, { size: 'small', onClick: () => window.maxiaoer.publish.retry(job.id, t.id) }, () => '重试'),
      ]),
  },
]
</script>

<template>
  <NEmpty v-if="!store.jobs.length" description="还没有发布记录" />
  <NSpace vertical :size="16">
    <NCard v-for="job in store.jobs" :key="job.id" :title="job.title || '(无标题)'" size="small">
      <template #header-extra>
        {{ new Date(job.scheduledAt ?? job.createdAt).toLocaleString() }}
        <NTag v-if="job.scheduledAt" size="small" style="margin-left: 8px">定时</NTag>
      </template>
      <NDataTable size="small" :columns="taskColumns(job)" :data="job.tasks" :row-key="(t: PublishTask) => t.id" />
    </NCard>
  </NSpace>
</template>
