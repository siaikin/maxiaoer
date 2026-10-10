<script setup lang="ts">
import type { Account, PlatformId } from '@maxiaoer/core'
import {
  NButton, NCard, NDataTable, NForm, NFormItem, NInput, NModal, NSpace, NTabPane, NTabs, NTag, useMessage,
  type DataTableColumns,
} from 'naive-ui'
import { computed, h, ref } from 'vue'
import AccountAvatar from '../components/AccountAvatar.vue'
import { platformMeta } from '../platforms'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const message = useMessage()
const filter = ref<'all' | PlatformId>('all')
const rows = computed(() => store.accounts.filter((a) => filter.value === 'all' || a.platform === filter.value))

const addOpen = ref(false)
const credentialPlatform = ref<PlatformId | null>(null)
const credentials = ref<Record<string, string>>({})
const busy = ref(false)
const credentialFields = computed(() => store.platforms.find((p) => p.id === credentialPlatform.value)?.credentialFields ?? [])

async function add(platform: PlatformId) {
  const info = store.platforms.find((p) => p.id === platform)
  if (info?.mode === 'api') {
    credentialPlatform.value = platform
    credentials.value = {}
    return
  }
  addOpen.value = false
  const account = await window.maxiaoer.accounts.login(platform)
  if (account) message.success(`已添加 ${account.nickname}`)
  await store.refreshAccounts()
}

async function submitCredentials() {
  busy.value = true
  try {
    const account = await window.maxiaoer.accounts.addWithCredentials(credentialPlatform.value!, { ...credentials.value })
    message.success(`已添加 ${account.nickname}`)
    credentialPlatform.value = null
    addOpen.value = false
    await store.refreshAccounts()
  } catch (e) {
    message.error(String(e))
  } finally {
    busy.value = false
  }
}

async function check(a: Account) {
  const updated = await window.maxiaoer.accounts.check(a.id)
  message.info(updated.status === 'active' ? '登录正常' : '登录已失效，请重新登录')
  await store.refreshAccounts()
}

async function remove(a: Account) {
  await window.maxiaoer.accounts.remove(a.id)
  await store.refreshAccounts()
}

const columns: DataTableColumns<Account> = [
  {
    title: '账号',
    key: 'nickname',
    render: (a) => h(NSpace, { align: 'center' }, () => [h(AccountAvatar, { account: a }), a.nickname]),
  },
  { title: '平台', key: 'platform', render: (a) => platformMeta[a.platform].name },
  {
    title: '状态',
    key: 'status',
    render: (a) =>
      h(NTag, { size: 'small', type: a.status === 'active' ? 'success' : a.status === 'expired' ? 'error' : 'default' }, () =>
        a.status === 'active' ? '正常' : a.status === 'expired' ? '已失效' : '未检测',
      ),
  },
  {
    title: '操作',
    key: 'actions',
    render: (a) =>
      h(NSpace, null, () => [
        h(NButton, { size: 'small', onClick: () => window.maxiaoer.accounts.open(a.id) }, () => '进入后台'),
        h(NButton, { size: 'small', onClick: () => check(a) }, () => '检测'),
        h(NButton, { size: 'small', type: 'error', ghost: true, onClick: () => remove(a) }, () => '删除'),
      ]),
  },
]
</script>

<template>
  <NCard>
    <NSpace justify="space-between" style="margin-bottom: 12px">
      <NTabs v-model:value="filter" type="segment" style="width: 560px">
        <NTabPane name="all" tab="全部" />
        <NTabPane v-for="p in store.platforms" :key="p.id" :name="p.id" :tab="p.name" />
      </NTabs>
      <NButton type="primary" @click="addOpen = true">添加账号</NButton>
    </NSpace>
    <NDataTable :columns="columns" :data="rows" :row-key="(a: Account) => a.id" />
  </NCard>

  <NModal v-model:show="addOpen" preset="card" title="添加账号" style="width: 520px">
    <template v-if="!credentialPlatform">
      <NSpace>
        <NButton v-for="p in store.platforms" :key="p.id" size="large" @click="add(p.id)">
          {{ p.name }}
        </NButton>
      </NSpace>
      <p style="color: #888; font-size: 12px">小红书 / 微博 / 公众号会打开登录窗口扫码；X / Facebook 需填写开发者凭据。</p>
    </template>
    <NForm v-else @submit.prevent="submitCredentials">
      <NFormItem v-for="f in credentialFields" :key="f.key" :label="f.label">
        <NInput v-model:value="credentials[f.key]" :type="f.secret ? 'password' : 'text'" show-password-on="click" />
      </NFormItem>
      <NSpace justify="end">
        <NButton @click="credentialPlatform = null">返回</NButton>
        <NButton type="primary" :loading="busy" attr-type="submit">验证并添加</NButton>
      </NSpace>
    </NForm>
  </NModal>
</template>
