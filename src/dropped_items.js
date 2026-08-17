// Minecraft 1.8-style dropped block entities.
//
// Survival block breaks spawn a small world item that is affected by gravity,
// bounces/settles on blocks, slowly spins and bobs, casts a shadow, can be
// picked up after the classic short pickup delay, and despawns after five
// minutes. Solid block drops use the same 3D block model as the held item;
// plant drops stay as flat cutout sprites.
import * as THREE from 'three';
import { BLOCKS, BIOME_PLAINS, isSolid } from './blocks.js';
import { buildHeldBlock } from './skin.js';
import { blockFaceTiles, tileCanvas } from './textures.js';

const HALF = 0.13;
const PICKUP_DELAY = 0.50;
const DESPAWN_TIME = 300;
const GRAVITY = 16.0; // close to classic EntityItem gravity: 0.04 blocks/tick²
const SPIN_SPEED = 1.0; // rad/s, close to vanilla item spin

function makePlantVisual(id, biome) {
  const faces = blockFaceTiles(id, biome || BIOME_PLAINS);
  const source = tileCanvas(faces.side);
  const tex = new THREE.CanvasTexture(source);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;

  const mat = new THREE.MeshLambertMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), mat);
  mesh.position.y = 0.03;
  return mesh;
}

function makeVisual(id, biome) {
  const def = BLOCKS[id];
  let visual;
  if (def?.plant) {
    visual = new THREE.Group();
    visual.add(makePlantVisual(id, biome));
  } else {
    visual = buildHeldBlock(id, biome || BIOME_PLAINS);
    visual.scale.setScalar(0.25);
  }

  visual.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return visual;
}

function overlapsSolid(world, p) {
  const minX = Math.floor(p.x - HALF), maxX = Math.floor(p.x + HALF);
  const minY = Math.floor(p.y - HALF), maxY = Math.floor(p.y + HALF);
  const minZ = Math.floor(p.z - HALF), maxZ = Math.floor(p.z + HALF);
  for (let y = minY; y <= maxY; y++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        if (isSolid(world.getBlock(x, y, z))) return true;
      }
    }
  }
  return false;
}

function disposeVisual(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of mats) {
      if (!mat) continue;
      if (mat.map) mat.map.dispose();
      mat.dispose();
    }
  });
}

export class DroppedItemSystem {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
  }

  spawn(x, y, z, id, biome = BIOME_PLAINS) {
    if (!BLOCKS[id]) return;

    const root = new THREE.Group();
    root.name = `droppedItem:${id}`;
    root.position.set(
      x + 0.5 + (Math.random() - 0.5) * 0.16,
      y + 0.48,
      z + 0.5 + (Math.random() - 0.5) * 0.16,
    );

    const visual = makeVisual(id, biome);
    visual.rotation.y = Math.random() * Math.PI * 2;
    root.add(visual);
    this.scene.add(root);

    const angle = Math.random() * Math.PI * 2;
    const speed = 0.45 + Math.random() * 0.35;
    this.items.push({
      id,
      root,
      visual,
      vel: new THREE.Vector3(Math.cos(angle) * speed, 2.0 + Math.random() * 0.35, Math.sin(angle) * speed),
      age: 0,
      phase: Math.random() * Math.PI * 2,
      onGround: false,
    });
  }

  _remove(index) {
    const item = this.items[index];
    if (!item) return;
    this.scene.remove(item.root);
    disposeVisual(item.root);
    this.items.splice(index, 1);
  }

  _moveAxis(item, world, axis, delta) {
    if (delta === 0) return false;
    const p = item.root.position;
    p.setComponent(axis, p.getComponent(axis) + delta);
    if (!overlapsSolid(world, p)) return false;
    p.setComponent(axis, p.getComponent(axis) - delta);
    return true;
  }

  update(dt, world, player, onPickup) {
    if (!world) return;
    // Clamp entity physics after a tab-switch/frame hitch so items cannot
    // tunnel through the terrain in one giant step.
    dt = Math.min(dt, 0.05);
    const airDrag = Math.pow(0.98, dt * 20);

    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      item.age += dt;
      if (item.age >= DESPAWN_TIME) {
        this._remove(i);
        continue;
      }

      item.vel.y -= GRAVITY * dt;
      item.vel.multiplyScalar(airDrag);

      // A few small substeps keep the 0.26m item AABB stable on voxel edges.
      const steps = Math.max(1, Math.ceil(item.vel.length() * dt / 0.12));
      const stepDt = dt / steps;
      item.onGround = false;
      for (let s = 0; s < steps; s++) {
        if (this._moveAxis(item, world, 0, item.vel.x * stepDt)) item.vel.x *= -0.10;

        const dy = item.vel.y * stepDt;
        if (this._moveAxis(item, world, 1, dy)) {
          if (dy < 0) {
            item.onGround = true;
            // Vanilla EntityItem bounces with half of its vertical velocity.
            item.vel.y *= -0.50;
            if (Math.abs(item.vel.y) < 0.55) item.vel.y = 0;
          } else {
            item.vel.y = 0;
          }
        }

        if (this._moveAxis(item, world, 2, item.vel.z * stepDt)) item.vel.z *= -0.10;
      }

      if (item.onGround) {
        // 0.98 air friction * roughly 0.6 block slipperiness matches the
        // characteristic quick settle of old Java dropped items.
        const groundDrag = Math.pow(0.60, dt * 20);
        item.vel.x *= groundDrag;
        item.vel.z *= groundDrag;
      }

      // Vanilla-style hover/spin is visual only; physics stays at root.position.
      item.visual.position.y = 0.10 + Math.sin(item.age * 2.0 + item.phase) * 0.05;
      item.visual.rotation.y += SPIN_SPEED * dt;

      if (player && item.age >= PICKUP_DELAY) {
        const dx = item.root.position.x - player.pos.x;
        const dy = item.root.position.y - (player.pos.y + 0.9);
        const dz = item.root.position.z - player.pos.z;
        // Slightly generous collision radius feels like classic MC's expanded
        // pickup AABB without adding a magnetic attraction effect.
        if (dx * dx + dz * dz < 1.15 * 1.15 && Math.abs(dy) < 1.35) {
          if (!onPickup || onPickup(item.id) !== false) {
            this._remove(i);
          }
        }
      }
    }
  }

  clear() {
    for (let i = this.items.length - 1; i >= 0; i--) this._remove(i);
  }
}
