<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { ref, watch } from 'vue'
import type { Collection } from '../../../shared/types'
import { errorText } from '../composables/useAppState'

/** 小红书合集选择：弹框打开即搜索（关键字为空时列出全部），输入时防抖再搜 */
const selected = defineModel<Collection | null>({ default: null })
const props = defineProps<{ accountId: string }>()

const open = ref(false)
const searchTerm = ref('')
const debounced = refDebounced(searchTerm, 300)
const loading = ref(false)
const error = ref('')
const items = ref<Collection[]>([])

async function search(refresh = false) {
  loading.value = true
  error.value = ''
  try {
    items.value = await window.maxiaoer.accounts.collections(props.accountId, debounced.value, refresh)
  } catch (e) {
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}

watch(open, (v) => v && search())
watch(debounced, () => open.value && search())

function pick(c: Collection) {
  selected.value = { id: c.id, name: c.name, count: c.count }
  open.value = false
}
</script>

<template>
  <div class="flex items-center gap-2">
    <UModal v-model:open="open" title="选择合集" :ui="{ content: 'max-w-md' }">
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-folder-plus"
        :label="selected ? selected.name : '选择合集'"
        class="flex-1 justify-start"
      />
      <template #content>
        <UCommandPalette
          v-model:search-term="searchTerm"
          :loading="loading"
          placeholder="搜索合集"
          :autofocus="true"
          :fuse="{ resultLimit: 100 }"
          :groups="[{ id: 'collections', items: items.map((c) => ({ label: c.name, suffix: c.count ? `${c.count} 篇` : undefined, icon: 'i-lucide-folder', onSelect: () => pick(c) })), ignoreFilter: true }]"
          close
          @update:open="open = $event"
        >
          <template #empty>
            <div class="py-6 text-center text-sm text-muted">
              {{ loading ? '正在读取合集…' : error || '没有找到合集' }}
            </div>
          </template>
          <template #footer>
            <div class="flex justify-between items-center">
              <span class="text-xs text-muted">首次读取需要打开小红书发布页，稍等几秒</span>
              <UButton size="xs" variant="ghost" icon="i-lucide-refresh-cw" label="刷新" :loading="loading" @click="search(true)" />
            </div>
          </template>
        </UCommandPalette>
      </template>
    </UModal>
    <UButton v-if="selected" color="neutral" variant="ghost" icon="i-lucide-x" aria-label="清除合集" @click="selected = null" />
  </div>
</template>
