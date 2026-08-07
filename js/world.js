// world.js — 区块存储 + 地形生成（MC 风格：山丘/生物群系/树/洞穴/矿石/水）
// 生成逻辑拆为纯函数 + 分片生成器（ChunkGen），避免主线程长时间阻塞
'use strict';
window.MC = window.MC || {};

MC.WORLD_HEIGHT = 128;
MC.SEA_LEVEL = 62;

MC.Chunk = function (cx, cz) {
  this.cx = cx;
  this.cz = cz;
  this.data = new Uint8Array(16 * MC.WORLD_HEIGHT * 16);
  this.maxY = 0;             // 最高非空气层（mesh 构建用）
  this.mesh = null;
  this.generated = false;
  this.meshed = false;
  this.dirty = false;
};

MC.World = function (seed) {
  this.seed = (seed >>> 0) || 1337;
  this.chunks = new Map();
};

MC.World.prototype.key = function (cx, cz) { return cx + ',' + cz; };
MC.World.prototype.getChunk = function (cx, cz) { return this.chunks.get(this.key(cx, cz)) || null; };

MC.World.prototype.getBlock = function (x, y, z) {
  if (y < 0) return 17;
  if (y >= MC.WORLD_HEIGHT) return 0;
  const ch = this.chunks.get(this.key(Math.floor(x / 16), Math.floor(z / 16)));
  if (!ch) return 0;
  return ch.data[((y << 8) | ((z & 15) << 4) | (x & 15))];
};

MC.World.prototype.setBlock = function (x, y, z, id) {
  if (y < 0 || y >= MC.WORLD_HEIGHT) return false;
  const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
  const ch = this.chunks.get(this.key(cx, cz));
  if (!ch) return false;
  ch.data[((y << 8) | ((z & 15) << 4) | (x & 15))] = id;
  if (y > ch.maxY) ch.maxY = y;
  ch.dirty = true;
  return true;
};

// ---------- 纯函数：单块生成逻辑（供同步生成 / 分片生成 / 测试复用） ----------

// 高度 + 生物群系 + 填列（局部坐标 lx, lz）
MC.genColumn = function (seed, cx, cz, data, colInfo, lx, lz) {
  const fbm2 = MC.fbm2, hash2i = MC.hash2i;
  const SEA = MC.SEA_LEVEL;
  const wx = cx * 16 + lx, wz = cz * 16 + lz;
  const cont = fbm2(wx * 0.0035, wz * 0.0035, seed + 101, 3);
  const hills = fbm2(wx * 0.02, wz * 0.02, seed + 102, 4);
  const mountains = Math.max(0, cont - 0.62) * 90;
  let h = Math.floor(62 + (cont - 0.5) * 44 + (hills - 0.5) * 24 + mountains);
  h = Math.max(3, Math.min(118, h));
  const temp = fbm2(wx * 0.006, wz * 0.006, seed + 103, 3);
  const moist = fbm2(wx * 0.006, wz * 0.006, seed + 104, 3);
  let biome;
  if (temp > 0.6 && moist < 0.35) biome = 0;        // 沙漠
  else if (temp < 0.34) biome = 1;                  // 雪原
  else if (moist > 0.5) biome = 2;                  // 森林
  else biome = 3;                                   // 平原
  colInfo[lz * 16 + lx] = { h: h, biome: biome };
  for (let y = 0; y <= h; y++) {
    let id;
    if (y === 0) id = 17;
    else if (y === 1 && hash2i(wx, wz, seed + 105) < 0.55) id = 17;
    else if (biome === 0) id = (y >= h - 2) ? 8 : 3;
    else if (biome === 1) id = (y === h) ? 18 : (y >= h - 2 ? 2 : 3);
    else id = (y === h) ? 1 : (y >= h - 2 ? 2 : 3);
    data[(y << 8) | (lz << 4) | lx] = id;
  }
  return h;
};

// 洞穴 + 矿石（一层 y）
MC.genCavesAndOres = function (seed, cx, cz, data, colInfo, ly) {
  const fbm3 = MC.fbm3, hash3i = MC.hash3i;
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      const idx = (ly << 8) | (lz << 4) | lx;
      const id = data[idx];
      if (id === 0 || id === 17 || id === 10) continue;
      const info = colInfo[lz * 16 + lx];
      if (ly > info.h) continue;                    // 列顶以上跳过
      const wx = cx * 16 + lx, wz = cz * 16 + lz;
      // 洞穴（2 octave 噪声，视觉近似且更快）
      if (fbm3(wx * 0.09, ly * 0.09, wz * 0.09, seed + 106, 2) < 0.30) {
        data[idx] = 0;
        continue;
      }
      // 矿石（只在石头里）
      if (id === 3 && fbm3(wx * 0.13, ly * 0.13, wz * 0.13, seed + 107, 2) > 0.72) {
        const r = hash3i(wx, ly, wz, seed + 108);
        let ore;
        if (ly < 16) ore = (r < 0.35 ? 15 : (r < 0.6 ? 16 : 12));
        else if (ly < 32) ore = (r < 0.25 ? 14 : 12);
        else if (ly < 64) ore = (r < 0.35 ? 13 : 12);
        else ore = 12;
        data[idx] = ore;
      }
    }
  }
};

// 水 + 树 + 高草（依赖全部列信息）
MC.genWaterTrees = function (seed, cx, cz, data, colInfo) {
  const hash2i = MC.hash2i;
  const SEA = MC.SEA_LEVEL;
  // 水
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      const info = colInfo[lz * 16 + lx];
      for (let y = info.h + 1; y <= SEA; y++) {
        const idx = (y << 8) | (lz << 4) | lx;
        if (data[idx] === 0) data[idx] = 10;
      }
    }
  }
  // 树 + 高草（避开 chunk 边缘 2 格）
  for (let lz = 2; lz < 14; lz++) {
    for (let lx = 2; lx < 14; lx++) {
      const info = colInfo[lz * 16 + lx];
      const wx = cx * 16 + lx, wz = cz * 16 + lz;
      const h = info.h;
      const topId = data[(h << 8) | (lz << 4) | lx];
      const treeChance = info.biome === 2 ? 0.16 : (info.biome === 3 ? 0.06 : 0);
      if (treeChance > 0 && topId === 1 && h > SEA + 1 && hash2i(wx, wz, seed + 110) < treeChance) {
        placeTree(data, lx, lz, h, seed + 111);
      } else if (topId === 1 && hash2i(wx, wz, seed + 112) < 0.045) {
        const idx = ((h + 1) << 8) | (lz << 4) | lx;
        if (data[idx] === 0) data[idx] = 19;
      }
    }
  }
};

// 纯函数：完整同步生成（返回 {data, colInfo, maxY}）
MC.generateChunkData = function (seed, cx, cz) {
  const data = new Uint8Array(16 * MC.WORLD_HEIGHT * 16);
  const colInfo = new Array(256);
  let maxY = 0;
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      const h = MC.genColumn(seed, cx, cz, data, colInfo, lx, lz);
      if (h > maxY) maxY = h;
    }
  }
  for (let ly = 6; ly < 112; ly++) MC.genCavesAndOres(seed, cx, cz, data, colInfo, ly);
  MC.genWaterTrees(seed, cx, cz, data, colInfo);
  // 树会超出列高，重算 maxY
  for (let ly = maxY; ly < 118; ly++) {
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        if (data[(ly << 8) | (lz << 4) | lx] !== 0) { maxY = ly; break; }
      }
    }
  }
  return { data: data, colInfo: colInfo, maxY: maxY };
};

// ---------- 分片生成器（主线程渐进生成，不阻塞渲染） ----------
MC.ChunkGen = function (seed, cx, cz) {
  this.seed = seed;
  this.cx = cx;
  this.cz = cz;
  this.data = new Uint8Array(16 * MC.WORLD_HEIGHT * 16);
  this.colInfo = new Array(256);
  this.phase = 0;       // 0 列（8 片）→ 1 洞穴矿石（2 片）→ 2 水树（1 片）
  this.piece = 0;
  this.maxY = 0;
  this.done = false;
};

// 处理一片，返回是否完成
MC.ChunkGen.prototype.step = function () {
  const seed = this.seed, cx = this.cx, cz = this.cz;
  const data = this.data, colInfo = this.colInfo;
  if (this.phase === 0) {
    const lz = this.piece * 2;
    for (let i = 0; i < 2; i++) {
      const z = lz + i;
      if (z >= 16) break;
      for (let lx = 0; lx < 16; lx++) {
        const h = MC.genColumn(seed, cx, cz, data, colInfo, lx, z);
        if (h > this.maxY) this.maxY = h;
      }
    }
    this.piece++;
    if (this.piece >= 8) { this.phase = 1; this.piece = 0; }
    return false;
  }
  if (this.phase === 1) {
    const y0 = 6 + this.piece * 54;
    const y1 = Math.min(112, y0 + 54);
    for (let ly = y0; ly < y1; ly++) MC.genCavesAndOres(seed, cx, cz, data, colInfo, ly);
    this.piece++;
    if (this.piece >= 2) { this.phase = 2; this.piece = 0; }
    return false;
  }
  // phase 2：水 + 树 + 高草
  MC.genWaterTrees(seed, cx, cz, data, colInfo);
  // 重算 maxY：树冠可能远高于列高（否则树冠层不构建、树叶不显示）
  for (let ly = this.maxY; ly < MC.WORLD_HEIGHT; ly++) {
    let found = false;
    for (let lz = 0; lz < 16 && !found; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        if (data[(ly << 8) | (lz << 4) | lx] !== 0) { this.maxY = ly; found = true; break; }
      }
    }
    if (!found) break;   // 该层全空：树冠之上没有方块
  }
  this.done = true;
  return true;
};

// 同步生成（保留：测试/无 worker 快速路径）
MC.World.prototype.generateChunk = function (cx, cz) {
  if (this.chunks.has(this.key(cx, cz))) return;
  const ch = new MC.Chunk(cx, cz);
  const res = MC.generateChunkData(this.seed, cx, cz);
  ch.data = res.data;
  ch.maxY = res.maxY;
  ch.generated = true;
  this.chunks.set(this.key(cx, cz), ch);
};

// 分片生成：把 ChunkGen 的结果装入世界
MC.World.prototype.installChunk = function (gen) {
  const key = this.key(gen.cx, gen.cz);
  if (this.chunks.has(key)) return;
  const ch = new MC.Chunk(gen.cx, gen.cz);
  ch.data = gen.data;
  ch.maxY = gen.maxY;
  ch.generated = true;
  this.chunks.set(key, ch);
};

// 在局部坐标种橡树（树干 lx,lz，地面 h）
function placeTree(data, lx, lz, h, seed) {
  const trunk = 4 + Math.floor(MC.hash2i(lx * 31, lz * 17, seed) * 3);
  const set = function (dx, dy, dz, id) {
    const x = lx + dx, y = h + dy, z = lz + dz;
    if (y < 0 || y >= MC.WORLD_HEIGHT || x < 0 || x > 15 || z < 0 || z > 15) return;
    data[(y << 8) | (z << 4) | x] = id;
  };
  for (let dy = 1; dy <= trunk; dy++) set(0, dy, 0, 5);
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (Math.abs(dx) === 2 && Math.abs(dz) === 2 && MC.hash2i(lx + dx, lz + dz, seed + 1) < 0.5) continue;
      set(dx, trunk - 1, dz, 6);
      set(dx, trunk, dz, 6);
    }
  }
  set(0, trunk + 1, 0, 6);
}

// 找到出生点：中心附近最高实心方块上方（跳过树叶/高草）
MC.World.prototype.findSpawn = function () {
  const cx = 0, cz = 0;
  if (!this.getChunk(cx, cz)) this.generateChunk(cx, cz);
  for (let y = MC.WORLD_HEIGHT - 1; y > 0; y--) {
    const id = this.getBlock(cx * 16 + 8, y, cz * 16 + 8);
    if (id !== 0 && id !== 6 && id !== 19 && !MC.BLOCKS[id].liquid) {
      let sy = y + 1;
      if (y < MC.SEA_LEVEL) sy = MC.SEA_LEVEL + 1;
      return { x: cx * 16 + 8.5, y: sy + 0.01, z: cz * 16 + 8.5 };
    }
  }
  return { x: 8.5, y: MC.SEA_LEVEL + 2, z: 8.5 };
};
