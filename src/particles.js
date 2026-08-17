// Minecraft 1.8-style block particles.
//
// Digging particles in classic Java Minecraft are flat camera-facing texture
// fragments, not tiny copies of the whole voxel.  A destroyed block emits a
// 4x4x4 field of fragments and the currently-hit face sheds an occasional
// smaller chip.  Keep the system deliberately light-weight: lighting is
// resolved by Three.js + one cached world-light sample at spawn time, never by
// doing an expensive skylight query for every particle every frame.
import * as THREE from 'three';
import { blockFaceTiles, tileCanvas } from './textures.js';
import { BIOME_PLAINS, isSolid } from './blocks.js';

const fragmentTextureCache = new Map();
const sharedPlane = new THREE.PlaneGeometry(1, 1);
const MAX_PARTICLES = 220;
let steamTextureCache = null;

function particleTile(id, biome, normal = null, forBreak = false) {
  const faces = blockFaceTiles(id, biome || BIOME_PLAINS);
  if (normal?.y > 0) return faces.top;
  if (normal?.y < 0) return faces.bottom;
  // The final grass-block burst keeps the familiar dirt-heavy character, while
  // ongoing hit chips come from the actual face under the crosshair.
  if (forBreak && id === 2) return 'dirt';
  return faces.side;
}

function fragmentTexture(tileName, patchX, patchY) {
  const key = `${tileName}:${patchX}:${patchY}`;
  if (fragmentTextureCache.has(key)) return fragmentTextureCache.get(key);

  const src = tileCanvas(tileName); // 16x16 nearest-neighbour block texture
  const c = document.createElement('canvas');
  c.width = 4; c.height = 4;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, 4, 4);
  ctx.drawImage(src, patchX * 4, patchY * 4, 4, 4, 0, 0, 4, 4);

  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  fragmentTextureCache.set(key, tex);
  return tex;
}

function steamTexture() {
  if (steamTextureCache) return steamTextureCache;
  const c = document.createElement('canvas');
  c.width = 8; c.height = 8;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const a = [
    [0,0,0,0,0,0,0,0],
    [0,0,0.20,0.34,0.30,0,0,0],
    [0,0.22,0.55,0.72,0.68,0.40,0,0],
    [0.10,0.50,0.82,0.92,0.88,0.64,0.28,0],
    [0.08,0.45,0.78,0.90,0.84,0.58,0.24,0],
    [0,0.18,0.48,0.65,0.60,0.34,0,0],
    [0,0,0.10,0.24,0.18,0,0,0],
    [0,0,0,0,0,0,0,0],
  ];
  const img = ctx.createImageData(8, 8);
  for (let y=0;y<8;y++) for (let x=0;x<8;x++) {
    const i=(y*8+x)*4, alpha=Math.floor(a[y][x]*255);
    img.data[i]=205; img.data[i+1]=205; img.data[i+2]=205; img.data[i+3]=alpha;
  }
  ctx.putImageData(img,0,0);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false; tex.colorSpace = THREE.SRGBColorSpace;
  steamTextureCache = tex;
  return tex;
}

function makeMaterial(tex, light = 1) {
  // Lambert is intentional here: fragments now share the same hemisphere,
  // sun and shadow-map response as blocks, so a chip below a tree/cave no
  // longer looks like an unlit UI sprite pasted over the world.
  return new THREE.MeshLambertMaterial({
    map: tex,
    color: new THREE.Color(light, light, light),
    transparent: true,
    alphaTest: 0.10,
    depthTest: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    toneMapped: true,
  });
}

function blocked(world, x, y, z) {
  if (!world) return false;
  return isSolid(world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
}

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
  }

  _remove(index) {
    const p = this.particles[index];
    if (!p) return;
    this.scene.remove(p.mesh);
    p.mat.dispose();
    this.particles.splice(index, 1);
  }

  _trim() {
    while (this.particles.length >= MAX_PARTICLES) this._remove(0);
  }

  _add(tileName, position, velocity, scale, life, light = 1, patchX = null, patchY = null) {
    this._trim();
    const px = patchX ?? Math.floor(Math.random() * 4);
    const py = patchY ?? Math.floor(Math.random() * 4);
    const mat = makeMaterial(fragmentTexture(tileName, px, py), light);
    const mesh = new THREE.Mesh(sharedPlane, mat);
    mesh.position.copy(position);
    mesh.scale.setScalar(scale);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    this.scene.add(mesh);
    this.particles.push({
      mesh, mat, ...velocity, life, age: 0, scale, grounded: false,
      // Billboard particles in Java MC are not presented as a perfectly
      // aligned checkerboard.  A little in-plane rotation makes the burst read
      // as debris while keeping every fragment square and pixel-sharp.
      kind: 'debris',
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 3.6,
    });
  }

  // Equivalent in spirit to 1.8 EffectRenderer#addBlockDestroyEffects:
  // 64 fragments are still stratified through the block, but each cell is
  // jittered so the burst does not reveal a rigid 4x4x4 matrix to the eye.
  spawnBlockBreak(x, y, z, id, biome, light = 1) {
    const tile = particleTile(id, biome, null, true);
    const n = 4;
    for (let ix = 0; ix < n; ix++) {
      for (let iy = 0; iy < n; iy++) {
        for (let iz = 0; iz < n; iz++) {
          // Jitter within the middle 72% of each stratum: distribution stays
          // even like vanilla, but neighbouring rows no longer line up.
          const fx = (ix + 0.14 + Math.random() * 0.72) / n;
          const fy = (iy + 0.14 + Math.random() * 0.72) / n;
          const fz = (iz + 0.14 + Math.random() * 0.72) / n;
          const ox = fx - 0.5, oy = fy - 0.5, oz = fz - 0.5;
          const pos = new THREE.Vector3(x + fx, y + fy, z + fz);
          const radial = 1.75 + Math.random() * 0.95;
          const vel = {
            vx: ox * radial + (Math.random() - 0.5) * 0.16,
            vy: oy * radial + 0.42 + (Math.random() - 0.5) * 0.22,
            vz: oz * radial + (Math.random() - 0.5) * 0.16,
          };
          const scale = 0.078 + Math.random() * 0.068;
          const life = 0.22 + Math.random() * 0.26;
          // Random texture patches stop diagonal/repeating patterns from
          // appearing across the burst while staying within the source block.
          this._add(tile, pos, vel, scale, life, light);
        }
      }
    }
  }

  // Small chip from the face currently being mined.  This is intentionally
  // sparse; the destroy-stage overlay carries most of the continuous feedback.
  spawnBlockHit(x, y, z, id, biome, normal, light = 1, count = 1) {
    if (!normal) return;
    const tile = particleTile(id, biome, normal, false);
    const margin = 0.09;

    for (let i = 0; i < count; i++) {
      let px = x + margin + Math.random() * (1 - margin * 2);
      let py = y + margin + Math.random() * (1 - margin * 2);
      let pz = z + margin + Math.random() * (1 - margin * 2);
      const out = 0.018;

      if (normal.x > 0) px = x + 1 + out;
      else if (normal.x < 0) px = x - out;
      if (normal.y > 0) py = y + 1 + out;
      else if (normal.y < 0) py = y - out;
      if (normal.z > 0) pz = z + 1 + out;
      else if (normal.z < 0) pz = z - out;

      // A tiny outward kick plus random tangent motion gives the same visual
      // cue as chips being knocked from the contacted face rather than emitted
      // from the block centre.
      const vel = {
        vx: normal.x * (0.28 + Math.random() * 0.20) + (Math.random() - 0.5) * 0.22,
        vy: normal.y * (0.24 + Math.random() * 0.16) + 0.16 + (Math.random() - 0.5) * 0.15,
        vz: normal.z * (0.28 + Math.random() * 0.20) + (Math.random() - 0.5) * 0.22,
      };
      this._add(tile, new THREE.Vector3(px, py, pz), vel,
        0.070 + Math.random() * 0.036, 0.14 + Math.random() * 0.16, light);
    }
  }

  spawnSteam(x, y, z, count = 8) {
    for (let i = 0; i < count; i++) {
      this._trim();
      const mat = new THREE.MeshBasicMaterial({
        map: steamTexture(), transparent: true, alphaTest: 0.02, depthWrite: false,
        depthTest: true, side: THREE.DoubleSide, opacity: 0.82, toneMapped: true,
      });
      const mesh = new THREE.Mesh(sharedPlane, mat);
      mesh.position.set(x + (Math.random()-0.5)*0.72, y + Math.random()*0.18, z + (Math.random()-0.5)*0.72);
      const scale = 0.22 + Math.random()*0.18;
      mesh.scale.setScalar(scale);
      mesh.renderOrder = 2;
      this.scene.add(mesh);
      this.particles.push({
        mesh, mat, kind: 'steam',
        vx: (Math.random()-0.5)*0.35, vy: 0.70 + Math.random()*0.75, vz: (Math.random()-0.5)*0.35,
        life: 0.45 + Math.random()*0.35, age: 0, scale, grounded: false,
        rot: Math.random()*Math.PI*2, spin: (Math.random()-0.5)*1.6,
      });
    }
  }

  update(dt, camera, world) {
    const q = camera?.quaternion;
    const drag = Math.pow(0.965, dt * 60);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        this._remove(i);
        continue;
      }

      if (p.kind === 'steam') {
        const d = Math.pow(0.94, dt * 60);
        p.vx *= d; p.vz *= d;
        p.vy += 0.35 * dt;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        const grow = 1 + p.age * 1.15;
        p.mesh.scale.setScalar(p.scale * grow);
      } else {
        // Vanilla block chips fall sharply; the previous 4.8 m/s² made them
        // look underwater / slow-motion.
        if (!p.grounded) p.vy -= 13.5 * dt;
        p.vx *= drag;
        p.vy *= drag;
        p.vz *= drag;

        const pos = p.mesh.position;
        const dx = p.vx * dt, dy = p.vy * dt, dz = p.vz * dt;
        if (!blocked(world, pos.x + dx, pos.y, pos.z)) pos.x += dx;
        else p.vx *= -0.05;

        if (!blocked(world, pos.x, pos.y + dy, pos.z)) {
          pos.y += dy;
          p.grounded = false;
        } else {
          if (p.vy < 0) p.grounded = true;
          p.vy = 0;
        }

        if (!blocked(world, pos.x, pos.y, pos.z + dz)) pos.z += dz;
        else p.vz *= -0.05;

        if (p.grounded) {
          p.vx *= 0.56;
          p.vz *= 0.56;
        }
      }

      // Classic digging fragments always face the camera, with a small local
      // spin so an otherwise-square burst does not read as a rigid screen grid.
      p.rot += p.spin * dt;
      if (q) {
        p.mesh.quaternion.copy(q);
        p.mesh.rotateZ(p.rot);
      }

      // Very short fade only at the tail; old particles disappear quickly and
      // do not leave a long translucent smoke trail.
      const remain = 1 - p.age / p.life;
      p.mat.opacity = p.kind === 'steam' ? Math.min(0.82, remain * 1.25) : Math.min(1, remain * 5.0);
    }
  }

  clear() {
    for (let i = this.particles.length - 1; i >= 0; i--) this._remove(i);
  }
}
