/**
 * Smart Home IoT — Remote WebSocket Bridge (Render.com)
 * Connects browser dashboard to Render.com relay server → ESP32
 * Drop-in replacement for local esp32-ws.js
 */
(function () {
    'use strict';

    // ── Render.com server URL (auto-detected from current page host) ──
    const RENDER_HOST = location.hostname;
    const WS_PROTOCOL = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const WS_URL = WS_PROTOCOL + RENDER_HOST + '/ws';

    let ws = null;
    let reconnectTimer = null;
    let isConnected = false;
    let deviceOnline = false;

    function init() {
        connect();
    }

    function connect() {
        if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

        try {
            ws = new WebSocket(WS_URL);
        } catch (e) {
            console.warn('[Remote WS] Cannot connect:', e);
            scheduleReconnect();
            return;
        }

        ws.onopen = function () {
            console.log('[Remote WS] Connected to Render.com server:', WS_URL);
            isConnected = true;
            updateStatusUI('server');
            if (window.Toast) window.Toast.showToast('Server Connected — Waiting for ESP32...');
        };

        ws.onmessage = function (event) {
            try {
                const data = JSON.parse(event.data);

                // Handle device online/offline notifications
                if (data.type === 'device_status') {
                    deviceOnline = data.online;
                    updateStatusUI(data.online ? 'online' : 'offline');
                    if (data.online) {
                        if (window.Toast) window.Toast.showToast('ESP32 Online — Live Control Active');
                        if (window.WaterTank && window.WaterTank.stopDemo) window.WaterTank.stopDemo();
                        if (window.SafetyMonitor && window.SafetyMonitor.stopAutoDemo) window.SafetyMonitor.stopAutoDemo();
                    } else {
                        if (window.Toast) window.Toast.showToast('ESP32 Offline — Check device power');
                    }
                    return;
                }

                handleStateMessage(data);
            } catch (err) {
                console.error('[Remote WS] Parse error:', err);
            }
        };

        ws.onclose = function () {
            if (isConnected) console.warn('[Remote WS] Server disconnected');
            isConnected = false;
            deviceOnline = false;
            updateStatusUI('offline');
            scheduleReconnect();
        };

        ws.onerror = function () {
            ws.close();
        };
    }

    function scheduleReconnect() {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, 3000);
    }

    function updateStatusUI(status) {
        const dot  = document.getElementById('system-status-dot');
        const text = document.getElementById('system-status-text');
        if (!dot || !text) return;
        if (status === 'online') {
            dot.className  = 'status-dot online';
            text.textContent = 'ESP32 ONLINE';
        } else if (status === 'server') {
            dot.className  = 'status-dot'; // yellow-ish
            dot.style.background = '#f59e0b';
            text.textContent = 'SERVER OK — ESP32 Connecting...';
        } else {
            dot.className  = 'status-dot offline';
            dot.style.background = '';
            text.textContent = 'OFFLINE (DEMO)';
        }
    }

    function sendCommand(data) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        } else {
            console.warn('[Remote WS] Not connected — command dropped');
        }
    }

    function handleStateMessage(data) {
        if (data.type !== 'state') return;

        if (Array.isArray(data.lights) && window.LightControl && window.LightControl.applyServerState)
            window.LightControl.applyServerState(data.lights);

        if (data.gate && window.GateControl && window.GateControl.applyServerState)
            window.GateControl.applyServerState(data.gate.pos, data.gate.status);

        if (data.pump && window.PumpControl && window.PumpControl.applyServerState)
            window.PumpControl.applyServerState(data.pump.on, data.pump.mode);

        if (data.water && window.WaterTank && window.WaterTank.applyServerState)
            window.WaterTank.applyServerState(data.water.distance, data.water.level, data.water.height);

        if (window.SafetyMonitor && window.SafetyMonitor.applyServerState)
            window.SafetyMonitor.applyServerState(data.gas, data.flame, data.ir);

        if (data.settings && window.Settings && window.Settings.applyServerSettings)
            window.Settings.applyServerSettings(data.settings);
    }

    window.ESP32WS = {
        init,
        send: sendCommand,
        isConnected: () => isConnected && deviceOnline
    };

    document.addEventListener('DOMContentLoaded', init);
})();
