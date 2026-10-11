<script setup lang="ts">
import type { ContentField } from '../../../shared/types'

/** 字段名；平台页上附带“单独设置 / 沿用通用”状态和恢复按钮 */
defineProps<{ label: string; field: ContentField; overridden?: Partial<Record<ContentField, boolean>> }>()
defineEmits<{ reset: [] }>()
</script>

<template>
  <span class="inline-flex items-center gap-2">
    <span>{{ label }}</span>
    <template v-if="overridden">
      <template v-if="overridden[field]">
        <UBadge label="单独设置" size="sm" variant="subtle" />
        <UButton label="恢复通用" size="xs" variant="link" icon="i-lucide-undo-2" class="p-0" @click="$emit('reset')" />
      </template>
      <span v-else class="text-xs text-dimmed font-normal">沿用通用</span>
    </template>
  </span>
</template>
