import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, net, protocol, shell } from 'electron'
import { fromLocalFileUrl } from '../shared/localFile'
import { registerIpc } from './ipc'
import { initBrowserHost, shutdownBrowserHost, browserHasOpen } from './browser'
import { startScheduler } from './publisher'

// 渲染进程用 local-file:// 预览本地图片，避免开放 file://
// 开发时用 MXE_DEBUG_PORT 打开远程调试端口，方便在真实页面上调选择器
if (!app.isPackaged && process.env.MXE_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.MXE_DEBUG_PORT)

// 仅作用于本应用自己的 Electron 窗口。账号页在 CloakBrowser 里打开，不在这里改 UA，也不注入指纹脚本。
app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|maxiaoer)\/\S+/g, '')

protocol.registerSchemesAsPrivileged([{ scheme: 'local-file', privileges: { standard: true, supportFetchAPI: true } }])

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1100,
    minHeight: 720,
    title: '蚂小儿',
    webPreferences: { preload: join(__dirname, '../preload/index.mjs'), sandbox: false },
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  initBrowserHost()
  protocol.handle('local-file', (req) => net.fetch(pathToFileURL(fromLocalFileUrl(req.url)).toString()))
  registerIpc()
  startScheduler()
  createMainWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createMainWindow())
})

let quitting = false
app.on('before-quit', (event) => {
  if (quitting || !browserHasOpen()) return
  event.preventDefault()
  quitting = true
  void shutdownBrowserHost().finally(() => app.quit())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
