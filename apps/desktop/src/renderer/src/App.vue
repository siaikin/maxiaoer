<script setup lang="ts">
import {
  NConfigProvider, NDialogProvider, NLayout, NLayoutSider, NMenu, NMessageProvider,
  dateZhCN, zhCN, type MenuOption,
} from 'naive-ui'
import { computed, h, onMounted } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useAppStore } from './stores/app'

const route = useRoute()
const store = useAppStore()
onMounted(store.load)

const link = (to: string, label: string) => () => h(RouterLink, { to }, { default: () => label })
// 侧边导航结构参考蚁小二：首页 / 账号 / 发布 / 记录
const menu: MenuOption[] = [
  { key: 'home', label: link('/', '首页') },
  { key: 'accounts', label: link('/accounts', '账号管理') },
  { key: 'publish', label: link('/publish', '发布图文') },
  { key: 'records', label: link('/records', '发布记录') },
]
const active = computed(() => String(route.name ?? 'home'))
const themeOverrides = { common: { primaryColor: '#2468f2', primaryColorHover: '#4a84f5', primaryColorPressed: '#1a52c4' } }
</script>

<template>
  <NConfigProvider :locale="zhCN" :date-locale="dateZhCN" :theme-overrides="themeOverrides">
    <NMessageProvider>
      <NDialogProvider>
        <NLayout has-sider class="root">
          <NLayoutSider bordered :width="200" content-style="padding: 16px 0">
            <div class="brand">蚂小儿</div>
            <NMenu :value="active" :options="menu" />
          </NLayoutSider>
          <NLayout content-style="padding: 24px" :native-scrollbar="false">
            <h2 class="page-title">{{ route.meta.title }}</h2>
            <RouterView />
          </NLayout>
        </NLayout>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>

<style>
html, body, #app { margin: 0; height: 100%; }
.root { height: 100vh; }
.brand { font-size: 20px; font-weight: 600; padding: 0 24px 16px; color: #2468f2; }
.page-title { margin: 0 0 16px; font-size: 18px; font-weight: 600; }
</style>
