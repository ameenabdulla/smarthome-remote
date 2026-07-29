/**
 * Smart Home IoT — Render.com WebSocket Relay Server
 * Bridges ESP32 hardware (/device) with web browsers (/ws)
 * Works 100% free on Render.com
 */

'use strict';
const http  = require('http');
const WebSocket = require('ws');
const fs    = require('fs');
const path  = require('path');

const PORT = process.env.PORT || 10000;

// ──────────────────────────────────────────────────────────
// Static file server for the web dashboard
// ──────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css' : 'text/css',
  '.js'  : 'application/javascript',
  '.json': 'application/json',
  '.png' : 'image/png',
  '.ico' : 'image/x-icon'
};

const httpServer = http.createServer((req, res) => {
  // Strip query string
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  // Block WebSocket upgrade paths from HTTP handler
  if (urlPath === '/ws' || urlPath === '/device') {
    res.writeHead(426, { 'Content-Type': 'text/plain' });
    res.end('WebSocket only');
    return;
  }

  const filePath = path.join(__dirname, 'public', urlPath);
  const ext  = path.extname(filePath);
  const mime = MIME[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback — serve index.html for unknown routes
      fs.readFile(path.join(__dirname, 'public', 'index.html'), (err2, data2) => {
        if (err2) { res.writeHead(404); res.end('Not Found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data2);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

// ──────────────────────────────────────────────────────────
// WebSocket relay
//   /device  → ESP32 hardware
//   /ws      → browser clients
// ──────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ noServer: true });

let esp32  = null;            // The one ESP32 connection
const browsers = new Set();   // All browser connections
let lastState  = null;        // Cache last state for new browsers

function broadcastBrowsers(data) {
  browsers.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
}

httpServer.on('upgrade', (req, socket, head) => {
  const url = req.url.split('?')[0];

  if (url === '/device' || url === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, req) => {
  const url = req.url.split('?')[0];
  const isDevice = (url === '/device');

  if (isDevice) {
    // ── ESP32 connected ──────────────────────────────────
    esp32 = ws;
    console.log('[ESP32] Connected ✓');

    // Tell all browsers the device came online
    broadcastBrowsers(JSON.stringify({ type: 'device_status', online: true }));

    ws.on('message', (raw) => {
      const str = raw.toString();
      try {
        const msg = JSON.parse(str);
        if (msg.type === 'state') lastState = str; // cache
      } catch (_) {}
      broadcastBrowsers(str); // Forward to all browsers
    });

    ws.on('close', () => {
      console.log('[ESP32] Disconnected');
      if (esp32 === ws) esp32 = null;
      broadcastBrowsers(JSON.stringify({ type: 'device_status', online: false }));
    });

    ws.on('error', (e) => console.error('[ESP32] Error:', e.message));

  } else {
    // ── Browser connected ────────────────────────────────
    browsers.add(ws);
    console.log(`[Browser] Connected  (${browsers.size} online)`);

    // Send cached state immediately so UI populates
    if (lastState) ws.send(lastState);

    // Send current device online/offline status
    const devOnline = esp32 !== null && esp32.readyState === WebSocket.OPEN;
    ws.send(JSON.stringify({ type: 'device_status', online: devOnline }));

    ws.on('message', (raw) => {
      // Browser → ESP32
      if (esp32 && esp32.readyState === WebSocket.OPEN) {
        esp32.send(raw.toString());
      }
    });

    ws.on('close', () => {
      browsers.delete(ws);
      console.log(`[Browser] Disconnected (${browsers.size} online)`);
    });

    ws.on('error', (e) => console.error('[Browser] Error:', e.message));
  }
});

// ──────────────────────────────────────────────────────────
// Keep Render.com free tier alive (self-ping every 14 min)
// ──────────────────────────────────────────────────────────
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) {
  setInterval(() => {
    require('https').get(SELF_URL, () => {}).on('error', () => {});
    console.log('[Keep-Alive] Ping sent to', SELF_URL);
  }, 14 * 60 * 1000);
}

httpServer.listen(PORT, () => {
  console.log(`Smart Home Server running on port ${PORT}`);
  console.log(`  ESP32  → wss://<host>/device`);
  console.log(`  Browser→ wss://<host>/ws`);
});
