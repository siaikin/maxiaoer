<script setup lang="ts">
import { computed } from 'vue'
import { useAppState } from '../composables/useAppState'

const { accounts, jobs } = useAppState()
const tasks = computed(() => jobs.value.flatMap((j) => j.tasks))
const stats = computed(() => [
  { label: '已绑定账号', value: accounts.value.length, icon: 'i-lucide-users' },
  { label: '需重新登录', value: accounts.value.filter((a) => a.status === 'expired').length, icon: 'i-lucide-user-x' },
  { label: '发布成功', value: tasks.value.filter((t) => t.status === 'success').length, icon: 'i-lucide-circle-check' },
  { label: '发布失败', value: tasks.value.filter((t) => t.status === 'failed').length, icon: 'i-lucide-circle-x' },
])
</script>

<template>
  <div class="space-y-4">
    <div class="grid grid-cols-4 gap-4">
      <UCard v-for="s in stats" :key="s.label">
        <div class="flex items-center gap-3">
          <UIcon :name="s.icon" class="size-6 text-primary" />
          <div>
            <div class="text-xs text-muted">{{ s.label }}</div>
            <div class="text-2xl font-semibold tabular-nums">{{ s.value }}</div>
          </div>
        </div>
      </UCard>
    </div>
    <UCard>
      <template #header>快捷操作</template>
      <div class="flex gap-2">
        <UButton icon="i-lucide-square-pen" label="发布图文" to="/publish" />
        <UButton icon="i-lucide-user-plus" label="添加账号" color="neutral" variant="outline" to="/accounts" />
        <UButton icon="i-lucide-hash" label="常用话题" color="neutral" variant="outline" to="/topics" />
      </div>
    </UCard>
  </div>
</template>
