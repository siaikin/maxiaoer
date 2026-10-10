import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, net, protocol, shell } from 'electron'
import { fromLocalFileUrl } from '../shared/localFile'
import { registerIpc } from './ipc'
import { startScheduler } from './publisher'

// 渲染进程用 local-file:// 预览本地图片，避免开放 file://
// 开发时用 MXE_DEBUG_PORT 打开远程调试端口，方便在真实页面上调选择器
if (!app.isPackaged && process.env.MXE_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.MXE_DEBUG_PORT)

// 去掉 UA 里的 Electron / 应用名，平台页面按普通 Chrome 对待
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
  protocol.handle('local-file', (req) => net.fetch(pathToFileURL(fromLocalFileUrl(req.url)).toString()))
  registerIpc()
  startScheduler()
  createMainWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createMainWindow())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
