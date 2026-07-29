// ── Connection Setup ────────────────────────────────────────────────────
const host = window.location.host;
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${protocol}//${host}/ws`;
const API_URL = `${window.location.protocol}//${host}`;

// ── UI Elements ─────────────────────────────────────────────────────────
const connectionBadge = document.getElementById('connection-badge');
const badgeText = document.getElementById('badge-text');
const waterFill = document.getElementById('water-fill');
const levelPercent = document.getElementById('level-percent');
const distanceCm = document.getElementById('distance-cm');
const tankDepthDisplay = document.getElementById('tank-depth-display');
const rssiVal = document.getElementById('rssi-val');

const pumpStateIndicator = document.getElementById('pump-state-indicator');
const pumpStateText = document.getElementById('pump-state-text');
const pumpStatusText = document.getElementById('pump-status-text');

const settingsBtn = document.getElementById('settings-btn');
const modalOverlay = document.getElementById('modal-overlay');
const modalClose = document.getElementById('modal-close');

const inputDepth = document.getElementById('input-depth');
const inputOffset = document.getElementById('input-offset');
const inputLow = document.getElementById('input-low');
const inputHigh = document.getElementById('input-high');
const lowVal = document.getElementById('low-val');
const highVal = document.getElementById('high-val');
const calibrateDistance = document.getElementById('calibrate-distance');
const btnSave = document.getElementById('btn-save-settings');

// ── State variables ─────────────────────────────────────────────────────
let currentState = { levelPercent: 0, distanceCm: 0, pumpOn: false, mode: 'AUTOMATIC', online: false, rssi: 0 };
let currentConfig = { tankDepthCm: 100, sensorOffsetCm: 5, lowThreshold: 20, highThreshold: 90 };

// ── UI Updates ──────────────────────────────────────────────────────────
function updateTankUI(state) {
  if (!waterFill) return;
  const pct = Math.max(0, Math.min(100, state.levelPercent || 0));
  waterFill.style.height = pct + '%';

  if (pct < 20) {
    waterFill.style.background = 'linear-gradient(180deg, rgba(239,68,68,0.7) 0%, rgba(180,40,40,0.5) 100%)';
  } else if (pct < 50) {
    waterFill.style.background = 'linear-gradient(180deg, rgba(245,158,11,0.7) 0%, rgba(180,100,10,0.5) 100%)';
  } else {
    waterFill.style.background = 'linear-gradient(180deg, rgba(14,165,233,0.7) 0%, rgba(14,165,233,0.4) 40%, rgba(3,105,161,0.5) 100%)';
  }

  if (levelPercent) levelPercent.innerHTML = pct.toFixed(1) + '<small>%</small>';
  if (distanceCm) distanceCm.innerHTML = (state.distanceCm || 0).toFixed(1) + ' <small>cm</small>';
  if (rssiVal) rssiVal.innerHTML = (state.rssi || 0) + ' <small>dBm</small>';
  if (calibrateDistance) calibrateDistance.textContent = (state.distanceCm || 0).toFixed(1) + ' cm';
}

function updatePumpUI(state) {
  const isPumpOn = (state.pumpOn === true || state.pump_on === true);
  if (pumpStateText) pumpStateText.textContent = isPumpOn ? 'ON' : 'OFF';
  if (pumpStateIndicator) pumpStateIndicator.className = 'pump-state-badge ' + (isPumpOn ? 'on' : 'off');
  if (pumpStatusText) pumpStatusText.textContent = 'Mode: AUTOMATIC (Low ≤ 20% → ON, High ≥ 90% → OFF)';
}

function updateDeviceStatus(online) {
  if (!connectionBadge || !badgeText) return;
  if (online) {
    connectionBadge.className = 'badge online';
    badgeText.textContent = 'ESP32 ONLINE';
  } else {
    connectionBadge.className = 'badge offline';
    badgeText.textContent = 'ESP32 OFFLINE';
  }
}

function updateConfigUI(config) {
  if (tankDepthDisplay) tankDepthDisplay.innerHTML = (config.tankDepthCm || 100) + ' <small>cm</small>';
  if (inputDepth) inputDepth.value = config.tankDepthCm || 100;
  if (inputOffset) inputOffset.value = config.sensorOffsetCm || 5;
  if (inputLow) inputLow.value = config.lowThreshold || 20;
  if (inputHigh) inputHigh.value = config.highThreshold || 90;
  if (lowVal) lowVal.textContent = (config.lowThreshold || 20) + '%';
  if (highVal) highVal.textContent = (config.highThreshold || 90) + '%';
}

// ── Hook into Remote ESP32 WebSocket Bridge ──────────────────────────────
function handleState(data) {
  if (data.type === 'state') {
    currentState.levelPercent = (typeof data.levelPercent === 'number') ? data.levelPercent : (data.water ? data.water.level : 0);
    currentState.distanceCm = (typeof data.distanceCm === 'number') ? data.distanceCm : (data.water ? data.water.distance : 0);
    currentState.pumpOn = (typeof data.pumpOn === 'boolean') ? data.pumpOn : (data.pump ? data.pump.on : false);
    currentState.rssi = data.rssi || 0;
    currentState.online = data.online !== false;

    updateTankUI(currentState);
    updatePumpUI(currentState);
    updateDeviceStatus(currentState.online);
  }
}

// Global hook for esp32-ws.js
window.handleStateMessage = handleState;

// ── Settings Modal ───────────────────────────────────────────────────────
if (settingsBtn && modalOverlay) {
  settingsBtn.addEventListener('click', () => {
    modalOverlay.classList.add('show');
  });
}

if (modalClose && modalOverlay) {
  modalClose.addEventListener('click', () => { modalOverlay.classList.remove('show'); });
  modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) modalOverlay.classList.remove('show'); });
}

if (inputLow && lowVal) {
  inputLow.addEventListener('input', () => { lowVal.textContent = inputLow.value + '%'; });
}

if (inputHigh && highVal) {
  inputHigh.addEventListener('input', () => { highVal.textContent = inputHigh.value + '%'; });
}

if (btnSave) {
  btnSave.addEventListener('click', () => {
    const config = {
      type: 'settings',
      tankDepth: parseFloat(inputDepth.value) || 100,
      sensorOffset: parseFloat(inputOffset.value) || 5,
      lowThreshold: parseFloat(inputLow.value) || 20,
      highThreshold: parseFloat(inputHigh.value) || 90
    };
    if (window.ESP32WS) window.ESP32WS.send(config);
    if (modalOverlay) modalOverlay.classList.remove('show');
  });
}
