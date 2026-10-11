# 蚂小儿

一键把图文发布到 **小红书 / 微博 / 微信公众号 / X / Facebook** 的桌面工具，界面和操作流程参考蚁小二。

- **账号管理**：每个平台可绑定多个账号。登录、发布和手动后台共用该账号的指纹浏览器资料目录；旧账号会一次性迁入未过期的 Cookie，无法确认登录时显示「需重新登录」，重新登录仍使用原来的账号。
- **发布图文**：左边写一份通用内容（图片、标题、正文、话题），右边勾选账号；按所选平台实时校验字数、图片数和话题数；支持定时发布。
- **话题标签**：话题以标签形式输入和展示；发布时按平台转成原生话题（小红书输入 `#` 后从联想里选中，微博用 `#话题#`，X / Facebook 用 hashtag）。
- **常用话题**：维护常用话题库，发布页点一下即可添加，也能把当前话题一键存为常用。
- **发布配置**：每个账号一张配置卡片，如小红书的谁可以看、内容类型声明、原创声明、合集，微博 / Facebook 的可见范围，X 的回复权限，公众号的留言设置。每个账号可开启“使用上次选择”，下次勾选时自动带出上次的配置。
- **小红书合集**：弹框选择，打开即列出全部合集并聚焦搜索框，输入即过滤；合集列表按账号缓存，可手动刷新。
- **发布记录**：每次发布按账号拆成子任务，实时显示进度，失败可重试；成功的作品可以从平台删除（单个或整次发布一起删）。

## 技术栈

Electron + electron-vite + Vue 3 + TypeScript + [Nuxt UI](https://ui.nuxt.com)（Vue 模式），单个包。

界面仍是 Electron。每个账号启动一个内置的 [CloakBrowser](https://github.com/CloakHQ/CloakBrowser) 进程，平台适配器只依赖自己的 `BrowserContext`，经 CDP 发送真实输入。鼠标、输入和滚动的行为模拟在 `src/main/anti-detection/human.ts`，分层参考 [xiaohongshu-mcp 的 humanize](https://github.com/xpzouying/xiaohongshu-mcp/tree/main/humanize)。

```
src/
  shared/            主进程和渲染进程共用：类型、内容校验、IPC 接口定义
  main/
    anti-detection/  行为模拟（贝塞尔鼠标、逐字输入、滚轮）
    browser/         指纹内核、账号会话、Cookie 迁移、任务队列
    platforms/       各平台适配器：登录检测、发布、删除、合集
    accounts.ts      登录、重新登录、账号检测、合集缓存
    publisher.ts     发布队列、重试、删除、定时
    store.ts         JSON 文件存储（userData/maxiaoer.json）
  preload/           contextBridge 暴露 window.maxiaoer
  renderer/          Vue 界面（首页 / 账号管理 / 发布图文 / 发布记录 / 常用话题）
resources/cloakbrowser/   内核版本钉扎与许可证；二进制由 prepare 解压，不进 git
```

每个账号固定指纹 seed、语言（默认 `zh-CN`）和首次检测到的时区。Canvas、WebGL、硬件信息和 UA 由内核负责，不额外打 JS 补丁，也不在每次启动时重建身份。发布窗口有界面，但建在屏幕外且不抢焦点（不用最小化：最小化后页面停止渲染，点击和上传都会卡住），需要扫码时移回屏幕内。超过平台单张大小上限的图片（如 X 的 5MB）发布前自动压缩副本，原图不动。输入框发布前先清空，不在平台恢复的草稿后追加。同一账号的自动化串行，全局最多同时两个自动化任务。`MXE_HUMANIZE=0` 只关闭行为模拟，不更换内核。公众号的接口上传和少量直接 DOM 点击不走鼠标模拟。

内核是免订阅的官方二进制，版本和 SHA-256 写在 `resources/cloakbrowser/pins.json`，随安装包放在 ASAR 外。运行时不下载、不自动更新，也不会改用本机 Chrome。当前按 [CloakBrowser 二进制许可](https://github.com/CloakHQ/CloakBrowser/blob/main/BINARY-LICENSE.md) 的内部使用范围随包分发；对外公开发布前需要另行取得再分发授权。首版目标是 macOS ARM64、Windows x64、Linux x64。

### 平台实现

五个平台都走登录态浏览器自动化，不需要申请开发者账号或付费 API。实现参考了这些开源项目：

| 平台 | 参考 | 删除作品 |
| --- | --- | --- |
| 小红书 | [xpzouying/xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp)（Apache-2.0）：上传、标题正文、话题联想、可见范围、原创声明、发布按钮 | 笔记管理页 |
| 微博 | [leaperone/MultiPost-Extension](https://github.com/leaperone/MultiPost-Extension)（Apache-2.0） | `/ajax/statuses/destroy` |
| 微信公众号 | MultiPost-Extension：后台接口上传图片、创建图片消息 | 发表记录页（需管理员扫码） |
| X | MultiPost-Extension | 帖子菜单 |
| Facebook | MultiPost-Extension | 帖子菜单 |

选择器在 2026-10 用真实账号逐个平台发布、核对、删除过。界面文字按中文界面匹配，平台改版后需要重新核对。

开发时可以用 `MXE_DEBUG_PORT=9333 pnpm dev` 打开远程调试端口，用 `MXE_DRY_RUN=1` 只填表单不提交。

## 开发

```bash
pnpm install
pnpm browser:prepare   # 为本机准备指纹内核，只在打包或首次开发前需要
pnpm dev               # 启动桌面端
pnpm typecheck
pnpm test              # 真实浏览器的集成测试会弹出窗口，默认跳过；要跑时加 MXE_LIVE=1
pnpm build
pnpm package           # 先准备内核，再打安装包
```

国内网络下载 Electron 慢可以在 `.npmrc` 里打开镜像配置。`browser:prepare` 只下载当前系统对应的内核；Windows 和 Linux 需要在各自机器上准备。

## 本轮验收

已在本机 macOS ARM64 上跑通 `pnpm typecheck`、`pnpm test`、`pnpm build`，并确认安装包 `release/mac-arm64/蚂小儿.app/Contents/Resources/cloakbrowser` 里的内核版本是 `145.0.7632.109.2`，且能从该路径启动。测试使用本地页面，没有向五个平台提交或删除真实作品。

已验证的是本地兼容性：普通表单、富文本、closed Shadow DOM、嵌套滚动、遮挡、动态布局、文件上传、响应捕获、屏幕外窗口照常渲染并能移回屏幕内；同一账号的指纹和登录态跨重启保持，不同账号的资料隔离，Cookie 迁移只做一次，重新登录保留账号 ID，队列不会重复入队，退出时会关掉自己启动的浏览器。固定内核版本下，UA、UA-CH、语言、时区、Canvas 像素和 WebGL 在重启、弹窗和新标签页之间保持一致。

尚未验证五个平台上的实际风控效果。Windows x64 和 Linux x64 的内核版本已钉扎，安装包路径和启动需要在对应系统上再确认。
