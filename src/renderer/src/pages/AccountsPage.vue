<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { computed, h, ref, resolveComponent } from 'vue'
import type { Account, PlatformId } from '../../../shared/types'
import AccountAvatar from '../components/AccountAvatar.vue'
import { errorText, useAppState } from '../composables/useAppState'

const { platforms, platformMap, accounts, refreshAccounts } = useAppState()
const toast = useToast()
const UButton = resolveComponent('UButton')
const UBadge = resolveComponent('UBadge')

const filter = ref<'all' | PlatformId>('all')
const tabs = computed(() => [{ label: '全部', value: 'all' }, ...platforms.value.map((p) => ({ label: p.name, value: p.id }))])
const rows = computed(() => accounts.value.filter((a) => filter.value === 'all' || a.platform === filter.value))
const addOpen = ref(false)
const busy = ref<string | null>(null)

async function add(platform: PlatformId) {
  addOpen.value = false
  const account = await window.maxiaoer.accounts.login(platform)
  if (account) toast.add({ title: `已添加 ${account.nickname}`, color: 'success' })
  await refreshAccounts()
}

async function run(a: Account, fn: () => Promise<unknown>, ok?: string) {
  busy.value = a.id
  try {
    await fn()
    if (ok) toast.add({ title: ok, color: 'success' })
  } catch (e) {
    toast.add({ title: '操作失败', description: errorText(e), color: 'error' })
  } finally {
    busy.value = null
    await refreshAccounts()
  }
}

const status = { active: ['正常', 'success'], expired: ['已失效', 'error'], unknown: ['未检测', 'neutral'] } as const

const columns: TableColumn<Account>[] = [
  {
    header: '账号',
    cell: ({ row }) => h('div', { class: 'flex items-center gap-3' }, [h(AccountAvatar, { account: row.original }), row.original.nickname]),
  },
  { header: '平台', cell: ({ row }) => platformMap.value[row.original.platform]?.name },
  {
    header: '状态',
    cell: ({ row }) => h(UBadge, { label: status[row.original.status][0], color: status[row.original.status][1], variant: 'subtle' }),
  },
  {
    id: 'actions',
    cell: ({ row }) => {
      const a = row.original
      const btn = (label: string, icon: string, onClick: () => void, color = 'neutral') =>
        h(UButton, { label, icon, size: 'xs', variant: 'ghost', color, loading: busy.value === a.id && label === '检测', onClick })
      return h('div', { class: 'flex justify-end gap-1' }, [
        btn('进入后台', 'i-lucide-external-link', () => window.maxiaoer.accounts.open(a.id)),
        btn('检测', 'i-lucide-refresh-cw', () => run(a, () => window.maxiaoer.accounts.check(a.id))),
        a.status === 'expired' ? btn('重新登录', 'i-lucide-log-in', () => add(a.platform), 'primary') : null,
        btn('删除', 'i-lucide-trash-2', () => run(a, () => window.maxiaoer.accounts.remove(a.id), '已删除'), 'error'),
      ])
    },
  },
]
</script>

<template>
  <div class="space-y-4">
    <div class="flex justify-between items-center">
      <UTabs v-model="filter" :items="tabs" :content="false" size="sm" />
      <UModal v-model:open="addOpen" title="添加账号" description="在弹出的窗口里扫码或登录，成功后自动保存">
        <UButton icon="i-lucide-plus" label="添加账号" />
        <template #body>
          <div class="grid grid-cols-3 gap-3">
            <UButton
              v-for="p in platforms"
              :key="p.id"
              color="neutral"
              variant="outline"
              size="xl"
              class="justify-center"
              @click="add(p.id)"
            >
              <span class="size-3 rounded-full" :style="{ background: p.color }" />
              {{ p.name }}
            </UButton>
          </div>
        </template>
      </UModal>
    </div>
    <UTable :data="rows" :columns="columns" class="rounded-lg ring ring-default">
      <template #empty>
        <UEmpty icon="i-lucide-users" title="还没有账号" description="点右上角“添加账号”绑定平台账号" />
      </template>
    </UTable>
  </div>
</template>
