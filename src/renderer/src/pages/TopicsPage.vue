<script setup lang="ts">
import { computed } from 'vue'
import { useAppState } from '../composables/useAppState'

/** 常用话题库：发布页可一键添加 */
const { commonTopics, saveCommonTopics } = useAppState()
const model = computed({ get: () => commonTopics.value, set: (v: string[]) => saveCommonTopics(v) })
</script>

<template>
  <UCard class="max-w-3xl" :ui="{ body: 'space-y-3' }">
    <p class="text-sm text-muted">在这里维护常用话题，发布图文时点一下即可添加。输入后回车保存，点标签上的 × 删除。</p>
    <UInputTags v-model="model" placeholder="输入话题后回车" icon="i-lucide-hash" :add-on-paste="true" class="w-full">
      <template #item-text="{ item }">#{{ item }}</template>
    </UInputTags>
  </UCard>
</template>
