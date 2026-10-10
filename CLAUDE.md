# 蚂小儿

参考蚁小二的一键发布图文桌面工具。结构和平台说明见 README.md。

- 包管理用 pnpm；提交前跑 `pnpm typecheck && pnpm test && pnpm build`。
- 工作区包（`@maxiaoer/core`、`@maxiaoer/adapters`）直接导出 TS 源码，由 electron-vite 打进主进程 bundle（见 `electron.vite.config.ts` 的 `externalizeDeps.exclude`）。
- 新平台：在 `packages/core/src/types.ts` 的 `PLATFORM_IDS` 加 id，在 `packages/adapters/src/platforms/` 加适配器并注册到 `index.ts`，在 `apps/desktop/src/renderer/src/platforms.ts` 加品牌色。
- 适配器不能 import electron，只用 `BrowserContext` / `ApiContext`。
- 渲染进程经 IPC 传对象前要去掉 Vue 响应式代理（JSON 克隆或 `toRaw`）。
- 界面文案用中文。
