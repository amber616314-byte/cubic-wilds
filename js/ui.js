// ui.js — HUD（准星/热栏/物品名）、标题/暂停菜单、物品栏、F3 调试
'use strict';
window.MC = window.MC || {};

MC.UI = (function () {
  let canvas = null, ctx = null;
  let main = null;
  let width = 0, height = 0;
  let crossName = '';
  let inventoryOpen = false;
  let invGridEl = null;

  function init(m) {
    main = m;
    canvas = document.getElementById('hud');
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    invGridEl = document.getElementById('inv-grid');
    bindMenuEvents();
  }

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }

  // ---------- HUD 绘制 ----------
  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    drawCrosshair();
    drawHotbar();
    drawName();
  }

  function drawCrosshair() {
    const cx = width / 2, cy = height / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy); ctx.lineTo(cx - 2, cy);
    ctx.moveTo(cx + 2, cy); ctx.lineTo(cx + 8, cy);
    ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy - 2);
    ctx.moveTo(cx, cy + 2); ctx.lineTo(cx, cy + 8);
    ctx.stroke();
  }

  function drawHotbar() {
    const inv = main.inventory;
    const SLOT = 46, GAP = 3;
    const total = SLOT * 9 + GAP * 8;
    const x0 = (width - total) / 2, y0 = height - SLOT - 16;
    for (let i = 0; i < 9; i++) {
      const x = x0 + i * (SLOT + GAP);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x, y0, SLOT, SLOT);
      const s = inv.slots[i];
      if (s && s.id > 0) {
        const sIdx = MC.Textures.slotOf(s.id, 0);
        if (sIdx !== undefined) {
          const S = 18, cols = 12;
          const col = sIdx % cols, row = Math.floor(sIdx / cols);
          ctx.drawImage(MC.Textures.atlasCanvas, col * S + 1, row * S + 1, 16, 16, x + 6, y0 + 6, SLOT - 12, SLOT - 12);
        }
        if (!main.creative && s.count > 1) {
          ctx.font = 'bold 14px monospace';
          ctx.textAlign = 'right';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,0.85)';
          ctx.strokeText(String(s.count), x + SLOT - 4, y0 + SLOT - 5);
          ctx.fillStyle = '#fff';
          ctx.fillText(String(s.count), x + SLOT - 4, y0 + SLOT - 5);
        }
      }
      const sel = i === inv.selected;
      ctx.strokeStyle = sel ? '#ffffff' : 'rgba(255,255,255,0.55)';
      ctx.lineWidth = sel ? 2.5 : 1.5;
      ctx.strokeRect(x + 0.5, y0 + 0.5, SLOT - 1, SLOT - 1);
    }
  }

  function drawName() {
    if (!crossName) return;
    ctx.font = 'bold 15px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(crossName, width / 2, height / 2 - 52);
    ctx.fillStyle = '#fff';
    ctx.fillText(crossName, width / 2, height / 2 - 52);
  }

  function setCrossName(name) { crossName = name; }

  // ---------- 物品栏 ----------
  function openInventory() {
    inventoryOpen = true;
    document.getElementById('inv-screen').style.display = 'flex';
    buildInvGrid();
  }
  function closeInventory() {
    inventoryOpen = false;
    document.getElementById('inv-screen').style.display = 'none';
  }
  function isInventoryOpen() { return inventoryOpen; }

  function buildInvGrid() {
    invGridEl.innerHTML = '';
    const cur = main.inventory.slots[main.inventory.selected];
    MC.PLACEABLE.forEach(function (b) {
      const cell = document.createElement('div');
      cell.className = 'inv-cell' + (cur && cur.id === b.id ? ' inv-selected' : '');
      const icon = document.createElement('div');
      icon.className = 'inv-icon';
      const sIdx = MC.Textures.slotOf(b.id, 0);
      if (sIdx !== undefined) {
        const S = 18, cols = 12;
        const col = sIdx % cols, row = Math.floor(sIdx / cols);
        const c = document.createElement('canvas');
        c.width = c.height = 32;
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = false;
        g.drawImage(MC.Textures.atlasCanvas, col * S + 1, row * S + 1, 16, 16, 0, 0, 32, 32);
        icon.appendChild(c);
      }
      const label = document.createElement('span');
      label.textContent = b.name;
      cell.appendChild(icon);
      cell.appendChild(label);
      cell.addEventListener('click', function () {
        main.setHotbarBlock(b.id);
        buildInvGrid();
      });
      invGridEl.appendChild(cell);
    });
  }

  // ---------- 菜单 ----------
  function showTitle() {
    document.getElementById('title-screen').style.display = 'flex';
    document.getElementById('pause-screen').style.display = 'none';
  }
  function showPause() {
    document.getElementById('pause-screen').style.display = 'flex';
  }
  function hideAll() {
    document.getElementById('title-screen').style.display = 'none';
    document.getElementById('pause-screen').style.display = 'none';
  }

  function bindMenuEvents() {
    // 标题屏
    document.getElementById('btn-start').addEventListener('click', function () {
      MC.Audio.init(); // 用户手势内初始化音频
      const seedInput = document.getElementById('seed-input');
      const seed = seedInput.value.trim() === '' ? (Math.floor(Math.random() * 0x7fffffff)) : (parseInt(seedInput.value, 10) || (function () { let s = 0; for (let i = 0; i < seedInput.value.length; i++) s = (s * 31 + seedInput.value.charCodeAt(i)) | 0; return s; })());
      main.newGame(seed);
    });
    // 暂停屏
    document.getElementById('btn-resume').addEventListener('click', function () { main.resume(); });
    document.getElementById('btn-reseed').addEventListener('click', function () {
      main.newGame(Math.floor(Math.random() * 0x7fffffff));
    });
    document.getElementById('btn-title').addEventListener('click', function () {
      main.toTitle();
    });
    // 设置控件（标题屏 + 暂停屏两套同步）
    bindSetting(['sens-range', 'sens-range2'], ['sens-value', 'sens-value2'], function (v) { main.sensitivity = parseFloat(v); });
    bindSetting(['radius-range', 'radius-range2'], ['radius-value', 'radius-value2'], function (v) {
      main.radius = parseInt(v, 10);
      main.updateFog();
    });
    bindSetting(['volume-range', 'volume-range2'], ['volume-value', 'volume-value2'], function (v) { MC.Audio.setVolume(parseFloat(v)); });
    bindCheck(['sound-check', 'sound-check2'], function (checked) { MC.Audio.setEnabled(checked); });
    bindCheck(['cycle-check', 'cycle-check2'], function (checked) { if (main.env) main.env.setCycle(checked); });
    bindCheck(['light-check', 'light-check2'], function (checked) { main.setLightFx(checked); });
    bindSelect(['mode-select', 'mode-select2'], function (value) { main.setMode(value); });
  }

  function bindSetting(rangeIds, valIds, fn) {
    const rs = rangeIds.map(function (id) { return document.getElementById(id); });
    const vs = valIds.map(function (id) { return document.getElementById(id); });
    rs.forEach(function (r, i) {
      r.addEventListener('input', function () {
        vs.forEach(function (v) { v.textContent = r.value; });
        rs.forEach(function (o) { if (o !== r) o.value = r.value; });
        fn(r.value);
      });
    });
  }

  function bindCheck(ids, fn) {
    const els = ids.map(function (id) { return document.getElementById(id); });
    els.forEach(function (el, i) {
      el.addEventListener('change', function () {
        els.forEach(function (o) { if (o !== el) o.checked = el.checked; });
        fn(el.checked);
      });
    });
  }

  function bindSelect(ids, fn) {
    const els = ids.map(function (id) { return document.getElementById(id); });
    els.forEach(function (el, i) {
      el.addEventListener('change', function () {
        els.forEach(function (o) { if (o !== el) o.value = el.value; });
        fn(el.value);
      });
    });
  }

  // ---------- F3 ----------
  const debugEl = function () { return document.getElementById('debug'); };
  function updateDebug(text) {
    const el = debugEl();
    if (el) el.textContent = text;
  }
  function setDebugVisible(v) { debugEl().style.display = v ? 'block' : 'none'; }

  return {
    init: init, draw: draw, resize: resize,
    setCrossName: setCrossName,
    openInventory: openInventory, closeInventory: closeInventory,
    isInventoryOpen: isInventoryOpen,
    showTitle: showTitle, showPause: showPause, hideAll: hideAll,
    updateDebug: updateDebug, setDebugVisible: setDebugVisible
  };
})();
