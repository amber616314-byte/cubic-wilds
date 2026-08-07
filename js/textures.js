// textures.js — 纹理系统：加载官方 PNG → 图集；失败自动程序生成兜底
'use strict';
window.MC = window.MC || {};

MC.Textures = (function () {
  const TEX_FILES = [
    'grass_block_top', 'grass_block_side', 'dirt', 'stone', 'cobblestone',
    'oak_log', 'oak_log_top', 'oak_leaves', 'oak_planks', 'sand', 'gravel',
    'water_still', 'glass', 'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore',
    'redstone_ore', 'bedrock', 'snow', 'grass'
  ];
  // 灰度 tint 模板（Mojang 新版资源：灰度 × 生物群系色 → 最终色）
  const TINT_MAP = {
    grass_block_top: [124, 189, 107],  // 草绿 #7cbd6b
    oak_leaves: [89, 174, 48],         // 橡树叶绿
    grass: [124, 189, 107],            // 高草
    water_still: [63, 118, 228]        // 水蓝
  };
  const SLOT = 18;        // 槽尺寸（16px 纹理 + 1px 边缘 padding x2）
  const PAD = 1;
  const PER_ROW = 12;

  let loaded = {};        // key -> 16x16 canvas（加载成功或程序生成）
  let slotMap = {};       // "blockId:face(0|1|2)" -> 槽索引
  let atlasCanvas = null;
  let atlasTexture = null;
  let crackTextures = [];
  let ready = false;

  // ---------- 程序生成兜底 ----------
  function makeCanvas16() {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    return c;
  }
  function px(ctx, x, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  }
  // 通用噪声填充
  function noiseFill(ctx, seed, colors) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const v = MC.hash2i(x, y, seed);
      let col = colors[0];
      for (let i = 1; i < colors.length; i++) {
        if (v < i / colors.length) { col = colors[i - 1]; break; }
        col = colors[colors.length - 1];
      }
      px(ctx, x, y, col);
    }
  }
  function stoneBase(ctx, seed) {
    noiseFill(ctx, seed, ['#8a8a8a', '#7d7d7d', '#949494', '#838383', '#6f6f6f']);
  }
  function genTexture(key) {
    const c = makeCanvas16();
    const ctx = c.getContext('2d');
    const h = MC.hash2i;
    switch (key) {
      case 'dirt':
        noiseFill(ctx, 11, ['#79553a', '#6b4a33', '#8a6547', '#5f402c', '#7a5b40']);
        break;
      case 'stone':
        stoneBase(ctx, 22);
        // 裂纹
        for (let i = 0; i < 3; i++) {
          let x = 3 + Math.floor(h(i, 7, 5) * 10);
          for (let y = 0; y < 16; y++) { px(ctx, x, y, '#5f5f5f'); x += (h(i, y, 9) > 0.5 ? 1 : -1); if (x < 0 || x > 15) break; }
        }
        break;
      case 'grass_block_top':
        noiseFill(ctx, 33, ['#5fa832', '#6fb63c', '#4f9428', '#7cc244']);
        break;
      case 'grass_block_side':
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
          const v = h(x, y, 44);
          if (y < 10) px(ctx, x, y, v < 0.5 ? '#6fb63c' : '#5fa832');
          else px(ctx, x, y, v < 0.5 ? '#79553a' : '#6b4a33');
        }
        // 过渡
        for (let x = 0; x < 16; x++) px(ctx, x, 9, h(x, 9, 55) < 0.5 ? '#5fa832' : '#6b4a33');
        break;
      case 'cobblestone':
        stoneBase(ctx, 66);
        for (let i = 0; i < 7; i++) {
          const x = Math.floor(h(i, 1, 7) * 14), y = Math.floor(h(i, 2, 7) * 14);
          ctx.strokeStyle = '#565656';
          ctx.beginPath(); ctx.arc(x + 1, y + 1, 2.4, 0, Math.PI * 2); ctx.stroke();
        }
        break;
      case 'oak_log':
        noiseFill(ctx, 77, ['#6e5233', '#7a5c3a', '#63482c', '#82623d']);
        for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) {
          if (x % 4 === 0) px(ctx, x, y, '#4e3820');
        }
        break;
      case 'oak_log_top':
        noiseFill(ctx, 88, ['#6e5233', '#7a5c3a']);
        for (let r = 2; r < 8; r++) {
          ctx.strokeStyle = r % 2 === 0 ? '#4e3820' : '#8a6a44';
          ctx.beginPath(); ctx.arc(7.5, 7.5, r, 0, Math.PI * 2); ctx.stroke();
        }
        break;
      case 'oak_leaves':
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
          const v = h(x, y, 99);
          if (v < 0.22) continue; // 透明洞
          px(ctx, x, y, v < 0.5 ? '#3f7d20' : v < 0.75 ? '#4c8f27' : '#35691b');
        }
        break;
      case 'oak_planks':
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
          const v = h(x, y, 111);
          const row = Math.floor(y / 4);
          const base = ['#a98f5e', '#9d8352', '#b39a68', '#8f7546'][row];
          px(ctx, x, y, v < 0.4 ? base : v < 0.7 ? shade(base, -12) : shade(base, 10));
        }
        break;
      case 'sand':
        noiseFill(ctx, 122, ['#dbd3a0', '#c8bf8b', '#e6deb0', '#d2c99a']);
        break;
      case 'gravel':
        noiseFill(ctx, 133, ['#8b8070', '#766c5e', '#9a8f7d', '#6a6153', '#857b6b']);
        break;
      case 'water_still':
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
          const v = h(x, y, 144);
          const wave = Math.sin(x * 0.9 + y * 0.5) * 0.5 + 0.5;
          const light = Math.floor(90 + wave * 40 + v * 30);
          px(ctx, x, y, 'rgb(50,' + (70 + wave * 60) + ',' + (150 + wave * 50) + ')');
        }
        break;
      case 'glass':
        ctx.clearRect(0, 0, 16, 16);
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.strokeRect(0.5, 0.5, 15, 15);
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(2, 2, 12, 12);
        break;
      case 'coal_ore': stoneBase(ctx, 155); oreSpots(ctx, 166, '#2b2b2b', 4); break;
      case 'iron_ore': stoneBase(ctx, 177); oreSpots(ctx, 188, '#d8af93', 4); break;
      case 'gold_ore': stoneBase(ctx, 199); oreSpots(ctx, 200, '#fcee4b', 4); break;
      case 'diamond_ore': stoneBase(ctx, 211); oreSpots(ctx, 222, '#4aedd9', 4); break;
      case 'redstone_ore': stoneBase(ctx, 233); oreSpots(ctx, 244, '#ff3a2f', 4); break;
      case 'bedrock':
        noiseFill(ctx, 255, ['#3a3a3a', '#2c2c2c', '#464646', '#202020']);
        break;
      case 'snow':
        noiseFill(ctx, 266, ['#f6f9f6', '#eef4ee', '#ffffff']);
        break;
      case 'grass': {
        ctx.clearRect(0, 0, 16, 16);
        for (let i = 0; i < 24; i++) {
          const x = Math.floor(h(i, 1, 277) * 16);
          const len = 4 + Math.floor(h(i, 2, 277) * 10);
          ctx.strokeStyle = h(i, 3, 277) < 0.5 ? '#4c8f27' : '#5fa832';
          ctx.beginPath(); ctx.moveTo(x + 0.5, 16);
          ctx.lineTo(x + 0.5 + (h(i, 4, 277) - 0.5) * 3, 16 - len);
          ctx.stroke();
        }
        break;
      }
      default:
        noiseFill(ctx, 1, ['#808080']);
    }
    return c;
  }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, (n >> 16) + amt));
    const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
    const b = Math.max(0, Math.min(255, (n & 255) + amt));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  function oreSpots(ctx, seed, color, count) {
    for (let i = 0; i < count; i++) {
      const x = Math.floor(MC.hash2i(i, 1, seed) * 14), y = Math.floor(MC.hash2i(i, 2, seed) * 14);
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 2, 2);
    }
  }

  // 对灰度 tint 模板应用生物群系色（仅当纹理确实是灰度时）
  function applyTint(key, canvas) {
    const tint = TINT_MAP[key];
    if (!tint) return canvas;
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, 16, 16);
    const d = img.data;
    let grayPct = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (Math.abs(r - g) < 6 && Math.abs(g - b) < 6) grayPct++;
    }
    if (grayPct / (d.length / 4) < 0.9) return canvas; // 已是彩色（如程序生成兜底）
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
      d[i] = Math.min(255, Math.round(l * tint[0] / 255));
      d[i + 1] = Math.min(255, Math.round(l * tint[1] / 255));
      d[i + 2] = Math.min(255, Math.round(l * tint[2] / 255));
      // alpha 保留
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  // ---------- 加载 ----------
  function imgToCanvas(img) {
    const c = makeCanvas16();
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, 16, 16);
    return c;
  }
  // 18x18：16px + 复制边缘 1px（防 mipmap 渗色）
  function padCanvas(src) {
    const c = document.createElement('canvas');
    c.width = c.height = SLOT;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, PAD, PAD);
    // 四边复制
    for (let i = 0; i < 16; i++) {
      ctx.drawImage(src, i, 0, 1, 1, i + PAD, 0, 1, 1);           // 上
      ctx.drawImage(src, i, 15, 1, 1, i + PAD, 17, 1, 1);         // 下
      ctx.drawImage(src, 0, i, 1, 1, 0, i + PAD, 1, 1);           // 左
      ctx.drawImage(src, 15, i, 1, 1, 17, i + PAD, 1, 1);         // 右
    }
    // 四角
    ctx.drawImage(src, 0, 0, 1, 1, 0, 0, 1, 1);
    ctx.drawImage(src, 15, 0, 1, 1, 17, 0, 1, 1);
    ctx.drawImage(src, 0, 15, 1, 1, 0, 17, 1, 1);
    ctx.drawImage(src, 15, 15, 1, 1, 17, 17, 1, 1);
    return c;
  }
  function buildAtlas() {
    // 分配槽：相同 tex key 共享
    const slots = [];
    const slotIndex = {};
    MC.BLOCKS.forEach(function (b) {
      if (b.id === 0) return;
      ['top', 'side', 'bottom'].forEach(function (face, fi) {
        const key = b.tex[face];
        if (!key || key === 'air') return;
        const mapKey = b.id + ':' + fi;
        if (slotIndex[key] !== undefined) {
          slotMap[mapKey] = slotIndex[key];
        } else {
          const idx = slots.length;
          slots.push({ key: key, canvas: loaded[key] || genTexture(key) });
          slotIndex[key] = idx;
          slotMap[mapKey] = idx;
        }
      });
    });
    const rows = Math.ceil(slots.length / PER_ROW);
    atlasCanvas = document.createElement('canvas');
    atlasCanvas.width = PER_ROW * SLOT;
    atlasCanvas.height = rows * SLOT;
    const ctx = atlasCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    slots.forEach(function (s, i) {
      ctx.drawImage(padCanvas(s.canvas), (i % PER_ROW) * SLOT, Math.floor(i / PER_ROW) * SLOT);
    });
    atlasTexture = new THREE.CanvasTexture(atlasCanvas);
    atlasTexture.magFilter = THREE.NearestFilter;
    atlasTexture.minFilter = THREE.LinearMipmapLinearFilter;
    atlasTexture.generateMipmaps = true;
    atlasTexture.wrapS = atlasTexture.wrapT = THREE.ClampToEdgeWrapping;
    atlasTexture.needsUpdate = true;
    // 裂纹材质
    crackTextures = [];
    for (let i = 0; i < 10; i++) {
      const key = 'destroy_stage_' + i;
      const canvas = loaded[key] || genCrackFallback(i);
      const t = new THREE.CanvasTexture(canvas);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.needsUpdate = true;
      crackTextures.push(t);
    }
    ready = true;
  }
  function genCrackFallback(stage) {
    const c = makeCanvas16();
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 16, 16);
    const n = Math.floor(3 + stage * 1.1);
    for (let i = 0; i < n; i++) {
      let x = Math.floor(MC.hash2i(i, 1, stage + 300) * 16);
      let y = 0;
      ctx.strokeStyle = 'rgba(0,0,0,' + (0.25 + stage * 0.07) + ')';
      ctx.beginPath(); ctx.moveTo(x + 0.5, y + 0.5);
      while (y < 15) {
        y += 1 + Math.floor(MC.hash2i(i, y, stage + 301) * 3);
        x += Math.floor(MC.hash2i(i, y, stage + 302) * 3) - 1;
        if (x < 0) x = 0; if (x > 15) x = 15;
        ctx.lineTo(x + 0.5, y + 0.5);
      }
      ctx.stroke();
    }
    return c;
  }

  function load(onDone) {
    const all = TEX_FILES.concat(Array.from({ length: 10 }, function (_, i) { return 'destroy_stage_' + i; }));
    let remaining = all.length;
    let failed = false;
    function loadOne(key) {
      const img = new Image();
      img.onload = function () {
        const c = imgToCanvas(img);
        // 检测 canvas 污染（file:// 协议下 Chrome 会 taint）
        try {
          c.getContext('2d').getImageData(0, 0, 1, 1);
          loaded[key] = applyTint(key, c);
        } catch (e) {
          failed = true;
          loaded[key] = null;
        }
        done();
      };
      img.onerror = function () { failed = true; loaded[key] = null; done(); };
      img.src = 'assets/textures/' + key + '.png';
    }
    function done() {
      if (--remaining === 0) {
        if (failed && window.MC && MC.TEXTURE_DATA) {
          // 文件加载失败/被污染 → 用内嵌 base64 重载
          loaded = {};
          remaining = all.length;
          failed = false;
          all.forEach(function (key) {
            const data = MC.TEXTURE_DATA[key];
            if (!data) { loaded[key] = genTexture(key); done(); return; }
            const img = new Image();
            img.onload = function () {
              const c = imgToCanvas(img);
              try { c.getContext('2d').getImageData(0, 0, 1, 1); loaded[key] = applyTint(key, c); } catch (e) { loaded[key] = genTexture(key); }
              done();
            };
            img.onerror = function () { loaded[key] = genTexture(key); done(); };
            img.src = 'data:image/png;base64,' + data;
          });
          return;
        }
        // 个别失败的用程序生成兜底
        all.forEach(function (key) { if (!loaded[key]) loaded[key] = genTexture(key); });
        buildAtlas();
        onDone();
      }
    }
    all.forEach(loadOne);
  }

  function uvOf(slot) {
    const col = slot % PER_ROW, row = Math.floor(slot / PER_ROW);
    const w = atlasCanvas.width, h = atlasCanvas.height;
    return {
      u0: (col * SLOT + PAD) / w,
      v0: 1 - (row * SLOT + PAD + 16) / h,
      u1: (col * SLOT + PAD + 16) / w,
      v1: 1 - (row * SLOT + PAD) / h
    };
  }
  function slotOf(blockId, face) { // face: 0 top 1 side 2 bottom
    return slotMap[blockId + ':' + face];
  }

  // 把 BoxGeometry 六面 UV 设为方块对应面（面顺序 +X,-X,+Y,-Y,+Z,-Z）
  MC.setBoxFaceUV = function (geo, blockId) {
    const uv = geo.getAttribute('uv');
    const faceSlots = [1, 1, 0, 2, 1, 1];
    for (let f = 0; f < 6; f++) {
      const slot = slotOf(blockId, faceSlots[f]);
      if (slot === undefined) continue;
      const r = uvOf(slot);
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        const a = uv.getX(i) >= 0.5 ? 1 : 0;
        const b = uv.getY(i) >= 0.5 ? 1 : 0;
        uv.setXY(i, r.u0 + a * (r.u1 - r.u0), r.v0 + b * (r.v1 - r.v0));
      }
    }
    uv.needsUpdate = true;
  };

  return {
    load: load,
    get ready() { return ready; },
    get atlasTexture() { return atlasTexture; },
    get atlasCanvas() { return atlasCanvas; },
    get crackTextures() { return crackTextures; },
    uvOf: uvOf,
    slotOf: slotOf,
    getTexture: function (key) { return loaded[key]; }
  };
})();
