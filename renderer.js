const sites = require('./sites');
const { ipcRenderer, shell } = require('electron');
const remote = require('@electron/remote');

// ========== DOM 元素 ==========
const webviewContainer = document.getElementById('webview-container');
const floatingBall = document.getElementById('floating-ball');
const floatingPanel = document.getElementById('floating-panel');
const panelCloseBtn = document.getElementById('panel-close-btn');
const mainInput = document.getElementById('main-input');
const sendBtn = document.getElementById('send-btn');
const aiList = document.getElementById('ai-list');
const selectAllBtn = document.getElementById('select-all-btn');
const deselectAllBtn = document.getElementById('deselect-all-btn');
const pkBtn = document.getElementById('pk-btn');

// ========== 状态管理 ==========
let lastQuestion = ''; // 记录最后一次发送的问题
let isPanelVisible = false;
let selectedAIs = new Set(); // 选中的 AI
const webviewMap = new Map(); // 存储 webview 实例
const aiStatusMap = new Map(); // 存储 AI 状态

// 默认选中的 AI
const defaultSelected = ['DeepSeek', '通义千问 (Qwen)', 'Kimi (Moonshot)'];

// ========== 悬浮球拖拽（移动整个窗口） ==========
let isDragging = false;
let hasMoved = false;
let dragStartX, dragStartY;
let winStartX, winStartY;
let animationId = null;
let targetX, targetY;
const mainWindow = remote.getCurrentWindow();

floatingBall.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  isDragging = true;
  hasMoved = false;
  
  const [wx, wy] = mainWindow.getPosition();
  winStartX = wx;
  winStartY = wy;
  targetX = wx;
  targetY = wy;
  dragStartX = e.screenX;
  dragStartY = e.screenY;
  
  floatingBall.classList.add('dragging');
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  
  const deltaX = e.screenX - dragStartX;
  const deltaY = e.screenY - dragStartY;
  
  if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
    hasMoved = true;
  }
  
  if (hasMoved) {
    targetX = winStartX + deltaX;
    targetY = winStartY + deltaY;
    
    // 使用 requestAnimationFrame 优化性能
    if (!animationId) {
      animationId = requestAnimationFrame(updateWindowPosition);
    }
  }
});

function updateWindowPosition() {
  if (isDragging && hasMoved) {
    mainWindow.setPosition(Math.round(targetX), Math.round(targetY), false);
  }
  animationId = null;
}

document.addEventListener('mouseup', () => {
  if (!isDragging) return;
  isDragging = false;
  floatingBall.classList.remove('dragging');
  
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  
  if (!hasMoved) {
    togglePanel();
  }
});

// ========== 面板展开/收起 ==========
function togglePanel() {
  isPanelVisible = !isPanelVisible;
  
  if (isPanelVisible) {
    floatingPanel.classList.add('visible');
    floatingBall.classList.add('hidden');
    setTimeout(() => mainInput.focus(), 200);
  } else {
    floatingPanel.classList.remove('visible');
    floatingBall.classList.remove('hidden');
  }
}

panelCloseBtn.addEventListener('click', togglePanel);

// ESC 键关闭面板
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isPanelVisible) {
    togglePanel();
  }
});

// ========== 初始化 AI 列表 ==========
function initAIList() {
  sites.forEach(site => {
    // 创建 AI 项目
    const item = document.createElement('div');
    item.className = 'ai-item';
    item.dataset.name = site.name;
    
    // 复选框
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'ai-checkbox';
    checkbox.checked = defaultSelected.includes(site.name);
    
    // AI 信息
    const info = document.createElement('div');
    info.className = 'ai-info';
    
    const name = document.createElement('div');
    name.className = 'ai-name';
    name.textContent = site.name;
    
    info.appendChild(name);
    
    // 状态区域
    const status = document.createElement('div');
    status.className = 'ai-status';
    
    const statusDot = document.createElement('div');
    statusDot.className = 'status-dot';
    statusDot.id = `status-${site.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    
    const viewBtn = document.createElement('button');
    viewBtn.className = 'view-btn';
    viewBtn.textContent = '查看';
    viewBtn.onclick = (e) => {
      e.stopPropagation();
      openDetailWindow(site);
    };
    
    status.appendChild(statusDot);
    status.appendChild(viewBtn);
    
    // 组装
    item.appendChild(checkbox);
    item.appendChild(info);
    item.appendChild(status);
    
    // 点击整行切换选中
    item.addEventListener('click', (e) => {
      if (e.target !== checkbox && e.target !== viewBtn) {
        checkbox.checked = !checkbox.checked;
      }
      updateSelection(site.name, checkbox.checked);
      item.classList.toggle('selected', checkbox.checked);
    });
    
    checkbox.addEventListener('change', () => {
      updateSelection(site.name, checkbox.checked);
      item.classList.toggle('selected', checkbox.checked);
    });
    
    // 初始化选中状态
    if (checkbox.checked) {
      selectedAIs.add(site.name);
      item.classList.add('selected');
    }
    
    aiList.appendChild(item);
    
    // 创建后台 webview
    createBackgroundWebview(site);
  });
}

// ========== 更新选中状态 ==========
function updateSelection(name, isSelected) {
  if (isSelected) {
    selectedAIs.add(name);
  } else {
    selectedAIs.delete(name);
  }
}

// 全选
selectAllBtn.addEventListener('click', () => {
  document.querySelectorAll('.ai-item').forEach(item => {
    const checkbox = item.querySelector('.ai-checkbox');
    checkbox.checked = true;
    item.classList.add('selected');
    selectedAIs.add(item.dataset.name);
  });
});

// 清空选择
deselectAllBtn.addEventListener('click', () => {
  document.querySelectorAll('.ai-item').forEach(item => {
    const checkbox = item.querySelector('.ai-checkbox');
    checkbox.checked = false;
    item.classList.remove('selected');
  });
  selectedAIs.clear();
});

// ========== 创建后台 Webview ==========
function createBackgroundWebview(site) {
  const wrapper = document.createElement('div');
  wrapper.className = 'webview-wrapper';
  wrapper.dataset.name = site.name;
  
  const webview = document.createElement('webview');
  webview.src = site.url;
  webview.partition = "persist:ai-in-one";
  webview.useragent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  webview.allowpopups = true;
  
  const safeName = site.name.replace(/[^a-zA-Z0-9]/g, '_');
  
  webview.addEventListener('dom-ready', () => {
    // 检测登录状态
    const checkScript = `
      setInterval(() => {
        const input = document.querySelector('${site.inputSelector}');
        if (input) {
          console.log('SyncChat-Status: ready');
        } else {
          console.log('SyncChat-Status: waiting');
        }
      }, 2000);
    `;
    webview.executeJavaScript(checkScript).catch(() => {});
    
    // 初始状态设为 loading
    updateAIStatus(site.name, 'loading');
  });
  
  webview.addEventListener('console-message', (e) => {
    if (e.message === 'SyncChat-Status: ready') {
      updateAIStatus(site.name, 'ready');
    } else if (e.message === 'SyncChat-Status: waiting') {
      updateAIStatus(site.name, 'loading');
    }
  });
  
  wrapper.appendChild(webview);
  webviewContainer.appendChild(wrapper);
  webviewMap.set(site.name, { wrapper, webview, site });
}

// ========== 更新 AI 状态 ==========
function updateAIStatus(name, status) {
  const safeName = name.replace(/[^a-zA-Z0-9]/g, '_');
  const dot = document.getElementById(`status-${safeName}`);
  if (dot) {
    dot.className = 'status-dot ' + status;
  }
  aiStatusMap.set(name, status);
}

// ========== 打开详情窗口（独立窗口） ==========
function openDetailWindow(site) {
  const data = webviewMap.get(site.name);
  // 获取当前 webview 的实际 URL（可能已经在对话页面）
  let currentUrl = site.url;
  if (data && data.webview) {
    try {
      currentUrl = data.webview.getURL() || site.url;
    } catch (e) {
      currentUrl = site.url;
    }
  }
  
  // 通过 IPC 通知主进程打开新窗口
  ipcRenderer.send('open-ai-detail', {
    name: site.name,
    url: currentUrl
  });
}

// ========== 发送消息到选中的 AI ==========
async function sendToSelectedAIs() {
  const text = mainInput.value.trim();
  if (!text) return;
  
  if (selectedAIs.size === 0) {
    alert('请至少选择一个 AI 服务商');
    return;
  }
  
  const promises = Array.from(selectedAIs).map(async (name) => {
    const site = sites.find(s => s.name === name);
    const data = webviewMap.get(name);
    if (!site || !data) return;
    const webview = data.webview;
    
    try {
      // 1. 聚焦输入框
      const focusScript = `
        (function() {
          const input = document.querySelector('${site.inputSelector}');
          if (input) {
            if ('${site.name}' === '文心一言') {
              input.click();
            }
            input.focus();
            return true;
          }
          return false;
        })();
      `;
      const focused = await webview.executeJavaScript(focusScript);
      
      if (!focused) {
        console.warn(`[${site.name}] Input not found`);
        return;
      }
      
      // 2. 插入文本
      await new Promise(r => setTimeout(r, 200));
      webview.focus();
      
      try {
        await webview.insertText(text);
      } catch (e) {
        console.log(`[${site.name}] insertText failed, fallback to JS`);
      }
      
      // 补充策略
      const escapedText = text.replace(/'/g, "\\'").replace(/\n/g, '\\n');
      await webview.executeJavaScript(`
        (function() {
          const input = document.querySelector('${site.inputSelector}');
          if (!input) return;
          
          const currentVal = input.value || input.innerText || '';
          if (!currentVal.includes('${escapedText.substring(0, 10)}')) {
            input.focus();
            if (input.isContentEditable) {
              document.execCommand('insertText', false, '${escapedText}');
            } else {
              const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set ||
                            Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
              if (setter) {
                setter.call(input, '${escapedText}');
              } else {
                input.value = '${escapedText}';
              }
            }
            input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '${escapedText}' }));
          }
        })();
      `);
      
      // 3. 发送
      await new Promise(r => setTimeout(r, 500));
      
      const sendScript = `
        (function() {
          function simulateEnter(element) {
            const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
            element.dispatchEvent(new KeyboardEvent('keydown', opts));
            element.dispatchEvent(new KeyboardEvent('keypress', opts));
            element.dispatchEvent(new KeyboardEvent('keyup', opts));
          }
          
          const input = document.querySelector('${site.inputSelector}');
          let btn = null;
          if (${JSON.stringify(site.buttonSelector)}) {
            btn = document.querySelector('${site.buttonSelector}');
          }
          
          const shouldClick = btn && '${site.submitType}' !== 'enter';
          
          if (shouldClick) {
            btn.click();
            setTimeout(() => { if (input) simulateEnter(input); }, 500);
          } else {
            if (input) simulateEnter(input);
          }
        })();
      `;
      await webview.executeJavaScript(sendScript);
      
    } catch (err) {
      console.error(`[${site.name}] Send failed:`, err);
    }
  });
  
  await Promise.all(promises);
  lastQuestion = text; // 记录问题
  mainInput.value = '';
  mainInput.focus();
}

// 发送按钮点击
sendBtn.addEventListener('click', sendToSelectedAIs);

// ========== PK 对比功能 ==========
pkBtn.addEventListener('click', () => {
  if (selectedAIs.size < 2) {
    alert('请至少选择 2 个 AI 进行对比');
    return;
  }
  
  if (!lastQuestion) {
    alert('请先发送一个问题');
    return;
  }
  
  // 构建 AI 列表
  const aiListData = Array.from(selectedAIs).map(name => {
    const site = sites.find(s => s.name === name);
    return { name, url: site ? site.url : '' };
  });
  
  // 打开 PK 窗口
  ipcRenderer.send('open-pk-window', {
    question: lastQuestion,
    aiList: aiListData
  });
});

// ========== IPC 监听：获取 AI 回答内容 ==========
ipcRenderer.on('get-ai-contents', async (event, { aiList, question }) => {
  for (const aiName of aiList) {
    const data = webviewMap.get(aiName);
    if (!data || !data.webview) {
      ipcRenderer.send('ai-content-result', { aiName, content: '未找到该 AI' });
      continue;
    }
    
    const site = data.site;
    try {
      // 尝试获取最新回答
      const content = await data.webview.executeJavaScript(`
        (function() {
          // 通用方法：获取最后一个回答
          const selectors = [
            '${site.messageSelector || ''}',
            '.markdown-body',
            '[class*="message"][class*="assistant"]',
            '[class*="answer"]',
            '[class*="response"]',
            '.chat-message:last-child',
            '[data-role="assistant"]:last-child'
          ].filter(s => s);
          
          for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
              const last = elements[elements.length - 1];
              return last.innerText || last.textContent || '';
            }
          }
          return '正在等待回答...';
        })();
      `);
      
      ipcRenderer.send('ai-content-result', { aiName, content: content || '暂无回答' });
    } catch (err) {
      console.error(`获取 ${aiName} 回答失败:`, err);
      ipcRenderer.send('ai-content-result', { aiName, content: '获取失败' });
    }
  }
});

// ========== IPC 监听：转发回答到其他 AI ==========
ipcRenderer.on('forward-to-ai', (event, { fromAI, content, question }) => {
  // 弹出选择框让用户选择目标 AI
  const targetAIs = Array.from(selectedAIs).filter(name => name !== fromAI);
  
  if (targetAIs.length === 0) {
    alert('没有其他可选的 AI');
    return;
  }
  
  // 简单实现：发送到第一个可用的 AI
  // TODO: 可以改成弹窗让用户选择
  const prompt = `请评价以下来自 ${fromAI} 的回答：\n\n问题：${question}\n\n回答：${content}`;
  
  mainInput.value = prompt;
  mainInput.focus();
});

// 回车发送
mainInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendToSelectedAIs();
  }
});

// ========== 初始化 ==========
initAIList();

