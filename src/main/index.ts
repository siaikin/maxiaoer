import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, net, protocol, shell } from 'electron'
import { fromLocalFileUrl } from '../shared/localFile'
import { registerIpc } from './ipc'
import { initBrowserHost, shutdownBrowserHost, browserHasOpen } from './browser'
import { startScheduler } from './publisher'
import { closeDb, getDb } from './store'
import { startLocalMcp } from './mcp/runtime'

// 渲染进程用 local-file:// 预览本地图片，避免开放 file://
// 开发时用 MXE_DEBUG_PORT 打开远程调试端口，方便在真实页面上调选择器
if (!app.isPackaged && process.env.MXE_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.MXE_DEBUG_PORT)
// 开发时 MXE_USER_DATA 指定另一份数据目录，测试不碰正在用的数据
if (!app.isPackaged && process.env.MXE_USER_DATA) app.setPath('userData', process.env.MXE_USER_DATA)

const ownsInstance = app.requestSingleInstanceLock()
if (!ownsInstance) app.quit()

// 仅作用于本应用自己的 Electron 窗口。账号页在 CloakBrowser 里打开，不在这里改 UA，也不注入指纹脚本。
app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|maxiaoer)\/\S+/g, '')

protocol.registerSchemesAsPrivileged([{ scheme: 'local-file', privileges: { standard: true, supportFetchAPI: true } }])

function createMainWindow() {
  // 开发时 MXE_BACKGROUND=1：主窗口建在屏幕外且不抢焦点，自动化测试时不打扰正在用电脑的人
  const background = !app.isPackaged && process.env.MXE_BACKGROUND === '1'
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1100,
    minHeight: 720,
    title: '蚂小儿',
    // 有边框的窗口会被 macOS 拉回屏幕内，无边框的不会
    ...(background ? { show: false, frame: false, x: -30000, y: -30000, enableLargerThanScreen: true } : {}),
    webPreferences: { preload: join(__dirname, '../preload/index.mjs'), sandbox: false },
  })
  if (background) win.showInactive()
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

let localMcp: Awaited<ReturnType<typeof startLocalMcp>>
if (ownsInstance) app.whenReady().then(async () => {
  getDb()
  initBrowserHost()
  protocol.handle('local-file', (req) => net.fetch(pathToFileURL(fromLocalFileUrl(req.url)).toString()))
  registerIpc()
  startScheduler()
  createMainWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createMainWindow())
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus() }
  })
  try {
    localMcp = await startLocalMcp()
  } catch (error) {
    console.error('本地 MCP 启动失败：', error instanceof Error ? error.message : '未知错误')
  }
})

let quitting = false
app.on('before-quit', (event) => {
  if (quitting || (!browserHasOpen() && !localMcp)) return
  event.preventDefault()
  quitting = true
  void Promise.allSettled([localMcp?.close(), shutdownBrowserHost()]).finally(() => app.quit())
})

app.on('will-quit', closeDb)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
