# 蚂小儿

一键把图文发布到 **小红书 / 微博 / 微信公众号 / X / Facebook / 哔哩哔哩模型小站** 的桌面工具，界面和操作流程参考蚁小二。

- **账号管理**：每个平台可绑定多个账号。登录、发布和手动后台共用该账号的指纹浏览器资料目录；旧账号会一次性迁入未过期的 Cookie，无法确认登录时显示「需重新登录」，重新登录仍使用原来的账号。
- **发布图文**：左边写一份通用内容（图片、标题、正文、话题），右边勾选账号；支持定时发布。
- **分平台内容**：内容区按所选平台分标签页。「通用」页所有平台共用；切到某个平台的标签页，图片、标题、正文、话题都沿用通用内容，改了哪一项哪一项就只对这个平台生效（可「恢复通用」）。每个标签页显示该平台的字数、图片数、话题数上限，按各平台实际要发的内容分别校验。
- **话题标签**：话题以标签形式输入和展示；小红书输入 `#` 后从联想里选中，微博用 `#话题#`，X / Facebook 用 hashtag；模型小站将 `#话题#` 文字附在正文末尾，计入正文上限。
- **话题合集**：可建多组预设话题（如「高达」「旅行」），发布页点一下整组加入，再点一下整组取消；也能把当前话题一键存为新合集。
- **发布配置**：每个账号一张配置卡片，如小红书的谁可以看、内容类型声明、原创声明、合集，微博 / Facebook 的可见范围，X 的回复权限，公众号的留言设置。每个账号可开启“使用上次选择”，下次勾选时自动带出上次的配置。
- **小红书合集**：弹框选择，打开即列出全部合集并聚焦搜索框，输入即过滤；合集列表按账号缓存，可手动刷新。
- **发布记录**：每次发布按账号拆成子任务，实时显示进度，失败可重试；支持删除的平台可从记录删除成功的作品（单个或整次发布一起删）。
- **模型小站**：绑定哔哩哔哩账号后，固定发布到[模型小站](https://www.bilibili.com/bubble/home/26)。支持独立标题、正文、图片、分区选择和可选的“同步至动态”（默认关闭）。默认限制为标题 20 字、正文与话题合计 2000 字、18 张图片，发布时再读取官方编辑器的实际限制；GIF 单张不超过 8 MiB，其他支持的图片不超过 20 MiB。需要账号具备所选分区的发帖权限；恢复出已有草稿时会停止，先在后台处理草稿再重试。发布响应超时应先到小站核对，避免重复发帖。目前需在小站手动删除帖子。

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
    db.ts            SQLite 存储（Node 内置 node:sqlite，userData/maxiaoer.db）
    store.ts         打开数据库
  preload/           contextBridge 暴露 window.maxiaoer
  renderer/          Vue 界面（首页 / 账号管理 / 发布图文 / 发布记录 / 话题合集）
resources/cloakbrowser/   内核版本钉扎与许可证；二进制由 prepare 解压，不进 git
```

每个账号固定指纹 seed、语言（默认 `zh-CN`）和首次检测到的时区。Canvas、WebGL、硬件信息和 UA 由内核负责，不额外打 JS 补丁，也不在每次启动时重建身份。发布窗口有界面，但建在屏幕外且不抢焦点（不用最小化：最小化后页面停止渲染，点击和上传都会卡住），需要扫码时移回屏幕内。超过平台单张大小或尺寸上限的图片（如 X 的 5MB、最长边 16384 像素）发布时自动跳过，并显示原因；原图保留，不自动压缩或裁剪。输入框发布前先清空，不在平台恢复的草稿后追加。同一账号的自动化串行，全局最多同时两个自动化任务。`MXE_HUMANIZE=0` 只关闭行为模拟，不更换内核。公众号的接口上传和少量直接 DOM 点击不走鼠标模拟。

内核是免订阅的官方二进制，版本和 SHA-256 写在 `resources/cloakbrowser/pins.json`，随安装包放在 ASAR 外。运行时不下载、不自动更新，也不会改用本机 Chrome。当前按 [CloakBrowser 二进制许可](https://github.com/CloakHQ/CloakBrowser/blob/main/BINARY-LICENSE.md) 的内部使用范围随包分发；对外公开发布前需要另行取得再分发授权。首版目标是 macOS ARM64、Windows x64、Linux x64。

### 平台实现

各渠道都走登录态浏览器自动化，不需要申请开发者账号或付费 API。实现参考与入口如下：

| 平台 | 参考 | 删除作品 |
| --- | --- | --- |
| 小红书 | [xpzouying/xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp)（Apache-2.0）：上传、标题正文、话题联想、可见范围、原创声明、发布按钮 | 笔记管理页 |
| 微博 | 在已登录页面里直接调网页版接口：`picupload.weibo.com` 传图、`/ajax/statuses/update` 发帖（带网页版风控 SDK 给的 `fp`），不点发布框 | `/ajax/statuses/destroy` |
| 微信公众号 | MultiPost-Extension：后台接口上传图片、创建图片消息 | 发表记录页（需管理员扫码） |
| X | MultiPost-Extension | 帖子菜单 |
| Facebook | MultiPost-Extension | 帖子菜单 |
| 哔哩哔哩模型小站 | [官方小站](https://www.bilibili.com/bubble/home/26)图文编辑器；复用页面图片上传回调与提交按钮，保留帖子 ID 原始精度 | 暂不支持，需在小站手动删除 |

原有五个平台的选择器在 2026-10 用真实账号逐个平台发布、核对、删除过。新增模型小站的选择器、图片上传和提交逻辑依据 2026-10 官方前端资源核对，并进行本地模拟测试；尚未用登录账号实际发布。界面文字按中文界面匹配，平台改版后需要重新核对。

开发时可以用 `MXE_DEBUG_PORT=9333 pnpm dev` 打开远程调试端口，用 `MXE_DRY_RUN=1` 只填表单不提交，用 `MXE_USER_DATA=<目录>` 换一份数据目录，用 `MXE_BACKGROUND=1` 让主窗口开在屏幕外且不抢焦点。

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

## 本地 MCP 与发布 Skill

已提供同时包含 MCP 与 Skill 的插件：[安装说明](docs/plugin-install.md) · [下载发布包](https://github.com/siaikin/maxiaoer/releases/latest)。

```bash
codex plugin marketplace add siaikin/maxiaoer
codex plugin add maxiaoer@maxiaoer-plugins
```

安装后在 ChatGPT 桌面端 / Codex 的本地对话中使用；需要先运行蚂小儿和 Node.js 22+。以下手工配置适用于不使用插件安装的情况。

启动桌面应用后，本机 MCP 会复用现有账号、素材库和发布队列。默认只监听 `127.0.0.1` 的随机端口，连接地址与访问令牌写入 `~/.maxiaoer/mcp.json`；需要隔离运行时，可给应用和客户端同时设置 `MAXIAOER_CONNECTION_FILE`。连接文件包含凭据，不要提交到仓库或粘贴到聊天中。

### 连接本机 Codex

先运行 `pnpm install` 和 `pnpm dev`，然后将以下内容加入项目的 `.codex/config.toml`（替换为本项目的实际绝对路径）：

```toml
[mcp_servers.maxiaoer]
command = "node"
args = ["/path/to/maxiaoer/scripts/mcp-stdio.mjs"]
startup_timeout_sec = 20
tool_timeout_sec = 120
```

Node.js 需支持内置 `fetch`（建议 Node.js 22 或更新版本）。桥接脚本从连接文件读取地址和令牌，配置中不需要写入令牌；应用重启后，重连 MCP 以读取新的连接信息。自定义连接文件可通过参数传入：`args = ["/path/to/maxiaoer/scripts/mcp-stdio.mjs", "--connection", "/path/to/mcp.json"]`。

项目级配置用于已信任的本地项目，相关选项见 [OpenAI MCP 配置说明](https://learn.chatgpt.com/docs/extend/mcp)。此版本面向能运行本机工具的客户端；ChatGPT 网页端不会读取这份本地配置，网页接入需另行配置远程连接。

发布 Skill 位于 [`skills/maxiaoer-publish`](skills/maxiaoer-publish/SKILL.md)，可以将整个目录放入本机的 Skill 目录（例如 `~/.codex/skills/maxiaoer-publish`）。图片上传和连接校验统一维护在 Skill 的 `scripts` 目录，仓库同名脚本仅作兼容入口；整个 Skill 可独立安装。接入后可请求：“用蚂小儿把这些图片和文案发布到我指定的小红书、微博账号，并告诉我结果。”Skill 会查询真实账号和平台限制，导入图片、准备稿件，按已有授权提交并查询任务。

### 图片统一保存到素材库

MCP 发布参数只接受 `materialIds`。图片链接、Base64、Data URL（含 Base64 或百分号编码）或上传的文件字节都先导入素材库，返回素材 ID；发布不会依赖用户原文件的位置。界面里的“导入图片”也会保存副本，“从素材库选择”可重复使用已导入图片。

对于聊天附件或生成图片，先取得其可读取的文件副本，再运行上传客户端。客户端仅在本机读取原文件，将字节上传到应用；无需把本地路径作为 MCP 图片参数，也无需在模型上下文中生成大段 Base64。

```bash
node scripts/maxiaoer-client.mjs info
node scripts/maxiaoer-client.mjs import '/实际图片路径/封面.png' '/实际图片路径/正文.jpg'
```

`info` 只输出不含令牌的连接信息；`import` 为每个成功的导入输出一行 JSON 素材信息。也可调用 `import_material`，在 `url`、`base64`、`dataUrl` 中任选一个字段，并可传 `filename`。URL 应能直接下载到图片；需要登录的链接、普通网页和内网链接可能被拒绝。

单张原图不超过 **25 MiB**。JPEG、PNG、GIF、WebP 保留格式；单页 TIFF、静态 AVIF、SVG 保留原图，并生成 PNG 发布副本。多页 TIFF 和动画 AVIF 会被拒绝，避免丢页或丢帧；BMP、HEIC 暂不保证支持。素材入库不应用平台边长限制或原先的 4000 万像素限制，保留解码器默认的像素资源保护和 300 帧动画保护。发布时按目标平台过滤超限图片，桌面端和 MCP 使用同一规则：`prepare_publish` 的 `preview.materialIds` 为将发布的图片，`skippedMaterials` 和 `warning` 列出跳过的图片及原因。过滤后仍须满足平台的最少/最多图片数；允许纯文字的平台可以不带图片发布。过滤不改变素材库原图，也不影响其他平台。

### 发布、查询与重试

工具包括 `list_platforms`、`list_accounts`、`import_material`、`list_materials`、`prepare_publish`、`publish`、`get_publish_jobs`、`retry_publish_task`、`get_account_collections`、`list_topic_presets`。

`prepare_publish` 返回逐账号预览、校验结果和 `draftId`，支持平台内容覆盖、账号配置，以及带时区的 ISO 定时时间。`publish` 使用 `draftId` 和唯一的 `requestId` 提交；响应丢失时复用相同参数即可获取原任务，不会因重试重复创建任务。一份草稿只提交一次，`get_publish_jobs` 用于查询实际完成状态。

失败重试仅操作指定子任务。凡已有 `startedAt`、即曾经开始执行的任务，以及已有作品 ID／链接或提示超时、无法确认的任务，都必须先核实平台尚未发布，再传 `verifiedNotPublished: true`，避免请求提交后断线导致重复发帖。尚未启动的预检失败可在原发布授权范围内修正后重试；因重复内容跳过的任务，仅在确实要求重复发布时传 `allowDuplicate: true`。

素材保存在应用的数据目录中。账号登录、立即发布、定时发布和素材导入均由本机执行，应用退出或电脑休眠时不会继续执行；定时任务不是云端调度。应用重启会恢复尚未执行的 `pending` 任务；中断时正在执行的 `running` 任务会标为失败，核对平台结果后才可重试。此版本没有自动部署公网服务。

## 本轮验收

已在本机 macOS ARM64 上跑通 `pnpm typecheck`、`pnpm test`、`pnpm build`，并确认安装包 `release/mac-arm64/蚂小儿.app/Contents/Resources/cloakbrowser` 里的内核版本是 `145.0.7632.109.2`，且能从该路径启动。测试使用本地页面，没有向五个平台提交或删除真实作品。

已验证的是本地兼容性：普通表单、富文本、closed Shadow DOM、嵌套滚动、遮挡、动态布局、文件上传、响应捕获、屏幕外窗口照常渲染并能移回屏幕内；同一账号的指纹和登录态跨重启保持，不同账号的资料隔离，Cookie 迁移只做一次，重新登录保留账号 ID，队列不会重复入队，退出时会关掉自己启动的浏览器。固定内核版本下，UA、UA-CH、语言、时区、Canvas 像素和 WebGL 在重启、弹窗和新标签页之间保持一致。

尚未验证五个平台上的实际风控效果。Windows x64 和 Linux x64 的内核版本已钉扎，安装包路径和启动需要在对应系统上再确认。
