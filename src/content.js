// BTYouTube — Content Script v3
// Spotlight search + full customization system

(function () {
  'use strict';

  // ─── Default Settings ─────────────────────────────────────────────────────
  const DEFAULTS = {
    // Search
    showVideos: true,
    showShorts: true,
    showSearchSuggestions: true,
    // Customization
    blur: 18,
    contrast: 100,
    transparency: 88,
    accentColor: '#e8ff47',
    bgColor: '#111116',
    advancedMode: false,
    // Theme
    theme: 'default',           // 'default' | 'frosted' | 'gradient' | 'image'
    gradientColor1: '#1a1a2e',
    gradientColor2: '#16213e',
    gradientType: 'linear',     // 'linear' | 'radial'
    bgImageDataUrl: null,
  };

  let settings = { ...DEFAULTS };
  let spotlightOpen = false;
  let settingsOpen = false;
  let searchResults = [];
  let selectedIndex = 0;
  let debounceTimer = null;
  let buttonInjected = false;
  let observerPaused = false;
  let bgImageDataUrl = null; // stored locally (not in sync — too large)

  // Load settings
  chrome.storage.sync.get(['btySettings'], (res) => {
    if (res.btySettings) settings = { ...DEFAULTS, ...res.btySettings };
    // Load image from local storage
    chrome.storage.local.get(['btyBgImage'], (r) => {
      if (r.btyBgImage) bgImageDataUrl = r.btyBgImage;
      applyCustomization();
    });
  });

  function saveSettings() {
    chrome.storage.sync.set({ btySettings: settings });
    applyCustomization();
  }

  // ─── Apply Customization to Modal ─────────────────────────────────────────
  function applyCustomization() {
    const modal = document.getElementById('bty-spotlight-modal');
    if (!modal) return;

    const alpha = Math.round((100 - settings.transparency) * 2.55).toString(16).padStart(2, '0');
    const bg = settings.bgColor;

    // Reset
    modal.style.cssText = '';
    modal.removeAttribute('data-bty-theme');

    modal.style.setProperty('--bty-accent', settings.accentColor);
    modal.style.setProperty('--bty-accent-dim', hexToRgba(settings.accentColor, 0.13));
    modal.style.filter = `contrast(${settings.contrast}%)`;

    if (settings.theme === 'frosted') {
      modal.style.background = hexToRgba(bg, 0.45);
      modal.style.backdropFilter = `blur(${settings.blur}px) saturate(180%)`;
      modal.style.webkitBackdropFilter = `blur(${settings.blur}px) saturate(180%)`;
      modal.style.border = `1px solid ${hexToRgba(settings.accentColor, 0.18)}`;
      modal.setAttribute('data-bty-theme', 'frosted');
    } else if (settings.theme === 'gradient') {
      const g = settings.gradientType === 'radial'
        ? `radial-gradient(circle at 60% 40%, ${settings.gradientColor1}, ${settings.gradientColor2})`
        : `linear-gradient(135deg, ${settings.gradientColor1}, ${settings.gradientColor2})`;
      modal.style.background = g;
      modal.style.backdropFilter = `blur(${settings.blur}px)`;
      modal.style.webkitBackdropFilter = `blur(${settings.blur}px)`;
    } else if (settings.theme === 'image' && bgImageDataUrl) {
      modal.style.backgroundImage = `url(${bgImageDataUrl})`;
      modal.style.backgroundSize = 'cover';
      modal.style.backgroundPosition = 'center';
      modal.style.backdropFilter = `blur(${settings.blur}px)`;
      modal.style.webkitBackdropFilter = `blur(${settings.blur}px)`;
    } else {
      // Default
      modal.style.background = `${bg}${alpha}`;
      modal.style.backdropFilter = `blur(${settings.blur}px)`;
      modal.style.webkitBackdropFilter = `blur(${settings.blur}px)`;
    }

    // Propagate accent
    document.documentElement.style.setProperty('--bty-accent', settings.accentColor);
    document.documentElement.style.setProperty('--bty-accent-dim', hexToRgba(settings.accentColor, 0.13));
    document.documentElement.style.setProperty('--bty-surface', settings.bgColor);
  }

  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ─── Color Palettes ───────────────────────────────────────────────────────
  const PALETTE_COMMON = [
    '#e8ff47','#ff2d55','#00d4ff','#7c3aed','#f97316','#10b981',
    '#ec4899','#ffffff','#64748b','#000000'
  ];
  const PALETTE_EXTENDED = [
    '#ffd700','#ff6b35','#c084fc','#34d399','#fb923c','#38bdf8',
    '#f43f5e','#a3e635','#e879f9','#2dd4bf','#94a3b8','#1e293b',
    '#dc2626','#16a34a','#2563eb','#d97706','#7c3aed','#db2777',
    '#0891b2','#65a30d','#9333ea','#0284c7','#b45309','#be185d'
  ];

  function buildColorPalette(currentColor, onSelect, containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const showingExtra = el.dataset.showExtra === 'true';
    const palette = showingExtra ? [...PALETTE_COMMON, ...PALETTE_EXTENDED] : PALETTE_COMMON;

    el.innerHTML = `
      <div class="bty-palette-swatches">
        ${palette.map(c => `
          <button class="bty-swatch ${c === currentColor ? 'bty-swatch-active' : ''}"
            style="background:${c}" data-color="${c}" title="${c}"></button>
        `).join('')}
      </div>
      <button class="bty-palette-more">${showingExtra ? '▲ Less colors' : '▼ More colors'}</button>
    `;

    el.querySelectorAll('.bty-swatch').forEach(sw => {
      sw.addEventListener('click', () => { onSelect(sw.dataset.color); buildColorPalette(sw.dataset.color, onSelect, containerId); });
    });
    el.querySelector('.bty-palette-more').addEventListener('click', () => {
      el.dataset.showExtra = showingExtra ? 'false' : 'true';
      buildColorPalette(currentColor, onSelect, containerId);
    });
  }

  // ─── Color Wheel ──────────────────────────────────────────────────────────
  function buildColorWheel(containerId, initialColor, onChange) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = `
      <div class="bty-wheel-wrap">
        <canvas id="${containerId}-canvas" width="160" height="160"></canvas>
        <div id="${containerId}-cursor" class="bty-wheel-cursor"></div>
      </div>
      <div class="bty-wheel-controls">
        <div class="bty-wheel-row">
          <label>L</label>
          <input type="range" id="${containerId}-lightness" min="5" max="95" value="50" class="bty-slider">
        </div>
        <div class="bty-hex-row">
          <span>#</span>
          <input type="text" id="${containerId}-hex" maxlength="6" value="${initialColor.replace('#','')}" class="bty-hex-input">
        </div>
      </div>
    `;

    const canvas = document.getElementById(`${containerId}-canvas`);
    const ctx = canvas.getContext('2d');
    const cursor = document.getElementById(`${containerId}-cursor`);
    const lightnessSlider = document.getElementById(`${containerId}-lightness`);
    const hexInput = document.getElementById(`${containerId}-hex`);

    let hue = 0, saturation = 100, lightness = 50;

    // Parse initial color
    try {
      const r = parseInt(initialColor.slice(1,3),16)/255;
      const g = parseInt(initialColor.slice(3,5),16)/255;
      const b = parseInt(initialColor.slice(5,7),16)/255;
      const max = Math.max(r,g,b), min = Math.min(r,g,b);
      lightness = Math.round(((max+min)/2)*100);
      if (max !== min) {
        const d = max-min;
        saturation = Math.round(d/(1-Math.abs(2*lightness/100-1))*100);
        if (max===r) hue = 60*((g-b)/d%6);
        else if (max===g) hue = 60*((b-r)/d+2);
        else hue = 60*((r-g)/d+4);
        if (hue < 0) hue += 360;
      }
      lightnessSlider.value = lightness;
    } catch(e) {}

    function drawWheel() {
      const cx = 80, cy = 80, r = 75;
      ctx.clearRect(0,0,160,160);
      for (let angle = 0; angle < 360; angle++) {
        const startAngle = (angle-1)*Math.PI/180;
        const endAngle = (angle+1)*Math.PI/180;
        for (let s = 0; s <= r; s += 1) {
          const satPct = (s/r)*100;
          ctx.beginPath();
          ctx.arc(cx, cy, s, startAngle, endAngle);
          ctx.strokeStyle = `hsl(${angle}, ${satPct}%, ${lightness}%)`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }

    function placeCursor() {
      const r = 75;
      const angle = hue * Math.PI / 180;
      const dist = (saturation / 100) * r;
      const x = 80 + dist * Math.cos(angle);
      const y = 80 + dist * Math.sin(angle);
      cursor.style.left = `${x - 7}px`;
      cursor.style.top = `${y - 7}px`;
    }

    function emitColor() {
      const color = hslToHex(hue, saturation, lightness);
      hexInput.value = color.replace('#','');
      onChange(color);
    }

    function pickFromCanvas(e) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = 160 / rect.width;
      const scaleY = 160 / rect.height;
      const x = (e.clientX - rect.left) * scaleX - 80;
      const y = (e.clientY - rect.top) * scaleY - 80;
      const dist = Math.sqrt(x*x + y*y);
      if (dist > 75) return;
      hue = ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
      saturation = Math.round((dist / 75) * 100);
      placeCursor();
      emitColor();
    }

    let dragging = false;
    canvas.addEventListener('mousedown', (e) => { dragging = true; pickFromCanvas(e); });
    document.addEventListener('mousemove', (e) => { if (dragging) pickFromCanvas(e); });
    document.addEventListener('mouseup', () => { dragging = false; });

    lightnessSlider.addEventListener('input', () => {
      lightness = parseInt(lightnessSlider.value);
      drawWheel();
      emitColor();
    });

    hexInput.addEventListener('change', () => {
      const hex = '#' + hexInput.value.replace('#','').padStart(6,'0');
      onChange(hex);
    });

    drawWheel();
    placeCursor();
  }

  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1-l);
    const f = n => { const k=(n+h/30)%12; const c=l-a*Math.max(Math.min(k-3,9-k,1),-1); return Math.round(255*c).toString(16).padStart(2,'0'); };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  // ─── Build Settings Panel HTML ────────────────────────────────────────────
  function buildSettingsPanelHTML() {
    return `
    <div id="bty-settings-panel">
      <!-- SEARCH RESULTS SECTION -->
      <div class="bty-settings-section">
        <div class="bty-section-label">Search Results</div>
        <label class="bty-setting-row">
          <div class="bty-setting-info">
            <span class="bty-setting-name">Videos</span>
            <span class="bty-setting-desc">Top 5 video results</span>
          </div>
          <div class="bty-toggle" data-key="showVideos"><div class="bty-toggle-thumb"></div></div>
        </label>
        <label class="bty-setting-row">
          <div class="bty-setting-info">
            <span class="bty-setting-name">Shorts</span>
            <span class="bty-setting-desc">Top 3 short results</span>
          </div>
          <div class="bty-toggle" data-key="showShorts"><div class="bty-toggle-thumb"></div></div>
        </label>
        <label class="bty-setting-row">
          <div class="bty-setting-info">
            <span class="bty-setting-name">Suggestions</span>
            <span class="bty-setting-desc">Autocomplete suggestions</span>
          </div>
          <div class="bty-toggle" data-key="showSearchSuggestions"><div class="bty-toggle-thumb"></div></div>
        </label>
      </div>

      <!-- CUSTOMIZATION SECTION -->
      <div class="bty-settings-section">
        <div class="bty-section-label">Customization</div>

        <div class="bty-slider-row">
          <span class="bty-slider-label">Blur</span>
          <input type="range" class="bty-slider" id="bty-blur-slider" min="0" max="40" step="1" value="${settings.blur}">
          <span class="bty-slider-val" id="bty-blur-val">${settings.blur}</span>
        </div>
        <div class="bty-slider-row">
          <span class="bty-slider-label">Contrast</span>
          <input type="range" class="bty-slider" id="bty-contrast-slider" min="60" max="160" step="1" value="${settings.contrast}">
          <span class="bty-slider-val" id="bty-contrast-val">${settings.contrast}%</span>
        </div>
        <div class="bty-slider-row">
          <span class="bty-slider-label">Transparency</span>
          <input type="range" class="bty-slider" id="bty-trans-slider" min="0" max="95" step="1" value="${settings.transparency}">
          <span class="bty-slider-val" id="bty-trans-val">${settings.transparency}%</span>
        </div>

        <!-- Mode toggle -->
        <div class="bty-mode-toggle">
          <button class="bty-mode-btn ${!settings.advancedMode ? 'active' : ''}" id="bty-mode-basic">Palette</button>
          <button class="bty-mode-btn ${settings.advancedMode ? 'active' : ''}" id="bty-mode-advanced">Advanced</button>
        </div>

        <!-- BASIC: Color palettes -->
        <div id="bty-basic-colors" class="${settings.advancedMode ? 'bty-hidden' : ''}">
          <div class="bty-color-group">
            <span class="bty-color-label">Accent Color</span>
            <div id="bty-accent-palette" data-show-extra="false"></div>
          </div>
          <div class="bty-color-group">
            <span class="bty-color-label">Background Color</span>
            <div id="bty-bg-palette" data-show-extra="false"></div>
          </div>
        </div>

        <!-- ADVANCED: Color wheels -->
        <div id="bty-advanced-colors" class="${!settings.advancedMode ? 'bty-hidden' : ''}">
          <div class="bty-color-group">
            <span class="bty-color-label">Accent Color</span>
            <div id="bty-accent-wheel"></div>
          </div>
          <div class="bty-color-group">
            <span class="bty-color-label">Background Color</span>
            <div id="bty-bg-wheel"></div>
          </div>
        </div>
      </div>

      <!-- THEME SECTION (Advanced only) -->
      <div class="bty-settings-section ${!settings.advancedMode ? 'bty-hidden' : ''}" id="bty-theme-section">
        <div class="bty-section-label">Theme</div>
        <div class="bty-theme-pills">
          <button class="bty-theme-pill ${settings.theme==='default'?'active':''}" data-theme="default">Default</button>
          <button class="bty-theme-pill ${settings.theme==='frosted'?'active':''}" data-theme="frosted">Frosted Glass</button>
          <button class="bty-theme-pill ${settings.theme==='gradient'?'active':''}" data-theme="gradient">Gradient</button>
          <button class="bty-theme-pill ${settings.theme==='image'?'active':''}" data-theme="image">Custom Image</button>
        </div>

        <!-- Gradient controls -->
        <div id="bty-gradient-controls" class="${settings.theme==='gradient'?'':'bty-hidden'}">
          <div class="bty-grad-row">
            <span class="bty-color-label">Color 1</span>
            <div class="bty-mini-palette" id="bty-grad1-palette" data-show-extra="false"></div>
          </div>
          <div class="bty-grad-row">
            <span class="bty-color-label">Color 2</span>
            <div class="bty-mini-palette" id="bty-grad2-palette" data-show-extra="false"></div>
          </div>
          <div class="bty-grad-type">
            <button class="bty-grad-btn ${settings.gradientType==='linear'?'active':''}" data-grad="linear">Linear</button>
            <button class="bty-grad-btn ${settings.gradientType==='radial'?'active':''}" data-grad="radial">Radial</button>
          </div>
        </div>

        <!-- Image controls -->
        <div id="bty-image-controls" class="${settings.theme==='image'?'':'bty-hidden'}">
          <div id="bty-img-preview" class="${bgImageDataUrl?'':'bty-hidden'}">
            <img id="bty-img-thumb" src="${bgImageDataUrl||''}" alt="bg"/>
            <button id="bty-img-remove">✕ Remove</button>
          </div>
          <label class="bty-upload-btn" for="bty-img-input">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Upload Image
          </label>
          <input type="file" id="bty-img-input" accept="image/*" style="display:none">
          <p class="bty-img-note">Stored locally on your device</p>
        </div>
      </div>
    </div>`;
  }

  // ─── Wire Settings Interactivity ──────────────────────────────────────────
  function wireSettings() {
    const input = document.getElementById('bty-spotlight-input');

    // Toggles
    document.querySelectorAll('#bty-settings-panel .bty-toggle').forEach(toggle => {
      toggle.addEventListener('click', () => {
        const key = toggle.dataset.key;
        settings[key] = !settings[key];
        saveSettings();
        updateToggles();
        updateShortsPanelVisibility();
        const q = input?.value.trim();
        if (q) fetchResults(q);
      });
    });

    // Sliders
    const blurSlider = document.getElementById('bty-blur-slider');
    const contrastSlider = document.getElementById('bty-contrast-slider');
    const transSlider = document.getElementById('bty-trans-slider');

    blurSlider?.addEventListener('input', () => {
      settings.blur = parseInt(blurSlider.value);
      document.getElementById('bty-blur-val').textContent = settings.blur;
      saveSettings();
    });
    contrastSlider?.addEventListener('input', () => {
      settings.contrast = parseInt(contrastSlider.value);
      document.getElementById('bty-contrast-val').textContent = settings.contrast + '%';
      saveSettings();
    });
    transSlider?.addEventListener('input', () => {
      settings.transparency = parseInt(transSlider.value);
      document.getElementById('bty-trans-val').textContent = settings.transparency + '%';
      saveSettings();
    });

    // Mode toggle
    document.getElementById('bty-mode-basic')?.addEventListener('click', () => {
      settings.advancedMode = false;
      saveSettings();
      refreshSettingsPanel();
    });
    document.getElementById('bty-mode-advanced')?.addEventListener('click', () => {
      settings.advancedMode = true;
      saveSettings();
      refreshSettingsPanel();
    });

    // Basic palettes
    buildColorPalette(settings.accentColor, (c) => {
      settings.accentColor = c; saveSettings();
    }, 'bty-accent-palette');
    buildColorPalette(settings.bgColor, (c) => {
      settings.bgColor = c; saveSettings();
    }, 'bty-bg-palette');

    // Advanced wheels
    if (settings.advancedMode) {
      buildColorWheel('bty-accent-wheel', settings.accentColor, (c) => {
        settings.accentColor = c; saveSettings();
      });
      buildColorWheel('bty-bg-wheel', settings.bgColor, (c) => {
        settings.bgColor = c; saveSettings();
      });

      // Theme pills
      document.querySelectorAll('.bty-theme-pill').forEach(btn => {
        btn.addEventListener('click', () => {
          settings.theme = btn.dataset.theme;
          saveSettings();
          document.querySelectorAll('.bty-theme-pill').forEach(b => b.classList.toggle('active', b.dataset.theme === settings.theme));
          document.getElementById('bty-gradient-controls')?.classList.toggle('bty-hidden', settings.theme !== 'gradient');
          document.getElementById('bty-image-controls')?.classList.toggle('bty-hidden', settings.theme !== 'image');
        });
      });

      // Gradient controls
      buildColorPalette(settings.gradientColor1, (c) => {
        settings.gradientColor1 = c; saveSettings();
      }, 'bty-grad1-palette');
      buildColorPalette(settings.gradientColor2, (c) => {
        settings.gradientColor2 = c; saveSettings();
      }, 'bty-grad2-palette');

      document.querySelectorAll('.bty-grad-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          settings.gradientType = btn.dataset.grad;
          saveSettings();
          document.querySelectorAll('.bty-grad-btn').forEach(b => b.classList.toggle('active', b.dataset.grad === settings.gradientType));
        });
      });

      // Image upload
      const imgInput = document.getElementById('bty-img-input');
      imgInput?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          bgImageDataUrl = ev.target.result;
          chrome.storage.local.set({ btyBgImage: bgImageDataUrl });
          document.getElementById('bty-img-thumb').src = bgImageDataUrl;
          document.getElementById('bty-img-preview').classList.remove('bty-hidden');
          saveSettings();
        };
        reader.readAsDataURL(file);
      });

      document.getElementById('bty-img-remove')?.addEventListener('click', () => {
        bgImageDataUrl = null;
        chrome.storage.local.remove('btyBgImage');
        document.getElementById('bty-img-preview').classList.add('bty-hidden');
        if (settings.theme === 'image') { settings.theme = 'default'; saveSettings(); }
      });
    }
  }

  function updateToggles() {
    document.querySelectorAll('#bty-settings-panel .bty-toggle').forEach(toggle => {
      toggle.classList.toggle('bty-on', !!settings[toggle.dataset.key]);
    });
  }

  function refreshSettingsPanel() {
    const existing = document.getElementById('bty-settings-panel');
    if (!existing) return;
    const parent = existing.parentNode;
    const next = existing.nextSibling;
    existing.remove();
    const tmp = document.createElement('div');
    tmp.innerHTML = buildSettingsPanelHTML();
    parent.insertBefore(tmp.firstElementChild, next);
    wireSettings();
    updateToggles();
    if (settingsOpen) {
      document.getElementById('bty-settings-panel')?.classList.add('bty-settings-open');
    }
  }

  // ─── Build Spotlight ──────────────────────────────────────────────────────
  function buildSpotlight() {
    if (document.getElementById('bty-spotlight-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'bty-spotlight-overlay';
    overlay.innerHTML = `
      <div id="bty-spotlight-modal">
        <div id="bty-spotlight-header">
          <svg id="bty-spotlight-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input id="bty-spotlight-input" type="text" placeholder="Search YouTube…" autocomplete="off" spellcheck="false"/>
          <button id="bty-settings-btn" title="Settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
          <kbd id="bty-spotlight-esc">ESC</kbd>
        </div>

        ${buildSettingsPanelHTML()}

        <div id="bty-spotlight-body">
          <div id="bty-spotlight-main">
            <div id="bty-spotlight-results"></div>
            <div id="bty-spotlight-footer">
              <span><kbd>↑↓</kbd> navigate</span>
              <span><kbd>↵</kbd> open</span>
              <span><kbd>⌘K</kbd> toggle</span>
            </div>
          </div>
          <div id="bty-shorts-panel">
            <div id="bty-shorts-panel-header">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.77 10.32l-1.2-.5L18 9.06c1.84-.96 2.53-3.23 1.56-5.06s-3.23-2.53-5.07-1.56L6 6.94c-1.29.68-2.07 2.04-2 3.49.07 1.17.62 2.18 1.46 2.82L4.23 13.68c-1.84.96-2.53 3.23-1.56 5.06.97 1.83 3.23 2.53 5.07 1.56l8.49-4.5c1.29-.68 2.07-2.04 2-3.49-.07-1.17-.62-2.18-1.46-2.99zM10 14.5v-5l4 2.5-4 2.5z"/></svg>
              <span>Shorts</span>
              <button id="bty-shorts-toggle" title="Toggle shorts panel">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div id="bty-shorts-list"></div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const searchInput = document.getElementById('bty-spotlight-input');
    const settingsBtn = document.getElementById('bty-settings-btn');
    const settingsPanel = document.getElementById('bty-settings-panel');

    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeSpotlight(); });
    overlay.addEventListener('keydown', (e) => e.stopPropagation(), true);
    overlay.addEventListener('keyup', (e) => e.stopPropagation(), true);

    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => fetchResults(searchInput.value.trim()), 280);
    });
    searchInput.addEventListener('keydown', handleSpotlightKeys);

    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      settingsOpen = !settingsOpen;
      settingsPanel.classList.toggle('bty-settings-open', settingsOpen);
      settingsBtn.classList.toggle('bty-active', settingsOpen);
    });

    wireSettings();
    updateToggles();
    wireShortsPanelToggle();
    applyCustomization();
  }

  function openSpotlight() {
    buildSpotlight();
    spotlightOpen = true;
    settingsOpen = false;
    const overlay = document.getElementById('bty-spotlight-overlay');
    const input = document.getElementById('bty-spotlight-input');
    const panel = document.getElementById('bty-settings-panel');
    if (panel) panel.classList.remove('bty-settings-open');
    overlay.classList.add('bty-visible');
    applyCustomization();
    updateShortsPanelVisibility();
    setTimeout(() => input && input.focus(), 60);
  }

  function closeSpotlight() {
    spotlightOpen = false;
    settingsOpen = false;
    const overlay = document.getElementById('bty-spotlight-overlay');
    if (!overlay) return;
    overlay.classList.remove('bty-visible');
    const input = document.getElementById('bty-spotlight-input');
    if (input) input.value = '';
    document.getElementById('bty-settings-panel')?.classList.remove('bty-settings-open');
    clearResults();
  }

  function handleSpotlightKeys(e) {
    if (e.key === 'Escape') { closeSpotlight(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); }
    if (e.key === 'Enter') { e.preventDefault(); openSelected(); }
  }

  function moveSelection(dir) {
    if (!searchResults.length) return;
    selectedIndex = Math.max(0, Math.min(searchResults.length - 1, selectedIndex + dir));
    renderResults(searchResults);
    document.getElementById('bty-spotlight-input')?.focus();
  }

  function openSelected() {
    const item = searchResults[selectedIndex];
    if (item?.url) { window.location.href = item.url; closeSpotlight(); }
  }

  // ─── Fetch ────────────────────────────────────────────────────────────────
  async function fetchResults(query) {
    if (!query) { clearResults(); return; }
    const resultsEl = document.getElementById('bty-spotlight-results');
    const shortsList = document.getElementById('bty-shorts-list');
    if (!resultsEl) return;
    resultsEl.innerHTML = `<div class="bty-loading"><span></span><span></span><span></span></div>`;
    if (shortsList) shortsList.innerHTML = `<div class="bty-shorts-loading"><span></span><span></span><span></span></div>`;
    selectedIndex = 0;

    const allResults = [{ type: 'direct', label: query, url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}` }];

    const [suggestions, pageResults, shortsResults] = await Promise.allSettled([
      fetchSuggestions(query),
      fetchPageResults(query),
      fetchShortsResults(query)
    ]);

    if (settings.showVideos) {
      const videos = pageResults.status === 'fulfilled' ? (pageResults.value.videos || []) : [];
      videos.slice(0, 5).forEach(v => allResults.push({ ...v, type: 'video' }));
    }
    if (settings.showSearchSuggestions) {
      const suggs = suggestions.status === 'fulfilled' ? (suggestions.value || []) : [];
      suggs.slice(0, 4).forEach(s => allResults.push({ type: 'search', label: s, url: `https://www.youtube.com/results?search_query=${encodeURIComponent(s)}` }));
    }

    searchResults = allResults;
    renderResults(searchResults);

    // Render shorts in sidebar — prefer dedicated shorts fetch, fall back to page parse
    const shortsFromPage = pageResults.status === 'fulfilled' ? (pageResults.value.shorts || []) : [];
    const shortsFromDedicated = shortsResults.status === 'fulfilled' ? (shortsResults.value || []) : [];
    const combinedShorts = shortsFromDedicated.length > 0 ? shortsFromDedicated : shortsFromPage;
    renderShortsSidebar(combinedShorts.slice(0, 5));

    // Show/hide sidebar based on toggle
    updateShortsPanelVisibility();
  }

  async function fetchSuggestions(query) {
    const res = await fetch(`https://suggestqueries-clients6.youtube.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(query)}`);
    const data = await res.json();
    return (data[1] || []).filter(s => s !== query);
  }

  async function fetchShortsResults(query) {
    // sp=EgQQARgB is YouTube's Shorts filter
    try {
      const res = await fetch(
        `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgQQARgB`,
        { credentials: 'include' }
      );
      const html = await res.text();
      const match = html.match(/var ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s)
        || html.match(/ytInitialData\s*=\s*(\{.+?\});\s*(?:\/\/|<)/s);
      if (!match) return [];
      const data = JSON.parse(match[1]);
      const shorts = [];
      const seen = new Set();

      function extractVideoId(r) {
        return r?.videoId ||
          r?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ||
          r?.onTap?.innertubeCommand?.commandMetadata?.webCommandMetadata?.url?.split('/shorts/')?.[1]?.split('?')?.[0] ||
          r?.entityId?.replace(/^shorts-/, '') || null;
      }

      function extractThumb(r) {
        return r?.thumbnail?.sources?.slice(-1)[0]?.url ||
          r?.thumbnail?.thumbnails?.slice(-1)[0]?.url || '';
      }

      function extractTitle(r) {
        return r?.overlayMetadata?.primaryText?.content ||
          r?.overlayMetadata?.primaryText?.runs?.[0]?.text ||
          r?.headline?.simpleText || r?.accessibilityText || 'Short';
      }

      // Walk entire response tree for video renderers (Shorts filter = all results are shorts)
      function walk(obj, depth) {
        if (!obj || typeof obj !== 'object' || depth > 15) return;
        if (obj.videoRenderer?.videoId) {
          const vr = obj.videoRenderer;
          const id = vr.videoId;
          if (!seen.has(id)) {
            seen.add(id);
            shorts.push({
              videoId: id,
              title: vr.title?.runs?.[0]?.text || vr.title?.simpleText || 'Short',
              thumb: vr.thumbnail?.thumbnails?.slice(-1)[0]?.url || '',
              url: `https://www.youtube.com/shorts/${id}`,
              label: vr.title?.runs?.[0]?.text || 'Short'
            });
          }
        }
        if (obj.reelItemRenderer) {
          const id = obj.reelItemRenderer.videoId;
          if (id && !seen.has(id)) {
            seen.add(id);
            shorts.push({ videoId: id, title: obj.reelItemRenderer.headline?.simpleText || 'Short', thumb: extractThumb(obj.reelItemRenderer), url: `https://www.youtube.com/shorts/${id}`, label: obj.reelItemRenderer.headline?.simpleText || 'Short' });
          }
        }
        if (obj.shortsLockupViewModel) {
          const id = extractVideoId(obj.shortsLockupViewModel);
          if (id && !seen.has(id)) {
            seen.add(id);
            shorts.push({ videoId: id, title: extractTitle(obj.shortsLockupViewModel), thumb: extractThumb(obj.shortsLockupViewModel), url: `https://www.youtube.com/shorts/${id}`, label: extractTitle(obj.shortsLockupViewModel) });
          }
        }
        if (Array.isArray(obj)) obj.forEach(v => walk(v, depth + 1));
        else for (const k of Object.keys(obj)) walk(obj[k], depth + 1);
      }
      walk(data, 0);
      return shorts;
    } catch(e) {
      return [];
    }
  }

  async function fetchPageResults(query) {
    const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, { credentials: 'include' });
    const html = await res.text();
    const match = html.match(/var ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s) || html.match(/ytInitialData\s*=\s*(\{.+?\});\s*(?:\/\/|<)/s);
    if (!match) return { videos: [], shorts: [] };
    let data;
    try { data = JSON.parse(match[1]); } catch { return { videos: [], shorts: [] }; }

    const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
    const videos = [], shorts = [];

    function extractShort(obj) {
      if (!obj) return null;

      // Shape 1: reelItemRenderer
      if (obj.reelItemRenderer) {
        const r = obj.reelItemRenderer;
        if (!r.videoId) return null;
        const thumb = r.thumbnail?.thumbnails?.slice(-1)[0]?.url || '';
        return { videoId: r.videoId, title: r.headline?.simpleText || 'Short', thumb, url: `https://www.youtube.com/shorts/${r.videoId}`, label: r.headline?.simpleText || 'Short' };
      }

      // Shape 2: shortsLockupViewModel — many nested locations for videoId
      if (obj.shortsLockupViewModel) {
        const r = obj.shortsLockupViewModel;
        const videoId =
          r.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ||
          r.onTap?.innertubeCommand?.commandMetadata?.webCommandMetadata?.url?.split('/shorts/')?.[1]?.split('?')?.[0] ||
          r.videoId ||
          r.entityId?.replace(/^shorts-/, '') ||
          r.accessibilityText?.match(/([A-Za-z0-9_-]{11})/)?.[1] ||
          null;
        if (!videoId || videoId.length < 5) return null;
        const title =
          r.overlayMetadata?.primaryText?.content ||
          r.overlayMetadata?.primaryText?.runs?.[0]?.text ||
          r.headline?.simpleText ||
          r.accessibilityText || 'Short';
        const thumb =
          r.thumbnail?.sources?.slice(-1)[0]?.url ||
          r.thumbnail?.thumbnails?.slice(-1)[0]?.url ||
          r.thumbnailRenderer?.movieThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)[0]?.url || '';
        return { videoId, title, thumb, url: `https://www.youtube.com/shorts/${videoId}`, label: title };
      }

      // Shape 3: wrapper nodes
      if (obj.richItemRenderer?.content) return extractShort(obj.richItemRenderer.content);
      if (obj.richGridMediaRenderer) return extractShort({ shortsLockupViewModel: obj.richGridMediaRenderer });
      return null;
    }

    for (const section of contents) {
      const items = section?.itemSectionRenderer?.contents || [];
      for (const item of items) {
        const vr = item?.videoRenderer;
        if (vr?.videoId) videos.push({ videoId: vr.videoId, title: vr.title?.runs?.[0]?.text || '', channel: vr.ownerText?.runs?.[0]?.text || '', thumb: vr.thumbnail?.thumbnails?.slice(-1)[0]?.url || '', duration: vr.lengthText?.simpleText || '', views: vr.viewCountText?.simpleText || '', url: `https://www.youtube.com/watch?v=${vr.videoId}`, label: vr.title?.runs?.[0]?.text || '' });
        const shelf = item?.reelShelfRenderer;
        if (shelf) for (const si of (shelf.items || [])) { const s = extractShort(si); if (s) shorts.push(s); }
      }
      const richShelf = section?.richSectionRenderer?.content?.richShelfRenderer;
      if (richShelf) for (const ri of (richShelf.contents || [])) { const s = extractShort(ri); if (s) shorts.push(s); }
      if (section?.reelShelfRenderer) for (const si of (section.reelShelfRenderer.items || [])) { const s = extractShort(si); if (s) shorts.push(s); }
    }

    // ── Deep scan fallback: walk entire ytInitialData tree for any shorts ──
    if (shorts.length === 0) {
      function deepScan(obj, depth) {
        if (!obj || typeof obj !== 'object' || depth > 12) return;
        // shortsLockupViewModel can appear anywhere
        if (obj.shortsLockupViewModel) {
          const s = extractShort(obj); if (s) shorts.push(s);
        }
        if (obj.reelItemRenderer) {
          const s = extractShort(obj); if (s) shorts.push(s);
        }
        for (const key of Object.keys(obj)) {
          const val = obj[key];
          if (Array.isArray(val)) val.forEach(v => deepScan(v, depth + 1));
          else if (val && typeof val === 'object') deepScan(val, depth + 1);
        }
      }
      deepScan(data, 0);
    }

    const seen = new Set();
    return { videos, shorts: shorts.filter(s => { if (seen.has(s.videoId)) return false; seen.add(s.videoId); return true; }) };
  }

  // ─── Render Results ───────────────────────────────────────────────────────
  function renderResults(results) {
    const el = document.getElementById('bty-spotlight-results');
    if (!el) return;
    if (!results.length) { el.innerHTML = ''; return; }

    // Separate shorts out so they render as a single card-row
    const shortsGroup = results.filter(r => r.type === 'short');
    const shortsIndices = results.reduce((acc, r, i) => { if (r.type === 'short') acc.push(i); return acc; }, []);

    const groups = [];
    let lastGroup = null;
    let shortsRowEmitted = false;

    results.forEach((r, i) => {
      if (r.type === 'short') {
        // Emit entire shorts row once, keyed to first short's index
        if (!shortsRowEmitted) {
          if (lastGroup !== 'Shorts') { groups.push({ isSectionHeader: true, label: 'Shorts' }); lastGroup = 'Shorts'; }
          groups.push({ type: 'shorts-row', shorts: shortsGroup, indices: shortsIndices });
          shortsRowEmitted = true;
        }
        return;
      }
      const gn = r.type === 'video' ? 'Videos' : r.type === 'search' ? 'Suggestions' : null;
      if (gn && gn !== lastGroup) { groups.push({ isSectionHeader: true, label: gn }); lastGroup = gn; }
      else if (!gn) lastGroup = null;
      groups.push({ ...r, _index: i });
    });

    el.innerHTML = groups.map(item => {
      if (item.isSectionHeader) return `<div class="bty-section-header">${item.label}</div>`;

      // Shorts rendered as a horizontal row of vertical cards
      if (item.type === 'shorts-row') {
        return `<div class="bty-shorts-row">${item.shorts.map((s, pos) => {
          const i = item.indices[pos];
          const sel = i === selectedIndex ? 'bty-short-selected' : '';
          return `<div class="bty-short-card ${sel}" data-index="${i}">
            <div class="bty-short-thumb">
              ${s.thumb ? `<img src="${s.thumb}" loading="lazy"/>` : '<div class="bty-thumb-ph"></div>'}
              <div class="bty-short-play">▶</div>
            </div>
            <span class="bty-short-title">${escapeHtml(s.title || 'Short')}</span>
          </div>`;
        }).join('')}</div>`;
      }

      const i = item._index, sel = i === selectedIndex ? 'bty-selected' : '';
      if (item.type === 'video') return `<div class="bty-result-item bty-result-media ${sel}" data-index="${i}"><div class="bty-thumb-wrap">${item.thumb ? `<img class="bty-thumb" src="${item.thumb}" loading="lazy"/>` : '<div class="bty-thumb-ph"></div>'}${item.duration ? `<span class="bty-duration">${escapeHtml(item.duration)}</span>` : ''}</div><div class="bty-result-meta"><span class="bty-result-title">${escapeHtml(item.title)}</span><span class="bty-result-sub">${escapeHtml(item.channel)}${item.views ? ' · ' + escapeHtml(item.views) : ''}</span></div><span class="bty-result-badge bty-badge-video">Video</span></div>`;
      return `<div class="bty-result-item ${sel}" data-index="${i}"><div class="bty-result-icon">${item.type==='direct'?`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`}</div><span class="bty-result-label">${escapeHtml(item.label)}</span>${item.type==='direct'?`<span class="bty-result-badge">Search</span>`:''}</div>`;
    }).join('');

    el.querySelectorAll('.bty-result-item').forEach(item => {
      item.addEventListener('mouseenter', () => { selectedIndex = parseInt(item.dataset.index); renderResults(results); });
      item.addEventListener('click', () => { selectedIndex = parseInt(item.dataset.index); openSelected(); });
    });
    el.querySelectorAll('.bty-short-card').forEach(card => {
      card.addEventListener('mouseenter', () => { selectedIndex = parseInt(card.dataset.index); renderResults(results); });
      card.addEventListener('click', () => { selectedIndex = parseInt(card.dataset.index); openSelected(); });
    });
  }

  function clearResults() {
    searchResults = []; selectedIndex = 0;
    const el = document.getElementById('bty-spotlight-results');
    if (el) el.innerHTML = '';
    const shortsList = document.getElementById('bty-shorts-list');
    if (shortsList) shortsList.innerHTML = '';
  }

  // ─── Shorts Sidebar ───────────────────────────────────────────────────────
  function renderShortsSidebar(shorts) {
    const list = document.getElementById('bty-shorts-list');
    if (!list) return;
    if (!shorts.length) {
      list.innerHTML = `<div class="bty-shorts-empty">No shorts found</div>`;
      return;
    }
    list.innerHTML = shorts.map((s, i) => `
      <a class="bty-sidebar-short" href="${s.url}" data-url="${s.url}">
        <div class="bty-sidebar-thumb">
          ${s.thumb ? `<img src="${s.thumb}" loading="lazy"/>` : '<div class="bty-thumb-ph"></div>'}
          <div class="bty-sidebar-play">▶</div>
        </div>
        <span class="bty-sidebar-title">${escapeHtml(s.title || 'Short')}</span>
      </a>
    `).join('');

    list.querySelectorAll('.bty-sidebar-short').forEach(card => {
      card.addEventListener('click', (e) => {
        e.preventDefault();
        window.location.href = card.dataset.url;
        closeSpotlight();
      });
    });
  }

  function updateShortsPanelVisibility() {
    const panel = document.getElementById('bty-shorts-panel');
    if (!panel) return;
    panel.classList.toggle('bty-shorts-hidden', !settings.showShorts);
    const body = document.getElementById('bty-spotlight-body');
    if (body) body.classList.toggle('bty-no-shorts', !settings.showShorts);
  }

  function wireShortsPanelToggle() {
    const btn = document.getElementById('bty-shorts-toggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
      settings.showShorts = !settings.showShorts;
      saveSettings();
      updateShortsPanelVisibility();
      updateToggles();
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ─── UI Overhaul ──────────────────────────────────────────────────────────
  function applyUIOverhaul() {
    document.documentElement.setAttribute('data-bty', 'true');
  }

  // ─── Keyboard ────────────────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'k') { e.preventDefault(); spotlightOpen ? closeSpotlight() : openSpotlight(); return; }
    if (e.key === 'Escape' && spotlightOpen) closeSpotlight();
  });

  // ─── Inject Button ────────────────────────────────────────────────────────
  function injectTriggerButton() {
    if (document.getElementById('bty-trigger')) { buttonInjected = true; return; }
    if (buttonInjected) return;
    const target = document.querySelector('#end.ytd-masthead') || document.querySelector('ytd-masthead #end') || document.querySelector('#masthead #end');
    if (!target) return;
    buttonInjected = true;
    observerPaused = true;
    const btn = document.createElement('button');
    btn.id = 'bty-trigger';
    btn.title = 'BTYouTube Spotlight (⌘K)';
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span>Search</span><kbd>⌘K</kbd>`;
    btn.addEventListener('click', openSpotlight);
    target.insertBefore(btn, target.firstChild);
    setTimeout(() => { observerPaused = false; }, 800);
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  function init() {
    applyUIOverhaul();
    buildSpotlight();
    const tryInject = setInterval(() => { injectTriggerButton(); if (buttonInjected) clearInterval(tryInject); }, 400);
    setTimeout(() => clearInterval(tryInject), 8000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  let retryTimeout = null;
  const observer = new MutationObserver(() => {
    if (observerPaused || document.getElementById('bty-trigger')) return;
    clearTimeout(retryTimeout);
    retryTimeout = setTimeout(() => { buttonInjected = false; injectTriggerButton(); }, 700);
  });
  observer.observe(document.body, { childList: true, subtree: false });

})();
