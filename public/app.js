class AndroidTester {
  constructor() {
    this.ws = null;
    this.canvas = document.getElementById('screen');
    this.ctx = this.canvas.getContext('2d');
    this.isConnected = false;
    
    this.init();
  }

  init() {
    this.setupWebSocket();
    this.setupEventListeners();
    this.loadDeviceInfo();
    this.loadInstalledApps();
  }

  setupWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${window.location.host}`);
    this.ws.binaryType = 'blob';

    this.ws.onopen = () => {
      this.isConnected = true;
      this.hideStatus();
    };

    this.ws.onmessage = (event) => {
      if (event.data instanceof Blob) {
        this.handleFrame(event.data);
      }
    };

    this.ws.onclose = () => {
      this.isConnected = false;
      this.showStatus('Connection lost. Reconnecting...');
      setTimeout(() => this.setupWebSocket(), 2000);
    };

    this.ws.onerror = () => {
      this.showStatus('Connection error');
    };
  }

  handleFrame(blob) {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    
    img.onload = () => {
      if (this.canvas.width !== img.width || this.canvas.height !== img.height) {
        this.canvas.width = img.width;
        this.canvas.height = img.height;
      }
      this.ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
    };
    
    img.src = url;
  }

  setupEventListeners() {
    this.canvas.addEventListener('click', (e) => this.handleTouch(e));
    
    const uploadArea = document.getElementById('upload-area');
    const fileInput = document.getElementById('apk-file');
    
    uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.classList.add('drag-over');
    });
    
    uploadArea.addEventListener('dragleave', () => {
      uploadArea.classList.remove('drag-over');
    });
    
    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith('.apk')) {
        this.installApk(file);
      }
    });
    
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.installApk(file);
      }
    });

    document.getElementById('install-url-btn').addEventListener('click', () => {
      const url = document.getElementById('apk-url').value.trim();
      if (url) {
        this.installApkFromUrl(url);
      }
    });

    document.getElementById('screenshot-btn').addEventListener('click', () => this.takeScreenshot());
    document.getElementById('home-btn').addEventListener('click', () => this.sendKey(3));
    document.getElementById('back-btn').addEventListener('click', () => this.sendKey(4));
    document.getElementById('recents-btn').addEventListener('click', () => this.sendKey(187));

    document.getElementById('shell-btn').addEventListener('click', () => this.executeShell());
    document.getElementById('shell-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.executeShell();
    });
  }

  handleTouch(e) {
    if (!this.isConnected) return;

    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) * (this.canvas.width / rect.width));
    const y = Math.floor((e.clientY - rect.top) * (this.canvas.height / rect.height));

    this.ws.send(JSON.stringify({
      type: 'touch',
      x: x,
      y: y
    }));
  }

  sendKey(code) {
    if (!this.isConnected) return;
    
    this.ws.send(JSON.stringify({
      type: 'key',
      code: code
    }));
  }

  async installApk(file) {
    const formData = new FormData();
    formData.append('apk', file);

    try {
      this.showToast('Installing APK...', 'info');
      const response = await fetch('/api/install', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();
      
      if (result.success) {
        this.showToast('APK installed successfully', 'success');
        this.loadInstalledApps();
      } else {
        this.showToast(result.error || 'Installation failed', 'error');
      }
    } catch (error) {
      this.showToast('Installation failed: ' + error.message, 'error');
    }
  }

  async installApkFromUrl(url) {
    try {
      this.showToast('Downloading and installing APK...', 'info');
      const response = await fetch('/api/install-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      const result = await response.json();
      
      if (result.success) {
        this.showToast('APK installed successfully', 'success');
        document.getElementById('apk-url').value = '';
        this.loadInstalledApps();
      } else {
        this.showToast(result.error || 'Installation failed', 'error');
      }
    } catch (error) {
      this.showToast('Installation failed: ' + error.message, 'error');
    }
  }

  async loadDeviceInfo() {
    try {
      const response = await fetch('/api/device-info');
      const info = await response.json();
      
      document.getElementById('android-version').textContent = info.version;
      document.getElementById('device-model').textContent = info.model;
      document.getElementById('device-resolution').textContent = info.resolution;
    } catch (error) {
      console.error('Failed to load device info:', error);
    }
  }

  async loadInstalledApps() {
    const appsList = document.getElementById('apps-list');
    appsList.innerHTML = '<div class="loading">Loading apps...</div>';

    try {
      const response = await fetch('/api/packages');
      const data = await response.json();
      
      if (data.packages.length === 0) {
        appsList.innerHTML = '<div class="loading">No user apps installed</div>';
        return;
      }

      appsList.innerHTML = data.packages.map(pkg => `
        <div class="app-item">
          <span class="app-name" title="${pkg}">${pkg}</span>
          <div class="app-actions">
            <button class="btn btn-secondary" onclick="tester.clearAppData('${pkg}')">Clear</button>
            <button class="btn btn-secondary" onclick="tester.uninstallApp('${pkg}')">Remove</button>
          </div>
        </div>
      `).join('');
    } catch (error) {
      appsList.innerHTML = '<div class="loading">Failed to load apps</div>';
    }
  }

  async uninstallApp(pkg) {
    if (!confirm(`Uninstall ${pkg}?`)) return;

    try {
      const response = await fetch('/api/uninstall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package: pkg })
      });

      const result = await response.json();
      
      if (result.success) {
        this.showToast('App uninstalled', 'success');
        this.loadInstalledApps();
      } else {
        this.showToast(result.error || 'Uninstall failed', 'error');
      }
    } catch (error) {
      this.showToast('Uninstall failed: ' + error.message, 'error');
    }
  }

  async clearAppData(pkg) {
    try {
      const response = await fetch('/api/clear-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package: pkg })
      });

      const result = await response.json();
      
      if (result.success) {
        this.showToast('App data cleared', 'success');
      } else {
        this.showToast(result.error || 'Clear data failed', 'error');
      }
    } catch (error) {
      this.showToast('Clear data failed: ' + error.message, 'error');
    }
  }

  async takeScreenshot() {
    try {
      this.showToast('Taking screenshot...', 'info');
      const response = await fetch('/api/screenshot');
      const blob = await response.blob();
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `screenshot-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
      
      this.showToast('Screenshot saved', 'success');
    } catch (error) {
      this.showToast('Screenshot failed: ' + error.message, 'error');
    }
  }

  async executeShell() {
    const input = document.getElementById('shell-input');
    const output = document.getElementById('shell-output');
    const command = input.value.trim();
    
    if (!command) return;

    try {
      const response = await fetch('/api/shell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command })
      });

      const result = await response.json();
      output.textContent = result.output || result.error || 'Command executed';
      input.value = '';
    } catch (error) {
      output.textContent = 'Error: ' + error.message;
    }
  }

  showStatus(message) {
    const status = document.getElementById('status');
    status.querySelector('span').textContent = message;
    status.classList.remove('hidden');
  }

  hideStatus() {
    document.getElementById('status').classList.add('hidden');
  }

  showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }
}

const tester = new AndroidTester();
