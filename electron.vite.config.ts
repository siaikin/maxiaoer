import { resolve } from 'node:path'
import ui from '@nuxt/ui/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
    plugins: [
      vue(),
      ui({
        ui: { colors: { primary: 'blue', neutral: 'zinc' } },
        // 组件和自动导入的类型声明放在 renderer 目录下
        autoImport: { dts: resolve(__dirname, 'src/renderer/auto-imports.d.ts') },
        components: { dts: resolve(__dirname, 'src/renderer/components.d.ts') },
      }),
    ],
  },
})
