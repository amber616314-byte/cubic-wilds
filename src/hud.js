// Canvas HUD: original widgets.png hotbar, selected-slot highlight, item icons
// cropped from the texture atlas, classic crosshair and F3 debug screen.
import { atlasCanvas, TILE, tiles, blockFaceTiles } from './textures.js';
import { BLOCKS, HOTBAR, BIOME_PLAINS, WATER, LAVA } from './blocks.js';

const ASSET_BASE = new URL('../assets/textures/', import.meta.url).href;

function atlasTileSource(name) {
  if (!tiles.hasOwnProperty(name)) return null;
  const idx = tiles[name];
  return { sx: (idx % 16) * TILE, sy: ((idx / 16) | 0) * TILE };
}

function drawAffineTile(ctx, name, p0, p1, p3) {
  const src = atlasTileSource(name);
  if (!src) return;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.transform(
    (p1.x - p0.x) / TILE,
    (p1.y - p0.y) / TILE,
    (p3.x - p0.x) / TILE,
    (p3.y - p0.y) / TILE,
    p0.x, p0.y,
  );
  ctx.drawImage(atlasCanvas, src.sx, src.sy, TILE, TILE, 0, 0, TILE, TILE);
  ctx.restore();
}

function shadeQuad(ctx, points, alpha) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.fill();
  ctx.restore();
}

// Minecraft-style inventory block icon: top + left + right textured faces.
// Keeping this in Canvas2D makes the HUD crisp and pixel-perfect at any GUI scale.
export function drawBlockIcon(ctx, id, cx, cy, scale = 1, biome = BIOME_PLAINS) {
  const faces = blockFaceTiles(id, biome);
  const def = BLOCKS[id];
  if (!def) return;

  // Plants stay sprite-like in the vanilla inventory instead of becoming cubes.
  if (def.plant) {
    const src = atlasTileSource(faces.side);
    if (!src) return;
    const size = 15 * scale;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(atlasCanvas, src.sx, src.sy, TILE, TILE,
      Math.round(cx - size / 2), Math.round(cy - size / 2), Math.round(size), Math.round(size));
    ctx.restore();
    return;
  }

  const hw = 7.2 * scale;
  const th = 4.2 * scale;
  const sh = 7.4 * scale;
  const top =    { x: cx,      y: cy - th - sh * 0.45 };
  const left =   { x: cx-hw,   y: cy - sh * 0.45 };
  const right =  { x: cx+hw,   y: cy - sh * 0.45 };
  const middle = { x: cx,      y: cy + th - sh * 0.45 };
  const lb =     { x: cx-hw,   y: left.y + sh };
  const rb =     { x: cx+hw,   y: right.y + sh };
  const bottom = { x: cx,      y: middle.y + sh };

  // Draw back-to-front, then apply the same classic per-face shading used by MC icons.
  drawAffineTile(ctx, faces.top, top, right, left);
  drawAffineTile(ctx, faces.side, left, middle, lb);
  drawAffineTile(ctx, faces.side, middle, right, bottom);
  shadeQuad(ctx, [left, middle, bottom, lb], 0.28);
  shadeQuad(ctx, [middle, right, rb, bottom], 0.12);

  // Glass/liquids read better with a subtle bright rim at tiny HUD sizes.
  if (id === WATER || id === LAVA || def.transparent) {
    ctx.save();
    ctx.globalAlpha = 0.30;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(0.6, 0.7 * scale);
    ctx.beginPath();
    ctx.moveTo(top.x, top.y); ctx.lineTo(right.x, right.y); ctx.lineTo(rb.x, rb.y);
    ctx.lineTo(bottom.x, bottom.y); ctx.lineTo(lb.x, lb.y); ctx.lineTo(left.x, left.y); ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}

export function makeBlockIconCanvas(id, size = 32, biome = BIOME_PLAINS) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  drawBlockIcon(ctx, id, size / 2, size / 2 + 1, size / 24, biome);
  return c;
}


function loadImage(path) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(path));
    img.src = ASSET_BASE + path;
  });
}

export class HUD {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.selected = 0;
    this.selectedTimer = 0;
    this.hotbar = [...HOTBAR];
    this.debug = false;
    this.widgets = null;
    this.icons = null;
    this.guiScale = 2;
    this.ready = false;
    this.nameToShow = '';
    this.nameTimer = 0;
    this.health = 20;
    this.hunger = 20;
    this.damageFlash = 0;
  }

  async load() {
    [this.widgets, this.icons] = await Promise.all([
      loadImage('gui/widgets.png'), loadImage('gui/icons.png'),
    ]);
    this.ready = true;
  }

  resize(w, h) {
    this.canvas.width = w * devicePixelRatio;
    this.canvas.height = h * devicePixelRatio;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    this.guiScale = w >= 1600 ? 3 : w >= 900 ? 2 : 1.5;
    this.w = w; this.h = h;
  }

  select(index) {
    this.selected = index;
    this.selectedTimer = 0;
    const id = this.hotbar[index];
    this.nameToShow = BLOCKS[id]?.name || '';
    this.nameTimer = 2.2;
  }

  setHotbar(hotbar) {
    this.hotbar = [...hotbar];
    this.select(this.selected);
  }

  // centre of slot i in widget pixels (0..182)
  slotCenterX(i) { return 11 + i * 20; }

  drawHotbar() {
    const c = this.ctx;
    const s = this.guiScale;
    const w = 182 * s, h = 22 * s;
    const x = (this.w - w) / 2, y = this.h - h - 2 * s;

    c.imageSmoothingEnabled = false;
    c.drawImage(this.widgets, 0, 0, 182, 22, x, y, w, h);

    // selected slot overlay, original 24x24 widget at (0,22)
    const sx = x + this.slotCenterX(this.selected) * s - 12 * s;
    const sy = y - 1 * s;
    c.drawImage(this.widgets, 0, 22, 24, 24, sx, sy, 24 * s, 24 * s);

    // item icons (16x16 atlas tiles, nearest)
    for (let i = 0; i < this.hotbar.length; i++) {
      const id = this.hotbar[i];
      const cx = x + this.slotCenterX(i) * s;
      const cy = y + h / 2 + 0.3 * s;
      drawBlockIcon(c, id, cx, cy, s, BIOME_PLAINS);
    }

    // item name popup (classic fade above the hotbar)
    if (this.nameTimer > 0) {
      c.font = `${16 * s / 2}px "Courier New", monospace`;
      c.textAlign = 'center';
      c.textBaseline = 'bottom';
      const alpha = Math.min(1, this.nameTimer / 0.5);
      c.globalAlpha = alpha;
      c.fillStyle = '#3f3f3f';
      c.fillText(this.nameToShow, this.w / 2 + 2 * s / 8, y - 6 * s + 2 * s / 8);
      c.fillStyle = '#ffffff';
      c.fillText(this.nameToShow, this.w / 2, y - 6 * s);
      c.globalAlpha = 1;
    }
  }

  drawCrosshair() {
    const c = this.ctx, s = this.guiScale;
    const cx = this.w / 2, cy = this.h / 2;
    c.fillStyle = 'rgba(0,0,0,0.75)';
    c.fillRect(cx - 8 * s / 2 - s / 2, cy - s / 2, 9 * s, s);
    c.fillRect(cx - s / 2, cy - 8 * s / 2 - s / 2, s, 9 * s);
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.fillRect(cx - 7 * s / 2, cy - s / 2 + s / 6, 6 * s, s * 0.7);
    c.fillRect(cx - s / 2 + s / 6, cy - 7 * s / 2, s * 0.7, 6 * s);
  }

  drawHearts() {
    if (this.health >= 20) return;
    const c = this.ctx, s = this.guiScale;
    const y = this.h - 30 * s;
    for (let i = 0; i < 10; i++) {
      const x = (this.w - 10 * 8 * s) / 2 + i * 8 * s;
      c.imageSmoothingEnabled = false;
      // container, full, half (1.8 icons.png layout)
      c.drawImage(this.icons, 16, 0, 9, 9, x, y, 9 * s, 9 * s);
      if (this.health >= (i + 1) * 2) c.drawImage(this.icons, 52, 0, 9, 9, x, y, 9 * s, 9 * s);
      else if (this.health === i * 2 + 1) c.drawImage(this.icons, 61, 0, 9, 9, x, y, 9 * s, 9 * s);
    }
  }

  drawDebug(lines) {
    const c = this.ctx;
    c.font = '14px "Courier New", monospace';
    c.textAlign = 'left'; c.textBaseline = 'top';
    const width = 320;
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.fillRect(2, 2, width, 14 + lines.length * 15);
    c.fillStyle = '#ffffff';
    lines.forEach((line, i) => c.fillText(line, 6, 8 + i * 15));
  }

  render(state, info = {}) {
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    if (!this.ready) return;
    c.imageSmoothingEnabled = false;
    if (state === 'playing' || state === 'paused') {
      // subtle cinematic vignette (kept very light so it never obscures play)
      const vg = c.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.42,
                                        this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.20)');
      c.fillStyle = vg;
      c.fillRect(0, 0, this.w, this.h);
    }
    if ((state === 'playing' || state === 'paused') && this.damageFlash > 0.01) {
      c.fillStyle = `rgba(150, 0, 0, ${Math.min(0.45, this.damageFlash * 0.4)})`;
      c.fillRect(0, 0, this.w, this.h);
    }
    if (state === 'playing' || state === 'paused') {
      this.drawCrosshair();
      this.drawHotbar();
      this.drawHearts();
    }
    if (info.debugLines) this.drawDebug(info.debugLines);
    this.nameTimer = Math.max(0, this.nameTimer - (info.dt || 0));
    this.selectedTimer += info.dt || 0;
  }
}
