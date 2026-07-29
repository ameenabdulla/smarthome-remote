// ── Connection Setup ────────────────────────────────────────────────────
const host = window.location.host;
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${protocol}//${host}`;
const API_URL = `${window.location.protocol}//${host}`;

// ── UI Elements ─────────────────────────────────────────────────────────
const loginOverlay = document.getElementById('login-overlay');
const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginError = document.getElementById('login-error');
const appContainer = document.getElementById('app-container');

const connectionBadge = document.getElementById('connection-badge');
const badgeText = document.getElementById('badge-text');
const waterFill = document.getElementById('water-fill');
const levelPercent = document.getElementById('level-percent');
const distanceCm = document.getElementById('distance-cm');
const tankDepthDisplay = document.getElementById('tank-depth-display');
const rssiVal = document.getElementById('rssi-val');
const pumpToggle = document.getElementById('pump-toggle');
const pumpStateIndicator = document.getElementById('pump-state-indicator');
const pumpStateText = document.getElementById('pump-state-text');
const pumpStatusText = document.getElementById('pump-status-text');
const autoBtn = document.getElementById('auto-btn');
const manualBtn = document.getElementById('manual-btn');
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
const currentPass = document.getElementById('current-pass');
const newPass = document.getElementById('new-pass');
const confirmPass = document.getElementById('confirm-pass');
const passError = document.getElementById('pass-error');
const btnSave = document.getElementById('btn-save-settings');

// ── State variables ─────────────────────────────────────────────────────
let socket = null;
let currentState = { levelPercent: 0, distanceCm: 0, pumpOn: false, mode: 'AUTO', online: false, rssi: 0 };
let currentConfig = { tankDepthCm: 100, sensorOffsetCm: 5, lowThreshold: 20, highThreshold: 90 };

// ── Authentication Check on Load ────────────────────────────────────────
function checkAuth() {
  const authStatus = sessionStorage.getItem('jdt_auth');
  if (authStatus === 'true') {
    loginOverlay.style.display = 'none';
    appContainer.style.display = 'flex';
    connectWebSocket();
  } else {
    loginOverlay.style.display = 'flex';
    appContainer.style.display = 'none';
  }
}

// Handle Login Submission
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.style.display = 'none';

  const username = usernameInput.value;
  const password = passwordInput.value;

  try {
    const res = await fetch(`${API_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (data.success) {
      sessionStorage.setItem('jdt_auth', 'true');
      loginOverlay.style.display = 'none';
      appContainer.style.display = 'flex';
      connectWebSocket();
    } else {
      loginError.style.display = 'block';
    }
  } catch (err) {
    loginError.textContent = 'Server connection failed.';
    loginError.style.display = 'block';
  }
});

// ── WebSocket ───────────────────────────────────────────────────────────
function connectWebSocket() {
  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    console.log('Connected to server');
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === 'state') {
        currentState = data;
        updateTankUI(data);
        updatePumpUI(data);
        updateDeviceStatus(data.online);
        if (data.safety) updateSafetyUI(data.safety);
      }

      if (data.type === 'config') {
        currentConfig = data;
        updateConfigUI(data);
      }
    } catch (err) {
      console.error('WS parse error:', err);
    }
  };

  socket.onclose = () => {
    console.log('Disconnected. Reconnecting in 3s...');
    updateDeviceStatus(false);
    setTimeout(connectWebSocket, 3000);
  };

  socket.onerror = () => {};
}

// ── UI Updates ──────────────────────────────────────────────────────────
function updateTankUI(state) {
  // Water fill height
  waterFill.style.height = state.levelPercent + '%';

  // Dynamic colors based on water level
  if (state.levelPercent < 20) {
    waterFill.style.background = 'linear-gradient(180deg, rgba(239,68,68,0.7) 0%, rgba(180,40,40,0.5) 100%)';
  } else if (state.levelPercent < 50) {
    waterFill.style.background = 'linear-gradient(180deg, rgba(245,158,11,0.7) 0%, rgba(180,100,10,0.5) 100%)';
  } else {
    waterFill.style.background = 'linear-gradient(180deg, rgba(14,165,233,0.7) 0%, rgba(14,165,233,0.4) 40%, rgba(3,105,161,0.5) 100%)';
  }

  // Value readouts
  levelPercent.innerHTML = state.levelPercent.toFixed(1) + '<small>%</small>';
  distanceCm.innerHTML = state.distanceCm.toFixed(1) + ' <small>cm</small>';
  rssiVal.innerHTML = state.rssi + ' <small>dBm</small>';
  calibrateDistance.textContent = state.distanceCm.toFixed(1) + ' cm';
}

function updatePumpUI(state) {
  pumpToggle.checked = state.pumpOn;
  pumpStateText.textContent = state.pumpOn ? 'ON' : 'OFF';
  pumpStateIndicator.className = 'pump-state-badge ' + (state.pumpOn ? 'on' : 'off');

  if (state.mode === 'AUTO') {
    autoBtn.classList.add('active');
    manualBtn.classList.remove('active');
    pumpToggle.disabled = true;
    pumpStatusText.textContent = 'Mode: AUTO';
  } else {
    autoBtn.classList.remove('active');
    manualBtn.classList.add('active');
    pumpToggle.disabled = false;
    pumpStatusText.textContent = 'Mode: MANUAL';
  }
}

function updateDeviceStatus(online) {
  if (online) {
    connectionBadge.className = 'badge online';
    badgeText.textContent = 'ESP32 ONLINE';
  } else {
    connectionBadge.className = 'badge offline';
    badgeText.textContent = 'ESP32 OFFLINE';
  }
}

function updateConfigUI(config) {
  tankDepthDisplay.innerHTML = config.tankDepthCm + ' <small>cm</small>';
  inputDepth.value = config.tankDepthCm;
  inputOffset.value = config.sensorOffsetCm;
  inputLow.value = config.lowThreshold;
  inputHigh.value = config.highThreshold;
  lowVal.textContent = config.lowThreshold + '%';
  highVal.textContent = config.highThreshold + '%';
}

// ── Manual controls ─────────────────────────────────────────────────────
autoBtn.addEventListener('click', () => {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: 'control', mode: 'AUTO' }));
  currentState.mode = 'AUTO';
  updatePumpUI(currentState);
});

manualBtn.addEventListener('click', () => {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: 'control', mode: 'MANUAL' }));
  currentState.mode = 'MANUAL';
  updatePumpUI(currentState);
});

pumpToggle.addEventListener('change', () => {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: 'control', pumpOn: pumpToggle.checked }));
  currentState.pumpOn = pumpToggle.checked;
  updatePumpUI(currentState);
});

// ── Settings modal ──────────────────────────────────────────────────────
settingsBtn.addEventListener('click', () => {
  currentPass.value = '';
  newPass.value = '';
  confirmPass.value = '';
  passError.style.display = 'none';
  modalOverlay.classList.add('show');
});

modalClose.addEventListener('click', () => { modalOverlay.classList.remove('show'); });
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) modalOverlay.classList.remove('show'); });

inputLow.addEventListener('input', () => { lowVal.textContent = inputLow.value + '%'; });
inputHigh.addEventListener('input', () => { highVal.textContent = inputHigh.value + '%'; });



// Save configurations & settings
btnSave.addEventListener('click', async () => {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  passError.style.display = 'none';

  // 1. Handle Password Change (Optional)
  if (newPass.value !== '') {
    if (newPass.value !== confirmPass.value) {
      passError.textContent = 'Passwords do not match.';
      passError.style.display = 'block';
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: currentPass.value,
          newPassword: newPass.value
        })
      });
      const data = await res.json();
      if (!data.success) {
        passError.textContent = data.error || 'Password update failed.';
        passError.style.display = 'block';
        return;
      }
    } catch (err) {
      passError.textContent = 'Connection error updating password.';
      passError.style.display = 'block';
      return;
    }
  }

  // 2. Handle configuration updates over WS
  const newConfig = {
    type: 'config',
    tankDepthCm: parseFloat(inputDepth.value),
    sensorOffsetCm: parseFloat(inputOffset.value),
    lowThreshold: parseFloat(inputLow.value),
    highThreshold: parseFloat(inputHigh.value)
  };

  socket.send(JSON.stringify(newConfig));
  currentConfig = { ...currentConfig, ...newConfig };
  updateConfigUI(currentConfig);

  modalOverlay.classList.remove('show');

  // Button feedback animation
  btnSave.textContent = '✓ Saved Successfully!';
  setTimeout(() => {
    btnSave.innerHTML = '<i data-lucide="save"></i> Save Settings & Password';
    lucide.createIcons();
  }, 1500);
});

// ── Safety & Hazard Monitors UI Update ─────────────────────────
function updateSafetyUI(safety) {
  if (!safety) return;
  const gasBadge = document.getElementById('gas-status-badge');
  const flameBadge = document.getElementById('flame-status-badge');
  const safetyStatusText = document.getElementById('safety-status-text');
  const gasCard = document.getElementById('gas-card');
  const flameCard = document.getElementById('flame-card');

  const isGas = (safety.gas === 1 || safety.gas === true);
  const isFlame = (safety.flame === 1 || safety.flame === true);

  if (gasBadge && gasCard) {
    if (isGas) {
      gasBadge.textContent = 'DANGER! LEAK';
      gasBadge.style.color = '#ef4444';
      gasCard.style.borderColor = '#ef4444';
      gasCard.style.background = 'rgba(239, 68, 68, 0.15)';
    } else {
      gasBadge.textContent = 'SAFE';
      gasBadge.style.color = '#10b981';
      gasCard.style.borderColor = 'rgba(255,255,255,0.08)';
      gasCard.style.background = 'rgba(255,255,255,0.02)';
    }
  }

  if (flameBadge && flameCard) {
    if (isFlame) {
      flameBadge.textContent = 'FIRE ALERT!';
      flameBadge.style.color = '#ef4444';
      flameCard.style.borderColor = '#ef4444';
      flameCard.style.background = 'rgba(239, 68, 68, 0.15)';
    } else {
      flameBadge.textContent = 'SAFE';
      flameBadge.style.color = '#10b981';
      flameCard.style.borderColor = 'rgba(255,255,255,0.08)';
      flameCard.style.background = 'rgba(255,255,255,0.02)';
    }
  }

  if (safetyStatusText) {
    if (isFlame && isGas) {
      safetyStatusText.textContent = 'EMERGENCY: FIRE & GAS LEAK DETECTED!';
      safetyStatusText.style.color = '#ef4444';
    } else if (isFlame) {
      safetyStatusText.textContent = 'EMERGENCY: FIRE/FLAME DETECTED!';
      safetyStatusText.style.color = '#ef4444';
    } else if (isGas) {
      safetyStatusText.textContent = 'EMERGENCY: GAS LEAK DETECTED!';
      safetyStatusText.style.color = '#ef4444';
    } else {
      safetyStatusText.textContent = 'Status: ALL SYSTEMS NORMAL';
      safetyStatusText.style.color = 'rgba(255,255,255,0.5)';
    }
  }
}

// Run auth check on initialization
checkAuth();
