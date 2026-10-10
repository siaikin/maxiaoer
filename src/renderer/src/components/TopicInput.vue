<script setup lang="ts">
import { computed } from 'vue'
import { normalizeTopics } from '../../../shared/validate'
import { useAppState } from '../composables/useAppState'

/** 话题输入：已选话题显示为标签，下方可一键添加常用话题 */
const topics = defineModel<string[]>({ required: true })
const props = defineProps<{ max?: number }>()
const { commonTopics, saveCommonTopics } = useAppState()

const model = computed({
  get: () => topics.value,
  set: (v: string[]) => (topics.value = normalizeTopics(v)),
})
const unused = computed(() => commonTopics.value.filter((t) => !topics.value.includes(t)))
const full = computed(() => !!props.max && topics.value.length >= props.max)
const notSaved = computed(() => topics.value.filter((t) => !commonTopics.value.includes(t)))

function add(t: string) {
  if (!full.value) topics.value = normalizeTopics([...topics.value, t])
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
    <div v-if="unused.length || notSaved.length" class="flex flex-wrap items-center gap-1.5">
      <span class="text-xs text-muted">常用话题</span>
      <UBadge
        v-for="t in unused"
        :key="t"
        :label="`#${t}`"
        color="neutral"
        variant="soft"
        class="cursor-pointer hover:bg-accented"
        :class="{ 'opacity-50 pointer-events-none': full }"
        @click="add(t)"
      />
      <UButton
        v-if="notSaved.length"
        size="xs"
        variant="link"
        icon="i-lucide-bookmark-plus"
        label="存为常用"
        @click="saveCommonTopics([...commonTopics, ...notSaved])"
      />
    </div>
  </div>
</template>
