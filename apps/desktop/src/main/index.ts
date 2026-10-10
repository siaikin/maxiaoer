import { join } from 'node:path'
import { app, BrowserWindow, net, protocol, shell } from 'electron'
import { pathToFileURL } from 'node:url'
import { registerIpc } from './ipc'
import { startScheduler } from './publisher'

// 渲染进程用 local-file:// 预览本地图片，避免开放 file://
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
  protocol.handle('local-file', (req) => {
    const path = decodeURIComponent(new URL(req.url).pathname)
    return net.fetch(pathToFileURL(path).toString())
  })
  registerIpc()
  startScheduler()
  createMainWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createMainWindow())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
