// Texture pipeline.  All original 1.8.8 PNG files are packed into a single
// 1024x1024 atlas (NearestFilter, no mipmaps) exactly like classic MC's
// texture atlas, with biome-tinted variants pre-baked for grass / foliage.
import * as THREE from 'three';
import {
  BIOME_PLAINS, BIOME_TINTS, WATER, LAVA,
} from './blocks.js';

const ASSET_BASE = new URL('../assets/textures/', import.meta.url).href;
export const TILE = 64;       // atlas pixels per tile
export const ATLAS_SIZE = 1024;
const COLS = ATLAS_SIZE / TILE; // 16

const imgCache = new Map();
export async function loadImage(path) {
  if (imgCache.has(path)) return imgCache.get(path);
  const url = ASSET_BASE + path;
  const promise = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load ' + url));
    img.src = url;
  });
  imgCache.set(path, promise);
  return promise;
}

function tintImage(src, tint, onlyGreen = false) {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0, 16, 16);
  const data = ctx.getImageData(0, 0, 16, 16);
  const p = data.data;
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3] === 0) continue;
    if (onlyGreen) {
      const r = p[i], g = p[i + 1], b = p[i + 2];
      if (!(g > r + 12 && g > b + 8)) continue;
      p[i]     = Math.min(255, r * (tint[0] / 125));
      p[i + 1] = Math.min(255, g * (tint[1] / 185));
      p[i + 2] = Math.min(255, b * (tint[2] / 82));
    } else {
      p[i]     = Math.min(255, p[i]     * (tint[0] / 148));
      p[i + 1] = Math.min(255, p[i + 1] * (tint[1] / 148));
      p[i + 2] = Math.min(255, p[i + 2] * (tint[2] / 148));
    }
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

// atlas tile name -> [col,row]
export const tiles = {};
const tileOrder = [];
function addTile(name) {
  const idx = tileOrder.length;
  tiles[name] = idx;
  tileOrder.push(name);
}

// fixed tiles
for (const name of [
  'stone', 'dirt', 'cobblestone', 'planks', 'bedrock', 'sand', 'gravel',
  'brick', 'obsidian', 'glass', 'snow', 'water', 'lava', 'stonebrick',
  'log_oak_side', 'log_oak_top', 'log_birch_side', 'log_birch_top',
  'log_spruce_side', 'log_spruce_top',
  'crafting_top', 'crafting_side', 'sandstone_side', 'sandstone_top',
  'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'redstone_ore',
  'flower_rose', 'flower_dandelion', 'particle',
]) addTile(name);

const biomeTiles = {};
for (const biome of Object.keys(BIOME_TINTS).map(Number)) {
  biomeTiles[biome] = {};
  for (const n of ['grass_top', 'grass_side', 'tallgrass']) {
    biomeTiles[biome][n] = `${n}_${biome}`;
    addTile(biomeTiles[biome][n]);
  }
  for (const leaf of ['leaves_oak', 'leaves_birch', 'leaves_spruce']) {
    biomeTiles[biome][leaf] = `${leaf}_${biome}`;
    addTile(biomeTiles[biome][leaf]);
  }
}
for (let i = 0; i < 10; i++) addTile(`destroy_${i}`);

export const atlasCanvas = document.createElement('canvas');
atlasCanvas.width = ATLAS_SIZE; atlasCanvas.height = ATLAS_SIZE;
const actx = atlasCanvas.getContext('2d');
actx.imageSmoothingEnabled = false;

function drawTileAt(name, img, sx = 0, sy = 0, sw = 16, sh = 16) {
  const idx = tiles[name];
  const col = idx % COLS, row = (idx / COLS) | 0;
  actx.drawImage(img, sx, sy, sw, sh, col * TILE, row * TILE, TILE, TILE);
}

// Used by the mesher: resolve the atlas tile for every face of a block.
export function blockFaceTiles(id, biome = BIOME_PLAINS) {
  const b = biomeTiles[biome] || biomeTiles[BIOME_PLAINS];
  switch (id) {
    case 1: return { top: 'stone', bottom: 'stone', side: 'stone' };
    case 2: return { top: b.grass_top, bottom: 'dirt', side: b.grass_side };
    case 3: return { top: 'dirt', bottom: 'dirt', side: 'dirt' };
    case 4: return { top: 'cobblestone', bottom: 'cobblestone', side: 'cobblestone' };
    case 5: return { top: 'planks', bottom: 'planks', side: 'planks' };
    case 7: return { top: 'bedrock', bottom: 'bedrock', side: 'bedrock' };
    case 12: return { top: 'sand', bottom: 'sand', side: 'sand' };
    case 13: return { top: 'gravel', bottom: 'gravel', side: 'gravel' };
    case 14: return { top: 'gold_ore', bottom: 'gold_ore', side: 'gold_ore' };
    case 15: return { top: 'iron_ore', bottom: 'iron_ore', side: 'iron_ore' };
    case 16: return { top: 'coal_ore', bottom: 'coal_ore', side: 'coal_ore' };
    case 17: return { top: 'log_oak_top', bottom: 'log_oak_top', side: 'log_oak_side' };
    case 18: return { top: b.leaves_oak, bottom: b.leaves_oak, side: b.leaves_oak };
    case 20: return { top: 'glass', bottom: 'glass', side: 'glass' };
    case 24: return { top: 'sandstone_top', bottom: 'sandstone_top', side: 'sandstone_side' };
    case 31: return { top: b.tallgrass, bottom: b.tallgrass, side: b.tallgrass };
    case 37: return { top: 'flower_dandelion', bottom: 'flower_dandelion', side: 'flower_dandelion' };
    case 38: return { top: 'flower_rose', bottom: 'flower_rose', side: 'flower_rose' };
    case 45: return { top: 'brick', bottom: 'brick', side: 'brick' };
    case 49: return { top: 'obsidian', bottom: 'obsidian', side: 'obsidian' };
    case 56: return { top: 'diamond_ore', bottom: 'diamond_ore', side: 'diamond_ore' };
    case 58: return { top: 'crafting_top', bottom: 'planks', side: 'crafting_side' };
    case 73: return { top: 'redstone_ore', bottom: 'redstone_ore', side: 'redstone_ore' };
    case 78: return { top: 'snow', bottom: 'snow', side: 'snow' };
    case 8: return { top: 'water', bottom: 'water', side: 'water' };
    case 10: return { top: 'lava', bottom: 'lava', side: 'lava' };
    case 98: return { top: 'stonebrick', bottom: 'stonebrick', side: 'stonebrick' };
    case 101: return { top: 'log_birch_top', bottom: 'log_birch_top', side: 'log_birch_side' };
    case 102: return { top: 'log_spruce_top', bottom: 'log_spruce_top', side: 'log_spruce_side' };
    case 103: return { top: b.leaves_birch, bottom: b.leaves_birch, side: b.leaves_birch };
    case 104: return { top: b.leaves_spruce, bottom: b.leaves_spruce, side: b.leaves_spruce };
    default: return { top: 'stone', bottom: 'stone', side: 'stone' };
  }
}

export function tileNameToIndex(name) { return tiles[name]; }

// Convert a 0..1 UV inside a tile into atlas UV space.
export function tileUV(name, u, v) {
  const idx = tiles[name];
  const col = idx % COLS, row = (idx / COLS) | 0;
  const px = col * TILE + 0.5 + u * (TILE - 1);
  // v=1 must sample the top texel row of the tile (the canvas is uploaded
  // with flipY, so the atlas v coordinate is 1 - pixelY / height).
  const py = row * TILE + 0.5 + (1 - v) * (TILE - 1);
  return [px / ATLAS_SIZE, 1 - py / ATLAS_SIZE];
}

let atlasTexture = null;
export function getAtlasTexture() { return atlasTexture; }

export async function buildAtlas() {
  const files = {
    stone: 'blocks/stone.png', dirt: 'blocks/dirt.png', cobblestone: 'blocks/cobblestone.png',
    stonebrick: 'blocks/stonebrick.png',
    planks: 'blocks/planks_oak.png', bedrock: 'blocks/bedrock.png', sand: 'blocks/sand.png',
    gravel: 'blocks/gravel.png', brick: 'blocks/brick.png', obsidian: 'blocks/obsidian.png',
    glass: 'blocks/glass.png', snow: 'blocks/snow.png',
    log_oak_side: 'blocks/log_oak.png', log_oak_top: 'blocks/log_oak_top.png',
    log_birch_side: 'blocks/log_birch.png', log_birch_top: 'blocks/log_birch_top.png',
    log_spruce_side: 'blocks/log_spruce.png', log_spruce_top: 'blocks/log_spruce_top.png',
    crafting_top: 'blocks/crafting_table_top.png', crafting_side: 'blocks/crafting_table_side.png',
    sandstone_side: 'blocks/sandstone_normal.png', sandstone_top: 'blocks/sandstone_top.png',
    coal_ore: 'blocks/coal_ore.png', iron_ore: 'blocks/iron_ore.png', gold_ore: 'blocks/gold_ore.png',
    diamond_ore: 'blocks/diamond_ore.png', redstone_ore: 'blocks/redstone_ore.png',
    flower_rose: 'blocks/flower_rose.png', flower_dandelion: 'blocks/flower_dandelion.png',
    particle: 'particle/particles.png',
    water: 'blocks/water_still.png', lava: 'blocks/lava_still.png',
  };
  const images = {};
  await Promise.all(Object.entries(files).map(async ([name, path]) => {
    images[name] = await loadImage(path);
  }));
  const grassTop = await loadImage('blocks/grass_top.png');
  const grassSide = await loadImage('blocks/grass_side.png');
  const tallgrass = await loadImage('blocks/tallgrass.png');
  const leavesOak = await loadImage('blocks/leaves_oak.png');
  const leavesBirch = await loadImage('blocks/leaves_birch.png');
  const leavesSpruce = await loadImage('blocks/leaves_spruce.png');
  const destroyImgs = await Promise.all(
    Array.from({ length: 10 }, (_, i) => loadImage(`blocks/destroy_stage_${i}.png`))
  );

  actx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  for (const [name, img] of Object.entries(images)) {
    if (name === 'particle') {
      // keep particles available, draw whole 128x128 sheet into the tile
      drawTileAt(name, img, 0, 0, img.width, img.height);
    } else {
      drawTileAt(name, img);
    }
  }
  for (const biome of Object.keys(BIOME_TINTS).map(Number)) {
    const t = BIOME_TINTS[biome];
    drawTileAt(biomeTiles[biome].grass_top, tintImage(grassTop, t.grass));
    drawTileAt(biomeTiles[biome].grass_side, tintImage(grassSide, t.grass, true));
    drawTileAt(biomeTiles[biome].tallgrass, tintImage(tallgrass, t.grass));
    drawTileAt(biomeTiles[biome].leaves_oak, tintImage(leavesOak, t.foliage));
    drawTileAt(biomeTiles[biome].leaves_birch, tintImage(leavesBirch, t.foliage));
    drawTileAt(biomeTiles[biome].leaves_spruce, tintImage(leavesSpruce, t.foliage));
  }
  destroyImgs.forEach((img, i) => drawTileAt(`destroy_${i}`, img));

  atlasTexture = new THREE.CanvasTexture(atlasCanvas);
  atlasTexture.magFilter = THREE.NearestFilter;
  atlasTexture.minFilter = THREE.NearestFilter;
  atlasTexture.generateMipmaps = false;
  atlasTexture.colorSpace = THREE.SRGBColorSpace;
  atlasTexture.needsUpdate = true;
  return atlasTexture;
}

// Animated classic liquids.  The vanilla sheets do NOT all contain 32
// frames: water_still=32, water_flow=32, lava_still=20 and lava_flow=16 in
// this 1.8.8 resource set.  Derive frame count from the sheet dimensions so
// lava is not vertically squashed / sampling half-frames.
function animatedSheetTexture(img) {
  const frameSize = img.width; // every liquid frame is square
  const frames = Math.max(1, Math.floor(img.height / frameSize));
  const tex = new THREE.CanvasTexture(img);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1 / frames);
  tex.offset.set(0, 1 - 1 / frames);
  tex.userData.frameCount = frames;
  tex.needsUpdate = true;
  return tex;
}

export async function createLiquidTextures() {
  const [waterStill, waterFlow, lavaStill, lavaFlow] = await Promise.all([
    loadImage('blocks/water_still.png'),
    loadImage('blocks/water_flow.png'),
    loadImage('blocks/lava_still.png'),
    loadImage('blocks/lava_flow.png'),
  ]);
  return {
    waterStill: animatedSheetTexture(waterStill),
    waterFlow: animatedSheetTexture(waterFlow),
    lavaStill: animatedSheetTexture(lavaStill),
    lavaFlow: animatedSheetTexture(lavaFlow),
  };
}

export function updateLiquidAnimation(tex, t, speed = 1) {
  if (!tex) return;
  const frames = tex.userData.frameCount || 1;
  const frame = Math.floor(t * 20 * speed) % frames;
  tex.offset.y = 1 - 1 / frames - frame / frames;
}

// Small 16x16 icon texture cropped from the atlas (used by break particles
// and the creative block picker).
const tileCanvasCache = new Map();
export function tileCanvas(name) {
  if (tileCanvasCache.has(name)) return tileCanvasCache.get(name);
  const idx = tiles[name];
  const col = idx % COLS, row = (idx / COLS) | 0;
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(atlasCanvas, col * TILE, row * TILE, TILE, TILE, 0, 0, 16, 16);
  tileCanvasCache.set(name, c);
  return c;
}

export function tileTexture(name) {
  const tex = new THREE.CanvasTexture(tileCanvas(name));
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function biomeAt(biome) { return biomeTiles[biome] || biomeTiles[BIOME_PLAINS]; }

// atlas texture with a crop, for the first-person held cube
export function croppedAtlasTexture(name) {
  const idx = tiles[name];
  const col = idx % COLS, row = (idx / COLS) | 0;
  const tex = atlasTexture.clone();
  tex.repeat.set(TILE / ATLAS_SIZE, TILE / ATLAS_SIZE);
  tex.offset.set(col * TILE / ATLAS_SIZE, 1 - (row + 1) * TILE / ATLAS_SIZE);
  tex.needsUpdate = true;
  return tex;
}
