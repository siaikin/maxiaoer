<script setup lang="ts">
import type { Account } from '../../../shared/types'
import { useAppState } from '../composables/useAppState'

defineProps<{ account: Account; size?: 'xs' | 'sm' | 'md' | 'lg' }>()
const { platformMap } = useAppState()
</script>

<template>
  <UChip
    :color="account.status === 'expired' ? 'error' : 'neutral'"
    :show="account.status === 'expired'"
    position="top-right"
    inset
  >
    <div class="relative">
      <UAvatar :src="account.avatar" :alt="account.nickname" :size="size ?? 'md'" />
      <span
        class="absolute -right-1 -bottom-1 size-3.5 rounded-full ring-2 ring-default"
        :style="{ background: platformMap[account.platform]?.color }"
        :title="platformMap[account.platform]?.name"
      />
    </div>
  </UChip>
</template>
