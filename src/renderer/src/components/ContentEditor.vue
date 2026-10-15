<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ContentLimits, FieldLimit } from '../../../shared/content'
import type { ContentField, ImageAsset, PostContent } from '../../../shared/types'
import { errorText, localFileUrl } from '../composables/useAppState'
import { useMaterials } from '../composables/useMaterials'
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
  /** 图片路径 -> 超出平台限制的提示 */
  imageWarnings?: Record<string, string>
}>()
const emit = defineEmits<{ update: [field: ContentField, value: PostContent[ContentField]]; reset: [field: ContentField] }>()

const isPlatform = computed(() => !!props.overridden)
const len = (s: string) => [...s].length
const toast = useToast()
const picking = ref(false)
const libraryOpen = ref(false)
const librarySelecting = ref(false)
const selectedMaterials = ref<string[]>([])
const {
  materials, loading: libraryLoading, error: libraryError,
  search: librarySearch, filtered: filteredMaterials, refresh: loadLibrary,
} = useMaterials()

function setImages(images: ImageAsset[]) {
  emit('update', 'images', images)
}
async function pickImages() {
  picking.value = true
  try {
    addImages(await window.maxiaoer.posts.pickImages())
  } catch (e) {
    toast.add({ title: '导入图片失败', description: errorText(e), color: 'error' })
  } finally {
    picking.value = false
  }
}
function addImages(picked: ImageAsset[]) {
  setImages([...props.value.images, ...picked.filter((p) => !props.value.images.some((i) => i.path === p.path))])
}
function openLibrary() {
  selectedMaterials.value = []
  librarySearch.value = ''
  libraryOpen.value = true
  void loadLibrary()
}
function toggleMaterial(id: string) {
  selectedMaterials.value = selectedMaterials.value.includes(id)
    ? selectedMaterials.value.filter((value) => value !== id)
    : [...selectedMaterials.value, id]
}
async function selectMaterials() {
  librarySelecting.value = true
  libraryError.value = ''
  try {
    addImages(await window.maxiaoer.materials.select([...selectedMaterials.value]))
    libraryOpen.value = false
  } catch (e) {
    libraryError.value = errorText(e)
  } finally {
    librarySelecting.value = false
  }
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
const skippedCount = computed(() => props.value.images.filter((i) => props.imageWarnings?.[i.path]).length)
// 通用页上的图片可能只被部分平台跳过，张数仍按全部算，各平台的实际张数看右侧校验
const imageCount = computed(() => props.value.images.length - (isPlatform.value ? skippedCount.value : 0))
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
        <span v-if="skippedCount" class="text-warning">，{{ skippedCount }} 张超出限制会跳过</span>
      </template>
      <div class="flex flex-wrap gap-2">
        <div v-for="(img, i) in value.images" :key="img.path" class="relative group">
          <img
            :src="localFileUrl(img.path)"
            :alt="`待发布图片 ${i + 1}`"
            class="size-24 rounded-md object-cover ring"
            :class="imageWarnings?.[img.path] ? 'ring-2 ring-warning opacity-60' : 'ring-default'"
          />
          <UBadge v-if="i === 0" label="封面" size="sm" class="absolute left-1 top-1" />
          <UTooltip v-if="imageWarnings?.[img.path]" :text="imageWarnings[img.path]">
            <UBadge icon="i-lucide-triangle-alert" color="warning" size="sm" class="absolute right-1 top-1" />
          </UTooltip>
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
          type="button"
          :disabled="picking"
          class="size-24 rounded-md border border-dashed border-accented flex flex-col items-center justify-center gap-1 text-muted text-sm hover:border-primary hover:text-primary disabled:opacity-50"
          @click="pickImages"
        >
          <UIcon :name="picking ? 'i-lucide-loader-circle' : 'i-lucide-image-plus'" class="size-6" :class="{ 'animate-spin': picking }" />
          {{ picking ? '正在导入' : '导入图片' }}
        </button>
        <button
          type="button"
          class="size-24 rounded-md border border-dashed border-accented flex flex-col items-center justify-center gap-1 text-muted text-sm hover:border-primary hover:text-primary"
          @click="openLibrary"
        >
          <UIcon name="i-lucide-images" class="size-6" />
          从素材库选择
        </button>
      </div>
      <p class="mt-2 text-xs text-muted">导入图片会保存副本到素材库，原文件移动或删除后仍可使用。</p>
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

  <UModal v-model:open="libraryOpen" title="从素材库选择图片" description="按选择顺序追加到当前内容，加入后可调整顺序和封面。" :ui="{ content: 'max-w-3xl' }" :dismissible="!librarySelecting">
    <template #body>
      <div class="space-y-3">
        <div class="flex gap-2">
          <UInput v-model="librarySearch" icon="i-lucide-search" placeholder="搜索图片名称或素材 ID" class="flex-1" />
          <UButton color="neutral" variant="outline" icon="i-lucide-refresh-cw" label="刷新" :loading="libraryLoading" :disabled="librarySelecting" @click="loadLibrary" />
        </div>
        <UAlert v-if="libraryError" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="libraryError" />
        <div v-if="libraryLoading" class="py-12 text-center text-sm text-muted">正在读取素材库…</div>
        <UEmpty v-else-if="!materials.length && !libraryError" icon="i-lucide-images" title="还没有图片素材" description="先关闭此窗口并导入图片，或前往素材库导入图片链接。" />
        <UEmpty v-else-if="materials.length && !filteredMaterials.length" icon="i-lucide-search" title="没有找到图片" description="试试其他名称或素材 ID。" />
        <div v-else class="grid grid-cols-3 sm:grid-cols-4 gap-3 max-h-[55vh] overflow-y-auto p-1">
          <button
            v-for="m in filteredMaterials"
            :key="m.id"
            type="button"
            :aria-pressed="selectedMaterials.includes(m.id)"
            :disabled="librarySelecting"
            class="relative overflow-hidden rounded-lg ring text-left transition focus-visible:outline-2 focus-visible:outline-primary"
            :class="selectedMaterials.includes(m.id) ? 'ring-2 ring-primary bg-primary/10' : 'ring-default hover:ring-primary'"
            @click="toggleMaterial(m.id)"
          >
            <img :src="m.previewUrl" :alt="m.name" loading="lazy" class="aspect-square w-full object-contain bg-elevated" />
            <UBadge v-if="selectedMaterials.includes(m.id)" :label="String(selectedMaterials.indexOf(m.id) + 1)" class="absolute top-2 right-2" />
            <div class="p-2">
              <p class="truncate text-xs font-medium" :title="m.name">{{ m.name }}</p>
              <p class="text-xs text-muted mt-1">{{ m.width }} × {{ m.height }}</p>
            </div>
          </button>
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex items-center justify-between gap-3 w-full">
        <span class="text-sm text-muted">已选 {{ selectedMaterials.length }} 张</span>
        <div class="flex gap-2">
          <UButton color="neutral" variant="ghost" label="取消" :disabled="librarySelecting" @click="libraryOpen = false" />
          <UButton label="加入内容" :disabled="!selectedMaterials.length || libraryLoading || librarySelecting" :loading="librarySelecting" @click="selectMaterials" />
        </div>
      </div>
    </template>
  </UModal>
</template>
