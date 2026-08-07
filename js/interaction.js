// interaction.js — 射线拾取、挖掘（硬度×时间）、放置、掉落物、粒子
'use strict';
window.MC = window.MC || {};

MC.Interaction = function (world, player, camera, scene) {
  this.world = world;
  this.player = player;
  this.camera = camera;
  this.scene = scene;

  this.reach = 5;
  this.mineHeld = false;
  this.mineTarget = null;       // {x,y,z}
  this.mineProgress = 0;        // 0..1
  this.mineBlock = null;        // 当前挖掘的方块 id
  this.mineSoundTimer = 0;
  this.mineSoundPhase = 0;

  this.highlight = null;        // 选中方块线框
  this.crack = null;            // 裂纹 overlay mesh
  this.crackFrame = -1;

  this.drops = [];              // 掉落物
  this.particles = [];          // 粒子
  this.dropAcc = 0;             // 掉落物物理累积（60Hz 步长）

  // 手持方块动画状态
  this.handMine = false;
  this.mineTime = 0;
  this.placePulse = 0;

  this.crossTarget = null;      // 当前准星指向 {id, name, x,y,z}

  // 高亮线框
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002));
  this.highlight = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000 }));
  this.highlight.visible = false;
  scene.add(this.highlight);

  // 裂纹 overlay
  this.crack = new THREE.Mesh(
    new THREE.PlaneGeometry(1.02, 1.02),
    new THREE.MeshBasicMaterial({ transparent: true, depthTest: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
  );
  this.crack.visible = false;
  scene.add(this.crack);

  // 放置预览（半透明幽灵方块）
  this.ghostGeo = new THREE.BoxGeometry(1.002, 1.002, 1.002);
  this.ghost = new THREE.Mesh(
    this.ghostGeo,
    new THREE.MeshLambertMaterial({ map: MC.Textures.atlasTexture, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide })
  );
  this.ghost.visible = false;
  scene.add(this.ghost);
  this.ghostBlockId = 0;
};

// 体素 DDA 射线
MC.Interaction.prototype.raycast = function (origin, dir, maxDist) {
  const w = this.world;
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = dir.x > 0 ? 1 : -1, stepY = dir.y > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
  const tdx = Math.abs(1 / (dir.x || 1e-30)), tdy = Math.abs(1 / (dir.y || 1e-30)), tdz = Math.abs(1 / (dir.z || 1e-30));
  let tmx = (stepX > 0 ? (x + 1 - origin.x) : (origin.x - x)) * tdx;
  let tmy = (stepY > 0 ? (y + 1 - origin.y) : (origin.y - y)) * tdy;
  let tmz = (stepZ > 0 ? (z + 1 - origin.z) : (origin.z - z)) * tdz;
  let face = { x: 0, y: 0, z: 0 };
  let t = 0;
  while (t <= maxDist) {
    const id = w.getBlock(x, y, z);
    if (id !== 0 && !MC.BLOCKS[id].liquid) {
      return { x: x, y: y, z: z, id: id, face: face, dist: t };
    }
    if (tmx < tmy && tmx < tmz) { x += stepX; t = tmx; tmx += tdx; face = { x: -stepX, y: 0, z: 0 }; }
    else if (tmy < tmz) { y += stepY; t = tmy; tmy += tdy; face = { x: 0, y: -stepY, z: 0 }; }
    else { z += stepZ; t = tmz; tmz += tdz; face = { x: 0, y: 0, z: -stepZ }; }
    if (y < 0 || y >= MC.WORLD_HEIGHT) return null;
  }
  return null;
};

// 破坏时间（MC 公式：hardness × 1.5；无合适工具 ×5）
MC.Interaction.prototype.breakTime = function (block) {
  if (block.unbreakable) return Infinity;
  const t = block.hardness * (block.needsTool ? 5 : 1.5);
  return Math.max(t, 0.05);
};

MC.Interaction.prototype.update = function (dt, creative) {
  const w = this.world;
  const player = this.player;
  const dir = new THREE.Vector3();
  this.camera.getWorldDirection(dir);

  // 准星目标
  const hit = this.raycast(player.pos.clone().add(new THREE.Vector3(0, 1.62, 0)), dir, this.reach);
  if (hit) {
    this.crossTarget = { id: hit.id, name: MC.BLOCKS[hit.id].name, x: hit.x, y: hit.y, z: hit.z };
    this.highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    this.highlight.visible = true;
  } else {
    this.crossTarget = null;
    this.highlight.visible = false;
  }

  // 放置预览（幽灵方块）：合法位置显示、非法隐藏
  if (hit && this.ghostBlockId > 0) {
    const px = hit.x + hit.face.x, py = hit.y + hit.face.y, pz = hit.z + hit.face.z;
    if (py >= 0 && py < MC.WORLD_HEIGHT) {
      const cur = w.getBlock(px, py, pz);
      const curB = MC.BLOCKS[cur];
      const p = player;
      const overlap = px < p.pos.x + p.half && px + 1 > p.pos.x - p.half &&
        py < p.pos.y + p.height && py + 1 > p.pos.y &&
        pz < p.pos.z + p.half && pz + 1 > p.pos.z - p.half;
      if ((cur === 0 || curB.liquid) && !overlap) {
        this.ghost.position.set(px + 0.5, py + 0.5, pz + 0.5);
        this.ghost.visible = true;
      } else {
        this.ghost.visible = false;
      }
    } else {
      this.ghost.visible = false;
    }
  } else {
    this.ghost.visible = false;
  }

  // 挖掘
  if (this.mineHeld && hit) {
    const block = MC.BLOCKS[hit.id];
    if (block.unbreakable) {
      this.cancelMine();
      this.handMine = false;
    } else {
      this.handMine = true;
      this.mineTime += dt;
      if (!this.mineTarget || this.mineTarget.x !== hit.x || this.mineTarget.y !== hit.y || this.mineTarget.z !== hit.z) {
        this.mineTarget = { x: hit.x, y: hit.y, z: hit.z };
        this.mineBlock = hit.id;
        this.mineProgress = 0;
        this.mineSoundPhase = 0;
      }
      if (this.mineBlock === hit.id) {
        const time = creative ? 0.06 : this.breakTime(block);
        this.mineProgress += dt / time;
        if (MC.Audio && MC.Audio.enabled) {
          this.mineSoundTimer += dt;
          if (this.mineSoundTimer > 0.25) {
            this.mineSoundTimer = 0;
            MC.Audio.dig(block.sound);
          }
        }
        // 裂纹帧
        const frame = Math.min(9, Math.floor(this.mineProgress * 10));
        if (frame !== this.crackFrame) {
          this.crackFrame = frame;
          if (this.mineProgress < 1) this.showCrack(hit, frame);
        }
        if (this.mineProgress >= 1) {
          this.finishMine(hit, block, creative);
        }
      }
    }
  } else {
    this.cancelMine();
    this.handMine = false;
    this.mineTime = 0;
  }

  // 放置脉冲衰减
  if (this.placePulse > 0) {
    this.placePulse *= Math.pow(0.05, dt);
    if (this.placePulse < 0.01) this.placePulse = 0;
  }

  // 掉落物物理（固定 60Hz 步长，稳定平滑）
  this.dropAcc += dt;
  const STEP = 1 / 60;
  let guard = 0;
  while (this.dropAcc >= STEP && guard++ < 4) {
    this.dropAcc -= STEP;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      this.stepDrop(this.drops[i], STEP);
    }
  }
  // 拾取（每帧，平滑吸附）
  const drops = this.drops;
  const ppos = player.pos;
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    if (!d.pickup) continue;
    const dx = ppos.x - d.pos.x, dy = ppos.y + 1 - d.pos.y, dz = ppos.z - d.pos.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.85) {
      // 背包满则不拾取（掉落物留在地上）
      if (this.onPickup && !this.onPickup(d.blockId)) continue;
      this.scene.remove(d.mesh);
      d.mesh.geometry.dispose(); d.mesh.material.dispose();
      drops.splice(i, 1);
      if (MC.Audio && MC.Audio.enabled) MC.Audio.pickup();
    } else if (dist < 2.4) {
      // 距离越近吸附越快（easeOut）
      const pull = dt * 9 * (1 - dist / 2.4) + dt * 2;
      d.pos.x += dx * pull; d.pos.y += dy * pull; d.pos.z += dz * pull;
      d.mesh.position.copy(d.pos);
    }
  }

  // 粒子
  for (let i = this.particles.length - 1; i >= 0; i--) {
    const p = this.particles[i];
    p.age += dt;
    if (p.age > p.life) {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose(); p.mesh.material.dispose();
      this.particles.splice(i, 1);
      continue;
    }
    p.vel.y -= 22 * dt;
    p.pos.addScaledVector(p.vel, dt);
    p.mesh.position.copy(p.pos);
    p.mesh.rotation.x += dt * 5; p.mesh.rotation.z += dt * 4;
    const s = 1 - p.age / p.life;
    p.mesh.scale.setScalar(Math.max(0.05, s));
  }
};

MC.Interaction.prototype.showCrack = function (hit, frame) {
  const f = hit.face;
  const c = this.crack;
  // 面中心
  c.position.set(hit.x + 0.5 + f.x * 0.501, hit.y + 0.5 + f.y * 0.501, hit.z + 0.5 + f.z * 0.501);
  // 朝向：法线
  c.lookAt(c.position.x + f.x, c.position.y + f.y, c.position.z + f.z);
  c.material.map = MC.Textures.crackTextures[frame];
  c.material.needsUpdate = true;
  c.visible = true;
};

// 设置放置预览方块（热栏切换时由 main 调用）
MC.Interaction.prototype.setGhostBlock = function (blockId) {
  if (blockId === this.ghostBlockId) return;
  this.ghostBlockId = blockId;
  if (blockId > 0 && MC.setBoxFaceUV) MC.setBoxFaceUV(this.ghostGeo, blockId);
  if (blockId === 0) this.ghost.visible = false;
};

// 掉落物单步物理（60Hz）
MC.Interaction.prototype.stepDrop = function (d, dt) {
  const w = this.world;
  d.age += dt;
  if (!d.resting) {
    d.vel.y -= 32 * dt;
    d.vel.x *= Math.max(0, 1 - 2.2 * dt);
    d.vel.z *= Math.max(0, 1 - 2.2 * dt);
    d.pos.x += d.vel.x * dt;
    d.pos.z += d.vel.z * dt;
    d.pos.y += d.vel.y * dt;
    if (d.vel.y < 0) {
      const by = Math.floor(d.pos.y + 0.13);
      const id = w.getBlock(Math.floor(d.pos.x), by, Math.floor(d.pos.z));
      const b = MC.BLOCKS[id];
      if (b.solid && !b.liquid) {
        d.pos.y = by + 1 + 0.13;
        d.vel.y = -d.vel.y * 0.5;
        if (Math.abs(d.vel.y) < 0.5) { d.vel.y = 0; d.resting = true; }
      }
    }
    // 4 秒后静止
    if (d.age > 4) {
      d.vel.x *= Math.max(0, 1 - 8 * dt);
      d.vel.z *= Math.max(0, 1 - 8 * dt);
      d.vel.y = 0;
      d.resting = true;
    }
  }
  d.mesh.position.copy(d.pos);
  d.mesh.rotation.y += dt * 2.5;
};

MC.Interaction.prototype.cancelMine = function () {
  this.mineProgress = 0;
  this.mineTarget = null;
  this.mineBlock = null;
  this.crack.visible = false;
  this.crackFrame = -1;
};

MC.Interaction.prototype.finishMine = function (hit, block, creative) {
  const w = this.world;
  w.setBlock(hit.x, hit.y, hit.z, 0);
  this.crack.visible = false;
  this.crackFrame = -1;
  this.mineTarget = null;
  this.mineProgress = 0;
  if (MC.Audio && MC.Audio.enabled) MC.Audio.breakBlock(block.sound);
  this.spawnParticles(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, block);
  if (!creative && block.drop && block.drop > 0) {
    this.spawnDrop(hit.x + 0.5, hit.y + 0.3, hit.z + 0.5, block.drop);
  }
  if (this.onBlockChanged) this.onBlockChanged(hit.x, hit.y, hit.z);
};

// 放置方块（返回是否成功）
MC.Interaction.prototype.place = function (blockId, creative, inventory) {
  const w = this.world;
  const origin = this.camera.getWorldPosition(new THREE.Vector3());
  const dir = new THREE.Vector3();
  this.camera.getWorldDirection(dir);
  const hit = this.raycast(origin, dir, this.reach);
  if (!hit) return false;
  const px = hit.x + hit.face.x, py = hit.y + hit.face.y, pz = hit.z + hit.face.z;
  if (py < 0 || py >= MC.WORLD_HEIGHT) return false;
  const cur = w.getBlock(px, py, pz);
  const curB = MC.BLOCKS[cur];
  if (cur !== 0 && !curB.liquid) return false;
  // 不与玩家重叠
  const p = this.player;
  const bx0 = px, by0 = py, bz0 = pz, bx1 = px + 1, by1 = py + 1, bz1 = pz + 1;
  const px0 = p.pos.x - p.half, px1 = p.pos.x + p.half;
  const py0 = p.pos.y, py1 = p.pos.y + p.height;
  const pz0 = p.pos.z - p.half, pz1 = p.pos.z + p.half;
  if (bx0 < px1 && bx1 > px0 && by0 < py1 && by1 > py0 && bz0 < pz1 && bz1 > pz0) return false;
  w.setBlock(px, py, pz, blockId);
  if (MC.Audio && MC.Audio.enabled) MC.Audio.place(MC.BLOCKS[blockId].sound);
  this.placePulse = 1;   // 手持方块前推动画
  if (this.onBlockChanged) this.onBlockChanged(px, py, pz);
  return true;
};

// 掉落物
MC.Interaction.prototype.spawnDrop = function (x, y, z, blockId) {
  const texKey = MC.BLOCKS[blockId].tex.side;
  const src = MC.Textures.getTexture(texKey) || MC.Textures.atlasCanvas;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.25, 0.25),
    new THREE.MeshLambertMaterial({ map: tex })
  );
  mesh.position.set(x, y, z);
  this.scene.add(mesh);
  this.drops.push({
    mesh: mesh, blockId: blockId, pos: new THREE.Vector3(x, y, z),
    vel: new THREE.Vector3((Math.random() - 0.5) * 3, 3 + Math.random() * 2, (Math.random() - 0.5) * 3),
    age: 0, resting: false, pickup: true
  });
};

// 破坏粒子
MC.Interaction.prototype.spawnParticles = function (x, y, z, block) {
  const colors = {
    grass: 0x6fb63c, dirt: 0x79553a, stone: 0x8a8a8a, wood: 0x7a5c3a,
    sand: 0xdbd3a0, gravel: 0x8b8070, glass: 0xd8f0ff, ore: 0x9a9a9a, snow: 0xf6f9f6
  };
  const color = colors[block.sound] || 0x808080;
  for (let i = 0; i < 14; i++) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.09, 0.09),
      new THREE.MeshBasicMaterial({ color: color })
    );
    const pos = new THREE.Vector3(
      x + (Math.random() - 0.5) * 0.8,
      y + (Math.random() - 0.5) * 0.8,
      z + (Math.random() - 0.5) * 0.8
    );
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.particles.push({
      mesh: mesh, pos: pos,
      vel: new THREE.Vector3((Math.random() - 0.5) * 4, 2 + Math.random() * 3.5, (Math.random() - 0.5) * 4),
      age: 0, life: 0.55 + Math.random() * 0.3
    });
  }
};
