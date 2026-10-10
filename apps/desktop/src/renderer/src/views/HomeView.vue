<script setup lang="ts">
import { NButton, NCard, NGrid, NGridItem, NSpace, NStatistic } from 'naive-ui'
import { computed } from 'vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const tasks = computed(() => store.jobs.flatMap((j) => j.tasks))
const stats = computed(() => [
  { label: '已绑定账号', value: store.accounts.length },
  { label: '登录失效', value: store.accounts.filter((a) => a.status === 'expired').length },
  { label: '发布成功', value: tasks.value.filter((t) => t.status === 'success').length },
  { label: '发布失败', value: tasks.value.filter((t) => t.status === 'failed').length },
])
</script>

<template>
  <NSpace vertical :size="16">
    <NGrid :cols="4" :x-gap="16">
      <NGridItem v-for="s in stats" :key="s.label">
        <NCard><NStatistic :label="s.label" :value="s.value" /></NCard>
      </NGridItem>
    </NGrid>
    <NCard title="快捷操作">
      <NSpace>
        <NButton type="primary" @click="$router.push('/publish')">发布图文</NButton>
        <NButton @click="$router.push('/accounts')">添加账号</NButton>
      </NSpace>
    </NCard>
  </NSpace>
</template>
