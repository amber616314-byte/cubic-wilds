import * as THREE from 'three';
import {
  buildAtlas, createLiquidTextures, updateLiquidAnimation, loadImage,
  tiles, blockFaceTiles, tileCanvas, getAtlasTexture,
} from './textures.js';
import { World } from './world.js';
import { buildChunkGeometry } from './mesher.js';
import { Player, raycastVoxel, playerAABBIntersectsBlock } from './player.js';
import { AudioManager } from './audio.js';
import { HUD, makeBlockIconCanvas } from './hud.js';
import { ParticleSystem } from './particles.js';
import { DroppedItemSystem } from './dropped_items.js';
import { FluidSystem } from './fluids.js';
import { buildPlayerModel, buildHeldBlock, buildFirstPersonArm } from './skin.js';
import {
  AIR, WATER, LAVA, BLOCKS, HOTBAR, CREATIVE_BLOCKS, CHUNK_SIZE, WORLD_HEIGHT,
  BIOME_OCEAN, BIOME_DEEP_OCEAN, BIOME_RIVER, biomeName, blockName, blockDrop, isSolid,
} from './blocks.js';

// ------------------------------------------------------------------ globals
const canvas = document.getElementById('game');
const hudCanvas = document.getElementById('hud');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;

const scene = new THREE.Scene();
const SKY = new THREE.Color(0x7fa8ff);
const FOG = new THREE.Color(0xa9c8ef);
scene.background = SKY;
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 1500);
// The first-person hand/item are children of the camera, so the camera itself
// must live in the scene graph or those children are never traversed/rendered.
scene.add(camera);

// title panorama scene
const titleScene = new THREE.Scene();
titleScene.background = new THREE.Color(0x000000);
const titleCamera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 500);
let panoramaCube = null;

const audio = new AudioManager();
const hud = new HUD(hudCanvas);
const particles = new ParticleSystem(scene);
const droppedItems = new DroppedItemSystem(scene);
let fluidSystem = null;

const settings = {
  renderDistance: 4, fov: 70, sensitivity: 1.0, volume: 0.7, music: true,
  creative: true,
};
try {
  Object.assign(settings, JSON.parse(localStorage.getItem('voxelcraft-reborn-settings') || localStorage.getItem('mc-web-settings') || '{}'));
} catch (e) { /* ignore */ }

let world = null;
let player = null;
let gameModeCreative = settings.creative;
let hotbar = [...HOTBAR];
let spawnPoint = { x: 8, y: 70, z: 8 };
let playerModel = null;
let firstPersonArm = null;
let heldBlock = null;
let viewMode = 0;
let walkTime = 0;
let armSwing = 0;
let state = 'title';        // title | loading | playing | paused | picker
let started = false;
let titleT = 0;
let liquidT = 0;

// interaction
const keys = new Set();
const mouse = { left: false, right: false, middle: false };
let mouseDX = 0, mouseDY = 0;
let target = null;
let mining = null;
let digCooldown = 0, placeCooldown = 0;
let hurtCooldown = 0;
let damageFlash = 0;
let health = 20;
let swimTimer = 0;
let liquidAmbientTimer = 0;
let splashCooldown = 0;
let wasInWater = false;
let saveTimer = 0;
let worldReady = false;

// scene bits
let cloudMesh = null, cloudTime = 0, cloudPeriod = 768;
let skyMesh = null, skyTex = null, sunGlow = null, sunLight = null, hemiLight = null;
const SUN_DIR = new THREE.Vector3(0.42, 0.58, -0.70).normalize();

// Minecraft 1.8-style first-person display transform.  Keeping these values
// together makes the view-model easy to tune against reference screenshots.
const FP_ITEM = Object.freeze({
  x: 0.56, y: -0.52, z: -0.72,
  scale: 0.40,
  yaw: Math.PI / 4,
});
const FP_ARM = Object.freeze({
  x: 0.58, y: -0.44, z: -0.79,
  pitch: -0.48,
  yaw: 0.12,
  roll: 0.42,
});
let highlightBox = null;
let crackMeshes = [];
const crackTintCache = new Map();
let atlasMaterial, cutoutMaterial, plantMaterial, glassMaterial, waterStillMaterial, waterFlowMaterial, lavaStillMaterial, lavaFlowMaterial, cutoutDepthMaterial;
let liquidTextures = null;

const $ = id => document.getElementById(id);
const titleScreen = $('title-screen'), loadingScreen = $('loading-screen');
const pauseScreen = $('pause-screen'), optionsScreen = $('options-screen');
const pickerScreen = $('picker-screen'), pickerPanel = $('picker-panel');
const btnPlay = $('btn-play');

// ------------------------------------------------------------------ input
function onKeyDown(e) {
  // F5 is a browser shortcut.  Prevent it even before repeat handling so the
  // game can own all three Minecraft camera modes without reloading the page.
  if (e.code === 'F5') {
    e.preventDefault();
    if (!e.repeat && state === 'playing') {
      viewMode = (viewMode + 1) % 3;
      audio.playClick();
    }
    return;
  }
  if (e.repeat) { keys.add(e.code); return; }
  keys.add(e.code);
  if (e.code === 'F3') { e.preventDefault(); hud.debug = !hud.debug; }
  if (e.code === 'KeyG' && state === 'playing') {
    gameModeCreative = !gameModeCreative;
    if (player && !gameModeCreative) player.flying = false;
    audio.playClick();
  }
  if (e.code === 'KeyE' && state === 'playing') openPicker();
  if (e.code === 'Escape') {
    if (state === 'picker') closePicker(false);
    else if (state === 'paused') resumeGame();
    else if (state === 'playing') { document.exitPointerLock(); }
  }
  if (/^Digit[1-9]$/.test(e.code) && (state === 'playing')) {
    selectSlot(Number(e.code.slice(5)) - 1);
  }
}
function onKeyUp(e) { keys.delete(e.code); }

function onMouseMove(e) {
  if (document.pointerLockElement === canvas && (state === 'playing')) {
    mouseDX += e.movementX; mouseDY += e.movementY;
  }
}
function onMouseDown(e) {
  if (document.pointerLockElement !== canvas || state !== 'playing') return;
  if (e.button === 0) mouse.left = true;
  else if (e.button === 1) { e.preventDefault(); pickTargetBlock(); }
  else if (e.button === 2) mouse.right = true;
}
function onMouseUp(e) {
  if (e.button === 0) mouse.left = false;
  else if (e.button === 2) mouse.right = false;
}
function onWheel(e) {
  if (state !== 'playing') return;
  const dir = Math.sign(e.deltaY) || (e.deltaY > 0 ? 1 : -1);
  selectSlot((hud.selected + dir + hotbar.length) % hotbar.length);
}
function onContext(e) { e.preventDefault(); }

function onPointerLockChange() {
  const locked = document.pointerLockElement === canvas;
  if (!locked && state === 'playing') pauseGame();
  else if (!locked && state === 'loading' && started) {
    loadingText.textContent = '点击画面继续';
  }
}
function onPointerLockError() {
  if (state === 'loading' || state === 'playing') {
    loadingText.textContent = '浏览器拒绝了指针锁定，请点击画面后重试';
  }
}
function onClickCanvas() {
  audio.unlock();
  if (state === 'playing' && document.pointerLockElement !== canvas) {
    canvas.requestPointerLock();
  } else if (state === 'loading' && started) {
    canvas.requestPointerLock();
  }
}

const loadingText = $('loading-text');
function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

document.addEventListener('keydown', onKeyDown);
document.addEventListener('keyup', onKeyUp);
document.addEventListener('mousemove', onMouseMove);
document.addEventListener('mousedown', onMouseDown);
document.addEventListener('mouseup', onMouseUp);
document.addEventListener('wheel', onWheel, { passive: false });
document.addEventListener('contextmenu', onContext);
document.addEventListener('pointerlockchange', onPointerLockChange);
document.addEventListener('pointerlockerror', onPointerLockError);
canvas.addEventListener('click', onClickCanvas);

// ------------------------------------------------------------------ UI
function selectSlot(i) {
  hud.select(i);
  refreshHeldBlock();
  if (state === 'playing') audio.playPop();
}
function refreshHeldBlock() {
  if (!firstPersonArm) return;
  const old = heldBlock;
  if (old) firstPersonArm.itemPivot.remove(old);
  heldBlock = buildHeldBlock(hotbar[hud.selected]);
  firstPersonArm.itemPivot.add(heldBlock);
  if (playerModel) {
    // Third-person uses its own much smaller transform.  Do not reuse the
    // first-person 0.4-scale presentation cube directly at full unit size.
    if (playerModel.heldItem) playerModel.rightArmPivot.remove(playerModel.heldItem);
    const item = buildHeldBlock(hotbar[hud.selected]);
    item.position.set(0.03, -0.58, -0.02);
    item.rotation.set(0.18, -0.72, 0.10);
    item.scale.setScalar(0.28);
    playerModel.rightArmPivot.add(item);
    playerModel.heldItem = item;
  }
}

function pauseGame() {
  if (state !== 'playing') return;
  state = 'paused';
  mouse.left = mouse.right = false;
  show(pauseScreen);
}
function resumeGame() {
  hide(pauseScreen);
  state = 'playing';
  audio.unlock();
  canvas.requestPointerLock();
}
function quitToTitle() {
  saveGame();
  hide(pauseScreen); hide(optionsScreen); hide(pickerScreen);
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  state = 'title';
  started = false;
  show(titleScreen);
  audio.startMenuMusic();
}
function openOptions() { hide(pauseScreen); show(optionsScreen); }
function closeOptions() { hide(optionsScreen); show(pauseScreen); }

function openPicker() {
  if (!pickerPanel.dataset.built) buildPicker();
  state = 'picker';
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  show(pickerScreen);
  hide(pauseScreen);
}
function closePicker(relock = true) {
  hide(pickerScreen);
  state = 'playing';
  if (relock) canvas.requestPointerLock();
}

function buildPicker() {
  pickerPanel.innerHTML = '';
  for (const id of CREATIVE_BLOCKS) {
    const cell = document.createElement('div');
    cell.className = 'pick-cell';
    const icon = makeBlockIconCanvas(id, 36);
    icon.className = 'pick-icon';
    const label = document.createElement('span'); label.textContent = blockName(id);
    cell.append(icon, label);
    cell.onclick = () => {
      hotbar[hud.selected] = id;
      // HUD owns its own hotbar copy.  Keep it synchronized immediately so
      // the selected slot icon changes together with the actual placed block.
      hud.setHotbar(hotbar);
      refreshHeldBlock();
      closePicker(true);
      audio.playPop();
    };
    pickerPanel.appendChild(cell);
  }
  pickerPanel.dataset.built = '1';
}

// ------------------------------------------------------------------ world / chunks
function readSave() {
  try { return JSON.parse(localStorage.getItem('voxelcraft-reborn-save') || localStorage.getItem('mc-web-save') || 'null'); }
  catch (e) { return null; }
}

function createWorld(seed) {
  world = new World(seed);
  const saved = readSave();
  if (saved && [2, 3, 4].includes(saved.gen) && saved.seed === seed) world.loadEdits(saved);
  fluidSystem = new FluidSystem(world, audio, (x, y, z) => particles.spawnSteam(x, y, z, 8));
  // find spawn on land
  let sx = 8, sz = 8;
  outer:
  for (let r = 0; r < 400; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const h = world.surfaceHeight(sx + dx, sz + dz);
        const b = world.biomeAt(sx + dx, sz + dz);
        if (h >= 63 && b !== BIOME_OCEAN && b !== BIOME_DEEP_OCEAN && b !== BIOME_RIVER &&
            !world.isCave(sx + dx, h, sz + dz, h)) {
          sx += dx; sz += dz;
          break outer;
        }
      }
    }
  }
  spawnPoint = { x: sx + 0.5, y: world.surfaceHeight(sx, sz) + 1.01, z: sz + 0.5 };
}

function chunkDist2(cx, cz, pcx, pcz) { return (cx - pcx) ** 2 + (cz - pcz) ** 2; }

// Initial join only waits for a safe core around the player.  The requested
// render-distance ring keeps streaming after play begins.  Waiting for every
// render-distance-8 chunk (293 generated / ~200 meshed) made the loading screen
// look frozen even though generation had already completed.
function loadingCoreRadius() {
  return Math.min(settings.renderDistance, 4);
}

function updateChunkStream() {
  const px = player.pos.x, pz = player.pos.z;
  const pcx = Math.floor(px / CHUNK_SIZE), pcz = Math.floor(pz / CHUNK_SIZE);
  const rd = settings.renderDistance;
  const radius2 = (rd + 1.5) ** 2;

  const wanted = [];
  for (let dz = -rd - 1; dz <= rd + 1; dz++) {
    for (let dx = -rd - 1; dx <= rd + 1; dx++) {
      if (dx * dx + dz * dz <= radius2) wanted.push([pcx + dx, pcz + dz]);
    }
  }
  wanted.sort((a, b) => chunkDist2(a[0], a[1], pcx, pcz) - chunkDist2(b[0], b[1], pcx, pcz));

  let genBudget = 2, meshBudget = 2;
  for (const [cx, cz] of wanted) {
    if (!world.hasChunk(cx, cz) && genBudget-- > 0) {
      world.generateChunk(cx, cz);
      fluidSystem?.activateChunk(cx, cz);
    }
  }
  // mesh only chunks whose four neighbours exist
  for (const [cx, cz] of wanted) {
    const chunk = world.getChunk(cx, cz);
    if (!chunk || !chunk.dirty) continue;
    if (chunkDist2(cx, cz, pcx, pcz) > rd * rd) continue;
    let neighboursReady = true;
    for (let nx = -1; nx <= 1 && neighboursReady; nx++) {
      for (let nz = -1; nz <= 1 && neighboursReady; nz++) {
        if ((nx || nz) && !world.hasChunk(cx + nx, cz + nz)) neighboursReady = false;
      }
    }
    if (!neighboursReady) continue;
    if (meshBudget-- > 0) rebuildChunkMesh(chunk);
  }

  // unload far chunks
  for (const [key, chunk] of world.chunks) {
    if (chunkDist2(chunk.cx, chunk.cz, pcx, pcz) > (rd + 2.2) ** 2) {
      removeChunkMesh(chunk);
      world.chunks.delete(key);
    }
  }
  // During the loading screen we only require a fully generated/meshed core
  // (radius <= 4).  Larger render distances continue streaming outward in the
  // normal game loop, which matches how Minecraft progressively fills distant
  // chunks and avoids a long main-thread stall at render distance 8+.
  const readyRadius = state === 'loading' ? loadingCoreRadius() : rd;
  worldReady = true;
  for (const [cx, cz] of wanted) {
    if (chunkDist2(cx, cz, pcx, pcz) > (readyRadius + 1.45) ** 2) continue;
    if (!world.hasChunk(cx, cz)) { worldReady = false; break; }
  }
  if (worldReady) {
    for (const [cx, cz] of wanted) {
      if (chunkDist2(cx, cz, pcx, pcz) > readyRadius * readyRadius) continue;
      const chunk = world.getChunk(cx, cz);
      if (!chunk || chunk.dirty || !chunk.meshes) { worldReady = false; break; }
    }
  }
}

function rebuildChunkMesh(chunk) {
  removeChunkMesh(chunk);
  const geos = buildChunkGeometry(chunk, world);
  const meshes = [];
  const mk = (geo, mat, cast, receive) => {
    if (!geo) return null;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    mesh.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
    mesh.updateMatrix();
    mesh.frustumCulled = true;
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    scene.add(mesh);
    meshes.push(mesh);
    return mesh;
  };
  mk(geos.opaque, atlasMaterial, true, true);
  const cutoutMesh = mk(geos.cutout, cutoutMaterial, true, true);
  if (cutoutMesh) cutoutMesh.customDepthMaterial = cutoutDepthMaterial;
  // Alpha-tested plant silhouettes now cast proper crossed-quad shadows, just
  // like Minecraft foliage, instead of looking detached from the ground.
  const plantMesh = mk(geos.plants, plantMaterial, true, false);
  if (plantMesh) plantMesh.customDepthMaterial = cutoutDepthMaterial;
  mk(geos.glass, glassMaterial, false, true);
  mk(geos.waterStill, waterStillMaterial, false, true);
  mk(geos.waterFlow, waterFlowMaterial, false, true);
  mk(geos.lavaStill, lavaStillMaterial, false, false);
  mk(geos.lavaFlow, lavaFlowMaterial, false, false);
  chunk.meshes = meshes;
  chunk.dirty = false;
}

function removeChunkMesh(chunk) {
  if (!chunk || !chunk.meshes) return;
  for (const mesh of chunk.meshes) {
    scene.remove(mesh);
    mesh.geometry.dispose();
  }
  chunk.meshes = null;
}

function clearAllChunkMeshes() {
  for (const chunk of world.chunks.values()) removeChunkMesh(chunk);
}

// ------------------------------------------------------------------ sky / sun / shadows
function buildCloudGeometry(img) {
  // Fancy-cloud style voxel sheet.  We sample the vanilla 256px texture down
  // to 64x64 logical cells (4 source pixels per cell) and extrude it 4 blocks.
  // Boundary-only side faces keep the geometry light while still being truly 3D.
  const sample = 4;
  const cells = Math.floor(Math.min(img.width, img.height) / sample);
  const cellSize = 12;
  const thickness = 4;
  cloudPeriod = cells * cellSize;

  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  const occ = new Uint8Array(cells * cells);
  for (let z = 0; z < cells; z++) {
    for (let x = 0; x < cells; x++) {
      let alpha = 0;
      for (let dz = 0; dz < sample; dz++) for (let dx = 0; dx < sample; dx++) {
        const sx = x * sample + dx, sz = z * sample + dz;
        alpha += data[(sz * img.width + sx) * 4 + 3];
      }
      occ[z * cells + x] = alpha / (sample * sample) > 42 ? 1 : 0;
    }
  }

  const pos = [], nrm = [], col = [], idx = [];
  const shades = { top: 1.0, bottom: 0.68, x: 0.82, z: 0.90 };
  const emit = (corners, normal, shade) => {
    const base = pos.length / 3;
    for (const p of corners) {
      pos.push(p[0], p[1], p[2]); nrm.push(normal[0], normal[1], normal[2]);
      col.push(shade, shade, shade);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const filled = (x, z) => occ[((z + cells) % cells) * cells + ((x + cells) % cells)] !== 0;
  const half = cloudPeriod / 2;
  for (let z = 0; z < cells; z++) for (let x = 0; x < cells; x++) {
    if (!filled(x, z)) continue;
    const x0 = x * cellSize - half, x1 = x0 + cellSize;
    const z0 = z * cellSize - half, z1 = z0 + cellSize;
    const y0 = -thickness / 2, y1 = thickness / 2;
    emit([[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0]],[0,1,0],shades.top);
    emit([[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]],[0,-1,0],shades.bottom);
    if (!filled(x + 1, z)) emit([[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[x1,y0,z1]],[1,0,0],shades.x);
    if (!filled(x - 1, z)) emit([[x0,y0,z1],[x0,y1,z1],[x0,y1,z0],[x0,y0,z0]],[-1,0,0],shades.x);
    if (!filled(x, z + 1)) emit([[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]],[0,0,1],shades.z);
    if (!filled(x, z - 1)) emit([[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0]],[0,0,-1],shades.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  g.computeBoundingSphere();
  return g;
}

async function buildSky() {
  const cloudImg = await loadImage('environment/clouds.png');
  const cloudGeo = buildCloudGeometry(cloudImg);
  const cloudMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.90,
    depthTest: true, depthWrite: true, fog: true,
  });
  cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
  cloudMesh.position.y = 128;
  cloudMesh.renderOrder = 0;
  cloudMesh.castShadow = false;
  cloudMesh.receiveShadow = false;
  scene.add(cloudMesh);

  // Vertical sky gradient with a slightly less blown-out horizon.
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 16; skyCanvas.height = 256;
  {
    const c = skyCanvas.getContext('2d');
    const g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0.00, '#4f82dc');
    g.addColorStop(0.50, '#86afea');
    g.addColorStop(1.00, '#b7d2ef');
    c.fillStyle = g; c.fillRect(0, 0, 16, 256);
  }
  skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.magFilter = THREE.LinearFilter; skyTex.minFilter = THREE.LinearFilter;
  skyTex.generateMipmaps = false; skyTex.colorSpace = THREE.SRGBColorSpace;
  const skyGeo = new THREE.SphereGeometry(1250, 40, 20);
  const skyMaterial = new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, depthWrite: false, fog: false });
  skyMesh = new THREE.Mesh(skyGeo, skyMaterial);
  skyMesh.frustumCulled = false; skyMesh.renderOrder = -100;
  skyMesh.castShadow = false; skyMesh.receiveShadow = false;
  scene.add(skyMesh);

  // Use the actual 1.8.8 square sun.  A small depth-tested halo adds warmth,
  // but both sprites disappear behind terrain/trees instead of shining through.
  const sunImg = await loadImage('environment/sun.png');
  const sunTex = new THREE.CanvasTexture(sunImg);
  sunTex.magFilter = THREE.NearestFilter; sunTex.minFilter = THREE.NearestFilter;
  sunTex.generateMipmaps = false; sunTex.colorSpace = THREE.SRGBColorSpace;
  const sunMat = new THREE.SpriteMaterial({
    map: sunTex, transparent: true, blending: THREE.AdditiveBlending,
    depthTest: true, depthWrite: false, fog: false,
  });
  const sunDisk = new THREE.Sprite(sunMat);
  sunDisk.scale.set(64, 64, 1);

  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = 128; glowCanvas.height = 128;
  {
    const c = glowCanvas.getContext('2d');
    const g = c.createRadialGradient(64, 64, 10, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,242,190,0.35)');
    g.addColorStop(0.45, 'rgba(255,220,150,0.10)');
    g.addColorStop(1, 'rgba(255,210,120,0)');
    c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  }
  const glowTex = new THREE.CanvasTexture(glowCanvas); glowTex.colorSpace = THREE.SRGBColorSpace;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, transparent: true, opacity: 0.55, depthTest: true, depthWrite: false,
    fog: false, blending: THREE.AdditiveBlending,
  }));
  halo.scale.set(110, 110, 1);
  sunGlow = new THREE.Group();
  sunGlow.add(halo, sunDisk);
  scene.add(sunGlow);

  window.__sky = { cloudMesh, skyMesh, skyTex, sunGlow };
}

function setupLighting() {
  if (hemiLight) return;
  hemiLight = new THREE.HemisphereLight(0xd6e6ff, 0x665e50, 0.66);
  scene.add(hemiLight);

  const ambient = new THREE.AmbientLight(0x9fb6d8, 0.12);
  scene.add(ambient);

  sunLight = new THREE.DirectionalLight(0xfff0d1, 2.30);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(4096, 4096);
  sunLight.shadow.camera.near = 20;
  sunLight.shadow.camera.far = 520;
  sunLight.shadow.bias = -0.00035;
  sunLight.shadow.normalBias = 0.025;
  sunLight.shadow.radius = 1.5;
  sunLight.shadow.camera.updateProjectionMatrix();
  scene.add(sunLight);
  scene.add(sunLight.target);
  updateSunAndShadows();
}

function updateSunAndShadows() {
  if (!sunLight) return;
  const rd = settings.renderDistance;
  const half = rd * CHUNK_SIZE + 26;
  const cam = sunLight.shadow.camera;
  cam.left = -half; cam.right = half;
  cam.top = half; cam.bottom = -half;
  cam.updateProjectionMatrix();
  // Snap the shadow frustum to whole shadow-map texels.  This keeps the
  // PCF penumbra perfectly stable while the player moves.
  const mapSize = sunLight.shadow.mapSize.x;
  const texel = (half * 2) / mapSize;
  const tx = Math.round(camera.position.x / texel) * texel;
  const tz = Math.round(camera.position.z / texel) * texel;
  const ty = camera.position.y;
  sunLight.target.position.set(tx, ty, tz);
  sunLight.position.set(
    tx + SUN_DIR.x * 260,
    ty + SUN_DIR.y * 260,
    tz + SUN_DIR.z * 260,
  );
  sunLight.target.updateMatrixWorld();
  if (skyMesh) skyMesh.position.copy(camera.position);
  if (sunGlow) sunGlow.position.copy(camera.position).addScaledVector(SUN_DIR, 1100);
}

// ------------------------------------------------------------------ crack / highlight
function buildCrackMeshes() {
  for (let i = 0; i < 10; i++) {
    const geo = new THREE.BoxGeometry(1.005, 1.005, 1.005);
    const uv = geo.getAttribute('uv');
    // all six faces use the crack tile
    const name = `destroy_${i}`;
    for (let f = 0; f < 6; f++) {
      const base = f * 4;
      // BoxGeometry UV order is face-local; overwrite all vertices with tile.
      for (let v = 0; v < 4; v++) {
        const u = uv.getX(base + v), vv = uv.getY(base + v);
        const [tu, tv] = tileUVFor(name, u, vv);
        uv.setXY(base + v, tu, tv);
      }
    }
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: getAtlasTexture(),
      color: 0xffffff,
      transparent: true,
      // The vanilla destroy PNG uses alpha=1 for its nominally transparent
      // background.  Discard that background completely so the block keeps
      // its own colour; only the opaque crack pixels are drawn.
      alphaTest: 0.02,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      toneMapped: true,
    }));
    mesh.visible = false;
    scene.add(mesh);
    crackMeshes.push(mesh);
  }
  const hlGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002));
  highlightBox = new THREE.LineSegments(hlGeo, new THREE.LineBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.55, depthTest: true,
  }));
  highlightBox.visible = false;
  scene.add(highlightBox);
}
function tileUVFor(name, u, v) {
  const idx = tiles[name];
  const TILE = 64, ATLAS = 1024;
  const col = idx % 16, row = (idx / 16) | 0;
  return [(col * TILE + 1 + u * (TILE - 2)) / ATLAS,
          1 - (row * TILE + 1 + (1 - v) * (TILE - 2)) / ATLAS];
}

function targetFaceTile(id, biome, normal) {
  const faces = blockFaceTiles(id, biome);
  if (normal?.y > 0) return faces.top;
  if (normal?.y < 0) return faces.bottom;
  return faces.side;
}

function crackTintForTile(tileName) {
  if (crackTintCache.has(tileName)) return crackTintCache.get(tileName);
  const c = tileCanvas(tileName);
  const ctx = c.getContext('2d');
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  let r = 0, g = 0, b = 0, weight = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    if (a < 0.08) continue;
    r += data[i] * a;
    g += data[i + 1] * a;
    b += data[i + 2] * a;
    weight += a;
  }
  if (weight <= 0) {
    const fallback = new THREE.Color(0x9a9a9a);
    crackTintCache.set(tileName, fallback);
    return fallback;
  }
  r /= weight; g /= weight; b /= weight;
  // Keep the hue of the face being mined, but blend it part-way toward white.
  // The destroy-stage texture itself contains dark/mid-grey pixels, so this
  // produces a darker shade of the source block rather than a foreign black
  // decal pasted on top of it.
  const lift = 0.34;
  r = Math.round(r * (1 - lift) + 255 * lift);
  g = Math.round(g * (1 - lift) + 255 * lift);
  b = Math.round(b * (1 - lift) + 255 * lift);
  const color = new THREE.Color((r << 16) | (g << 8) | b);
  crackTintCache.set(tileName, color);
  return color;
}

// ------------------------------------------------------------------ mining / placing
function updateTarget() {
  if (!player) { target = null; return; }
  const origin = player.eyePos();
  const dir = cameraDirection();
  const hit = raycastVoxel(world, origin, dir, 5.5);
  target = hit;
  if (highlightBox) {
    highlightBox.visible = !!hit;
    if (hit) highlightBox.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  }
}

function cameraDirection() {
  const cp = Math.cos(player.pitch), sp = Math.sin(player.pitch);
  const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw);
  return new THREE.Vector3(-sy * cp, sp, -cy * cp).normalize();
}

function updateMining(dt) {
  digCooldown = Math.max(0, digCooldown - dt);
  placeCooldown = Math.max(0, placeCooldown - dt);

  if (!mouse.left || !target) {
    mining = null;
  } else if (mouse.left && target) {
    if (gameModeCreative) {
      if (digCooldown <= 0) {
        breakBlock(target);
        digCooldown = 0.22;
      }
    } else {
      const def = BLOCKS[target.id];
      if (def.unbreakable) { mining = null; }
      else {
        if (!mining || mining.x !== target.x || mining.y !== target.y || mining.z !== target.z) {
          // Cache one light sample for the whole mining action.  V4 queried
          // skylight again for every moving particle every frame, which could
          // stall survival mining badly on generated terrain.
          const sky = world.skyLight(target.x, target.y, target.z);
          mining = {
            ...target,
            progress: 0,
            stage: -1,
            soundTimer: 0,
            particleTimer: 0,
            // Keep replaying the exact same first-person swing used on the
            // final break.  Holding attack in classic MC does not leave the
            // held item frozen while the crack texture advances.
            swingTimer: 0,
            particleLight: 0.52 + sky * 0.48,
          };
        }
        mining.soundTimer -= dt;
        mining.particleTimer -= dt;
        mining.swingTimer -= dt;
        if (mining.swingTimer <= 0) {
          // armSwing=1 starts the same 1.8-style transform used by breakBlock.
          // One full swing currently lasts ~0.31 s, so restart just after it
          // finishes instead of snapping back half-way through a stroke.
          armSwing = 1;
          mining.swingTimer = 0.32;
        }
        if (mining.soundTimer <= 0) {
          audio.playDig(def);
          // MC repeats the hit sound every 4 damage ticks (0.2 s)
          mining.soundTimer = 0.2;
        }
        // Vanilla continuously sheds one small texture fragment from the face
        // being hit, separate from the final 4x4x4 destroy burst.
        if (mining.particleTimer <= 0) {
          particles.spawnBlockHit(target.x, target.y, target.z, target.id,
            world.biomeAt(target.x, target.z), target.normal, mining.particleLight,
            Math.random() < 0.38 ? 2 : 1);
          // Small face chips remain sparse, but are now frequent enough to be
          // visible throughout a long survival dig instead of only at the end.
          mining.particleTimer = 0.105 + Math.random() * 0.035;
        }
        mining.progress += dt / Math.max(0.05, def.digTime);
        if (mining.progress >= 1) {
          breakBlock(target);
          mining = null;
        } else {
          mining.stage = Math.min(9, Math.floor(mining.progress * 10));
        }
      }
    }
  }

  // Crack overlay.  Tint the destroy stage toward the colour of the exact
  // face being hit; the transparent background is discarded in the material,
  // so the original block texture remains untouched between crack pixels.
  const crackBiome = target ? world.biomeAt(target.x, target.z) : null;
  const crackTile = target ? targetFaceTile(target.id, crackBiome, target.normal) : null;
  const crackTint = crackTile ? crackTintForTile(crackTile) : null;
  for (let i = 0; i < crackMeshes.length; i++) {
    const show = mining && mining.stage === i && target;
    crackMeshes[i].visible = !!show;
    if (show) {
      crackMeshes[i].position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
      crackMeshes[i].material.color.copy(crackTint);
    }
  }
}

function breakBlock(hit) {
  const id = world.getBlock(hit.x, hit.y, hit.z);
  if (id === AIR) return;
  // Sample before removing the block so fragments inherit the light of the
  // place they came from rather than suddenly becoming full-bright.
  const sky = world.skyLight(hit.x, hit.y, hit.z);
  const particleLight = 0.52 + sky * 0.48;
  const biome = world.biomeAt(hit.x, hit.z);
  world.setBlock(hit.x, hit.y, hit.z, AIR);
  fluidSystem?.notifyBlockChanged(hit.x, hit.y, hit.z);
  world.clearSkyCache();
  particles.spawnBlockBreak(hit.x, hit.y, hit.z, id, biome, particleLight);

  // Creative mode destroys blocks cleanly. Survival mode creates the familiar
  // spinning/bobbing world item after the block has actually broken.
  if (!gameModeCreative) {
    const dropId = blockDrop(id);
    if (dropId !== AIR) droppedItems.spawn(hit.x, hit.y, hit.z, dropId, biome);
  }

  audio.playBreak(BLOCKS[id]);
  armSwing = Math.max(armSwing, 1);
  target = null;
}

function placeBlock() {
  if (!target || placeCooldown > 0) return;
  const p = target.prev;
  const id = hotbar[hud.selected];
  const cur = world.getBlock(p.x, p.y, p.z);
  const replaceable = cur === AIR || cur === WATER || cur === LAVA || BLOCKS[cur]?.plant;
  if (!replaceable) return;
  if (p.y < 0 || p.y >= WORLD_HEIGHT) return;
  if (playerAABBIntersectsBlock(player.pos.x, player.pos.y, player.pos.z, p.x, p.y, p.z)) return;
  if (id === WATER || id === LAVA) fluidSystem?.placeSource(p.x, p.y, p.z, id);
  else {
    world.setBlock(p.x, p.y, p.z, id);
    fluidSystem?.notifyBlockChanged(p.x, p.y, p.z);
  }
  world.clearSkyCache();
  audio.playPlace(BLOCKS[id]);
  armSwing = Math.max(armSwing, 1);
  placeCooldown = 0.22;
}

function pickTargetBlock() {
  if (!target) return;
  const id = target.id;
  const idx = hotbar.indexOf(id);
  if (idx >= 0) selectSlot(idx);
  else {
    hotbar[hud.selected] = id;
    hud.setHotbar(hotbar);
    refreshHeldBlock();
    hud.selectedTimer = 0;
    hud.nameToShow = blockName(id);
    hud.nameTimer = 2.2;
  }
  audio.playPop();
}


// The current prototype still uses an unlimited block hotbar rather than a
// full survival stack inventory.  Picked-up world items therefore make sure
// their block is accessible in the hotbar; if it is new, it occupies the
// currently selected slot.  This keeps pickup useful now and leaves stack
// counts as an isolated future inventory upgrade.
function collectDroppedBlock(id) {
  const idx = hotbar.indexOf(id);
  if (idx < 0) {
    hotbar[hud.selected] = id;
    hud.setHotbar(hotbar);
    refreshHeldBlock();
  }
  hud.selectedTimer = 0;
  hud.nameToShow = blockName(id);
  hud.nameTimer = 1.6;
  audio.playPop();
  return true;
}

// ------------------------------------------------------------------ game init
function applyFog() {
  const rd = settings.renderDistance;
  scene.fog = new THREE.Fog(FOG, rd * CHUNK_SIZE * 0.72, rd * CHUNK_SIZE * 1.02);
}

function setupMaterials() {
  atlasMaterial = new THREE.MeshLambertMaterial({ map: getAtlasTexture(), vertexColors: true });
  cutoutMaterial = new THREE.MeshLambertMaterial({
    map: getAtlasTexture(), vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide,
    alphaToCoverage: true,
  });
  // Plants need a tiny ambient/emissive floor: they still receive directional
  // shadows, but never collapse into pitch-black silhouettes under a tree.
  plantMaterial = new THREE.MeshLambertMaterial({
    map: getAtlasTexture(), vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide,
    alphaToCoverage: true, emissive: new THREE.Color(0x10170a), emissiveIntensity: 0.45,
  });
  cutoutDepthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: getAtlasTexture(), alphaTest: 0.5, side: THREE.DoubleSide,
  });
  glassMaterial = new THREE.MeshLambertMaterial({
    map: getAtlasTexture(), vertexColors: true, transparent: true, opacity: 0.85,
    depthWrite: false, side: THREE.DoubleSide,
  });
  waterStillMaterial = new THREE.MeshLambertMaterial({
    map: liquidTextures.waterStill, vertexColors: true, transparent: true, opacity: 0.74,
    depthWrite: false, side: THREE.DoubleSide,
  });
  waterFlowMaterial = new THREE.MeshLambertMaterial({
    map: liquidTextures.waterFlow, vertexColors: true, transparent: true, opacity: 0.74,
    depthWrite: false, side: THREE.DoubleSide,
  });
  lavaStillMaterial = new THREE.MeshBasicMaterial({
    map: liquidTextures.lavaStill, vertexColors: true, side: THREE.DoubleSide,
  });
  lavaFlowMaterial = new THREE.MeshBasicMaterial({
    map: liquidTextures.lavaFlow, vertexColors: true, side: THREE.DoubleSide,
  });
}

function disposeWorldVisuals() {
  particles.clear();
  droppedItems.clear();
  if (world) clearAllChunkMeshes();
  for (const m of crackMeshes) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
  crackMeshes = [];
  if (highlightBox) { scene.remove(highlightBox); highlightBox.geometry.dispose(); highlightBox.material.dispose(); highlightBox = null; }
  if (playerModel && playerModel.heldItem) {
    playerModel.rightArmPivot.remove(playerModel.heldItem);
    playerModel.heldItem = null;
  }
}

function startGame() {
  audio.unlock();
  audio.stopMenuMusic();
  audio.startGameMusicTimer();
  disposeWorldVisuals();
  hide(titleScreen); hide(pauseScreen); hide(optionsScreen); hide(pickerScreen);
  show(loadingScreen);
  loadingText.textContent = '';
  state = 'loading';
  started = true;
  canvas.requestPointerLock();

  const saved = readSave();
  const seed = saved && [2, 3, 4].includes(saved.gen) && saved.seed ? saved.seed : (Math.random() * 0xffffffff) >>> 0;
  createWorld(seed);
  player = new Player(world, spawnPoint);
  player.flying = gameModeCreative;
  health = 20;
  viewMode = 0;
  hud.setHotbar(hotbar);
  window.__game = { world, player, droppedItems, get health() { return health; }, get creative() { return gameModeCreative; } };
  setupLighting();
  setupMaterials();
  applyFog();
  refreshHeldBlock();
  buildCrackMeshes();
  updateChunkStream();

  // Clear a spawn pocket so the player never starts inside a tree/terrain.
  const sx = Math.floor(player.pos.x), sy = Math.floor(player.pos.y), sz = Math.floor(player.pos.z);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    for (let dy = 0; dy < 3; dy++) {
      const id = world.getBlock(sx + dx, sy + dy, sz + dz);
      if (id !== AIR) world.setBlock(sx + dx, sy + dy, sz + dz, AIR);
    }
  }
  world.clearSkyCache();
}

async function initTitleScene() {
  const names = [];
  for (let i = 0; i < 6; i++) names.push(loadImage(`gui/title/background/panorama_${i}.png`));
  const imgs = await Promise.all(names);
  const mats = imgs.map(img => {
    const t = new THREE.CanvasTexture(img);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide });
  });
  const cube = new THREE.Mesh(new THREE.BoxGeometry(120, 120, 120), mats);
  titleScene.add(cube);
  panoramaCube = cube;
}

function renderTitle(dt) {
  titleT += dt;
  if (panoramaCube) {
    panoramaCube.rotation.y += dt * 0.006;
    panoramaCube.rotation.x = Math.sin(titleT * 0.05) * 0.02;
  }
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.render(titleScene, titleCamera);
}

// ------------------------------------------------------------------ player visuals
async function initPlayerVisuals() {
  playerModel = await buildPlayerModel();
  playerModel.group.visible = false;
  playerModel.group.traverse(o => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  scene.add(playerModel.group);
  firstPersonArm = await buildFirstPersonArm();
  firstPersonArm.group.traverse(o => {
    if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; }
  });
  camera.add(firstPersonArm.group);
  refreshHeldBlock();
}

function updatePlayerVisuals(dt) {
  if (!playerModel || !player) return;
  playerModel.group.visible = viewMode !== 0 && (state === 'playing' || state === 'paused');
  const moving = player.horizontalSpeed > 0.4;
  const groundMoving = moving && player.onGround && !player.flying;
  const speedFactor = Math.min(1, player.horizontalSpeed / 5.6);
  walkTime += dt * (4 + speedFactor * 6);
  const swing = Math.sin(walkTime) * 0.55 * speedFactor;

  if (playerModel.group.visible) {
    playerModel.group.position.copy(player.pos);
    playerModel.group.rotation.y = player.yaw + (viewMode === 2 ? Math.PI : 0);
    playerModel.rightLegPivot.rotation.x = swing;
    playerModel.leftLegPivot.rotation.x = -swing;
    playerModel.rightArmPivot.rotation.x = -swing;
    playerModel.leftArmPivot.rotation.x = swing;
    playerModel.headPivot.rotation.x = -player.pitch * 0.9;
    if (viewMode === 2) playerModel.headPivot.rotation.x *= -1;
  }

  // First-person view model.  This follows the classic 1.8 transform much
  // more closely: the item rests at (0.56,-0.52,-0.72), yawed 45 degrees and
  // scaled to 0.4.  The arm is a separate, slightly deeper object so it sits
  // behind the block instead of rotating the block with it.
  const fp = firstPersonArm.group;
  fp.visible = viewMode === 0 && state === 'playing';
  if (fp.visible) {
    // Let the held item carry most of the walking motion.  The world camera
    // below now uses a smaller, deliberately different cadence, which keeps
    // the two layers from moving in lock-step and feeling motion-sickening.
    const handBobPhase = walkTime * 0.52;
    const bobX = groundMoving ? Math.sin(handBobPhase) * 0.021 * speedFactor : 0;
    const bobY = groundMoving ? -Math.abs(Math.cos(handBobPhase)) * 0.016 * speedFactor : 0;
    fp.position.set(bobX, bobY, 0);
    fp.rotation.order = 'ZXY';
    fp.rotation.set(
      groundMoving ? Math.abs(Math.cos(handBobPhase - 0.18)) * 0.011 * speedFactor : 0,
      0,
      groundMoving ? Math.sin(handBobPhase) * 0.015 * speedFactor : 0,
    );

    // armSwing is 1 at click and decays to 0.  Reverse it so the trigonometric
    // swing begins and ends at zero, as Minecraft's swingProgress does.
    const swingProgress = 1 - Math.min(1, Math.max(0, armSwing));
    const swingA = Math.sin(swingProgress * swingProgress * Math.PI);
    const swingB = Math.sin(Math.sqrt(swingProgress) * Math.PI);

    const ip = firstPersonArm.itemPivot;
    // Vanilla 1.8 also applies a small translational swing before the base
    // first-person transform.
    const swingX = -0.4 * swingB;
    const swingY =  0.2 * Math.sin(Math.sqrt(swingProgress) * Math.PI * 2);
    const swingZ = -0.2 * Math.sin(swingProgress * Math.PI);
    ip.position.set(FP_ITEM.x + swingX, FP_ITEM.y + swingY, FP_ITEM.z + swingZ);
    // OpenGL's sequence is Y -> Z -> X, so use the matching Euler order.
    ip.rotation.order = 'YZX';
    ip.rotation.set(
      THREE.MathUtils.degToRad(-80) * swingB,
      FP_ITEM.yaw + THREE.MathUtils.degToRad(-20) * swingA,
      THREE.MathUtils.degToRad(-20) * swingB,
    );
    ip.scale.setScalar(FP_ITEM.scale);

    const ap = firstPersonArm.armPivot;
    // In Minecraft 1.8 the player arm is rendered when the hand is empty; a
    // held block/item is rendered by itself.  Hiding the cyan Steve arm here
    // is therefore both more accurate and fixes the oversized diagonal sleeve
    // visible in the V2 screenshot.
    ap.visible = !heldBlock;
    if (ap.visible) {
      ap.position.set(
        FP_ARM.x + swingB * 0.05,
        FP_ARM.y - swingB * 0.08,
        FP_ARM.z + swingB * 0.03,
      );
      ap.rotation.order = 'YXZ';
      ap.rotation.set(
        FP_ARM.pitch + swingB * 0.55,
        FP_ARM.yaw + swingA * 0.18,
        FP_ARM.roll - swingB * 0.38,
      );
    }
  }
  armSwing = Math.max(0, armSwing - dt * 3.2);
}

function thirdPersonClipDistance(origin, dir, wanted) {
  // Minecraft samples several rays around the head instead of only the exact
  // camera centre.  That keeps the near plane out of walls at corners.
  const step = 0.08;
  const offsets = [
    [-0.10, -0.10, -0.10], [-0.10, -0.10, 0.10],
    [-0.10,  0.10, -0.10], [-0.10,  0.10, 0.10],
    [ 0.10, -0.10, -0.10], [ 0.10, -0.10, 0.10],
    [ 0.10,  0.10, -0.10], [ 0.10,  0.10, 0.10],
  ];
  const probe = new THREE.Vector3();
  let best = wanted;
  for (const [ox, oy, oz] of offsets) {
    let lastSafe = 0.18;
    for (let d = 0.18; d <= best; d += step) {
      probe.set(origin.x + ox, origin.y + oy, origin.z + oz).addScaledVector(dir, d);
      const bx = Math.floor(probe.x), by = Math.floor(probe.y), bz = Math.floor(probe.z);
      if (isSolid(world.getBlock(bx, by, bz))) {
        best = Math.min(best, Math.max(0.18, lastSafe - 0.05));
        break;
      }
      lastSafe = d;
    }
  }
  return best;
}

function updateThirdPersonCamera() {
  if (viewMode === 0) {
    camera.position.copy(player.eyePos());
    let bobSide = 0, bobUp = 0, bobRoll = 0, bobPitch = 0;
    if (!player.flying && player.onGround && player.horizontalSpeed > 0.5) {
      const sf = Math.min(1, player.horizontalSpeed / 5.6);
      // Camera bob is intentionally much weaker than the item bob and runs at
      // a different cadence/phase.  The hand still communicates footsteps,
      // while the horizon stays calm enough for long play sessions.
      const phase = walkTime * 0.37 + 0.85;
      bobSide = Math.sin(phase) * 0.011 * sf;
      bobUp = Math.abs(Math.cos(phase)) * 0.014 * sf;
      bobRoll = Math.sin(phase) * THREE.MathUtils.degToRad(0.28) * sf;
      bobPitch = Math.abs(Math.cos(phase - 0.24)) * THREE.MathUtils.degToRad(0.20) * sf;

      // Move along camera-right, not world X, so strafing-looking sway remains
      // consistent at every yaw angle.
      camera.position.x += Math.cos(player.yaw) * bobSide;
      camera.position.z -= Math.sin(player.yaw) * bobSide;
      camera.position.y += bobUp;
    }
    camera.rotation.order = 'YXZ';
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch + bobPitch;
    camera.rotation.z = bobRoll;
  } else {
    const eye = player.eyePos();
    const f = player.forward(false).normalize();
    const dir = viewMode === 1 ? f.clone().multiplyScalar(-1) : f;
    const wanted = 4.2;
    const dist = thirdPersonClipDistance(eye, dir, wanted);
    camera.position.copy(eye).addScaledVector(dir, dist);
    camera.lookAt(eye);
  }
}

// ------------------------------------------------------------------ save
function saveGame() {
  if (!world) return;
  try {
    localStorage.setItem('voxelcraft-reborn-save', JSON.stringify(world.saveEdits()));
  } catch (e) { /* storage full or unavailable */ }
  persistSettings();
}

function persistSettings() {
  try {
    localStorage.setItem('voxelcraft-reborn-settings', JSON.stringify(settings));
  } catch (e) { /* ignore */ }
}

// ------------------------------------------------------------------ loop
let lastT = performance.now();
let fpsAccum = 0, fpsFrames = 0, fps = 0;
let skyCacheClearTimer = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  fpsAccum += dt; fpsFrames++;
  if (fpsAccum >= 0.5) { fps = fpsFrames / fpsAccum; fpsAccum = 0; fpsFrames = 0; }

  if (state === 'title') {
    renderTitle(dt);
    hud.ctx.clearRect(0, 0, hud.w, hud.h);
    return;
  }

  liquidT += dt;
  if (liquidTextures) {
    updateLiquidAnimation(liquidTextures.waterStill, liquidT, 1.00);
    updateLiquidAnimation(liquidTextures.waterFlow, liquidT, 1.00);
    updateLiquidAnimation(liquidTextures.lavaStill, liquidT, 0.62);
    updateLiquidAnimation(liquidTextures.lavaFlow, liquidT, 0.58);
  }

  if (state !== 'playing') spacePressed = false;
  if (state !== 'paused' && state !== 'picker') {
    // mouse look
    if (document.pointerLockElement === canvas && (state === 'playing' || state === 'loading')) {
      const sens = settings.sensitivity * 0.0022;
      player.yaw -= mouseDX * sens;
      player.pitch -= mouseDY * sens;
      const lim = Math.PI / 2 - 0.01;
      player.pitch = Math.max(-lim, Math.min(lim, player.pitch));
    }
    mouseDX = 0; mouseDY = 0;

    const input = {
      forward: keys.has('KeyW') || keys.has('ArrowUp'),
      back: keys.has('KeyS') || keys.has('ArrowDown'),
      left: keys.has('KeyA') || keys.has('ArrowLeft'),
      right: keys.has('KeyD') || keys.has('ArrowRight'),
      jump: keys.has('Space'),
      sneak: keys.has('ShiftLeft') || keys.has('ShiftRight'),
      sprint: keys.has('ControlLeft') || keys.has('ControlRight'),
      jumpPressed: false,
      canFly: gameModeCreative,
    };
    // jumpPressed tracking is handled by Player through space edge is unavailable here;
    // pass a cheap edge detector
    player.update(dt, { ...input, jumpPressed: spacePressed });
    spacePressed = false;

    // classic footstep cadence (~ every 0.65 m)
    if (player.stepAccum > 0.65) {
      const groundId = world.getBlock(
        Math.floor(player.pos.x), Math.floor(player.pos.y - 0.5), Math.floor(player.pos.z));
      audio.playStep(BLOCKS[groundId]);
      player.stepAccum = 0;
    }

    if (player.inWater && !wasInWater && splashCooldown <= 0) {
      audio.playSplash(); splashCooldown = 1.2; swimTimer = 0.5;
    }
    wasInWater = player.inWater;
    splashCooldown = Math.max(0, splashCooldown - dt);
    if (player.inWater && player.horizontalSpeed > 0.4) {
      swimTimer -= dt;
      if (swimTimer <= 0) { audio.playSwim(); swimTimer = 0.45; }
    }
    liquidAmbientTimer -= dt;
    if (player.inWater && liquidAmbientTimer <= 0) {
      audio.playWater();
      liquidAmbientTimer = 2.2;
    } else if (player.inLava && liquidAmbientTimer <= 0) {
      audio.playLava();
      liquidAmbientTimer = 1.8;
    }

    updateTarget();
    updateMining(dt);
    if (mouse.right) placeBlock();
    // Do not advance saved/placed liquid ticks while the spawn area is still
    // being meshed.  A previous save containing water could otherwise keep
    // marking chunks dirty faster than the loading mesher can finish them.
    if (state === 'playing') fluidSystem?.update(dt);

    // falling damage
    if (player.onGround && player.fallDistance > 0) {
      if (player.fallDistance > 3) {
        const dmg = Math.floor(player.fallDistance - 3);
        if (!gameModeCreative) damagePlayer(dmg, player.fallDistance > 8);
        else if (player.fallDistance > 8) audio.playFall(true);
      }
      player.fallDistance = 0;
    }
    // lava
    if (player.inLava) {
      hurtCooldown -= dt;
      if (hurtCooldown <= 0 && !gameModeCreative) { damagePlayer(4, false); hurtCooldown = 0.5; }
      if (Math.random() < dt * 4) audio.playLavaPop();
    }
    hurtCooldown = Math.max(0, hurtCooldown - dt);

    updateChunkStream();
    updatePlayerVisuals(dt);
    updateThirdPersonCamera();
    particles.update(dt, camera, world);
    droppedItems.update(dt, world, player, collectDroppedBlock);

    // 3D cloud sheet drifts through world space.  Snap the periodic tile around
    // the camera so the finite geometry behaves like an infinite cloud layer.
    if (cloudMesh) {
      cloudTime += dt * 1.55;
      const drift = cloudTime % cloudPeriod;
      cloudMesh.position.x = Math.round((camera.position.x - drift) / cloudPeriod) * cloudPeriod + drift;
      cloudMesh.position.z = Math.round(camera.position.z / cloudPeriod) * cloudPeriod;
    }
    updateSunAndShadows();

    saveTimer += dt;
    if (saveTimer > 5) { saveGame(); saveTimer = 0; }
    skyCacheClearTimer += dt;
    if (skyCacheClearTimer > 20) { world.clearSkyCache(); world.clearColumnCache(); skyCacheClearTimer = 0; }

    if (state === 'loading') {
      const px = player.pos.x, pz = player.pos.z;
      const pcx = Math.floor(px / CHUNK_SIZE), pcz = Math.floor(pz / CHUNK_SIZE);
      const rr = loadingCoreRadius();
      let coreTotal = 0, coreGenerated = 0, coreMeshed = 0;
      for (let dz = -rr; dz <= rr; dz++) {
        for (let dx = -rr; dx <= rr; dx++) {
          if (dx * dx + dz * dz > rr * rr) continue;
          coreTotal++;
          const c = world.getChunk(pcx + dx, pcz + dz);
          if (c) coreGenerated++;
          if (c && !c.dirty && c.meshes) coreMeshed++;
        }
      }
      // Meshing is the expensive/visible part, so progress is based primarily
      // on ready meshes instead of the old square estimate.  For RD=8 the old
      // denominator was 361 even though the circular wanted set contains only
      // 293 chunks, which is why the bar visibly stopped around 81%.
      const prog = Math.min(100, Math.round((coreMeshed + Math.min(coreGenerated, coreTotal) * 0.15) / (coreTotal * 1.15) * 100));
      $('loading-bar').style.width = Math.max(6, prog) + '%';
      loadingText.textContent = `正在生成地形  ${coreMeshed}/${coreTotal}`;
      if (worldReady) {
        $('loading-bar').style.width = '100%';
        hide(loadingScreen);
        state = 'playing';
        // Saved liquid edits are allowed to wake up only after the initial
        // world is visible; outer chunks will continue streaming normally.
        fluidSystem?.bootstrapFromSave();
      }
    }
  } else {
    mouseDX = 0; mouseDY = 0;
  }

  if (damageFlash > 0) damageFlash = Math.max(0, damageFlash - dt * 2.2);
  hud.damageFlash = damageFlash;

  // camera FOV (sprint + settings)
  const fovTarget = settings.fov + player.sprintFov * 11;
  if (Math.abs(camera.fov - fovTarget) > 0.01) {
    camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 10);
    camera.updateProjectionMatrix();
  }

  try {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.render(scene, camera);
  } catch (err) {
    console.error('RENDER ERROR', err);
    state = 'paused';
    show(pauseScreen);
  }
  // HUD
  const debugLines = [];
  if (hud.debug && player) {
    debugLines.push(`VoxelCraft Reborn · voxel sandbox`);
    debugLines.push(`${fps.toFixed(0)} fps · 渲染距离 ${settings.renderDistance} · 区块 ${world.chunks.size}`);
    debugLines.push(`XYZ: ${player.pos.x.toFixed(2)} / ${player.pos.y.toFixed(2)} / ${player.pos.z.toFixed(2)}`);
    debugLines.push(`朝向: ${((player.yaw * 180 / Math.PI) % 360 + 360).toFixed(1)}° 俯仰 ${(player.pitch * 180 / Math.PI).toFixed(1)}°`);
    debugLines.push(`生物群系: ${biomeName(world.biomeAt(Math.floor(player.pos.x), Math.floor(player.pos.z)))}`);
    debugLines.push(`模式: ${gameModeCreative ? '创造' : '生存'} · 飞行: ${player.flying ? '开' : '关'} · 生命: ${health / 2}❤`);
    debugLines.push(`热栏: ${blockName(hotbar[hud.selected])}`);
  }
  hud.render(state, { dt, debugLines });
}

function damagePlayer(amount, bigFall) {
  health -= amount;
  damageFlash = 1;
  if (health <= 0) {
    health = 20;
    player.pos.set(spawnPoint.x, spawnPoint.y, spawnPoint.z);
    player.vel.set(0, 0, 0);
    audio.playHurt();
  } else {
    audio.playHurt();
  }
  if (bigFall) audio.playFall(true);
  else audio.playFall(false);
}

let spacePressed = false;
// Patch the keydown listener so Player receives a one-frame jump-press edge.
const originalKeyDown = onKeyDown;
document.removeEventListener('keydown', onKeyDown);
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !keys.has('Space') && state === 'playing') spacePressed = true;
  originalKeyDown(e);
});

// ------------------------------------------------------------------ boot
function applyOptionUI() {
  $('opt-distance').value = settings.renderDistance;
  $('opt-distance-v').textContent = settings.renderDistance;
  $('opt-fov').value = settings.fov;
  $('opt-fov-v').textContent = settings.fov;
  $('opt-sens').value = settings.sensitivity * 100;
  $('opt-sens-v').textContent = `${Math.round(settings.sensitivity * 100)}%`;
  $('opt-vol').value = settings.volume * 100;
  $('opt-vol-v').textContent = `${Math.round(settings.volume * 100)}%`;
  $('opt-music').checked = settings.music;
  $('opt-creative').checked = settings.creative;
}

function bindUI() {
  btnPlay.addEventListener('click', startGame);
  $('btn-resume').addEventListener('click', resumeGame);
  $('btn-options').addEventListener('click', openOptions);
  $('btn-options-back').addEventListener('click', closeOptions);
  $('btn-quit-title').addEventListener('click', quitToTitle);
  $('opt-distance').addEventListener('input', e => {
    settings.renderDistance = Number(e.target.value);
    $('opt-distance-v').textContent = settings.renderDistance;
    if (world) applyFog();
    persistSettings();
  });
  $('opt-fov').addEventListener('input', e => {
    settings.fov = Number(e.target.value);
    $('opt-fov-v').textContent = settings.fov;
    persistSettings();
  });
  $('opt-sens').addEventListener('input', e => {
    settings.sensitivity = Number(e.target.value) / 100;
    $('opt-sens-v').textContent = `${e.target.value}%`;
    persistSettings();
  });
  $('opt-vol').addEventListener('input', e => {
    settings.volume = Number(e.target.value) / 100;
    audio.setVolume(settings.volume);
    $('opt-vol-v').textContent = `${e.target.value}%`;
    persistSettings();
  });
  $('opt-music').addEventListener('change', e => {
    settings.music = e.target.checked;
    audio.setMusicEnabled(settings.music);
    if (settings.music) {
      if (state === 'title') audio.startMenuMusic();
      else if (world) audio.startGameMusicTimer();
    }
    persistSettings();
  });
  $('opt-creative').addEventListener('change', e => {
    settings.creative = e.target.checked;
    gameModeCreative = e.target.checked;
    if (player && !gameModeCreative) player.flying = false;
    persistSettings();
  });
  window.addEventListener('resize', resize);
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  titleCamera.aspect = window.innerWidth / window.innerHeight;
  titleCamera.updateProjectionMatrix();
  hud.resize(window.innerWidth, window.innerHeight);
}

(async function boot() {
  resize();
  bindUI();
  applyOptionUI();
  audio.setVolume(settings.volume);
  audio.createMusicElements();
  audio.setMusicEnabled(settings.music);
  // Browsers only allow audio after a user gesture; start menu music then.
  document.addEventListener('pointerdown', () => {
    audio.unlock();
    if (state === 'title' && audio.musicEnabled) audio.startMenuMusic();
  }, { once: true });

  try {
    await buildAtlas();
    liquidTextures = await createLiquidTextures();
    await Promise.all([
      hud.load(),
      buildSky(),
      initTitleScene(),
      initPlayerVisuals(),
    ]).catch(err => console.error(err));
    btnPlay.disabled = false;
    btnPlay.textContent = '单人游戏';
    audio.preload(() => {});
  } catch (err) {
    console.error(err);
    btnPlay.disabled = false;
    btnPlay.textContent = '素材未安装 · 先运行 npm run assets';
  }

  requestAnimationFrame(frame);
})();
