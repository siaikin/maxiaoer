import './assets/main.css'
import lucide from '@iconify-json/lucide/icons.json'
import { addCollection } from '@iconify/vue'
import ui from '@nuxt/ui/vue-plugin'
import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'

// 图标离线打包，桌面端不依赖 Iconify 在线接口
addCollection(lucide)

createApp(App).use(router).use(ui).mount('#app')
