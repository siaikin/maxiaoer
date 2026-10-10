# 蚂小儿

参考蚁小二的一键发布图文桌面工具。结构和平台说明见 README.md。

- 单包项目，包管理用 pnpm；提交前跑 `pnpm typecheck && pnpm test && pnpm build`。
- UI 用 Nuxt UI（Vue 模式，`@nuxt/ui/vite` 插件），组件和 `useToast` 等自动导入；图标用 lucide，离线打包（`main.ts` 里 `addCollection`）。
- `src/shared` 两端共用，不能 import electron 或 node 专属模块以外的东西到渲染进程。
- 平台适配器在 `src/main/platforms/`，只用 `BrowserContext` 接口，不直接 import electron；交互优先用 `ctx.click / type / press`（CDP 真实输入事件），按文字定位用 `util.ts` 的 `mark / clickWithin`。
- 新平台：`shared/types.ts` 的 `PLATFORM_IDS` 加 id，`platforms/` 加适配器并注册到 `platforms/index.ts`。
- 渲染进程经 IPC 传对象前要去掉 Vue 响应式代理（`plain()`）。
- 界面文案、注释用中文。
