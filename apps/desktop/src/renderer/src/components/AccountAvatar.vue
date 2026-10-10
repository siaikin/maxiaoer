<script setup lang="ts">
import type { Account } from '@maxiaoer/core'
import { NAvatar, NBadge } from 'naive-ui'
import { platformMeta } from '../platforms'

defineProps<{ account: Account; size?: number }>()
</script>

<template>
  <span class="account-avatar">
    <NAvatar round :size="size ?? 36" :src="account.avatar" fallback-src="">
      {{ account.nickname.slice(0, 1) }}
    </NAvatar>
    <span class="badge" :style="{ background: platformMeta[account.platform].color }">
      {{ platformMeta[account.platform].short }}
    </span>
    <NBadge v-if="account.status === 'expired'" dot type="error" class="expired" />
  </span>
</template>

<style scoped>
.account-avatar { position: relative; display: inline-flex; }
.badge {
  position: absolute; right: -4px; bottom: -2px; width: 16px; height: 16px; border-radius: 50%;
  color: #fff; font-size: 10px; line-height: 16px; text-align: center; border: 1.5px solid #fff;
}
.expired { position: absolute; top: 0; right: 0; }
</style>
