<script setup lang="ts">
import { computed } from 'vue'
import type { Account, Collection, SettingValues } from '../../../shared/types'
import { useAppState } from '../composables/useAppState'
import AccountAvatar from './AccountAvatar.vue'
import CollectionPicker from './CollectionPicker.vue'

/** 单个账号的发布配置卡片；“使用上次选择”开关在父组件里决定初始值 */
const values = defineModel<SettingValues>({ required: true })
const useLast = defineModel<boolean>('useLast', { required: true })
const props = defineProps<{ account: Account; hasLast: boolean }>()
const emit = defineEmits<{ applyLast: [] }>()

const { platformMap } = useAppState()
const fields = computed(() => platformMap.value[props.account.platform]?.settings ?? [])
</script>

<template>
  <UCard :ui="{ header: 'p-3 sm:px-4', body: 'p-3 sm:p-4 space-y-3' }">
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <AccountAvatar :account="account" size="sm" />
          <span class="truncate text-sm font-medium">{{ account.nickname }}</span>
        </div>
        <USwitch
          :model-value="hasLast && useLast"
          size="sm"
          label="使用上次选择"
          :disabled="!hasLast"
          @update:model-value="(v: boolean) => { useLast = v; if (v) emit('applyLast') }"
        />
      </div>
    </template>
    <UFormField v-for="f in fields" :key="f.key" :label="f.label" :help="f.help" orientation="horizontal" :ui="{ container: 'w-48' }">
      <USelect v-if="f.type === 'select'" v-model="values[f.key] as string" :items="f.options" class="w-full" />
      <USwitch v-else-if="f.type === 'switch'" v-model="values[f.key] as boolean" />
      <CollectionPicker v-else-if="f.type === 'collection'" v-model="values[f.key] as Collection | null" :account-id="account.id" />
    </UFormField>
  </UCard>
</template>
