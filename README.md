# 蚂小儿

一键把图文发布到 **小红书 / 微博 / 微信公众号 / X / Facebook** 的桌面工具，界面和操作流程参考蚁小二：

1. **账号管理**：每个平台可绑定多个账号。小红书、微博、公众号在内置窗口里扫码 / 网页登录，每个账号一个独立的持久化浏览器分区（cookie 隔离）；X、Facebook 填写官方 API 凭据，凭据用系统钥匙串（`safeStorage`）加密保存。
2. **发布图文**：左侧写一份通用内容（图片、标题、正文、话题），右侧勾选账号；按所选平台实时校验字数和图片数量；支持定时发布。
3. **发布记录**：每次发布按账号拆成子任务，实时显示进度，失败可重试，成功后可跳到作品。

## 技术栈

Electron + electron-vite + Vue 3 + TypeScript + Naive UI + Pinia，pnpm monorepo。

```
apps/desktop            Electron 应用
  src/main              主进程：账号登录、浏览器自动化（CDP）、发布队列、本地存储
  src/preload           contextBridge 暴露 window.maxiaoer
  src/renderer          Vue 界面（首页 / 账号管理 / 发布图文 / 发布记录）
  src/shared            主进程与渲染进程共用的 IPC 类型
packages/core           领域类型（Account / Post / PublishJob）、适配器接口、内容校验
packages/adapters       各平台适配器
```

### 平台适配器

| 平台 | 方式 | 说明 |
| --- | --- | --- |
| 小红书 | 浏览器自动化 | creator.xiaohongshu.com，无开放发布 API |
| 微博 | 浏览器自动化 | weibo.com 网页版 |
| 微信公众号 | 浏览器自动化 | mp.weixin.qq.com 图片消息；官方 API 仅限认证号 |
| X | 官方 API v2 | OAuth 2.0 用户令牌，发帖需付费 API 套餐 |
| Facebook | Graph API | 仅公共主页（Page），需 Page Access Token |

浏览器类适配器只依赖 `@maxiaoer/core` 里的 `BrowserContext` 接口，桌面端用 `webContents.debugger`（CDP）实现，适配器本身不依赖 Electron。**三个浏览器类适配器的页面选择器都还是初版（代码里标了 `TODO(实测)`），需要登录真实账号逐个调通。**

## 开发

```bash
pnpm install
pnpm dev          # 启动桌面端
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @maxiaoer/desktop package   # 打安装包
```

国内网络下载 Electron 慢可以在 `.npmrc` 里打开镜像配置。
