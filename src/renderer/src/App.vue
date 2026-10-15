<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { zh_cn } from '@nuxt/ui/locale'
import { useRoute } from 'vue-router'

const route = useRoute()

// 账号、素材、内容和发布记录统一从侧边导航进入
const items: NavigationMenuItem[] = [
  { label: '首页', icon: 'i-lucide-house', to: '/' },
  { label: '账号管理', icon: 'i-lucide-users', to: '/accounts' },
  { label: '发布图文', icon: 'i-lucide-square-pen', to: '/publish' },
  { label: '素材库', icon: 'i-lucide-images', to: '/materials' },
  { label: '发布记录', icon: 'i-lucide-list-checks', to: '/records' },
  { label: '话题合集', icon: 'i-lucide-layers', to: '/topics' },
]
</script>

<template>
  <UApp :locale="zh_cn">
    <UDashboardGroup>
      <UDashboardSidebar :default-size="14" :min-size="12" :max-size="20">
        <template #header>
          <div class="flex items-center gap-2 px-1 font-semibold text-lg text-primary">
            <UIcon name="i-lucide-send" class="size-5" />
            蚂小儿
          </div>
        </template>
        <UNavigationMenu :items="items" orientation="vertical" />
      </UDashboardSidebar>

      <UDashboardPanel :id="String(route.name)">
        <template #header>
          <UDashboardNavbar :title="String(route.meta.title ?? '')" />
        </template>
        <template #body>
          <RouterView />
        </template>
      </UDashboardPanel>
    </UDashboardGroup>
  </UApp>
</template>
