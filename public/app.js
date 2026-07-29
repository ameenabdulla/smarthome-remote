'use strict';

const ActivityTimeline = (function() {
    let events = [];
    const maxEvents = 50;
    const timelineEl = document.getElementById('activity-timeline');

    function formatTime(date) {
        return date.toLocaleTimeString('en-US', { hour12: false });
    }

    function addEvent(text, type) {
        const time = new Date();
        events.unshift({ time, text, type });
        if (events.length > maxEvents) events.pop();
        
        if (timelineEl) {
            const item = document.createElement('div');
            item.className = 'timeline-item';
            item.innerHTML = `
                <div class="timeline-dot ${type}"></div>
                <span class="timeline-time">${formatTime(time)}</span>
                <span class="timeline-text">${text}</span>
            `;
            timelineEl.insertBefore(item, timelineEl.firstChild);
            while (timelineEl.children.length > maxEvents) {
                timelineEl.removeChild(timelineEl.lastChild);
            }
        }
    }

    function render() {
        if (!timelineEl) return;
        timelineEl.innerHTML = '';
        events.forEach(ev => {
            const item = document.createElement('div');
            item.className = 'timeline-item';
            item.innerHTML = `
                <div class="timeline-dot ${ev.type}"></div>
                <span class="timeline-time">${formatTime(ev.time)}</span>
                <span class="timeline-text">${ev.text}</span>
            `;
            timelineEl.appendChild(item);
        });
    }

    function init() {
        const now = Date.now();
        const demoEvents = [
            { text: 'System initialized (Demo Mode)', type: 'sensor', offset: 30 * 60000 },
            { text: 'Water pump turned ON (Auto)', type: 'pump', offset: 25 * 60000 },
            { text: 'Water level reached 85%', type: 'water', offset: 20 * 60000 },
            { text: 'Water pump turned OFF (Auto)', type: 'pump', offset: 19 * 60000 },
            { text: 'Gate opened', type: 'gate', offset: 15 * 60000 },
            { text: 'Living Room light turned ON', type: 'light', offset: 10 * 60000 },
            { text: 'Gate closed', type: 'gate', offset: 8 * 60000 },
            { text: 'IR Sensor: No Motion', type: 'sensor', offset: 5 * 60000 }
        ];

        demoEvents.forEach(ev => {
            events.push({
                time: new Date(now - ev.offset),
                text: ev.text,
                type: ev.type
            });
        });
        
        events.sort((a, b) => b.time - a.time);
        render();
    }

    return { init, addEvent };
})();

const Toast = (function() {
    const toastEl = document.getElementById('toast');
    let timeout;
    function showToast(message, duration = 3000) {
        if (!toastEl) return;
        toastEl.textContent = message;
        toastEl.classList.add('show');
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            toastEl.classList.remove('show');
        }, duration);
    }
    return { showToast };
})();

const Settings = (function() {
    let state = {
        dashName: 'Smart Home',
        tankDepth: 150,
        sensorOffset: 5,
        lowThreshold: 20,
        highThreshold: 90,
        soundMuted: false
    };

    function updateBrandUI(name) {
        if (!name) return;
        state.dashName = name;
        const navTitle = document.getElementById('nav-brand-title');
        const bootTitle = document.getElementById('boot-title');
        const footerTitle = document.getElementById('footer-brand-title');
        if (navTitle) navTitle.textContent = name.toUpperCase();
        if (bootTitle) bootTitle.textContent = name.toUpperCase();
        if (footerTitle) footerTitle.textContent = `${name.toUpperCase()} v3.0`;
        document.title = `${name} — Control Center`;
    }

    function load() {
        const saved = localStorage.getItem('nexus-settings');
        if (saved) {
            try {
                Object.assign(state, JSON.parse(saved));
            } catch (e) {}
        }
        const nameEl = document.getElementById('setting-dash-name');
        const depthEl = document.getElementById('setting-tank-depth');
        const offsetEl = document.getElementById('setting-sensor-offset');
        const lowEl = document.getElementById('setting-low-threshold');
        const highEl = document.getElementById('setting-high-threshold');
        const soundEl = document.getElementById('setting-sound-toggle');
        const soundText = document.getElementById('sound-status-text');

        if (nameEl) nameEl.value = state.dashName || 'Smart Home';
        if (depthEl) depthEl.value = state.tankDepth;
        if (offsetEl) offsetEl.value = state.sensorOffset;
        if (lowEl) lowEl.value = state.lowThreshold;
        if (highEl) highEl.value = state.highThreshold;
        if (soundEl) {
            soundEl.checked = !state.soundMuted;
            if (soundText) {
                soundText.textContent = state.soundMuted ? 'MUTED' : 'ENABLED';
                soundText.style.color = state.soundMuted ? 'var(--danger)' : 'var(--success)';
            }
        }
        updateBrandUI(state.dashName);
    }

    function save() {
        const nameEl = document.getElementById('setting-dash-name');
        const depth = parseInt(document.getElementById('setting-tank-depth').value);
        const offset = parseInt(document.getElementById('setting-sensor-offset').value);
        const low = parseInt(document.getElementById('setting-low-threshold').value);
        const high = parseInt(document.getElementById('setting-high-threshold').value);
        const soundEl = document.getElementById('setting-sound-toggle');

        if (isNaN(depth) || isNaN(offset) || isNaN(low) || isNaN(high)) {
            Toast.showToast('Invalid settings: values must be valid numbers');
            return;
        }
        if (depth <= 0 || depth > 1000) {
            Toast.showToast('Invalid depth: must be between 1 and 1000 cm');
            return;
        }
        if (low < 0 || high > 100 || low >= high) {
            Toast.showToast('Invalid thresholds: Low must be less than High (0-100%)');
            return;
        }

        if (nameEl && nameEl.value.trim()) {
            state.dashName = nameEl.value.trim();
            updateBrandUI(state.dashName);
        }
        state.tankDepth = depth;
        state.sensorOffset = offset;
        state.lowThreshold = low;
        state.highThreshold = high;
        if (soundEl) state.soundMuted = !soundEl.checked;

        localStorage.setItem('nexus-settings', JSON.stringify(state));
        Toast.showToast('Settings saved successfully');
        
        const soundText = document.getElementById('sound-status-text');
        if (soundText) {
            soundText.textContent = state.soundMuted ? 'MUTED' : 'ENABLED';
            soundText.style.color = state.soundMuted ? 'var(--danger)' : 'var(--success)';
        }
        
        if (window.WaterTank) {
            window.WaterTank.updateFromSettings();
        }

        if (window.ESP32WS) {
            window.ESP32WS.send({
                type: 'settings',
                dashName: state.dashName,
                tankDepth: state.tankDepth,
                sensorOffset: state.sensorOffset,
                lowThreshold: state.lowThreshold,
                highThreshold: state.highThreshold
            });
        }
    }

    function applyServerSettings(srv) {
        if (!srv) return;
        if (srv.dashName) {
            state.dashName = srv.dashName;
            const nameEl = document.getElementById('setting-dash-name');
            if (nameEl) nameEl.value = srv.dashName;
            updateBrandUI(srv.dashName);
        }
        if (typeof srv.tankDepth === 'number') {
            state.tankDepth = srv.tankDepth;
            const depthEl = document.getElementById('setting-tank-depth');
            if (depthEl) depthEl.value = srv.tankDepth;
        }
        if (typeof srv.sensorOffset === 'number') {
            state.sensorOffset = srv.sensorOffset;
            const offsetEl = document.getElementById('setting-sensor-offset');
            if (offsetEl) offsetEl.value = srv.sensorOffset;
        }
        if (typeof srv.lowThreshold === 'number') {
            state.lowThreshold = srv.lowThreshold;
            const lowEl = document.getElementById('setting-low-threshold');
            if (lowEl) lowEl.value = srv.lowThreshold;
        }
        if (typeof srv.highThreshold === 'number') {
            state.highThreshold = srv.highThreshold;
            const highEl = document.getElementById('setting-high-threshold');
            if (highEl) highEl.value = srv.highThreshold;
        }
        if (window.WaterTank) window.WaterTank.updateFromSettings();
    }

    function init() {
        load();
        const saveBtn = document.getElementById('settings-save-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', save);
        }

        const soundEl = document.getElementById('setting-sound-toggle');
        if (soundEl) {
            soundEl.addEventListener('change', () => {
                state.soundMuted = !soundEl.checked;
                const soundText = document.getElementById('sound-status-text');
                if (soundText) {
                    soundText.textContent = state.soundMuted ? 'MUTED' : 'ENABLED';
                    soundText.style.color = state.soundMuted ? 'var(--danger)' : 'var(--success)';
                }
            });
        }
    }

    return { init, getState: () => state, applyServerSettings };
})();

const Navigation = (function() {
    function init() {
        const clockEl = document.getElementById('nav-clock');
        if (clockEl) {
            setInterval(() => {
                clockEl.textContent = new Date().toLocaleTimeString('en-US', { hour12: false });
            }, 1000);
        }

        const navLinks = document.querySelectorAll('.nav-link');
        const sections = document.querySelectorAll('.dash-section');
        
        navLinks.forEach(link => {
            link.addEventListener('click', e => {
                e.preventDefault();
                const targetId = link.getAttribute('href').substring(1);
                const targetSec = document.getElementById(targetId);
                if (targetSec) {
                    const offset = 80;
                    const top = targetSec.getBoundingClientRect().top + window.pageYOffset - offset;
                    window.scrollTo({ top, behavior: 'smooth' });
                }
                const mobileMenu = document.getElementById('nav-mobile-menu');
                const hamburger = document.getElementById('nav-hamburger');
                if (mobileMenu && hamburger) {
                    mobileMenu.classList.remove('open');
                    hamburger.classList.remove('open');
                }
            });
        });

        const navStatus = document.querySelector('.nav-status');
        const statusDot = document.getElementById('system-status-dot');
        const statusText = document.getElementById('system-status-text');
        
        let isOnline = true;
        if (navStatus && statusDot && statusText) {
            navStatus.style.cursor = 'pointer';
            navStatus.setAttribute('title', 'Click to toggle ESP32 status mode');
            navStatus.addEventListener('click', () => {
                isOnline = !isOnline;
                if (isOnline) {
                    statusDot.className = 'status-dot online';
                    statusText.textContent = 'ONLINE';
                    Toast.showToast('ESP32 System Status: ONLINE (Demo Mode)');
                    ActivityTimeline.addEvent('ESP32 Status changed: ONLINE', 'sensor');
                } else {
                    statusDot.className = 'status-dot offline';
                    statusText.textContent = 'ESP32 OFFLINE';
                    Toast.showToast('ESP32 Disconnected — Hardware offline');
                    ActivityTimeline.addEvent('ESP32 Status changed: DISCONNECTED', 'danger-dot');
                }
            });
        }

        const hamburger = document.getElementById('nav-hamburger');
        const mobileMenu = document.getElementById('nav-mobile-menu');
        const navLinksContainer = document.getElementById('nav-links');
        
        if (hamburger && mobileMenu && navLinksContainer) {
            hamburger.addEventListener('click', () => {
                hamburger.classList.toggle('open');
                mobileMenu.classList.toggle('open');
                if (mobileMenu.classList.contains('open')) {
                    mobileMenu.innerHTML = navLinksContainer.innerHTML;
                    mobileMenu.querySelectorAll('.nav-link').forEach(link => {
                        link.addEventListener('click', e => {
                            e.preventDefault();
                            const targetId = link.getAttribute('href').substring(1);
                            const targetSec = document.getElementById(targetId);
                            if (targetSec) {
                                const offset = 80;
                                const top = targetSec.getBoundingClientRect().top + window.pageYOffset - offset;
                                window.scrollTo({ top, behavior: 'smooth' });
                            }
                            hamburger.classList.remove('open');
                            mobileMenu.classList.remove('open');
                        });
                    });
                }
            });
        }

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const id = entry.target.getAttribute('id');
                    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
                    document.querySelectorAll(`.nav-link[data-section="${id}"]`).forEach(l => l.classList.add('active'));
                }
            });
        }, { threshold: 0.2, rootMargin: '-80px 0px -20% 0px' });

        sections.forEach(sec => observer.observe(sec));
    }
    return { init };
})();

const ScrollAnimations = (function() {
    function init() {
        const observer = new IntersectionObserver((entries, obs) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('revealed');
                    obs.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1, rootMargin: '-50px' });

        const reveals = document.querySelectorAll('.scroll-reveal');
        
        const groups = {};
        reveals.forEach(el => {
            const parent = el.parentElement;
            if (!parent) return;
            if (!groups[parent]) groups[parent] = [];
            groups[parent].push(el);
        });
        
        Object.values(groups).forEach(group => {
            if (group.length > 1) {
                group.forEach((el, index) => {
                    el.style.transitionDelay = `${index * 0.1}s`;
                });
            }
        });

        reveals.forEach(el => observer.observe(el));
    }
    return { init };
})();

const LightControl = (function() {
    const lights = [
        { id: 1, name: 'Living Room', watts: 14, on: false },
        { id: 2, name: 'Kitchen', watts: 18, on: false },
        { id: 3, name: 'Bedroom', watts: 10, on: false },
        { id: 4, name: 'Bathroom', watts: 8, on: false },
        { id: 5, name: 'Garden', watts: 24, on: false }
    ];

    function loadSavedNames() {
        try {
            const saved = localStorage.getItem('nexus_light_names');
            if (saved) {
                const arr = JSON.parse(saved);
                if (Array.isArray(arr)) {
                    arr.forEach((n, idx) => {
                        if (lights[idx] && n) lights[idx].name = n;
                    });
                }
            }
        } catch (e) {}
    }

    function saveNames() {
        try {
            const arr = lights.map(l => l.name);
            localStorage.setItem('nexus_light_names', JSON.stringify(arr));
        } catch (e) {}
    }

    function updateNavIndicator() {
        const onCount = lights.filter(l => l.on).length;
        const ind = document.getElementById('nav-light-indicator');
        if (ind) {
            ind.textContent = `${onCount}/${lights.length}`;
            if (onCount > 0) ind.classList.add('active');
            else ind.classList.remove('active');
        }
    }

    function init() {
        loadSavedNames();
        const grid = document.getElementById('lights-grid');
        if (!grid) return;
        grid.innerHTML = '';
        lights.forEach((light, i) => {
            const card = document.createElement('div');
            card.className = 'light-card glass-card scroll-reveal';
            card.setAttribute('data-light-id', light.id);
            card.style.transitionDelay = `${i * 0.08}s`;
            
            card.innerHTML = `
                <div class="light-card-header">
                    <span class="light-conn-badge">● RELAY ${light.id}</span>
                    <span class="light-power-val">${light.on ? light.watts + ' W' : '0 W'}</span>
                </div>
                <div class="light-icon">
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z"/>
                    </svg>
                </div>
                <div class="light-info">
                    <div class="light-name-row">
                        <span class="light-name">${light.name}</span>
                        <button class="edit-light-name-btn" title="Rename Switch ✏️">✏️</button>
                    </div>
                    <span class="light-status">${light.on ? 'ON' : 'OFF'}</span>
                </div>
                <label class="toggle-wrap">
                    <input type="checkbox" class="toggle-input" ${light.on ? 'checked' : ''}>
                    <span class="toggle-slider"></span>
                </label>
            `;

            const input = card.querySelector('.toggle-input');
            const powerVal = card.querySelector('.light-power-val');
            const statusSpan = card.querySelector('.light-status');
            const editBtn = card.querySelector('.edit-light-name-btn');
            const nameSpan = card.querySelector('.light-name');

            if (editBtn) {
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const newName = prompt(`Enter new name for Switch #${light.id}:`, light.name);
                    if (newName !== null && newName.trim().length > 0) {
                        light.name = newName.trim();
                        nameSpan.textContent = light.name;
                        saveNames();
                        ActivityTimeline.addEvent(`Switch #${light.id} renamed to "${light.name}"`, 'light');
                    }
                });
            }

            function applyState(isOn, sendWs = true) {
                light.on = isOn;
                input.checked = isOn;
                if (isOn) {
                    card.classList.add('on');
                    statusSpan.textContent = 'ON';
                    if (powerVal) powerVal.textContent = `${light.watts} W`;
                } else {
                    card.classList.remove('on');
                    statusSpan.textContent = 'OFF';
                    if (powerVal) powerVal.textContent = '0 W';
                }
                updateNavIndicator();
                if (sendWs && window.ESP32WS) {
                    window.ESP32WS.send({ type: 'light', action: 'light', id: light.id - 1, index: light.id - 1, state: isOn, on: isOn });
                }
            }

            input.addEventListener('change', (e) => {
                applyState(e.target.checked);
                ActivityTimeline.addEvent(`${light.name} (Relay ${light.id}) turned ${light.on ? 'ON' : 'OFF'}`, 'light');
            });

            card.addEventListener('click', (e) => {
                if (e.target.closest('.toggle-wrap') || e.target.closest('.edit-light-name-btn')) return;
                applyState(!light.on);
                ActivityTimeline.addEvent(`${light.name} (Relay ${light.id}) turned ${light.on ? 'ON' : 'OFF'}`, 'light');
            });

            grid.appendChild(card);
            setTimeout(() => card.classList.add('revealed'), 50 + i * 80);
        });
        updateNavIndicator();
    }

    function applyServerState(serverLights) {
        if (!Array.isArray(serverLights)) return;
        serverLights.forEach((isOn, idx) => {
            if (lights[idx] && lights[idx].on !== isOn) {
                lights[idx].on = isOn;
                const card = document.querySelector(`.light-card[data-light-id="${lights[idx].id}"]`);
                if (card) {
                    const input = card.querySelector('.toggle-input');
                    const powerVal = card.querySelector('.light-power-val');
                    const statusSpan = card.querySelector('.light-status');
                    if (input) input.checked = isOn;
                    if (isOn) {
                        card.classList.add('on');
                        if (statusSpan) statusSpan.textContent = 'ON';
                        if (powerVal) powerVal.textContent = `${lights[idx].watts} W`;
                    } else {
                        card.classList.remove('on');
                        if (statusSpan) statusSpan.textContent = 'OFF';
                        if (powerVal) powerVal.textContent = '0 W';
                    }
                }
            }
        });
        updateNavIndicator();
    }

    return { init, applyServerState };
})();

const GateControl = (function() {
    let state = {
        position: 0,
        targetPosition: 0,
        isHolding: false,
        holdDirection: 0,
        rafId: null,
        lastTime: 0,
        status: 'CLOSED'
    };

    function updateVisuals() {
        const leftDoor = document.getElementById('gate-door-left');
        const rightDoor = document.getElementById('gate-door-right');
        const posText = document.getElementById('gate-position-text');
        const statusText = document.getElementById('gate-status-text');
        const slider = document.getElementById('gate-slider');
        const navInd = document.getElementById('nav-gate-indicator');

        if (leftDoor) leftDoor.style.width = `${50 - (state.position / 2)}%`;
        if (rightDoor) rightDoor.style.width = `${50 - (state.position / 2)}%`;
        
        if (posText) posText.textContent = `${Math.round(state.position)}%`;
        if (slider && document.activeElement !== slider) slider.value = Math.round(state.position);

        let isIrBlocked = window.SafetyMonitor && window.SafetyMonitor.isIrBlocked();
        let newStatus = '';
        if (isIrBlocked && state.position === 0) newStatus = 'IR BLOCKED — GATE LOCKED';
        else if (state.position === 0) newStatus = 'CLOSED';
        else if (state.position === 100) newStatus = 'OPEN';
        else if (state.targetPosition > state.position || (state.isHolding && state.holdDirection > 0)) newStatus = 'OPENING';
        else if (state.targetPosition < state.position || (state.isHolding && state.holdDirection < 0)) newStatus = 'CLOSING';
        else newStatus = 'PARTIAL';

        if (state.status !== newStatus) {
            state.status = newStatus;
            if (statusText) {
                statusText.textContent = state.status;
                statusText.className = 'gate-stat-value';
                if (state.status.indexOf('IR BLOCKED') >= 0) statusText.classList.add('status-closing');
                else if (state.status === 'OPEN') statusText.classList.add('status-open');
                else if (state.status === 'CLOSED') statusText.classList.add('status-closed');
                else if (state.status === 'OPENING') statusText.classList.add('status-opening');
                else if (state.status === 'CLOSING') statusText.classList.add('status-closing');
            }
            if (navInd) {
                navInd.textContent = (state.status.indexOf('IR BLOCKED') >= 0) ? 'BLOCKED' : state.status;
                if (state.status === 'OPEN') navInd.className = 'nav-badge status-open';
                else if (state.status.indexOf('IR BLOCKED') >= 0) navInd.className = 'nav-badge danger';
                else if (state.status === 'CLOSED') navInd.className = 'nav-badge';
                else navInd.className = 'nav-badge active';
            }
        }
        
        const pillars = document.querySelectorAll('.pillar-light');
        if (state.status === 'OPENING' || state.status === 'CLOSING') {
            pillars.forEach(p => p.style.animationDuration = '0.5s');
        } else {
            pillars.forEach(p => p.style.animationDuration = '2s');
        }
    }

    function loop(timestamp) {
        if (!state.lastTime) state.lastTime = timestamp;
        const dt = timestamp - state.lastTime;
        state.lastTime = timestamp;
        
        let oldPos = state.position;
        let changed = false;

        if (state.isHolding && state.holdDirection !== 0) {
            const move = state.holdDirection * 60 * (dt / 1000);
            state.position = Math.max(0, Math.min(100, state.position + move));
            state.targetPosition = state.position;
        } else if (state.position !== state.targetPosition) {
            const diff = state.targetPosition - state.position;
            if (Math.abs(diff) < 0.5) {
                state.position = state.targetPosition;
            } else {
                const move = Math.sign(diff) * Math.min(Math.abs(diff), 60 * (dt / 1000));
                state.position += move;
            }
        }

        if (state.position !== oldPos) {
            changed = true;
            if (state.position === 100 && oldPos < 100) ActivityTimeline.addEvent('Gate fully opened', 'gate');
            if (state.position === 0 && oldPos > 0) ActivityTimeline.addEvent('Gate fully closed', 'gate');
        }

        if (changed) {
            updateVisuals();
        }
        
        state.rafId = requestAnimationFrame(loop);
    }

    function setTarget(target, sendWs = true) {
        if (window.SafetyMonitor) window.SafetyMonitor.authorizeWebControl();
        state.targetPosition = Math.max(0, Math.min(100, target));
        if (sendWs && window.ESP32WS) {
            if (target === 100) window.ESP32WS.send({ type: 'gate', cmd: 'open', pos: 100 });
            else if (target === 0) window.ESP32WS.send({ type: 'gate', cmd: 'close', pos: 0 });
            else window.ESP32WS.send({ type: 'gate', pos: target });
        }
    }

    function setHolding(direction) {
        if (window.SafetyMonitor) window.SafetyMonitor.authorizeWebControl();
        if (direction !== 0) {
            if (direction > 0 && state.targetPosition < state.position) state.targetPosition = state.position;
            if (direction < 0 && state.targetPosition > state.position) state.targetPosition = state.position;
        }
        state.isHolding = direction !== 0;
        state.holdDirection = direction;
        
        const leftDoor = document.getElementById('gate-door-left');
        const rightDoor = document.getElementById('gate-door-right');
        if (state.isHolding) {
            if (leftDoor) leftDoor.style.transition = 'none';
            if (rightDoor) rightDoor.style.transition = 'none';
        } else {
            if (leftDoor) leftDoor.style.transition = '';
            if (rightDoor) rightDoor.style.transition = '';
        }

        if (window.ESP32WS) {
            if (direction > 0) window.ESP32WS.send({ type: 'gate', cmd: 'hold_open' });
            else if (direction < 0) window.ESP32WS.send({ type: 'gate', cmd: 'hold_close' });
            else window.ESP32WS.send({ type: 'gate', cmd: 'hold_stop' });
        }
    }

    function applyServerState(pos, status) {
        if (typeof pos === 'number' && !state.isHolding) {
            state.position = pos;
            state.targetPosition = pos;
            updateVisuals();
        }
    }

    function init() {
        const slider = document.getElementById('gate-slider');
        const openBtn = document.getElementById('gate-open-btn');
        const closeBtn = document.getElementById('gate-close-btn');
        const holdOpen = document.getElementById('gate-hold-open');
        const holdClose = document.getElementById('gate-hold-close');

        if (slider) {
            slider.addEventListener('input', (e) => {
                if (window.SafetyMonitor) window.SafetyMonitor.authorizeWebControl();
                const val = parseInt(e.target.value);
                let oldPos = state.position;
                state.position = val;
                state.targetPosition = val;
                updateVisuals();
                if (val === 100 && oldPos < 100) ActivityTimeline.addEvent('Gate fully opened', 'gate');
                if (val === 0 && oldPos > 0) ActivityTimeline.addEvent('Gate fully closed', 'gate');
                if (window.ESP32WS) window.ESP32WS.send({ type: 'gate', pos: val });
            });
        }
        if (openBtn) openBtn.addEventListener('click', () => {
            if (window.SafetyMonitor) window.SafetyMonitor.authorizeWebControl();
            setTarget(100);
        });
        if (closeBtn) closeBtn.addEventListener('click', () => {
            if (window.SafetyMonitor) window.SafetyMonitor.authorizeWebControl();
            setTarget(0);
        });

        const startHoldOpen = (e) => {
            e.preventDefault();
            if (window.SafetyMonitor) window.SafetyMonitor.authorizeWebControl();
            setHolding(1);
        };
        const startHoldClose = (e) => {
            e.preventDefault();
            if (window.SafetyMonitor) window.SafetyMonitor.authorizeWebControl();
            setHolding(-1);
        };
        const stopHold = (e) => { setHolding(0); };

        if (holdOpen) {
            holdOpen.addEventListener('mousedown', startHoldOpen);
            holdOpen.addEventListener('touchstart', startHoldOpen, {passive: false});
            holdOpen.addEventListener('mouseup', stopHold);
            holdOpen.addEventListener('mouseleave', stopHold);
            holdOpen.addEventListener('touchend', stopHold, {passive: false});
        }
        if (holdClose) {
            holdClose.addEventListener('mousedown', startHoldClose);
            holdClose.addEventListener('touchstart', startHoldClose, {passive: false});
            holdClose.addEventListener('mouseup', stopHold);
            holdClose.addEventListener('mouseleave', stopHold);
            holdClose.addEventListener('touchend', stopHold, {passive: false});
        }
        
        updateVisuals();
        state.rafId = requestAnimationFrame(loop);
    }
    return {
        init,
        forceOpen: () => setTarget(100),
        applyServerState
    };
})();

window.GateControl = GateControl;

window.PumpControl = (function() {
    let state = { mode: 'auto', isOn: false };
    
    function setOn(isOn, source = 'manual') {
        if (state.isOn === isOn) return;
        state.isOn = isOn;
        
        const powerBtn = document.getElementById('pump-power-btn');
        const statusText = document.getElementById('pump-status-text');
        const dot = document.getElementById('pump-dot');
        const miniStatus = document.getElementById('pump-mini-status');
        const pill = document.getElementById('pump-status-pill');

        if (isOn) {
            if (powerBtn) {
                powerBtn.classList.remove('off');
                powerBtn.classList.add('on');
                powerBtn.querySelector('span').textContent = 'TURN OFF';
            }
            if (statusText) statusText.textContent = 'RUNNING';
            if (dot) dot.classList.add('on');
            if (miniStatus) miniStatus.textContent = 'RUNNING';
            if (pill) pill.style.backgroundColor = 'rgba(0, 230, 118, 0.2)';
            ActivityTimeline.addEvent(`Pump turned ON (${source})`, 'pump');
        } else {
            if (powerBtn) {
                powerBtn.classList.remove('on');
                powerBtn.classList.add('off');
                powerBtn.querySelector('span').textContent = 'TURN ON';
            }
            if (statusText) statusText.textContent = 'OFF';
            if (dot) dot.classList.remove('on');
            if (miniStatus) miniStatus.textContent = 'OFF';
            if (pill) pill.style.backgroundColor = '';
            ActivityTimeline.addEvent(`Pump turned OFF (${source})`, 'pump');
        }
    }

    // Hysteresis-based auto control:
    // Pump ON when level drops to or below lowThreshold
    // Pump OFF only when level reaches or exceeds highThreshold
    // This prevents rapid cycling near threshold boundaries
    function checkAuto(level, low, high) {
        if (state.mode !== 'auto') return;
        if (!state.isOn && level <= low) {
            setOn(true, 'auto — level ≤ ' + low + '%');
            if (window.AlertSystem) window.AlertSystem.triggerWaterAlert('low');
        } else if (state.isOn && level >= high) {
            setOn(false, 'auto — level ≥ ' + high + '%');
            if (window.AlertSystem) window.AlertSystem.triggerWaterAlert('full');
        }
        // Between low and high: maintain current state (hysteresis)
    }

    function init() {
        const autoBtn = document.getElementById('pump-auto-btn');
        const manualBtn = document.getElementById('pump-manual-btn');
        const manualControls = document.getElementById('pump-manual-controls');
        const powerBtn = document.getElementById('pump-power-btn');

        if (autoBtn && manualBtn && manualControls) {
            autoBtn.addEventListener('click', () => {
                state.mode = 'auto';
                autoBtn.classList.add('active');
                manualBtn.classList.remove('active');
                manualControls.style.display = 'none';
                const modeLabel = document.getElementById('pump-mode-label');
                if (modeLabel) modeLabel.textContent = 'Mode: AUTO (Low -> ON, High -> OFF)';
                const hint = document.querySelector('.wm-pump-hint');
                if (hint) hint.style.display = '';
                ActivityTimeline.addEvent('Pump set to AUTO mode (Low -> ON, High -> OFF)', 'pump');
                if (window.ESP32WS) window.ESP32WS.send({ type: 'pump_mode', action: 'pump_mode', mode: 'AUTO', state: 'AUTO' });
            });

            manualBtn.addEventListener('click', () => {
                state.mode = 'manual';
                manualBtn.classList.add('active');
                autoBtn.classList.remove('active');
                manualControls.style.display = 'flex';
                const modeLabel = document.getElementById('pump-mode-label');
                if (modeLabel) modeLabel.textContent = 'Mode: MANUAL (User Switch Control)';
                const hint = document.querySelector('.wm-pump-hint');
                if (hint) hint.style.display = 'none';
                ActivityTimeline.addEvent('Pump set to MANUAL mode', 'pump');
                if (window.ESP32WS) window.ESP32WS.send({ type: 'pump_mode', action: 'pump_mode', mode: 'MANUAL', state: 'MANUAL' });
            });
        }

        if (powerBtn) {
            powerBtn.addEventListener('click', () => {
                const nextOn = !state.isOn;
                state.mode = 'manual';
                if (manualBtn) manualBtn.classList.add('active');
                if (autoBtn) autoBtn.classList.remove('active');
                if (manualControls) manualControls.style.display = 'flex';
                const modeLabel = document.getElementById('pump-mode-label');
                if (modeLabel) modeLabel.textContent = 'Mode: MANUAL';
                setOn(nextOn, 'manual');
                if (window.ESP32WS) window.ESP32WS.send({ type: 'pump', action: 'pump', mode: 'MANUAL', on: nextOn, state: nextOn });
            });
        }
    }

    function applyServerState(isOn, mode) {
        if (!mode) return;
        const normMode = String(mode).toLowerCase();
        state.mode = normMode;
        const autoBtn = document.getElementById('pump-auto-btn');
        const manualBtn = document.getElementById('pump-manual-btn');
        const manualControls = document.getElementById('pump-manual-controls');
        const modeLabel = document.getElementById('pump-mode-label');
        const hint = document.querySelector('.wm-pump-hint');

        if (normMode === 'auto') {
            if (autoBtn) autoBtn.classList.add('active');
            if (manualBtn) manualBtn.classList.remove('active');
            if (manualControls) manualControls.style.display = 'none';
            if (modeLabel) modeLabel.textContent = 'Mode: AUTO (Low -> ON, High -> OFF)';
            if (hint) hint.style.display = '';
        } else {
            if (manualBtn) manualBtn.classList.add('active');
            if (autoBtn) autoBtn.classList.remove('active');
            if (manualControls) manualControls.style.display = 'flex';
            if (modeLabel) modeLabel.textContent = 'Mode: MANUAL (User Switch Control)';
            if (hint) hint.style.display = 'none';
        }

        if (typeof isOn === 'boolean') {
            setOn(isOn, 'ESP32 telemetry');
        }
    }

    return { init, checkAuto, isOn: () => state.isOn, applyServerState };
})();

window.WaterGraph = (function() {
    let canvas, ctx;
    const MAX_POINTS = 60;
    let chartData = [];       // { time: Date, value: number }
    let displayData = [];     // smoothly animated current display values
    let animFrame = null;

    function generateDemoData() {
        chartData = [];
        displayData = [];
        const now = Date.now();
        let val = 40;
        for (let i = MAX_POINTS - 1; i >= 0; i--) {
            val += (Math.random() * 3 - 1.2);
            val = Math.max(5, Math.min(95, val));
            chartData.push({ time: new Date(now - i * 5000), value: val });
            displayData.push(val);
        }
    }

    function addPoint(val) {
        chartData.push({ time: new Date(), value: val });
        if (chartData.length > MAX_POINTS) chartData.shift();
        if (displayData.length > MAX_POINTS) displayData.shift();
        displayData.push(displayData.length > 0 ? displayData[displayData.length - 1] : val);
        // actual value will animate in the draw loop
    }

    function draw() {
        if (!canvas || !ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.width / dpr;
        const h = canvas.height / dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const padL = 36, padR = 10, padT = 10, padB = 24;
        const cw = w - padL - padR;
        const ch = h - padT - padB;

        // Smoothly animate display data toward actual data
        for (let i = 0; i < chartData.length && i < displayData.length; i++) {
            const diff = chartData[i].value - displayData[i];
            displayData[i] += diff * 0.15;
        }

        // Y-axis labels and grid
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'right';
        for (let pct = 0; pct <= 100; pct += 25) {
            const y = padT + ch - (pct / 100 * ch);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(padL, y);
            ctx.lineTo(padL + cw, y);
            ctx.stroke();
            ctx.fillStyle = 'rgba(121, 134, 203, 0.6)';
            ctx.fillText(pct + '%', padL - 6, y + 3);
        }

        if (displayData.length < 2) return;
        const dx = cw / (displayData.length - 1);

        // Line path
        ctx.beginPath();
        let pts = [];
        for (let i = 0; i < displayData.length; i++) {
            const x = padL + i * dx;
            const y = padT + ch - (displayData[i] / 100 * ch);
            pts.push({ x, y });
            if (i === 0) ctx.moveTo(x, y);
            else {
                const prev = pts[i - 1];
                const cpx = (prev.x + x) / 2;
                ctx.bezierCurveTo(cpx, prev.y, cpx, y, x, y);
            }
        }

        // Gradient fill under curve
        const grad = ctx.createLinearGradient(0, padT, 0, padT + ch);
        grad.addColorStop(0, 'rgba(0, 229, 255, 0.25)');
        grad.addColorStop(0.7, 'rgba(0, 229, 255, 0.05)');
        grad.addColorStop(1, 'rgba(0, 229, 255, 0)');
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineTo(padL + cw, padT + ch);
        ctx.lineTo(padL, padT + ch);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        // Data point dots (last 5 for emphasis)
        const dotStart = Math.max(0, pts.length - 5);
        for (let i = dotStart; i < pts.length; i++) {
            const alpha = 0.3 + 0.7 * ((i - dotStart) / (pts.length - dotStart));
            ctx.beginPath();
            ctx.arc(pts[i].x, pts[i].y, 3, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(0, 229, 255, ${alpha})`;
            ctx.fill();
        }

        // Glow on last point
        if (pts.length > 0) {
            const last = pts[pts.length - 1];
            ctx.beginPath();
            ctx.arc(last.x, last.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0, 229, 255, 0.8)';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(last.x, last.y, 10, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0, 229, 255, 0.15)';
            ctx.fill();
        }

        // Time labels on x-axis (show every ~10th)
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(121, 134, 203, 0.5)';
        ctx.font = '9px JetBrains Mono, monospace';
        const step = Math.max(1, Math.floor(chartData.length / 6));
        for (let i = 0; i < chartData.length; i += step) {
            const x = padL + i * dx;
            const t = chartData[i].time;
            const label = t.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
            ctx.fillText(label, x, padT + ch + 16);
        }

        animFrame = requestAnimationFrame(draw);
    }

    function resize() {
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const parent = canvas.parentElement;
        canvas.width = parent.clientWidth * dpr;
        canvas.height = parent.clientHeight * dpr;
        canvas.style.width = parent.clientWidth + 'px';
        canvas.style.height = parent.clientHeight + 'px';
    }

    function init() {
        canvas = document.getElementById('water-chart');
        if (canvas) {
            ctx = canvas.getContext('2d');
            generateDemoData();
            window.addEventListener('resize', resize);
            resize();
            animFrame = requestAnimationFrame(draw);
        }
    }
    return { init, addPoint };
})();

window.WaterTank = (function() {
    // State models the real sensor: sensorDistance is what the ultrasonic reads
    // waterHeight = tankDepth - sensorDistance
    // waterPercentage = (waterHeight / tankDepth) * 100, clamped 0-100
    let state = {
        sensorDistance: 0, // cm from sensor to water surface (simulated)
        level: 0,          // computed percentage (0-100)
        displayLevel: 0,   // smoothly animated display value
        rafId: null,
        lastTime: 0
    };

    let demoInterval = null;
    let lastLoggedLevel = -1; // for timeline threshold events

    function computeFromDistance() {
        const settings = Settings.getState();
        const waterHeight = Math.max(0, settings.tankDepth - state.sensorDistance);
        state.level = Math.max(0, Math.min(100, (waterHeight / settings.tankDepth) * 100));
    }

    function updateVisuals() {
        const settings = Settings.getState();
        const tankWater = document.getElementById('tank-water');
        const waterPercent = document.getElementById('water-percent');
        const waterHeight = document.getElementById('water-height');
        const sensorDist = document.getElementById('sensor-distance');
        const navInd = document.getElementById('nav-water-indicator');
        const depthDisplay = document.getElementById('tank-depth-display');
        const modeLabel = document.getElementById('pump-mode-label');

        // Animate display level smoothly
        const diff = state.level - state.displayLevel;
        state.displayLevel += diff * 0.12;
        if (Math.abs(diff) < 0.05) state.displayLevel = state.level;

        const displayPct = state.displayLevel;
        const heightCm = (displayPct / 100) * settings.tankDepth;
        const distCm = settings.tankDepth - heightCm + settings.sensorOffset;

        if (tankWater) tankWater.style.height = `${displayPct}%`;
        // LCD values: show one decimal, no unit suffix (units in separate HTML elements)
        if (waterPercent) waterPercent.textContent = displayPct.toFixed(1);
        if (navInd) navInd.textContent = `${Math.round(displayPct)}%`;
        if (waterHeight) waterHeight.textContent = heightCm.toFixed(1);
        if (sensorDist) sensorDist.textContent = distCm.toFixed(1);
        if (depthDisplay) depthDisplay.textContent = settings.tankDepth;

        // Stream animation when pump is ON
        const stream = document.getElementById('wm-water-stream');
        const pumpOn = window.PumpControl && window.PumpControl.isOn();
        if (stream) {
            stream.style.display = pumpOn ? 'block' : 'none';
        }

        // Water color based on level
        let color = 'rgba(0, 229, 255, 0.75)';
        if (displayPct < 20) color = 'rgba(255, 82, 82, 0.75)';
        else if (displayPct < 40) color = 'rgba(255, 171, 64, 0.75)';
        document.documentElement.style.setProperty('--water-color', color);

        // LCD value color matches water state
        const lcdEls = document.querySelectorAll('.wm-lcd-value');
        lcdEls.forEach(el => {
            if (displayPct < 20) el.style.color = 'var(--danger)';
            else if (displayPct < 40) el.style.color = 'var(--warning)';
            else el.style.color = '';
        });
    }

    function animationLoop(timestamp) {
        if (!state.lastTime) state.lastTime = timestamp;
        state.lastTime = timestamp;
        updateVisuals();
        state.rafId = requestAnimationFrame(animationLoop);
    }

    function setSensorDistance(dist) {
        const settings = Settings.getState();
        state.sensorDistance = Math.max(0, Math.min(settings.tankDepth + settings.sensorOffset, dist));
        computeFromDistance();

        // Pump auto-check
        if (window.PumpControl) {
            window.PumpControl.checkAuto(state.level, settings.lowThreshold, settings.highThreshold);
        }

        // Log threshold crossings to timeline
        const roundedLevel = Math.round(state.level);
        if (lastLoggedLevel >= 0) {
            if (lastLoggedLevel > settings.lowThreshold && roundedLevel <= settings.lowThreshold) {
                ActivityTimeline.addEvent(`Water level dropped to ${roundedLevel}% (low threshold)`, 'water');
            }
            if (lastLoggedLevel < settings.highThreshold && roundedLevel >= settings.highThreshold) {
                ActivityTimeline.addEvent(`Water level reached ${roundedLevel}% (high threshold)`, 'water');
            }
        }
        lastLoggedLevel = roundedLevel;
    }

    function updateFromSettings() {
        computeFromDistance();
        updateVisuals();
    }

    function startDemoSimulation() {
        if (demoInterval) clearInterval(demoInterval);
        const settings = Settings.getState();

        // Initial sensor distance = 48cm from top (about 68% full for 150cm tank)
        setSensorDistance(settings.tankDepth * 0.32);
        state.displayLevel = state.level; // Immediate fill on load

        // Every 3 seconds, simulate the water system:
        // - If pump is ON: water rises (sensor distance decreases)
        // - Natural evaporation/drain: water drops slightly (sensor distance increases)
        demoInterval = setInterval(() => {
            const settings = Settings.getState();
            const pumpOn = window.PumpControl && window.PumpControl.isOn();
            let newDist = state.sensorDistance;

            if (pumpOn) {
                // Pump fills at ~2-3 cm per tick
                newDist -= (2 + Math.random() * 1.5);
            } else {
                // Natural drain/evaporation: ~0.5-1.5 cm per tick
                newDist += (0.5 + Math.random());
            }

            // Small random noise to feel alive
            newDist += (Math.random() - 0.5) * 0.4;

            // Clamp: sensor can't read less than sensorOffset or more than tankDepth
            newDist = Math.max(settings.sensorOffset, Math.min(settings.tankDepth, newDist));

            setSensorDistance(newDist);

            // Feed the graph
            if (window.WaterGraph) {
                window.WaterGraph.addPoint(state.level);
            }
        }, 3000);
    }

    function stopDemo() {
        if (demoInterval) {
            clearInterval(demoInterval);
            demoInterval = null;
        }
    }

    function applyServerState(dist, level, height) {
        stopDemo();
        if (typeof dist === 'number') {
            state.sensorDistance = dist;
            computeFromDistance();
        } else if (typeof level === 'number') {
            state.level = Math.max(0, Math.min(100, level));
        }
        if (window.WaterGraph) {
            window.WaterGraph.addPoint(state.level);
        }
    }

    function init() {
        state.rafId = requestAnimationFrame(animationLoop);
        startDemoSimulation();
    }

    return {
        init,
        updateFromSettings,
        getState: () => ({ level: state.level, displayLevel: state.displayLevel }),
        setSensorDistance,
        stopDemo,
        applyServerState
    };
})();

const AlertSystem = (function() {
    let alertHistory = [];
    const maxHistory = 100;
    let activeFilter = 'all';
    let audioCtx = null;

    function getAudioContext() {
        if (!audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) audioCtx = new AudioContextClass();
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return audioCtx;
    }

    function playSound(type) {
        if (window.Settings && window.Settings.getState().soundMuted) return;
        try {
            const ctx = getAudioContext();
            if (!ctx) return;
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.connect(gain);
            gain.connect(ctx.destination);

            if (type === 'warning') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, now);
                osc.frequency.exponentialRampToValueAtTime(660, now + 0.25);
                gain.gain.setValueAtTime(0.3, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
                osc.start(now);
                osc.stop(now + 0.3);
            } else if (type === 'danger') {
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(1050, now);
                osc.frequency.setValueAtTime(800, now + 0.15);
                osc.frequency.setValueAtTime(1050, now + 0.3);
                gain.gain.setValueAtTime(0.4, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);
                osc.start(now);
                osc.stop(now + 0.45);
            } else if (type === 'emergency') {
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(500, now);
                osc.frequency.linearRampToValueAtTime(1400, now + 0.2);
                osc.frequency.linearRampToValueAtTime(500, now + 0.4);
                gain.gain.setValueAtTime(0.5, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
                osc.start(now);
                osc.stop(now + 0.6);
            }
        } catch (e) {}
    }

    function vibrate(pattern) {
        if ('vibrate' in navigator) {
            try { navigator.vibrate(pattern); } catch (e) {}
        }
    }

    // ── Toast Stack Manager ──────────────────────────────────────────────
    function showToastNotification(options) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const { id = Date.now() + Math.random(), title, message, type = 'info', icon, duration = 6000, actions } = options;
        const toastCard = document.createElement('div');
        toastCard.className = `toast-card toast-${type}`;
        toastCard.setAttribute('data-toast-id', id);

        const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false });

        toastCard.innerHTML = `
            <div class="toast-card-icon">${icon || '🔔'}</div>
            <div class="toast-card-content">
                <div class="toast-card-header">
                    <span class="toast-card-title">${title}</span>
                    <span class="toast-card-time">${timeStr}</span>
                </div>
                <p class="toast-card-msg">${message}</p>
                ${actions ? `
                <div class="toast-card-actions">
                    <button class="toast-action-btn accept" id="toast-accept-${id}">ACCEPT</button>
                    <button class="toast-action-btn reject" id="toast-reject-${id}">REJECT</button>
                </div>
                ` : ''}
            </div>
            <button class="toast-card-close" aria-label="Close">✕</button>
        `;

        const closeBtn = toastCard.querySelector('.toast-card-close');
        if (closeBtn) closeBtn.addEventListener('click', () => removeToast(toastCard));

        if (actions) {
            const acceptBtn = toastCard.querySelector(`.toast-action-btn.accept`);
            const rejectBtn = toastCard.querySelector(`.toast-action-btn.reject`);
            if (acceptBtn) {
                acceptBtn.addEventListener('click', () => {
                    if (actions.onAccept) actions.onAccept();
                    removeToast(toastCard);
                });
            }
            if (rejectBtn) {
                rejectBtn.addEventListener('click', () => {
                    if (actions.onReject) actions.onReject();
                    removeToast(toastCard);
                });
            }
        }

        container.appendChild(toastCard);

        if (duration > 0) {
            setTimeout(() => {
                removeToast(toastCard);
            }, duration);
        }
    }

    function removeToast(el) {
        if (!el || !el.parentElement) return;
        el.classList.add('hide');
        setTimeout(() => {
            if (el.parentElement) el.parentElement.removeChild(el);
        }, 300);
    }

    // ── Alert History Logger ──────────────────────────────────────────────
    function logAlert(alertObj) {
        const item = {
            id: Date.now() + Math.random(),
            time: new Date(),
            title: alertObj.title,
            message: alertObj.message,
            severity: alertObj.severity || 'info',
            icon: alertObj.icon || '🔔'
        };

        alertHistory.unshift(item);
        if (alertHistory.length > maxHistory) alertHistory.pop();

        renderHistory();
    }

    function renderHistory() {
        const list = document.getElementById('alert-history-list');
        if (!list) return;

        const filtered = alertHistory.filter(item => {
            if (activeFilter === 'all') return true;
            return item.severity === activeFilter;
        });

        if (filtered.length === 0) {
            list.innerHTML = `<div class="alert-history-empty">No ${activeFilter.toUpperCase()} alerts recorded</div>`;
            return;
        }

        list.innerHTML = filtered.map(item => `
            <div class="alert-history-item">
                <span class="ahi-icon">${item.icon}</span>
                <div class="ahi-content">
                    <div class="ahi-top">
                        <span class="ahi-title">${item.title}</span>
                        <span class="ahi-time">${item.time.toLocaleTimeString('en-US', { hour12: false })}</span>
                    </div>
                    <span class="ahi-msg">${item.message}</span>
                </div>
                <span class="ahi-badge ${item.severity}">${item.severity.toUpperCase()}</span>
            </div>
        `).join('');
    }

    function initHistoryFilters() {
        const btns = document.querySelectorAll('.alert-filter-btn');
        btns.forEach(btn => {
            btn.addEventListener('click', () => {
                btns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                activeFilter = btn.getAttribute('data-filter');
                renderHistory();
            });
        });
    }

    function triggerGasAlert(status) {
        if (status === 'warning') {
            const title = '⚠ GAS WARNING';
            const msg = 'Gas concentration is increasing. Please inspect the environment.';
            showToastNotification({ title, message: msg, type: 'warning', icon: '☣' });
            logAlert({ title, message: msg, severity: 'warning', icon: '☣' });
            playSound('warning');
            vibrate([200]);
        } else if (status === 'danger') {
            const title = '🚨 GAS LEAK DETECTED';
            const msg = 'High gas concentration detected. Immediate action is recommended.';
            showToastNotification({ title, message: msg, type: 'danger', icon: '🚨', duration: 8000 });
            logAlert({ title, message: msg, severity: 'danger', icon: '🚨' });
            playSound('danger');
            vibrate([300, 100, 300, 100, 300]);
        }
    }

    function triggerFlameAlert(status) {
        if (status === 'warning') {
            const title = '⚠ FLAME WARNING';
            const msg = 'Possible flame detected. Monitoring...';
            showToastNotification({ title, message: msg, type: 'warning', icon: '🔥' });
            logAlert({ title, message: msg, severity: 'warning', icon: '🔥' });
            playSound('warning');
            vibrate([200]);
        } else if (status === 'danger') {
            const title = '🔥 FIRE DETECTED';
            const msg = 'Critical danger. Emergency response required.';
            showToastNotification({ title, message: msg, type: 'emergency', icon: '🔥', duration: 10000 });
            logAlert({ title, message: msg, severity: 'emergency', icon: '🔥' });
            playSound('emergency');
            vibrate([500, 200, 500, 200, 500]);

            const card = document.getElementById('flame-sensor-card');
            if (card) {
                card.classList.add('flash-red');
                setTimeout(() => card.classList.remove('flash-red'), 4000);
            }
        }
    }

    function triggerIRAlert(status) {
        if (status === 'danger' || status === 'warning') {
            const title = '🚶 PERSON DETECTED';
            const msg = 'Object detected in front of gate. Gate opening paused.';
            showToastNotification({
                title,
                message: msg,
                type: 'warning',
                icon: '🚶',
                duration: 8000,
                actions: {
                    onAccept: () => {
                        ActivityTimeline.addEvent('⚠ Gate open ACCEPTED despite IR alert', 'gate');
                        if (window.GateControl) window.GateControl.forceOpen();
                    },
                    onReject: () => {
                        ActivityTimeline.addEvent('🔒 Gate open REJECTED — IR safety block', 'gate');
                    }
                }
            });
            logAlert({ title, message: msg, severity: 'warning', icon: '🚶' });
            playSound('warning');
            vibrate([200]);
        }
    }

    function triggerWaterAlert(type) {
        if (type === 'full') {
            const title = '💧 WATER TANK FULL';
            const msg = 'Pump stopped automatically.';
            showToastNotification({ title, message: msg, type: 'info', icon: '💧' });
            logAlert({ title, message: msg, severity: 'info', icon: '💧' });
            playSound('warning');
        } else if (type === 'low') {
            const title = '💧 LOW WATER LEVEL';
            const msg = 'Pump started automatically.';
            showToastNotification({ title, message: msg, type: 'warning', icon: '💧' });
            logAlert({ title, message: msg, severity: 'warning', icon: '💧' });
            playSound('warning');
        } else if (type === 'overflow') {
            const title = '⚠ OVERFLOW WARNING';
            const msg = 'Tank is overflowing. Turn pump OFF.';
            showToastNotification({ title, message: msg, type: 'danger', icon: '⚠', duration: 8000 });
            logAlert({ title, message: msg, severity: 'emergency', icon: '⚠' });
            playSound('danger');
            vibrate([300, 100, 300]);

            const tankCard = document.querySelector('.wm-tank-card');
            if (tankCard) {
                tankCard.classList.add('flash-red');
                setTimeout(() => tankCard.classList.remove('flash-red'), 4000);
            }
        }
    }

    function init() {
        initHistoryFilters();
        logAlert({ title: 'System Initialized', message: 'Nexus Home Alert System operational', severity: 'info', icon: 'ℹ' });
    }

    return { init, triggerGasAlert, triggerFlameAlert, triggerIRAlert, triggerWaterAlert, showToastNotification, logAlert };
})();

window.AlertSystem = AlertSystem;

const SafetyMonitor = (function() {
    // ── State ─────────────────────────────────────────────────────────────
    const sensors = {
        ir:    { status: 'safe', id: 'ir' },
        gas:   { status: 'safe', id: 'gas' },
        flame: { status: 'safe', id: 'flame' }
    };

    let pendingGateAction = null;
    let userWebControlActive = false;
    let webControlTimeout = null;

    function authorizeWebControl() {
        userWebControlActive = true;
        if (webControlTimeout) clearTimeout(webControlTimeout);
        webControlTimeout = setTimeout(() => {
            userWebControlActive = false;
        }, 10000);
    }

    function isIrBlocked() {
        return sensors.ir.status !== 'safe';
    }

    const sensorTexts = {
        ir:    { safe: 'No Motion',      warning: 'Motion Detected', danger: 'Intruder Alert!' },
        gas:   { safe: 'Normal',         warning: 'Gas Detected',    danger: 'Dangerous Level!' },
        flame: { safe: 'No Flame',       warning: 'Heat Detected',   danger: 'Fire Detected!' }
    };
    const sensorBars = {
        ir:    { safe: '10%', warning: '60%', danger: '95%' },
        gas:   { safe: '15%', warning: '55%', danger: '90%' },
        flame: { safe:  '5%', warning: '65%', danger: '100%' }
    };

    function updateNavIndicator() {
        let isDanger = false, isWarn = false;
        Object.values(sensors).forEach(s => {
            if (s.status === 'danger')  isDanger = true;
            if (s.status === 'warning') isWarn   = true;
        });
        const navInd = document.getElementById('nav-safety-indicator');
        if (navInd) {
            navInd.className = 'nav-badge';
            if (isDanger)     { navInd.textContent = 'ALERT'; navInd.classList.add('danger'); }
            else if (isWarn)  { navInd.textContent = 'WARN';  navInd.classList.add('warning'); }
            else              { navInd.textContent = 'OK';    navInd.classList.add('safe'); }
        }
    }

    function updateDangerBanner() {
        const dangerSensors = Object.values(sensors).filter(s => s.status === 'danger');
        const banner     = document.getElementById('danger-banner');
        const bannerText = document.getElementById('danger-banner-text');
        if (!banner) return;
        if (dangerSensors.length === 0) {
            banner.style.display = 'none';
        } else {
            const labels = { ir: '⚠ IR INTRUDER', gas: '☣ GAS DANGER', flame: '🔥 FIRE ALERT' };
            const msgs = dangerSensors.map(s => labels[s.id]).join('  •  ');
            if (bannerText) bannerText.textContent = msgs + '  —  Check safety section immediately';
            banner.style.display = 'flex';
        }
    }

    function updateGateBlockedOverlay() {
        const overlay = document.getElementById('gate-blocked-overlay');
        if (!overlay) return;
        const irTriggered = sensors.ir.status !== 'safe';
        overlay.classList.toggle('visible', irTriggered);
    }

    function setSensorState(sensorId, status, skipModal) {
        const prev = sensors[sensorId].status;
        if (prev === status) return;
        sensors[sensorId].status = status;

        const card      = document.getElementById(`${sensorId}-sensor-card`);
        const dot       = document.getElementById(`${sensorId}-sensor-dot`);
        const statusEl  = document.getElementById(`${sensorId}-sensor-status`);
        const bar       = document.getElementById(`${sensorId}-sensor-bar`);
        const stateLabel= document.getElementById(`${sensorId}-state-label`);

        if (card) {
            card.classList.remove('warning', 'danger');
            if (status !== 'safe') card.classList.add(status);
        }
        if (dot)        dot.className = `sensor-dot ${status}`;
        if (statusEl)   statusEl.textContent = sensorTexts[sensorId][status];
        if (bar)        bar.style.width = sensorBars[sensorId][status];
        if (stateLabel) {
            stateLabel.textContent =
                status === 'safe' ? 'SAFE' : status === 'warning' ? 'CAUTION' : 'DANGER';
        }

        updateNavIndicator();
        updateDangerBanner();
        updateGateBlockedOverlay();

        if (status === 'warning' || status === 'danger') {
            const text = sensorTexts[sensorId][status];
            ActivityTimeline.addEvent(`⚠ Sensor Alert [${sensorId.toUpperCase()}]: ${text}`, 'sensor');
        } else if (prev !== 'safe') {
            ActivityTimeline.addEvent(`✓ ${sensorId.toUpperCase()} sensor cleared — All safe`, 'sensor');
        }

        // Trigger AlertSystem notifications
        if (window.AlertSystem) {
            if (sensorId === 'gas') window.AlertSystem.triggerGasAlert(status);
            if (sensorId === 'flame') window.AlertSystem.triggerFlameAlert(status);
            if (sensorId === 'ir') window.AlertSystem.triggerIRAlert(status);
        }

        if (sensorId === 'ir' && status === 'danger' && !skipModal) {
            if (!userWebControlActive) {
                showGateModal('Visitor / Object detected near gate — Authorize entry?');
            }
        }
    }

    // ── IR Safety Modal ───────────────────────────────────────────────────
    function showGateModal(reason) {
        const modal  = document.getElementById('safety-modal');
        const reasonEl = document.getElementById('safety-modal-reason');
        if (!modal) return;
        if (reasonEl) reasonEl.textContent = reason;

        // Update mini sensor dots inside modal
        ['ir', 'gas', 'flame'].forEach(id => {
            const dot = document.getElementById(`sms-${id}-dot`);
            const val = document.getElementById(`sms-${id}-val`);
            const s = sensors[id].status;
            if (dot) {
                dot.className = 'sms-dot';
                if (s === 'danger')  dot.classList.add('triggered');
                else if (s === 'warning') dot.classList.add('warning');
            }
            if (val) {
                val.className = 'sms-val';
                if (s === 'danger')  { val.textContent = 'DANGER';   val.classList.add('triggered'); }
                else if (s === 'warning') { val.textContent = 'CAUTION'; val.classList.add('warning'); }
                else                { val.textContent = 'OK'; }
            }
        });

        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeGateModal() {
        const modal = document.getElementById('safety-modal');
        if (modal) modal.classList.remove('active');
        document.body.style.overflow = '';
        pendingGateAction = null;
    }

    // ── Gate interception: called by GateControl before opening ──────────
    function requestGateOpen(actionCallback) {
        if (userWebControlActive) return true;
        if (sensors.ir.status === 'safe' && sensors.gas.status !== 'danger' && sensors.flame.status !== 'danger') {
            return true;
        }
        pendingGateAction = actionCallback;
        let reason = '';
        if (sensors.ir.status !== 'safe')    reason = 'IR sensor detected object or person near gate';
        else if (sensors.gas.status === 'danger')   reason = 'Dangerous gas level detected in area';
        else if (sensors.flame.status === 'danger') reason = 'Flame/fire detected — cannot open gate';
        showGateModal(reason);
        return false;
    }

    // ── Modal button handlers ─────────────────────────────────────────────
    function initModalButtons() {
        const acceptBtn = document.getElementById('safety-modal-accept');
        const rejectBtn = document.getElementById('safety-modal-reject');
        const bannerClose = document.getElementById('danger-banner-close');

        if (acceptBtn) {
            acceptBtn.addEventListener('click', () => {
                authorizeWebControl();
                closeGateModal();
                ActivityTimeline.addEvent('⚠ Visitor Accepted — Opening Gate', 'gate');
                if (pendingGateAction === null) {
                    if (window.GateControl) window.GateControl.forceOpen();
                } else if (typeof pendingGateAction === 'function') {
                    pendingGateAction();
                }
            });
        }

        if (rejectBtn) {
            rejectBtn.addEventListener('click', () => {
                authorizeWebControl();
                ActivityTimeline.addEvent('🔒 Visitor Rejected — Gate stays locked', 'gate');
                closeGateModal();
            });
        }

        if (bannerClose) {
            bannerClose.addEventListener('click', () => {
                document.getElementById('danger-banner').style.display = 'none';
            });
        }

        // Close modal on backdrop click
        const backdrop = document.querySelector('.safety-modal-backdrop');
        if (backdrop) {
            backdrop.addEventListener('click', () => {
                ActivityTimeline.addEvent('🔒 Gate modal dismissed — gate stays closed', 'gate');
                closeGateModal();
            });
        }
    }

    let autoDemoInterval = null;

    // ── Auto demo simulation ──────────────────────────────────────────────
    function startAutoDemo() {
        if (autoDemoInterval) clearInterval(autoDemoInterval);
        // Gentle random simulation — mostly safe, occasional events
        autoDemoInterval = setInterval(() => {
            const keys = ['ir', 'gas', 'flame'];
            const id   = keys[Math.floor(Math.random() * keys.length)];
            const r    = Math.random();
            let newStatus = 'safe';
            if      (r > 0.93) newStatus = 'danger';
            else if (r > 0.80) newStatus = 'warning';
            setSensorState(id, newStatus);
        }, 12000);
    }

    function stopAutoDemo() {
        if (autoDemoInterval) {
            clearInterval(autoDemoInterval);
            autoDemoInterval = null;
        }
    }

    function applyServerState(gas, flame, ir) {
        stopAutoDemo();
        if (gas && gas.status) setSensorState('gas', gas.status);
        if (flame && flame.status) setSensorState('flame', flame.status);
        if (ir && ir.status) setSensorState('ir', ir.status);
    }

    // ── Public demo() for manual HTML buttons ────────────────────────────
    function demo(sensorId, status) {
        setSensorState(sensorId, status);
    }

    function init() {
        initModalButtons();
        stopAutoDemo(); // Real hardware pin readings only — no fake demo timers!
    }

    return { init, setSensorState, requestGateOpen, authorizeWebControl, isIrBlocked, demo, stopAutoDemo, applyServerState };
})();

// Expose globally for HTML onclick
window.SafetyMonitor = SafetyMonitor;

const ServoControl = (function() {
    let state = {
        isOn: false,
        angle: 0,
        targetAngle: 0,
        rafId: null,
        lastTime: 0
    };

    function updateVisuals() {
        const angleVal = document.getElementById('servo-angle-value');
        const needle = document.getElementById('servo-needle');
        const arcActive = document.getElementById('servo-arc-active');
        const slider = document.getElementById('servo-slider');
        const navInd = document.getElementById('nav-servo-indicator');

        if (angleVal) angleVal.textContent = Math.round(state.angle);
        if (navInd) navInd.textContent = `${Math.round(state.angle)}°`;
        if (needle) needle.setAttribute('transform', `rotate(${state.angle - 90}, 100, 110)`);
        
        if (arcActive) {
            const arcLen = 251.2;
            const offset = arcLen - ((state.angle / 180) * arcLen);
            arcActive.style.strokeDashoffset = offset;
        }

        if (slider && document.activeElement !== slider) {
            slider.value = Math.round(state.angle);
        }
        
        const presets = document.querySelectorAll('.servo-preset-btn');
        presets.forEach(btn => {
            if (parseInt(btn.getAttribute('data-angle')) === Math.round(state.angle)) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    function loop(timestamp) {
        if (!state.lastTime) state.lastTime = timestamp;
        const dt = timestamp - state.lastTime;
        state.lastTime = timestamp;

        if (state.angle !== state.targetAngle) {
            const diff = state.targetAngle - state.angle;
            if (Math.abs(diff) < 0.5) {
                state.angle = state.targetAngle;
            } else {
                const move = Math.sign(diff) * Math.min(Math.abs(diff), 180 * (dt / 1000));
                state.angle += move;
            }
            updateVisuals();
        }

        state.rafId = requestAnimationFrame(loop);
    }

    function init() {
        const toggle = document.getElementById('servo-power-toggle');
        const status = document.getElementById('servo-power-status');
        const toggleWrap = document.getElementById('servo-toggle-wrap');
        const slider = document.getElementById('servo-slider');
        const presets = document.querySelectorAll('.servo-preset-btn');

        if (toggle) {
            toggle.addEventListener('change', (e) => {
                state.isOn = e.target.checked;
                if (state.isOn) {
                    if (status) status.textContent = 'ON';
                    if (toggleWrap) toggleWrap.classList.add('on');
                    if (slider) slider.disabled = false;
                    ActivityTimeline.addEvent('Servo turned ON', 'servo');
                } else {
                    if (status) status.textContent = 'OFF';
                    if (toggleWrap) toggleWrap.classList.remove('on');
                    if (slider) slider.disabled = true;
                    state.targetAngle = 0;
                    ActivityTimeline.addEvent('Servo turned OFF', 'servo');
                }
                if (window.ESP32WS) window.ESP32WS.send({ type: 'servo', on: state.isOn, angle: state.angle });
            });
        }

        if (slider) {
            slider.addEventListener('input', (e) => {
                if (!state.isOn) return;
                state.targetAngle = parseInt(e.target.value);
                if (window.ESP32WS) window.ESP32WS.send({ type: 'servo', on: state.isOn, angle: state.targetAngle });
            });
        }

        presets.forEach(btn => {
            btn.addEventListener('click', () => {
                if (!state.isOn) return;
                const angle = parseInt(btn.getAttribute('data-angle'));
                state.targetAngle = angle;
                ActivityTimeline.addEvent(`Servo moved to ${angle}°`, 'servo');
                if (window.ESP32WS) window.ESP32WS.send({ type: 'servo', on: state.isOn, angle });
            });
        });

        updateVisuals();
        state.rafId = requestAnimationFrame(loop);
    }

    function applyServerState(angle, isOn) {
        const toggle = document.getElementById('servo-power-toggle');
        const status = document.getElementById('servo-power-status');
        const toggleWrap = document.getElementById('servo-toggle-wrap');
        const slider = document.getElementById('servo-slider');

        if (typeof isOn === 'boolean' && state.isOn !== isOn) {
            state.isOn = isOn;
            if (toggle) toggle.checked = isOn;
            if (status) status.textContent = isOn ? 'ON' : 'OFF';
            if (toggleWrap) {
                if (isOn) toggleWrap.classList.add('on');
                else toggleWrap.classList.remove('on');
            }
            if (slider) slider.disabled = !isOn;
        }

        if (typeof angle === 'number' && state.targetAngle !== angle) {
            state.targetAngle = angle;
        }
    }

    return { init, applyServerState };
})();

const BootSequence = (function() {
    function init() {
        const bootScreen = document.getElementById('boot-screen');
        const progressBar = document.getElementById('boot-progress-bar');
        const bootStatus = document.getElementById('boot-status');
        const dashboard = document.getElementById('dashboard');
        
        if (!bootScreen || !dashboard) return;

        const messages = [
            { text: 'Initializing core systems...', time: 0 },
            { text: 'Loading sensor modules...', time: 625 },
            { text: 'Connecting peripherals...', time: 1250 },
            { text: 'Calibrating sensors...', time: 1875 },
            { text: 'System ready.', time: 2500 }
        ];

        if (progressBar) {
            progressBar.style.transition = 'width 2.5s ease-in-out';
            setTimeout(() => {
                progressBar.style.width = '100%';
            }, 50);
        }

        messages.forEach(msg => {
            setTimeout(() => {
                if (bootStatus) bootStatus.textContent = msg.text;
            }, msg.time);
        });

        setTimeout(() => {
            bootScreen.style.transition = 'opacity 0.5s ease';
            bootScreen.style.opacity = '0';
            setTimeout(() => {
                bootScreen.style.display = 'none';
                dashboard.style.display = 'flex';
                void dashboard.offsetWidth;
                dashboard.style.transition = 'opacity 0.8s ease';
                dashboard.style.opacity = '1';
                initDashboard();
            }, 500);
        }, 2500);
    }
    return { init };
})();

function initDashboard() {
    Navigation.init();
    ScrollAnimations.init();
    Settings.init();
    LightControl.init();
    GateControl.init();
    ServoControl.init();
    if (window.WaterTank) window.WaterTank.init();
    if (window.WaterGraph) window.WaterGraph.init();
    if (window.PumpControl) window.PumpControl.init();
    if (window.AlertSystem) window.AlertSystem.init();
    SafetyMonitor.init();
    ActivityTimeline.init();
}

document.addEventListener('DOMContentLoaded', () => {
    BootSequence.init();
});
