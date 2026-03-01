import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import multer from 'multer';
import { spawn, exec } from 'child_process';
import { readFileSync, unlinkSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const ADB_DEVICE = '';
const PORT = 8000;

const upload = multer({ dest: '/tmp/' });

app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

let videoClients = new Set();
let scrcpyProcess = null;

function execAdb(command) {
  return new Promise((resolve, reject) => {
    const cmd = ADB_DEVICE ? `adb -s ${ADB_DEVICE} ${command}` : `adb ${command}`;
    exec(cmd, { timeout: 5000 }, (error, stdout, stderr) => {
      if (error) {
        reject(stderr || error.message);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

function startScrcpy() {
  if (scrcpyProcess) return;

  scrcpyProcess = spawn('scrcpy', [
    '--video-codec=h264',
    '--max-fps=30',
    '--max-size=1080',
    '--no-audio',
    '--video-bit-rate=2M',
    '--no-control',
    '--video-source=display'
  ]);

  scrcpyProcess.stdout.on('data', (data) => {
    videoClients.forEach(client => {
      if (client.readyState === 1) {
        client.send(data);
      }
    });
  });

  scrcpyProcess.on('close', () => {
    scrcpyProcess = null;
  });
}

wss.on('connection', (ws) => {
  videoClients.add(ws);
  
  if (!scrcpyProcess) {
    startScrcpy();
  }

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'touch':
          await execAdb(`shell input tap ${data.x} ${data.y}`);
          break;
        case 'swipe':
          await execAdb(`shell input swipe ${data.x1} ${data.y1} ${data.x2} ${data.y2} ${data.duration || 300}`);
          break;
        case 'key':
          await execAdb(`shell input keyevent ${data.code}`);
          break;
        case 'text':
          const escaped = data.text.replace(/[&|;<>()$`\\"']/g, '\\$&').replace(/ /g, '%s');
          await execAdb(`shell input text "${escaped}"`);
          break;
      }
    } catch (err) {
      ws.send(JSON.stringify({ error: err.toString() }));
    }
  });

  ws.on('close', () => {
    videoClients.delete(ws);
    if (videoClients.size === 0 && scrcpyProcess) {
      scrcpyProcess.kill();
      scrcpyProcess = null;
    }
  });
});

app.post('/api/install', upload.single('apk'), async (req, res) => {
  try {
    const apkPath = req.file.path;
    await execAdb(`install -r ${apkPath}`);
    unlinkSync(apkPath);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.toString() });
  }
});

app.post('/api/install-url', async (req, res) => {
  try {
    const { url } = req.body;
    const apkPath = '/tmp/app.apk';
    
    await new Promise((resolve, reject) => {
      exec(`wget -q "${url}" -O ${apkPath}`, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    
    await execAdb(`install -r ${apkPath}`);
    unlinkSync(apkPath);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.toString() });
  }
});

app.get('/api/packages', async (req, res) => {
  try {
    const output = await execAdb('shell pm list packages -3');
    const packages = output.split('\n')
      .map(line => line.replace('package:', ''))
      .filter(Boolean);
    res.json({ packages });
  } catch (error) {
    res.status(500).json({ error: error.toString() });
  }
});

app.post('/api/uninstall', async (req, res) => {
  try {
    const { package: pkg } = req.body;
    await execAdb(`uninstall ${pkg}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.toString() });
  }
});

app.post('/api/clear-data', async (req, res) => {
  try {
    const { package: pkg } = req.body;
    await execAdb(`shell pm clear ${pkg}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.toString() });
  }
});

app.post('/api/screenshot', async (req, res) => {
  try {
    const tmpFile = `/tmp/screenshot_${Date.now()}.png`;
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execPromise = promisify(exec);
    
    await execPromise(`adb -s ${ADB_DEVICE} exec-out screencap -p > ${tmpFile}`, { timeout: 5000 });
    
    if (existsSync(tmpFile)) {
      const image = readFileSync(tmpFile);
      unlinkSync(tmpFile);
      
      res.set('Content-Type', 'image/png');
      res.send(image);
    } else {
      throw new Error('Screenshot file not created');
    }
  } catch (error) {
    res.status(500).json({ error: error.toString() });
  }
});

app.get('/api/device-info', async (req, res) => {
  try {
    const [version, model, resolution] = await Promise.all([
      execAdb('shell getprop ro.build.version.release'),
      execAdb('shell getprop ro.product.model'),
      execAdb('shell wm size').then(r => r.split(': ')[1])
    ]);
    
    res.json({ version, model, resolution });
  } catch (error) {
    res.status(500).json({ error: error.toString() });
  }
});

app.post('/api/shell', async (req, res) => {
  try {
    const { command } = req.body;
    const output = await execAdb(`shell ${command}`);
    res.json({ output });
  } catch (error) {
    res.status(500).json({ error: error.toString() });
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
