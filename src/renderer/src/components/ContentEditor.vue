<script setup lang="ts">
import { computed } from 'vue'
import type { ContentLimits, FieldLimit } from '../../../shared/content'
import type { ContentField, ImageAsset, PostContent } from '../../../shared/types'
import { localFileUrl } from '../composables/useAppState'
import FieldLabel from './FieldLabel.vue'
import TopicInput from './TopicInput.vue'

/**
 * 图片、标题、正文、话题的编辑表单。通用页和各平台页共用：
 * 平台页传 overridden，未单独设置的字段显示“沿用通用”，一改就变成这个平台单独的内容。
 */
const props = defineProps<{
  value: PostContent
  limits: ContentLimits
  overridden?: Partial<Record<ContentField, boolean>>
}>()
const emit = defineEmits<{ update: [field: ContentField, value: PostContent[ContentField]]; reset: [field: ContentField] }>()

const isPlatform = computed(() => !!props.overridden)
const len = (s: string) => [...s].length

function setImages(images: ImageAsset[]) {
  emit('update', 'images', images)
}
async function pickImages() {
  const paths = await window.maxiaoer.posts.pickImages()
  setImages([...props.value.images, ...paths.filter((p) => !props.value.images.some((i) => i.path === p)).map((path) => ({ path }))])
}
function moveImage(i: number, delta: number) {
  const list = [...props.value.images]
  ;[list[i], list[i + delta]] = [list[i + delta], list[i]]
  setImages(list)
}

const over = (n: number, l?: FieldLimit) => !!l && n > l.max
const by = (name?: string) => (name ? `（${name}）` : '')
const imageRule = computed(() => {
  const l = props.limits.images
  if (!l) return ''
  const max = `最多 ${l.max} 张${by(l.maxBy)}`
  return l.min ? `至少 ${l.min} 张${by(l.minBy)}，${max}` : max
})
const imageCount = computed(() => props.value.images.length)
const imagesBad = computed(() => !!props.limits.images && (imageCount.value < props.limits.images.min || imageCount.value > props.limits.images.max))
</script>

<template>
  <div class="space-y-5">
    <UFormField>
      <template #label>
        <FieldLabel label="图片" field="images" :overridden="overridden" @reset="emit('reset', 'images')" />
      </template>
      <template #hint>
        <span class="tabular-nums" :class="{ 'text-error': imagesBad }">
          {{ imageCount }} 张<template v-if="limits.images">，{{ imageRule }}</template>
        </span>
      </template>
      <div class="flex flex-wrap gap-2">
        <div v-for="(img, i) in value.images" :key="img.path" class="relative group">
          <img :src="localFileUrl(img.path)" class="size-24 rounded-md object-cover ring ring-default" />
          <UBadge v-if="i === 0" label="封面" size="sm" class="absolute left-1 top-1" />
          <div class="absolute inset-x-1 bottom-1 hidden justify-between group-hover:flex">
            <UButton icon="i-lucide-chevron-left" size="xs" color="neutral" :disabled="i === 0" @click="moveImage(i, -1)" />
            <UButton icon="i-lucide-chevron-right" size="xs" color="neutral" :disabled="i === value.images.length - 1" @click="moveImage(i, 1)" />
          </div>
          <UButton
            icon="i-lucide-x"
            size="xs"
            color="neutral"
            class="absolute -right-2 -top-2 rounded-full opacity-0 group-hover:opacity-100"
            @click="setImages(value.images.filter((_, j) => j !== i))"
          />
        </div>
        <button
          class="size-24 rounded-md border border-dashed border-accented flex flex-col items-center justify-center gap-1 text-muted text-sm hover:border-primary hover:text-primary"
          @click="pickImages"
        >
          <UIcon name="i-lucide-image-plus" class="size-6" />
          添加图片
        </button>
      </div>
    </UFormField>

    <UFormField>
      <template #label>
        <FieldLabel label="标题" field="title" :overridden="overridden" @reset="emit('reset', 'title')" />
      </template>
      <UInput
        :model-value="value.title"
        placeholder="填写标题"
        :maxlength="isPlatform ? limits.title?.max : undefined"
        class="w-full"
        :ui="{ trailing: 'pointer-events-none' }"
        @update:model-value="emit('update', 'title', String($event))"
      >
        <template #trailing>
          <span class="text-xs tabular-nums" :class="over(len(value.title), limits.title) ? 'text-error' : 'text-muted'">
            {{ len(value.title) }}<template v-if="limits.title">/{{ limits.title.max }}{{ by(limits.title.by) }}</template>
          </span>
        </template>
      </UInput>
    </UFormField>

    <UFormField>
      <template #label>
        <FieldLabel label="正文" field="content" :overridden="overridden" @reset="emit('reset', 'content')" />
      </template>
      <template #hint>
        <span class="tabular-nums" :class="{ 'text-error': over(len(value.content), limits.content) }">
          {{ len(value.content) }}<template v-if="limits.content">/{{ limits.content.max }}</template> 字{{ by(limits.content?.by) }}
        </span>
      </template>
      <UTextarea
        :model-value="value.content"
        placeholder="填写正文"
        :rows="10"
        autoresize
        class="w-full"
        @update:model-value="emit('update', 'content', String($event))"
      />
    </UFormField>

    <UFormField>
      <template #label>
        <FieldLabel label="话题" field="topics" :overridden="overridden" @reset="emit('reset', 'topics')" />
      </template>
      <template #hint>
        <span class="tabular-nums" :class="{ 'text-error': over(value.topics.length, limits.topics) }">
          {{ value.topics.length }}<template v-if="limits.topics">/{{ limits.topics.max }}{{ by(limits.topics.by) }}</template>
        </span>
      </template>
      <TopicInput :model-value="value.topics" :max="limits.topics?.max" @update:model-value="emit('update', 'topics', $event)" />
    </UFormField>
  </div>
</template>

