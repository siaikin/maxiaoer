<script setup lang="ts">
import { computed, ref } from 'vue'
import { presetSelected, togglePreset } from '../../../shared/topics'
import { normalizeTopics } from '../../../shared/validate'
import type { TopicPreset } from '../../../shared/types'
import { useAppState } from '../composables/useAppState'

/** 话题输入：已选话题显示为标签，下方的话题合集点一下整组加入，再点一下整组取消 */
const topics = defineModel<string[]>({ required: true })
const props = defineProps<{ max?: number }>()
const { topicPresets, saveTopicPreset } = useAppState()
const toast = useToast()

const model = computed({
  get: () => topics.value,
  set: (v: string[]) => (topics.value = normalizeTopics(v)),
})

function toggle(p: TopicPreset) {
  const { topics: next, dropped } = togglePreset(topics.value, p.topics, props.max)
  topics.value = next
  if (dropped) toast.add({ title: `话题最多 ${props.max} 个，「${p.name}」有 ${dropped} 个没有加入`, color: 'warning' })
}

// 把当前话题存为新的合集
const saving = ref(false)
const presetName = ref('')
async function saveAsPreset() {
  const name = presetName.value.trim()
  if (!name) return
  await saveTopicPreset({ id: crypto.randomUUID(), name, topics: [...topics.value] })
  saving.value = false
  presetName.value = ''
  toast.add({ title: `已存为话题合集「${name}」`, color: 'success', icon: 'i-lucide-check' })
}
</script>

<template>
  <div class="space-y-2">
    <UInputTags
      v-model="model"
      placeholder="输入话题后回车"
      icon="i-lucide-hash"
      :max-length="30"
      :add-on-paste="true"
      :add-on-blur="true"
      class="w-full"
    >
      <template #item-text="{ item }">#{{ item }}</template>
    </UInputTags>
    <div class="flex flex-wrap items-center gap-1.5">
      <span class="text-xs text-muted">话题合集</span>
      <UTooltip v-for="p in topicPresets" :key="p.id" :text="p.topics.map((t) => `#${t}`).join(' ') || '空合集'">
        <UButton
          size="xs"
          :variant="presetSelected(topics, p.topics) ? 'solid' : 'soft'"
          :color="presetSelected(topics, p.topics) ? 'primary' : 'neutral'"
          :icon="presetSelected(topics, p.topics) ? 'i-lucide-check' : 'i-lucide-layers'"
          :label="`${p.name} · ${p.topics.length}`"
          :disabled="!p.topics.length"
          @click="toggle(p)"
        />
      </UTooltip>
      <UPopover v-model:open="saving">
        <UButton v-if="topics.length" size="xs" variant="link" icon="i-lucide-bookmark-plus" label="存为合集" />
        <template #content>
          <form class="flex gap-2 p-2" @submit.prevent="saveAsPreset">
            <UInput v-model="presetName" placeholder="合集名称" size="sm" autofocus />
            <UButton type="submit" size="sm" label="保存" :disabled="!presetName.trim()" />
          </form>
        </template>
      </UPopover>
      <UButton v-if="!topicPresets.length && !topics.length" size="xs" variant="link" to="/topics" label="去新建" />
    </div>
  </div>
</template>
