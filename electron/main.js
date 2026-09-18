const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron')
const path = require('path')
const fs = require('fs')

let controlWindow = null
const childWindows = new Map() // id -> { win, kind }
const lastStates = new Map() // kind -> последнее сообщение каждого типа

const DEV = !app.isPackaged
const indexPath = app.isPackaged
  ? `file://${path.join(__dirname, '..', 'dist', 'index.html')}`
  : (process.env.VITE_DEV_SERVER_URL || `file://${path.join(__dirname, '..', 'dist', 'index.html')}`)

function loadWithHash(win, hash) {
  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(`${process.env.VITE_DEV_SERVER_URL}#${hash}`)
  } else {
    win.loadURL(`file://${path.join(__dirname, '..', 'dist', 'index.html')}#${hash}`)
  }
}

function createControlWindow() {
  controlWindow = new BrowserWindow({
    width: 1500,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    title: 'ГОЛОВА — панель управления',
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  loadWithHash(controlWindow, '')
  controlWindow.on('closed', () => {
    controlWindow = null
    for (const [, { win }] of childWindows) {
      if (!win.isDestroyed()) win.close()
    }
    childWindows.clear()
  })
}

ipcMain.on('state:send', (e, payload) => {
  if (payload && typeof payload === 'object' && typeof payload.kind === 'string') {
    lastStates.set(payload.kind, payload)
  }
  for (const [, { win }] of childWindows) {
    if (!win.isDestroyed() && win.webContents.id !== e.sender.id) {
      win.webContents.send('state:apply', payload)
    }
  }
})

ipcMain.on('child:ready', (e) => {
  if (e.sender.isDestroyed()) return
  // Отдаём новому окну ПОЛНУЮ снапшот синхронизации: sync (параметры+состояние),
  // затем model и всё остальное, чтобы окно стартовало сразу с готовой головой,
  // а не с дефолтной простой моделью.
  const order = ['sync', 'params', 'emotion', 'chatter', 'audio', 'effects', 'color', 'video', 'model']
  for (const kind of order) {
    const m = lastStates.get(kind)
    if (m) {
      try {
        e.sender.send('state:apply', m)
      } catch {
        // ignore
      }
    }
  }
})

function displayForWindow(win) {
  if (win && !win.isDestroyed()) {
    const disp = screen.getDisplayMatching(win.getBounds())
    if (disp) return disp
  }
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
}

function createChildWindow(kind) {
  const parent = controlWindow
  const disp = displayForWindow(parent)
  const wa = disp.workArea
  const win = new BrowserWindow({
    x: wa.x,
    y: wa.y,
    width: wa.width,
    height: wa.height,
    title: kind === 'viz' ? 'ГОЛОВА — визуализация' : 'ГОЛОВА — плейер',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    fullscreenable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  const id = win.webContents.id
  childWindows.set(id, { win, kind })
  loadWithHash(win, kind === 'viz' ? 'viz' : 'player')
  win.on('closed', () => childWindows.delete(id))
  return id
}

app.whenReady().then(() => {
  createControlWindow()

  screen.on('display-metrics-changed', () => {
    for (const [, { win, kind }] of childWindows) {
      if (win.isDestroyed()) continue
      const disp = screen.getDisplayMatching(win.getBounds())
      const wa = disp.workArea
      const wasFull = win.isFullScreen()
      if (wasFull) {
        win.setFullScreen(false)
      }
      win.setBounds(wa)
      win.webContents.send('display:changed', {
        bounds: wa,
        display: {
          id: disp.id,
          size: disp.size,
          workArea: wa,
          scaleFactor: disp.scaleFactor,
        },
      })
      if (wasFull) {
        win.setFullScreen(true)
      }
    }
  })
})

ipcMain.handle('win:openViz', () => createChildWindow('viz'))
ipcMain.handle('win:openPlayer', () => createChildWindow('player'))

ipcMain.handle('win:openAllDisplays', () => {
  const created = []
  for (const disp of screen.getAllDisplays()) {
    const wa = disp.workArea
    const win = new BrowserWindow({
      x: wa.x,
      y: wa.y,
      width: wa.width,
      height: wa.height,
      title: `ГОЛОВА — рендер (дисплей ${disp.id})`,
      backgroundColor: '#000000',
      autoHideMenuBar: true,
      fullscreenable: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    const id = win.webContents.id
    childWindows.set(id, { win, kind: 'viz' })
    loadWithHash(win, 'viz')
    win.on('closed', () => childWindows.delete(id))
    created.push({ id: disp.id, bounds: wa, scaleFactor: disp.scaleFactor })
  }
  return created
})

ipcMain.handle('win:listDisplays', () => {
  return screen.getAllDisplays().map((d) => ({
    id: d.id,
    bounds: d.bounds,
    workArea: d.workArea,
    size: d.size,
    scaleFactor: d.scaleFactor,
  }))
})

ipcMain.handle('win:downloadSelf', async () => {
  try {
    const exe = process.execPath
    const dest = path.join(app.getPath('downloads'), path.basename(exe))
    await fs.promises.copyFile(exe, dest)
    return dest
  } catch (e) {
    return null
  }
})
ipcMain.handle('win:closeChild', (e) => {
  const id = e.sender.id
  const c = childWindows.get(id)
  if (c) { c.win.close(); childWindows.delete(id) }
  return true
})

ipcMain.handle('win:fullscreen', (e, flag) => {
  const id = e.sender.id
  const c = childWindows.get(id) || { win: controlWindow }
  if (c.win && !c.win.isDestroyed()) {
    if (typeof flag === 'boolean') c.win.setFullScreen(flag)
    else c.win.setFullScreen(!c.win.isFullScreen())
  }
  return c.win ? c.win.isFullScreen() : false
})

ipcMain.handle('win:getDisplay', (e) => {
  const id = e.sender.id
  const c = childWindows.get(id) || { win: controlWindow }
  const disp = c.win && !c.win.isDestroyed()
    ? screen.getDisplayMatching(c.win.getBounds())
    : screen.getPrimaryDisplay()
  return {
    bounds: c.win ? c.win.getBounds() : null,
    display: {
      id: disp.id,
      size: disp.size,
      workArea: disp.workArea,
      scaleFactor: disp.scaleFactor,
    },
  }
})

ipcMain.handle('dialog:openFile', async (e, opts) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const res = await dialog.showOpenDialog(win, {
    title: opts?.title || 'Выберите файл',
    filters: opts?.filters || [],
    properties: ['openFile'],
  })
  if (res.canceled || res.filePaths.length === 0) return null
  return res.filePaths[0]
})

ipcMain.handle('dialog:openFiles', async (e, opts) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const res = await dialog.showOpenDialog(win, {
    title: opts?.title || 'Выберите файлы',
    filters: opts?.filters || [],
    properties: ['openFile', 'multiSelections'],
  })
  if (res.canceled || res.filePaths.length === 0) return []
  return res.filePaths
})

ipcMain.handle('fs:readText', async (e, p) => {
  try { return await fs.promises.readFile(p, 'utf-8') } catch { return null }
})

ipcMain.handle('fs:readBinary', async (e, p) => {
  try {
    const buf = await fs.promises.readFile(p)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  } catch { return null }
})

ipcMain.handle('fs:writeText', async (e, p, data) => {
  try { await fs.promises.writeFile(p, data, 'utf-8'); return true } catch { return false }
})

ipcMain.handle('dialog:saveFile', async (e, opts) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const res = await dialog.showSaveDialog(win, {
    title: opts?.title || 'Сохранить',
    defaultPath: opts?.defaultPath || 'avatar.json',
    filters: opts?.filters || [],
  })
  if (res.canceled || !res.filePath) return null
  return res.filePath
})

const userDataFile = (name) => path.join(app.getPath('userData'), name)

ipcMain.handle('data:scriptsLoad', async () => {
  try { return await fs.promises.readFile(userDataFile('scripts.json'), 'utf-8') } catch { return null }
})
ipcMain.handle('data:scriptsSave', async (e, data) => {
  try { await fs.promises.writeFile(userDataFile('scripts.json'), data, 'utf-8'); return true } catch { return false }
})
ipcMain.handle('data:paramsLoad', async () => {
  try { return await fs.promises.readFile(userDataFile('avatar_params.json'), 'utf-8') } catch { return null }
})
ipcMain.handle('data:paramsSave', async (e, data) => {
  try { await fs.promises.writeFile(userDataFile('avatar_params.json'), data, 'utf-8'); return true } catch { return false }
})

app.on('window-all-closed', () => {
  app.quit()
})
