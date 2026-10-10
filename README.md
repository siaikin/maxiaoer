# 蚂小儿

一键把图文发布到 **小红书 / 微博 / 微信公众号 / X / Facebook** 的桌面工具，界面和操作流程参考蚁小二。

- **账号管理**：每个平台可绑定多个账号。在内置窗口里扫码 / 网页登录，每个账号一个独立的持久化浏览器分区（cookie 互相隔离）；支持检测登录态、进入平台后台。
- **发布图文**：左边写一份通用内容（图片、标题、正文、话题），右边勾选账号；按所选平台实时校验字数、图片数和话题数；支持定时发布。
- **话题标签**：话题以标签形式输入和展示；发布时按平台转成原生话题（小红书输入 `#` 后从联想里选中，微博用 `#话题#`，X / Facebook 用 hashtag）。
- **常用话题**：维护常用话题库，发布页点一下即可添加，也能把当前话题一键存为常用。
- **发布配置**：每个账号一张配置卡片，如小红书的谁可以看、内容类型声明、原创声明、合集，微博 / Facebook 的可见范围，X 的回复权限，公众号的留言设置。每个账号可开启“使用上次选择”，下次勾选时自动带出上次的配置。
- **小红书合集**：弹框选择，打开即列出全部合集并聚焦搜索框，输入即过滤；合集列表按账号缓存，可手动刷新。
- **发布记录**：每次发布按账号拆成子任务，实时显示进度，失败可重试；成功的作品可以从平台删除（单个或整次发布一起删）。

## 技术栈

Electron + electron-vite + Vue 3 + TypeScript + [Nuxt UI](https://ui.nuxt.com)（Vue 模式），单个包。

```
src/
  shared/            主进程和渲染进程共用：类型、内容校验、IPC 接口定义
  main/              主进程
    browser.ts       基于 webContents + CDP 的浏览器自动化（真实鼠标 / 键盘事件、接口响应抓取）
    platforms/       各平台适配器：登录检测、发布、删除、合集
    accounts.ts      登录窗口、账号检测、合集缓存
    publisher.ts     发布队列、重试、删除、定时
    store.ts         JSON 文件存储（userData/maxiaoer.json）
  preload/           contextBridge 暴露 window.maxiaoer
  renderer/          Vue 界面（首页 / 账号管理 / 发布图文 / 发布记录 / 常用话题）
```

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
pnpm dev          # 启动桌面端
pnpm typecheck
pnpm test
pnpm build
pnpm package      # 打安装包
```

国内网络下载 Electron 慢可以在 `.npmrc` 里打开镜像配置。
