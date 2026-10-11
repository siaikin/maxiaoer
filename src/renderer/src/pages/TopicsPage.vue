<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import type { TopicPreset } from '../../../shared/types'
import { normalizeTopics } from '../../../shared/validate'
import { plain, useAppState } from '../composables/useAppState'

/** 话题合集：每组一个名称和若干话题，发布页点一下整组加入 */
const { topicPresets, saveTopicPreset, removeTopicPreset, reorderTopicPresets } = useAppState()
const toast = useToast()

// 本地编辑副本；名称失焦、话题增删时保存
const drafts = reactive<TopicPreset[]>([])
watch(topicPresets, (list) => drafts.splice(0, drafts.length, ...plain(list)), { immediate: true })

async function save(p: TopicPreset) {
  if (!p.name.trim()) p.name = '未命名合集'
  p.topics = normalizeTopics(p.topics)
  await saveTopicPreset(p)
}

async function create() {
  await saveTopicPreset({ id: crypto.randomUUID(), name: `合集 ${topicPresets.value.length + 1}`, topics: [] })
}

async function move(i: number, delta: number) {
  const ids = drafts.map((p) => p.id)
  ;[ids[i], ids[i + delta]] = [ids[i + delta], ids[i]]
  await reorderTopicPresets(ids)
}

const confirmRemove = ref<TopicPreset | null>(null)
async function remove() {
  if (!confirmRemove.value) return
  await removeTopicPreset(confirmRemove.value.id)
  toast.add({ title: `已删除「${confirmRemove.value.name}」`, color: 'success' })
  confirmRemove.value = null
}
</script>

<template>
  <div class="max-w-3xl space-y-3">
    <div class="flex items-center justify-between">
      <p class="text-sm text-muted">把常一起用的话题存成一组，发布图文时点一下就能整组加入，再点一下整组取消。</p>
      <UButton icon="i-lucide-plus" label="新建合集" @click="create" />
    </div>
    <UEmpty v-if="!drafts.length" icon="i-lucide-layers" title="还没有话题合集" description="新建一个合集，或在发布页把当前话题“存为合集”" />
    <UCard v-for="(p, i) in drafts" :key="p.id" :ui="{ header: 'p-3 sm:px-4', body: 'p-3 sm:p-4' }">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-layers" class="size-4 text-muted" />
          <UInput v-model="p.name" variant="ghost" class="flex-1" :ui="{ base: 'font-medium' }" @blur="save(p)" @keydown.enter="($event.target as HTMLInputElement).blur()" />
          <span class="text-xs text-muted tabular-nums">{{ p.topics.length }} 个话题</span>
          <UButton icon="i-lucide-arrow-up" size="xs" color="neutral" variant="ghost" :disabled="i === 0" @click="move(i, -1)" />
          <UButton icon="i-lucide-arrow-down" size="xs" color="neutral" variant="ghost" :disabled="i === drafts.length - 1" @click="move(i, 1)" />
          <UButton icon="i-lucide-trash-2" size="xs" color="error" variant="ghost" @click="confirmRemove = p" />
        </div>
      </template>
      <UInputTags
        v-model="p.topics"
        placeholder="输入话题后回车"
        icon="i-lucide-hash"
        :add-on-paste="true"
        :add-on-blur="true"
        class="w-full"
        @update:model-value="save(p)"
      >
        <template #item-text="{ item }">#{{ item }}</template>
      </UInputTags>
    </UCard>
  </div>

  <UModal :open="!!confirmRemove" title="删除话题合集" :description="`删除「${confirmRemove?.name}」？已发布的内容不受影响。`" @update:open="(v) => !v && (confirmRemove = null)">
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" label="取消" @click="confirmRemove = null" />
        <UButton color="error" label="删除" @click="remove" />
      </div>
    </template>
  </UModal>
</template>
