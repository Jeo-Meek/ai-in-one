const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const remoteMain = require('@electron/remote/main');

remoteMain.initialize();

// 错误处理 - 捕获未处理的异常
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

let mainWindow = null;
let pkWindow = null;
const detailWindows = new Map(); // 存储详情窗口

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 550,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,  // 不显示在任务栏
    resizable: false,
    hasShadow: false,
    titleBarStyle: 'hidden',  // 隐藏标题栏
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, 
      webviewTag: true,
      webSecurity: false
    },
    show: false
  });
  
  // 移除菜单栏
  mainWindow.setMenu(null);

  // 启用 remote 模块
  remoteMain.enable(mainWindow.webContents);
  
  // 页面加载完成后显示窗口
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 加载错误处理
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });

  mainWindow.loadFile('index.html');
  
  // 忽略 HTTPS 证书错误
  app.commandLine.appendSwitch('ignore-certificate-errors');
  app.commandLine.appendSwitch('disable-site-isolation-trials');
}

// 打开 AI 详情窗口 - 使用 BrowserView 共享 webview
function openDetailWindow(name, url) {
  // 如果窗口已存在，聚焦它
  if (detailWindows.has(name)) {
    const existingWindow = detailWindows.get(name);
    if (!existingWindow.isDestroyed()) {
      existingWindow.focus();
      return;
    }
  }
  
  const detailWindow = new BrowserWindow({
    width: 1000,
    height: 750,
    minWidth: 600,
    minHeight: 400,
    title: name,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
      webSecurity: false
    },
    show: false
  });
  
  // 启用 remote
  remoteMain.enable(detailWindow.webContents);
  
  // 加载详情页面
  detailWindow.loadFile('detail.html', {
    query: { name, url }
  });
  
  detailWindow.once('ready-to-show', () => {
    detailWindow.show();
  });
  
  detailWindow.on('closed', () => {
    detailWindows.delete(name);
  });
  
  detailWindows.set(name, detailWindow);
}

// IPC 监听 - 打开 AI 详情窗口
ipcMain.on('open-ai-detail', (event, { name, url }) => {
  openDetailWindow(name, url);
});

// 打开 PK 对比窗口
function openPKWindow(question, aiList) {
  if (pkWindow && !pkWindow.isDestroyed()) {
    pkWindow.focus();
    return;
  }

  pkWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 600,
    minHeight: 500,
    title: 'AI PK 对比',
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
      webSecurity: false
    },
    show: false
  });

  pkWindow.setMenu(null);
  remoteMain.enable(pkWindow.webContents);

  const aiListEncoded = encodeURIComponent(JSON.stringify(aiList));
  pkWindow.loadFile('pk.html', {
    query: { question, aiList: aiListEncoded }
  });

  pkWindow.once('ready-to-show', () => {
    pkWindow.show();
  });

  pkWindow.on('closed', () => {
    pkWindow = null;
  });
}

// IPC 监听 - 打开 PK 窗口
ipcMain.on('open-pk-window', (event, { question, aiList }) => {
  openPKWindow(question, aiList);
});

// IPC 监听 - 请求获取 AI 回答内容
ipcMain.on('request-pk-contents', (event, { aiList, question }) => {
  // 转发给主窗口获取内容
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('get-ai-contents', { aiList, question });
  }
});

// IPC 监听 - 主窗口返回 AI 内容
ipcMain.on('ai-content-result', (event, { aiName, content }) => {
  if (pkWindow && !pkWindow.isDestroyed()) {
    pkWindow.webContents.send('update-pk-content', { aiName, content });
  }
});

// IPC 监听 - 转发回答到其他 AI
ipcMain.on('forward-answer', (event, { fromAI, content, question }) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('forward-to-ai', { fromAI, content, question });
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error) => {
  console.error('Failed to start app:', error);
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

