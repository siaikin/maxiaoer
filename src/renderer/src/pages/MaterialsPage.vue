<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { errorText } from '../composables/useAppState'
import { useMaterials } from '../composables/useMaterials'

const toast = useToast()
const { materials, loading, error, search, filtered: rows, refresh } = useMaterials()
const importing = ref<'files' | 'url' | null>(null)
const url = ref('')
const urlOpen = ref(false)
const urlError = ref('')

function size(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

async function importFiles() {
  importing.value = 'files'
  try {
    const imported = await window.maxiaoer.materials.importFiles()
    if (imported.length) {
      toast.add({ title: `已导入 ${imported.length} 张图片`, description: '图片副本已保存到素材库，可在发布时重复使用。', color: 'success' })
    }
  } catch (e) {
    toast.add({ title: '导入失败', description: errorText(e), color: 'error' })
  } finally {
    // 批量导入中途失败时，也展示已经保存成功的素材。
    await refresh()
    importing.value = null
  }
}

async function importUrl() {
  if (!url.value.trim()) return
  importing.value = 'url'
  urlError.value = ''
  try {
    await window.maxiaoer.materials.importUrl(url.value.trim())
    urlOpen.value = false
    url.value = ''
    await refresh()
    toast.add({ title: '图片已保存到素材库', color: 'success' })
  } catch (e) {
    urlError.value = errorText(e)
  } finally {
    importing.value = null
  }
}

onMounted(refresh)
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p class="text-sm text-muted">导入的图片会保存一份到素材库，发布时可重复选择。</p>
        <p class="mt-1 text-xs text-muted">共 {{ materials.length }} 张图片 · 发布页添加的图片和聊天导入的图片也会保存在这里</p>
      </div>
      <div class="flex items-center gap-2">
        <UButton color="neutral" variant="outline" icon="i-lucide-refresh-cw" label="刷新" :loading="loading" :disabled="!!importing" @click="refresh" />
        <UButton color="neutral" variant="outline" icon="i-lucide-link" label="从链接导入" :disabled="!!importing" @click="urlOpen = true; urlError = ''" />
        <UButton icon="i-lucide-image-plus" label="导入图片" :loading="importing === 'files'" :disabled="!!importing" @click="importFiles" />
      </div>
    </div>

    <UInput v-model="search" icon="i-lucide-search" placeholder="搜索图片名称或素材 ID" class="w-full max-w-sm" />

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" title="无法读取素材库" :description="error" :actions="[{ label: '重试', color: 'error', variant: 'outline', onClick: refresh }]" />
    <div v-else-if="loading && !materials.length" class="py-16 text-center text-sm text-muted">正在读取素材库…</div>
    <UEmpty v-else-if="!materials.length" icon="i-lucide-images" title="还没有图片素材" description="导入本地图片或图片链接，之后可从发布页直接选择。" :actions="[{ label: '导入图片', icon: 'i-lucide-image-plus', loading: importing === 'files', onClick: importFiles }]" />
    <UEmpty v-else-if="!rows.length" icon="i-lucide-search" title="没有找到图片" description="试试其他图片名称或素材 ID。" />
    <div v-else class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
      <UCard v-for="m in rows" :key="m.id" :ui="{ body: 'p-0 sm:p-0 overflow-hidden', root: 'overflow-hidden' }">
        <img :src="m.previewUrl" :alt="m.name" loading="lazy" class="aspect-square w-full object-contain bg-elevated" />
        <div class="p-3 space-y-1.5">
          <p class="truncate font-medium text-sm" :title="m.name">{{ m.name }}</p>
          <p class="text-xs text-muted">{{ m.width }} × {{ m.height }} · {{ size(m.bytes) }} · {{ m.mimeType.replace('image/', '').toUpperCase() }}</p>
          <p class="text-xs text-muted">{{ new Date(m.createdAt).toLocaleString('zh-CN') }}</p>
          <p class="text-xs text-muted truncate select-all" :title="m.id">ID: {{ m.id }}</p>
        </div>
      </UCard>
    </div>
  </div>

  <UModal v-model:open="urlOpen" title="从链接导入图片" description="填写可直接访问的图片链接，下载后会保存到素材库。" :dismissible="importing !== 'url'">
    <template #body>
      <form id="import-material-url" class="space-y-3" @submit.prevent="importUrl">
        <UFormField label="图片链接" :error="urlError || undefined">
          <UInput v-model="url" placeholder="https://example.com/image.jpg" autofocus class="w-full" :disabled="importing === 'url'" />
        </UFormField>
      </form>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" label="取消" :disabled="importing === 'url'" @click="urlOpen = false" />
        <UButton type="submit" form="import-material-url" label="保存到素材库" :disabled="!url.trim() || !!importing" :loading="importing === 'url'" />
      </div>
    </template>
  </UModal>
</template>
