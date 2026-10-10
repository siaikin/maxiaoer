import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'electron-vite'

// 工作区包（@maxiaoer/*）直接导出 TS 源码，需要打进 bundle 而不是 external
const bundleWorkspace = { externalizeDeps: { exclude: ['@maxiaoer/core', '@maxiaoer/adapters'] } }

export default defineConfig({
  main: { build: bundleWorkspace },
  preload: { build: bundleWorkspace },
  renderer: {
    resolve: { alias: { '@renderer': resolve(__dirname, 'src/renderer/src') } },
    plugins: [vue()],
  },
})
