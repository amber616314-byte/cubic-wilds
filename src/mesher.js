// Builds per-chunk BufferGeometry, MC style:
//  * only exposed faces are emitted
//  * per-vertex ambient occlusion / skylight
//  * crossed cutout vegetation
//  * level-aware Minecraft-style liquid surfaces with sloped corners
//  * separate still/flow passes so water/lava use their real animated sheets
import * as THREE from 'three';
import { hash3 } from './noise.js';
import {
  AIR, WATER, LAVA, GLASS, TALLGRASS, FLOWER_DANDELION, FLOWER_ROSE,
  LEAVES_OAK, LEAVES_BIRCH, LEAVES_SPRUCE, CHUNK_SIZE, WORLD_HEIGHT, isOpaque,
} from './blocks.js';
import { blockFaceTiles, tileUV } from './textures.js';

const CH = CHUNK_SIZE, H = WORLD_HEIGHT;
const AO_CURVE = [0.38, 0.58, 0.78, 1.0];

const FACE_DEFS = [
  { dir: [1, 0, 0], light: 0.6, corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], uv: p => [p[2], p[1]] },
  { dir: [-1, 0, 0], light: 0.6, corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], uv: p => [1 - p[2], p[1]] },
  { dir: [0, 1, 0], light: 1.0, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], uv: p => [p[0], p[2]] },
  { dir: [0, -1, 0], light: 0.5, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uv: p => [p[0], 1 - p[2]] },
  { dir: [0, 0, 1], light: 0.8, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], uv: p => [p[0], p[1]] },
  { dir: [0, 0, -1], light: 0.8, corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], uv: p => [1 - p[0], p[1]] },
];

const isLeaf = id => id === LEAVES_OAK || id === LEAVES_BIRCH || id === LEAVES_SPRUCE;
const isPlant = id => id === TALLGRASS || id === FLOWER_DANDELION || id === FLOWER_ROSE;

class GeoPass {
  constructor() {
    this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.idx = [];
  }
  quad(x, y, z, def, tile, brightness) {
    const base = this.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      const c = def.corners[i];
      this.pos.push(x + c[0], y + c[1], z + c[2]);
      this.nrm.push(def.dir[0], def.dir[1], def.dir[2]);
      const [u, v] = def.uv(c);
      const [tu, tv] = tileUV(tile, u, v);
      this.uv.push(tu, tv);
      this.col.push(brightness[i], brightness[i], brightness[i]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  rawQuad(points, normal, uvs, brightness) {
    const base = this.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      const p = points[i];
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(normal[0], normal[1], normal[2]);
      this.uv.push(uvs[i][0], uvs[i][1]);
      const b = Array.isArray(brightness) ? brightness[i] : brightness;
      this.col.push(b, b, b);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build() {
    if (this.idx.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(this.idx), 1));
    g.computeBoundingSphere();
    return g;
  }
}

function aoForVertex(world, wx, wy, wz, def, corner) {
  const qx = wx + def.dir[0], qy = wy + def.dir[1], qz = wz + def.dir[2];
  const normalAxis = def.dir[0] !== 0 ? 0 : def.dir[1] !== 0 ? 1 : 2;
  const tanAxes = [0, 1, 2].filter(d => d !== normalAxis);
  const a = tanAxes[0], b = tanAxes[1];
  const da = corner[a] === 0 ? -1 : 1;
  const db = corner[b] === 0 ? -1 : 1;
  const oa = [0, 0, 0], ob = [0, 0, 0];
  oa[a] = da; ob[b] = db;
  const s1 = isOpaque(world.getBlock(qx + oa[0], qy + oa[1], qz + oa[2])) ? 1 : 0;
  const s2 = isOpaque(world.getBlock(qx + ob[0], qy + ob[1], qz + ob[2])) ? 1 : 0;
  const cc = isOpaque(world.getBlock(qx + oa[0] + ob[0], qy + oa[1] + ob[1], qz + oa[2] + ob[2])) ? 1 : 0;
  const ao = (s1 && s2) ? 0 : 3 - (s1 + s2 + cc);
  return AO_CURVE[ao];
}

// BlockLiquid#getLiquidHeightPercent is effectively (level+1)/9, while the
// renderer uses 1-that value. Falling liquid renders as a nearly-full column.
function cellFluidHeight(world, x, y, z, id) {
  if (world.getBlock(x, y, z) !== id) return 0;
  if (world.getBlock(x, y + 1, z) === id) return 1;
  const s = world.getFluidState(x, y, z);
  if (!s) return 0;
  const level = s.falling ? 0 : s.level;
  return Math.max(1 / 9, (8 - level) / 9);
}

function cornerFluidHeight(world, x, y, z, id, cx, cz) {
  const sx = cx === 0 ? -1 : 1;
  const sz = cz === 0 ? -1 : 1;
  const samples = [[x, z], [x + sx, z], [x, z + sz], [x + sx, z + sz]];
  let sum = 0, weight = 0;
  for (const [px, pz] of samples) {
    if (world.getBlock(px, y + 1, pz) === id) return 1;
    if (world.getBlock(px, y, pz) !== id) continue;
    const state = world.getFluidState(px, y, pz);
    const h = cellFluidHeight(world, px, y, pz, id);
    // Source / near-full cells dominate the average, like vanilla's weighted
    // fluid corner calculation, keeping pools flat while flow fronts slope.
    const w = state?.source || h >= 0.8 ? 4 : 1;
    sum += h * w; weight += w;
  }
  return weight ? sum / weight : cellFluidHeight(world, x, y, z, id);
}

function fluidFlowVector(world, x, y, z, id) {
  const here = cellFluidHeight(world, x, y, z, id);
  let vx = 0, vz = 0;
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  for (const [dx, dz] of dirs) {
    const nx = x + dx, nz = z + dz;
    let nh;
    if (world.getBlock(nx, y, nz) === id) nh = cellFluidHeight(world, nx, y, nz, id);
    else if (!isOpaque(world.getBlock(nx, y, nz))) {
      nh = world.getBlock(nx, y - 1, nz) === id ? 0.05 : 0;
    } else continue;
    const d = Math.max(-1, Math.min(1, here - nh));
    vx += dx * d; vz += dz * d;
  }
  const len = Math.hypot(vx, vz);
  return len > 1e-4 ? { x: vx / len, z: vz / len, moving: true } : { x: 0, z: 0, moving: false };
}

function flowTopUV(flow) {
  if (!flow.moving) return [[0,1],[1,1],[1,0],[0,0]];
  const angle = Math.atan2(flow.z, flow.x) - Math.PI / 2;
  const s = Math.sin(angle) * 0.25, c = Math.cos(angle) * 0.25;
  return [
    [0.5 - c - s, 0.5 - c + s],
    [0.5 - c + s, 0.5 + c + s],
    [0.5 + c + s, 0.5 + c - s],
    [0.5 + c - s, 0.5 - c - s],
  ];
}

function emitFluidBlock(world, lx, y, lz, wx, wz, id, stillPass, flowPass) {
  const aboveSame = world.getBlock(wx, y + 1, wz) === id;
  const light = id === LAVA ? 1 : world.skyLight(wx, y + 1, wz);
  const eps = 0.0015;

  // Corner order: NW-ish (0,0), NE (1,0), SE (1,1), SW (0,1).
  const h00 = cornerFluidHeight(world, wx, y, wz, id, 0, 0);
  const h10 = cornerFluidHeight(world, wx, y, wz, id, 1, 0);
  const h11 = cornerFluidHeight(world, wx, y, wz, id, 1, 1);
  const h01 = cornerFluidHeight(world, wx, y, wz, id, 0, 1);

  if (!aboveSame) {
    const flow = fluidFlowVector(world, wx, y, wz, id);
    const pass = flow.moving ? flowPass : stillPass;
    pass.rawQuad([
      [lx,     y + h01 - eps, lz + 1],
      [lx + 1, y + h11 - eps, lz + 1],
      [lx + 1, y + h10 - eps, lz],
      [lx,     y + h00 - eps, lz],
    ], [0, 1, 0], flowTopUV(flow), light);
  }

  // Bottom uses still texture and stays a full block underside.
  const below = world.getBlock(wx, y - 1, wz);
  if (below !== id && !isOpaque(below)) {
    stillPass.rawQuad([
      [lx, y, lz], [lx + 1, y, lz], [lx + 1, y, lz + 1], [lx, y, lz + 1],
    ], [0, -1, 0], [[0,1],[1,1],[1,0],[0,0]], light * 0.72);
  }

  const sides = [
    // dx,dz, normal, own endpoint heights, neighbour endpoint corner coords,
    // local bottom/top ordering
    { dx: 1, dz: 0, n: [1,0,0], own: [h10,h11], nc: [[0,0],[0,1]], pts: (b0,b1) => [
      [lx+1,y+b0,lz], [lx+1,y+h10,lz], [lx+1,y+h11,lz+1], [lx+1,y+b1,lz+1]] },
    { dx:-1, dz: 0, n: [-1,0,0], own: [h01,h00], nc: [[1,1],[1,0]], pts: (b0,b1) => [
      [lx,y+b0,lz+1], [lx,y+h01,lz+1], [lx,y+h00,lz], [lx,y+b1,lz]] },
    { dx: 0, dz: 1, n: [0,0,1], own: [h11,h01], nc: [[1,0],[0,0]], pts: (b0,b1) => [
      [lx+1,y+b0,lz+1], [lx+1,y+h11,lz+1], [lx,y+h01,lz+1], [lx,y+b1,lz+1]] },
    { dx: 0, dz:-1, n: [0,0,-1], own: [h00,h10], nc: [[0,1],[1,1]], pts: (b0,b1) => [
      [lx,y+b0,lz], [lx,y+h00,lz], [lx+1,y+h10,lz], [lx+1,y+b1,lz]] },
  ];

  for (const side of sides) {
    const nx = wx + side.dx, nz = wz + side.dz;
    const nid = world.getBlock(nx, y, nz);
    if (isOpaque(nid)) continue;
    let b0 = 0, b1 = 0;
    if (nid === id) {
      b0 = cornerFluidHeight(world, nx, y, nz, id, side.nc[0][0], side.nc[0][1]);
      b1 = cornerFluidHeight(world, nx, y, nz, id, side.nc[1][0], side.nc[1][1]);
      if (side.own[0] <= b0 + 0.004 && side.own[1] <= b1 + 0.004) continue;
    }
    const points = side.pts(b0, b1);
    flowPass.rawQuad(points, side.n,
      [[0,b0],[0,side.own[0]],[1,side.own[1]],[1,b1]], light * 0.90);
  }
}

export function buildChunkGeometry(chunk, world) {
  const opaque = new GeoPass();
  const cutout = new GeoPass();
  const plants = new GeoPass();
  const glassP = new GeoPass();
  const waterStill = new GeoPass();
  const waterFlow = new GeoPass();
  const lavaStill = new GeoPass();
  const lavaFlow = new GeoPass();
  const blocks = chunk.blocks;
  const ox = chunk.cx * CH, oz = chunk.cz * CH;

  for (let lx = 0; lx < CH; lx++) {
    for (let lz = 0; lz < CH; lz++) {
      const wx = ox + lx, wz = oz + lz;
      const biome = world.biomeAt(wx, wz);
      for (let y = 0; y < H; y++) {
        const id = blocks[(lx * H + y) * CH + lz];
        if (id === AIR) continue;

        if (id === WATER) {
          emitFluidBlock(world, lx, y, lz, wx, wz, id, waterStill, waterFlow);
          continue;
        }
        if (id === LAVA) {
          emitFluidBlock(world, lx, y, lz, wx, wz, id, lavaStill, lavaFlow);
          continue;
        }

        const pass = (id === GLASS) ? glassP : isLeaf(id) ? cutout : isPlant(id) ? plants : opaque;
        const faces = blockFaceTiles(id, biome);

        if (isPlant(id)) {
          const sky = world.skyLight(wx, y, wz);
          const b = 0.62 + sky * 0.38;
          const tile = faces.side;
          const rh = hash3(wx, y, wz, world.seed ^ 0x9a11);
          const ro = hash3(wx, y, wz, world.seed ^ 0x51a7);
          const jitterX = (rh - 0.5) * 0.16;
          const jitterZ = (ro - 0.5) * 0.16;
          const scale = id === TALLGRASS ? 0.82 + rh * 0.18 : 1.0;
          for (const diag of [0, 1]) {
            const base = pass.pos.length / 3;
            const cs = diag === 0
              ? [[0, 0, 0], [1, 0, 1], [1, 1, 1], [0, 1, 0]]
              : [[1, 0, 0], [0, 0, 1], [0, 1, 1], [1, 1, 0]];
            const nn = diag === 0 ? [-0.7071068, 0, 0.7071068] : [0.7071068, 0, 0.7071068];
            for (const c of cs) {
              pass.pos.push(lx + c[0] + jitterX, y + c[1] * scale, lz + c[2] + jitterZ);
              pass.nrm.push(nn[0], nn[1], nn[2]);
              const [tu, tv] = tileUV(tile, c[0], c[1]);
              pass.uv.push(tu, tv);
              pass.col.push(b, b, b);
            }
            pass.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          }
          continue;
        }

        for (const def of FACE_DEFS) {
          const nx = wx + def.dir[0], ny = y + def.dir[1], nz = wz + def.dir[2];
          const nid = world.getBlock(nx, ny, nz);
          let visible;
          if (id === GLASS) visible = !isOpaque(nid) && nid !== GLASS;
          else if (isLeaf(id)) visible = !isOpaque(nid) && !isLeaf(nid);
          else visible = !isOpaque(nid);
          if (!visible) continue;

          let tile;
          if (def.dir[1] === 1) tile = faces.top;
          else if (def.dir[1] === -1) tile = faces.bottom;
          else tile = faces.side;

          const sky = world.skyLight(nx, ny, nz);
          const brightness = [];
          for (const corner of def.corners) {
            const ao = aoForVertex(world, wx, y, wz, def, corner);
            brightness.push(ao * sky);
          }
          pass.quad(lx, y, lz, def, tile, brightness);
        }
      }
    }
  }

  return {
    opaque: opaque.build(),
    cutout: cutout.build(),
    plants: plants.build(),
    glass: glassP.build(),
    waterStill: waterStill.build(),
    waterFlow: waterFlow.build(),
    lavaStill: lavaStill.build(),
    lavaFlow: lavaFlow.build(),
  };
}
