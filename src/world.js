// Infinite chunked world generator, modelled after MC 1.8:
//   * broad low-frequency continents + medium-frequency erosion hills
//   * ridged-noise mountain ranges
//   * temperature / rainfall climate noise -> biomes
//   * meandering rivers cut through lowlands
//   * two-scale 3D noise caves (also below the ocean, where they stay flooded)
//   * ore blobs, lava pockets, biome-specific trees and ground cover
import { Noise, mulberry32, hash2i, hash3 } from './noise.js';
import {
  AIR, STONE, GRASS, DIRT, COBBLESTONE, BEDROCK, WATER, LAVA, SAND, GRAVEL,
  GOLD_ORE, IRON_ORE, COAL_ORE, LOG_OAK, LOG_BIRCH, LOG_SPRUCE, LEAVES_OAK,
  LEAVES_BIRCH, LEAVES_SPRUCE, SANDSTONE, TALLGRASS, FLOWER_DANDELION,
  FLOWER_ROSE, DIAMOND_ORE, REDSTONE_ORE, SNOW,
  BIOME_OCEAN, BIOME_DEEP_OCEAN, BIOME_RIVER, BIOME_BEACH, BIOME_STONE_BEACH,
  BIOME_PLAINS, BIOME_DESERT, BIOME_SAVANNA, BIOME_FOREST, BIOME_BIRCH_FOREST,
  BIOME_ROOFED_FOREST, BIOME_SWAMP, BIOME_TAIGA, BIOME_COLD_TAIGA, BIOME_SNOWY,
  BIOME_EXTREME_HILLS,
  CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL, isOpaque,
} from './blocks.js';

const CH = CHUNK_SIZE;
const H = WORLD_HEIGHT;
const SEA = SEA_LEVEL;
const KEY = (cx, cz) => `${cx},${cz}`;
const POSKEY = (x, y, z) => `${x},${y},${z}`;

const TREEABLE = new Set([
  BIOME_PLAINS, BIOME_FOREST, BIOME_BIRCH_FOREST, BIOME_ROOFED_FOREST,
  BIOME_SWAMP, BIOME_TAIGA, BIOME_COLD_TAIGA, BIOME_SAVANNA, BIOME_EXTREME_HILLS,
]);

export class World {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.noise = new Noise(this.seed);
    this.chunks = new Map();
    this.edits = new Map();
    this.columnCache = new Map();
    this.skyCache = new Map();
    // Runtime/persisted fluid metadata. Missing entry on a WATER/LAVA block means
    // a full source block (level 0). Encoded values use the classic liquid
    // convention: 0..7 = horizontal depth, 8..15 = falling liquid with the
    // low three bits carrying its inherited depth.
    this.fluidStates = new Map();
  }

  columnKey(x, z) { return `${x},${z}`; }

  // ------------------------------------------------------------------ columns
  // The old generator used one very large 2D height map.  That produced long,
  // regular "terrace" contours.  This version separates continentalness,
  // erosion, climate and mountain shape, then perturbs the surface with a 3D
  // density field near the top.  It is still intentionally lightweight enough
  // for a browser, but the scale and silhouette are much closer to classic MC.
  _terrainShape(x, z) {
    const n = this.noise;

    const continent = n.fbm2(x * 0.00105 + 137.0, z * 0.00105 - 211.0, 5);
    const macro = n.fbm2(x * 0.0021 - 911.0, z * 0.0021 + 577.0, 4);
    const erosion = n.fbm2(x * 0.0038 + 404.0, z * 0.0038 - 707.0, 3);
    const ridge = n.ridged2(x * 0.0042 + 31.5, z * 0.0042 - 17.5, 4);
    const detail = n.fbm2(x * 0.014 + 811.0, z * 0.014 - 91.0, 3);

    // Broad climate fields.  Keeping them low-frequency prevents postage-stamp
    // biomes and creates the large biome regions familiar from 1.7/1.8.
    const temp = (n.fbm2(x * 0.00072 + 1000.0, z * 0.00072 - 700.0, 4) + 0.04) * 3.2;
    const humid = (n.fbm2(x * 0.00082 - 600.0, z * 0.00082 + 800.0, 4) + 0.05) * 3.2;
    const variant = n.fbm2(x * 0.00165 + 1234.0, z * 0.00165 - 4321.0, 3);
    const riverN = n.fbm2(x * 0.00155 + 311.0, z * 0.00155 - 991.0, 4);

    // Ocean/land is decided primarily by continentalness instead of by the
    // final noisy height.  This gives coherent coastlines and avoids tiny seas.
    const landness = continent + macro * 0.22;
    const oceanDepth = Math.max(0, (-0.12 - landness) / 0.42);
    const coast = Math.max(0, Math.min(1, (landness + 0.18) / 0.24));

    // A soft mountain mask: ridges only become tall on established land and in
    // areas where erosion allows relief.  Plains remain genuinely broad/flat.
    const ridgeMask = Math.max(0, (ridge - 0.62) / 0.38);
    const mountainMask = Math.max(0, Math.min(1, ridgeMask * (0.72 + macro * 0.55) * coast));
    const rolling = macro * (5.0 + Math.max(0, erosion) * 5.0);
    let baseHeight = SEA + 5 + rolling + detail * 2.2;

    if (landness < -0.12) {
      // Smooth shallow shelf -> ocean -> deep ocean.
      baseHeight = SEA - 2 - oceanDepth * 24 + macro * 2.5 + detail * 1.2;
    } else {
      baseHeight += Math.max(-4, landness * 8);
      // Extreme-hills silhouette without the old 100+ block amplitude spikes.
      baseHeight += mountainMask * (18 + 22 * mountainMask + Math.max(0, erosion) * 9);
    }

    // River valleys are wide and smoothly depressed rather than a one-cell
    // hard cut.  Only established land below high mountains can become river.
    const riverWidth = 0.028;
    const riverStrength = Math.max(0, 1 - Math.abs(riverN) / riverWidth);
    if (landness > -0.06 && baseHeight < 99 && riverStrength > 0) {
      const t = riverStrength * riverStrength * (3 - 2 * riverStrength);
      baseHeight = baseHeight * (1 - t * 0.92) + (SEA - 1) * (t * 0.92);
    }

    // Choose biome after the terrain fields are known.  This keeps biome type
    // and terrain character related while still allowing broad transitions.
    let biome;
    if (landness < -0.30) biome = BIOME_DEEP_OCEAN;
    else if (landness < -0.12) biome = BIOME_OCEAN;
    else if (riverStrength > 0.68 && baseHeight <= SEA + 2) biome = BIOME_RIVER;
    else if (baseHeight <= SEA + 1) biome = ridge > 0.76 ? BIOME_STONE_BEACH : BIOME_BEACH;
    else if (mountainMask > 0.43 || baseHeight >= 88) biome = BIOME_EXTREME_HILLS;
    else if (temp < -0.34) biome = humid > 0.18 ? BIOME_COLD_TAIGA : BIOME_SNOWY;
    else if (temp < 0.02) {
      if (humid > 0.42) biome = BIOME_TAIGA;
      else if (humid > 0.12) biome = variant < -0.16 ? BIOME_BIRCH_FOREST : BIOME_FOREST;
      else biome = BIOME_PLAINS;
    } else {
      if (humid < -0.34) biome = BIOME_DESERT;
      else if (humid < -0.10) biome = variant > 0.06 ? BIOME_SAVANNA : BIOME_PLAINS;
      else if (humid > 0.53 && baseHeight < SEA + 8) biome = BIOME_SWAMP;
      else if (humid > 0.27) biome = variant < -0.22 ? BIOME_ROOFED_FOREST : BIOME_FOREST;
      else biome = BIOME_PLAINS;
    }

    // Biome-specific shaping keeps flat biomes flat and lets forests/taiga roll.
    if (biome === BIOME_PLAINS) baseHeight = SEA + 5 + (baseHeight - (SEA + 5)) * 0.58;
    else if (biome === BIOME_DESERT) baseHeight = SEA + 4 + (baseHeight - (SEA + 4)) * 0.48;
    else if (biome === BIOME_SWAMP) baseHeight = SEA + 2 + (baseHeight - (SEA + 2)) * 0.24;
    else if (biome === BIOME_FOREST || biome === BIOME_BIRCH_FOREST || biome === BIOME_ROOFED_FOREST)
      baseHeight = SEA + 7 + (baseHeight - (SEA + 7)) * 0.78;
    else if (biome === BIOME_TAIGA || biome === BIOME_COLD_TAIGA)
      baseHeight = SEA + 8 + (baseHeight - (SEA + 8)) * 0.88;

    const relief = biome === BIOME_EXTREME_HILLS ? 1.0
      : (biome === BIOME_TAIGA || biome === BIOME_COLD_TAIGA) ? 0.48
      : (biome === BIOME_FOREST || biome === BIOME_BIRCH_FOREST || biome === BIOME_ROOFED_FOREST) ? 0.34
      : 0.16;

    return { baseHeight, biome, temp, humid, variant, relief, mountainMask, landness };
  }

  _terrainDensity(x, y, z, shape) {
    // Vertical gradient plus 3D surface displacement.  The second term uses a
    // different scale so exposed mountain faces do not follow long 2D contours.
    const n = this.noise;
    const fine = n.fbm3(x * 0.024 + 17, y * 0.031 - 9, z * 0.024 + 43, 3);
    const coarse = n.fbm3(x * 0.010 - 73, y * 0.017 + 31, z * 0.010 + 19, 2);
    const amp = 0.75 + shape.relief * 4.7;
    return (shape.baseHeight - y) + fine * amp + coarse * amp * 0.55;
  }

  getColumn(x, z) {
    const k = this.columnKey(x, z);
    if (this.columnCache.has(k)) return this.columnCache.get(k);
    const shape = this._terrainShape(x, z);

    // Find the actual top of the density surface near the predicted height.
    // Below this band the terrain is solid (before cave carving), so scanning
    // only ~30 blocks keeps generation fast.
    const top = Math.min(H - 12, Math.ceil(shape.baseHeight + 10));
    const bottom = Math.max(4, Math.floor(shape.baseHeight - 20));
    let height = bottom;
    for (let y = top; y >= bottom; y--) {
      if (this._terrainDensity(x, y, z, shape) > 0) { height = y; break; }
    }
    height = Math.max(4, Math.min(H - 12, height));

    const col = { ...shape, height };
    this.columnCache.set(k, col);
    return col;
  }

  surfaceHeight(x, z) { return this.getColumn(x, z).height; }
  biomeAt(x, z) { return this.getColumn(x, z).biome; }

  // ------------------------------------------------------------------ caves
  caveNoise(x, y, z) {
    const n = this.noise;
    const main = n.fbm3(x * 0.046 + 17.0, y * 0.052 - 5.0, z * 0.046 + 33.0, 3);
    const branch = n.fbm3(x * 0.15 + 91.0, y * 0.19 - 13.0, z * 0.15 - 47.0, 2);
    return { main, branch };
  }

  isCave(x, y, z, h) {
    if (y < 5 || y > H - 8) return false;
    // Keep a thin cap on the surface, but strong noise may still break
    // through and create the classic surface cave entrances.
    if (y >= h - 1 && this.caveNoise(x, y, z).main < 0.48) return false;
    const { main, branch } = this.caveNoise(x, y, z);
    const depthBonus = Math.min(0.07, Math.max(0, 50 - y) * 0.0022);
    const threshold = 0.34 - depthBonus;
    return main > threshold || (main > threshold - 0.08 && branch > 0.64);
  }

  // ------------------------------------------------------------------ chunks
  chunkKey(cx, cz) { return KEY(cx, cz); }
  hasChunk(cx, cz) { return this.chunks.has(this.chunkKey(cx, cz)); }
  getChunk(cx, cz) { return this.chunks.get(this.chunkKey(cx, cz)); }

  generateChunk(cx, cz) {
    const key = this.chunkKey(cx, cz);
    if (this.chunks.has(key)) return this.chunks.get(key);
    const blocks = new Uint8Array(CH * H * CH);
    const x0 = cx * CH, z0 = cz * CH;

    for (let lx = 0; lx < CH; lx++) {
      for (let lz = 0; lz < CH; lz++) {
        const x = x0 + lx, z = z0 + lz;
        const col = this.getColumn(x, z);
        const h = col.height;
        const underwaterColumn = h < SEA;
        const densityFloor = Math.max(3, Math.floor(col.baseHeight - 20));

        for (let y = 0; y <= h; y++) {
          // Use the 3D density field near the surface.  This breaks up long
          // staircase bands and permits small shelves/overhangs on steep land.
          const solidTerrain = y <= densityFloor || this._terrainDensity(x, y, z, col) > 0;
          if (!solidTerrain) {
            if (y <= SEA && underwaterColumn) blocks[(lx * H + y) * CH + lz] = WATER;
            continue;
          }

          let id = this._stoneForDepth(x, y, z, col, h);
          if (y === 0) id = BEDROCK;
          else if (y === 1 && hash3(x, y, z, this.seed ^ 0xbe) < 0.72) id = BEDROCK;
          else if (id === STONE) id = this._oreAt(x, y, z);
          if (id === STONE && y < 10 && this.noise.noise3(x * 0.055 + 11, y * 0.05, z * 0.055 - 29) > 0.74) {
            id = LAVA;
          }
          if (id !== BEDROCK && this.isCave(x, y, z, h)) {
            id = underwaterColumn && y <= SEA ? WATER : AIR;
          }
          blocks[(lx * H + y) * CH + lz] = id;
        }
        if (underwaterColumn) {
          for (let y = h + 1; y <= SEA; y++) blocks[(lx * H + y) * CH + lz] = WATER;
        }
      }
    }

    const chunk = { cx, cz, blocks, meshes: null, dirty: true, loaded: true };
    this.chunks.set(key, chunk);

    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) this._applyTreeCandidates(cx + ox, cz + oz, chunk);
    }
    this._growPlants(chunk);

    for (const [pkey, id] of this.edits) {
      const [ex, ey, ez] = pkey.split(',').map(Number);
      if ((ex >> 4) === cx && (ez >> 4) === cz && ey >= 0 && ey < H) {
        blocks[(ex & 15) * H * CH + ey * CH + (ez & 15)] = id;
      }
    }
    return chunk;
  }

  _stoneForDepth(x, y, z, col, h) {
    const depth = h - y;
    const biome = col.biome;
    const underwater = h < SEA;
    const dirtDepth = biome === BIOME_EXTREME_HILLS ? 2
      : biome === BIOME_PLAINS || biome === BIOME_SAVANNA ? 4
      : biome === BIOME_SWAMP ? 5 : 3;
    const soilHash = hash3(x, 0, z, this.seed ^ 0xd17);

    if (depth === 0) {
      if (biome === BIOME_RIVER || underwater) {
        if (h >= SEA - 3) return SAND;
        return soilHash < 0.32 ? SAND : GRAVEL;
      }
      if (biome === BIOME_STONE_BEACH) return STONE;
      if (biome === BIOME_BEACH) return SAND;
      if (biome === BIOME_DESERT) return SAND;
      if (biome === BIOME_SNOWY) return SNOW;
      if (biome === BIOME_EXTREME_HILLS) {
        if (h >= 91) return SNOW;
        if (h >= 82 && soilHash < 0.22) return STONE;
        return GRASS;
      }
      return GRASS;
    }

    if (underwater || biome === BIOME_RIVER) {
      if (depth < 3) return h >= SEA - 5 ? SAND : DIRT;
      return STONE;
    }
    if (biome === BIOME_BEACH) {
      if (depth < 3) return SAND;
      if (depth < 5 && soilHash < 0.4) return SANDSTONE;
      return STONE;
    }
    if (biome === BIOME_DESERT) {
      if (depth < dirtDepth) return SAND;
      if (depth < dirtDepth + 5) return SANDSTONE;
      return STONE;
    }
    if (biome === BIOME_SNOWY && depth === 1) return GRASS;
    if (depth < dirtDepth) return DIRT;

    // Gravel patches scattered through the stone layer.
    if (y > 5 && hash3(x, y, z, this.seed ^ 0x51) < 0.045) return GRAVEL;
    return STONE;
  }

  _oreAt(x, y, z) {
    const n = this.noise;
    const n1 = n.noise3(x * 0.12 + 13.7, y * 0.12 + 5.1, z * 0.12 - 9.3);
    const n2 = n.noise3(x * 0.17 + 71, y * 0.17 - 19, z * 0.17 + 41);
    const n3 = n.noise3(x * 0.19 - 33, y * 0.19 + 88, z * 0.19 + 12);
    if (y < 96 && y > 5 && n1 > 0.70) return COAL_ORE;
    if (y < 64 && y > 4 && n1 < -0.76) return IRON_ORE;
    if (y < 34 && y > 4 && n2 > 0.76) return GOLD_ORE;
    if (y < 17 && y > 4 && n3 > 0.78) return DIAMOND_ORE;
    if (y < 17 && y > 4 && n3 < -0.82) return REDSTONE_ORE;
    return STONE;
  }

  // ------------------------------------------------------------------ trees
  _treeCandidates(cx, cz) {
    const centerBiome = this.getColumn(cx * CH + 8, cz * CH + 8).biome;
    let attempts;
    switch (centerBiome) {
      case BIOME_FOREST: attempts = 7; break;
      case BIOME_BIRCH_FOREST: attempts = 6; break;
      case BIOME_ROOFED_FOREST: attempts = 5; break;
      case BIOME_TAIGA:
      case BIOME_COLD_TAIGA: attempts = 5; break;
      case BIOME_SWAMP: attempts = 4; break;
      case BIOME_SAVANNA: attempts = 2; break;
      case BIOME_EXTREME_HILLS: attempts = 2; break;
      case BIOME_PLAINS: attempts = 1; break;
      default: attempts = 0;
    }
    const rng = mulberry32(hash2i(cx, cz, this.seed ^ 0x7ee));
    // Per-chunk density jitter breaks any remaining grid-like rhythm.
    attempts = Math.max(0, attempts + Math.floor(rng() * 5) - 2);
    const list = [];
    for (let i = 0; i < attempts; i++) {
      const lx = 2 + Math.floor(rng() * 12);
      const lz = 2 + Math.floor(rng() * 12);
      list.push({
        x: cx * CH + lx, z: cz * CH + lz,
        kindR: rng(), hR: rng(), shapeR: rng(), branchR: rng(),
      });
    }
    return list;
  }

  _treeCandidateAccepted(homeCx, homeCz, c) {
    // Vanilla decorators reject trees when their crowns collide.  Our chunks
    // are generated independently, so use a deterministic priority filter on
    // nearby candidates to get the same practical result without seams.
    const priority = hash3(c.x, 0, c.z, this.seed ^ 0x51f15e);
    const minDist2 = 16; // four-block trunk spacing; crowns may touch, not merge
    for (let cx = homeCx - 1; cx <= homeCx + 1; cx++) {
      for (let cz = homeCz - 1; cz <= homeCz + 1; cz++) {
        for (const o of this._treeCandidates(cx, cz)) {
          if (o.x === c.x && o.z === c.z) continue;
          const dx = o.x - c.x, dz = o.z - c.z;
          if (dx * dx + dz * dz >= minDist2) continue;
          const op = hash3(o.x, 0, o.z, this.seed ^ 0x51f15e);
          if (op < priority || (op === priority && (o.x < c.x || (o.x === c.x && o.z < c.z)))) return false;
        }
      }
    }
    return true;
  }

  _applyTreeCandidates(homeCx, homeCz, chunk) {
    for (const c of this._treeCandidates(homeCx, homeCz)) {
      if (!this._treeCandidateAccepted(homeCx, homeCz, c)) continue;
      const col = this.getColumn(c.x, c.z);
      if (!TREEABLE.has(col.biome)) continue;
      if (col.height < SEA + 1 || col.height > H - 16) continue;
      // No trees floating above cave entrances or on rock/snow.
      if (this.isCave(c.x, col.height, c.z, col.height)) continue;
      const ground = this._stoneForDepth(c.x, col.height, c.z, col, col.height);
      if (ground !== GRASS && ground !== DIRT) continue;

      const biome = col.biome;
      let kind;
      if (biome === BIOME_TAIGA || biome === BIOME_COLD_TAIGA || biome === BIOME_EXTREME_HILLS) kind = 2;
      else if (biome === BIOME_BIRCH_FOREST) kind = 1;
      else if (biome === BIOME_FOREST) kind = c.kindR < 0.68 ? 0 : 1;
      else kind = 0; // plains / swamp / savanna / roofed

      let hgt;
      if (kind === 0) hgt = 4 + Math.floor(c.hR * 3);        // 4..6
      else if (kind === 1) hgt = 5 + Math.floor(c.hR * 3);    // 5..7
      else hgt = 6 + Math.floor(c.hR * 4);                    // 6..9

      this._placeTree(chunk, c.x, col.height, c.z, kind, hgt, c.shapeR, c.branchR);
    }
  }

  _placeTree(chunk, tx, ty, tz, kind, hgt, shapeR = 0.5, branchR = 0.5) {
    const log = kind === 0 ? LOG_OAK : kind === 1 ? LOG_BIRCH : LOG_SPRUCE;
    const leaf = kind === 0 ? LEAVES_OAK : kind === 1 ? LEAVES_BIRCH : LEAVES_SPRUCE;
    const set = (x, y, z, id) => {
      if (y < 0 || y >= H) return;
      const lx = x - chunk.cx * CH, lz = z - chunk.cz * CH;
      if (lx < 0 || lx >= CH || lz < 0 || lz >= CH) return;
      const idx = (lx * H + y) * CH + lz;
      if (id === log) {
        if (chunk.blocks[idx] === AIR || chunk.blocks[idx] === LEAVES_OAK ||
            chunk.blocks[idx] === LEAVES_BIRCH || chunk.blocks[idx] === LEAVES_SPRUCE)
          chunk.blocks[idx] = id;
      } else if (chunk.blocks[idx] === AIR) chunk.blocks[idx] = id;
    };
    const leafLayer = (relY, r, seedSalt, cornerChance = 0.45, fillCenter = true) => {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (!fillCenter && dx === 0 && dz === 0) continue;
        if (r >= 2 && Math.abs(dx) === r && Math.abs(dz) === r &&
            hash3(tx + dx, ty + relY, tz + dz, this.seed ^ seedSalt) < cornerChance) continue;
        set(tx + dx, ty + relY, tz + dz, leaf);
      }
    };

    if (kind === 0 || kind === 1) {
      // WorldGenTrees-style oak/birch: trunk stops inside the crown instead of
      // punching a visible log square through the top of every tree.
      const trunkTop = hgt - 1;
      for (let y = 1; y <= trunkTop; y++) set(tx, ty + y, tz, log);

      // Vanilla-ish four-layer crown: 5x5 lower/middle layers, 3x3 cap.
      leafLayer(hgt - 3, 2, kind === 0 ? 0x111 : 0x211, 0.50, false);
      leafLayer(hgt - 2, 2, kind === 0 ? 0x112 : 0x212, 0.45, false);
      leafLayer(hgt - 1, 1, kind === 0 ? 0x113 : 0x213, 0.0, false);
      leafLayer(hgt,     1, kind === 0 ? 0x114 : 0x214, 0.58, true);

      // A very rare oak side limb adds variation without producing giant blobs.
      if (kind === 0 && shapeR > 0.94 && hgt >= 6) {
        const sx = branchR < 0.25 ? 1 : branchR < 0.5 ? -1 : 0;
        const sz = sx === 0 ? (branchR < 0.75 ? 1 : -1) : 0;
        set(tx + sx, ty + hgt - 2, tz + sz, log);
      }
      return;
    }

    // WorldGenTaiga2-inspired spruce.  The foliage top is a leaf, the trunk is
    // recessed below it, and radii expand/contract in stepped conifer tiers.
    const top = hgt;
    const bareBottom = 1 + Math.floor(shapeR * 2);       // 1..2 blocks bare
    const crownDepth = Math.min(hgt - bareBottom, 4 + Math.floor(shapeR * 3)); // 4..6
    const crownBottom = Math.max(bareBottom + 1, top - crownDepth + 1);
    const maxR = shapeR > 0.72 ? 2 : 2;
    const trunkTop = Math.max(crownBottom + 1, top - 2);
    for (let y = 1; y <= trunkTop; y++) set(tx, ty + y, tz, log);

    let radius = 0;
    let grow = true;
    for (let relY = top; relY >= crownBottom; relY--) {
      const level = top - relY;
      if (level === 0) radius = 0;
      else if (level === 1) radius = 1;
      else if (grow) radius = Math.min(maxR, radius + 1);
      else radius = Math.max(1, radius - 1);

      if (radius === 0) set(tx, ty + relY, tz, leaf);
      else leafLayer(relY, radius, 0x300 + level, radius >= 2 ? 0.58 : 0.20, true);

      // Alternate full and tucked-in tiers after reaching max radius.
      if (radius >= maxR) grow = false;
      else if (radius <= 1 && level > 2) grow = true;
    }
  }

  _growPlants(chunk) {
    const rng = mulberry32(hash2i(chunk.cx, chunk.cz, this.seed ^ 0x9a11));
    let attempts;
    const biome = this.getColumn(chunk.cx * CH + 8, chunk.cz * CH + 8).biome;
    switch (biome) {
      case BIOME_PLAINS: attempts = 30; break;
      case BIOME_SAVANNA: attempts = 20; break;
      case BIOME_FOREST: attempts = 14; break;
      case BIOME_BIRCH_FOREST: attempts = 12; break;
      case BIOME_ROOFED_FOREST: attempts = 8; break;
      case BIOME_SWAMP: attempts = 16; break;
      case BIOME_TAIGA:
      case BIOME_COLD_TAIGA: attempts = 10; break;
      case BIOME_EXTREME_HILLS: attempts = 8; break;
      default: attempts = 0;
    }
    attempts += Math.floor(rng() * 7) - 3;
    for (let i = 0; i < attempts; i++) {
      const lx = Math.floor(rng() * CH), lz = Math.floor(rng() * CH);
      const x = chunk.cx * CH + lx, z = chunk.cz * CH + lz;
      const col = this.getColumn(x, z);
      if (!TREEABLE.has(col.biome) && col.biome !== BIOME_PLAINS) continue;
      if (col.height < SEA + 1 || col.height + 1 >= H) continue;
      if (this.isCave(x, col.height, z, col.height)) continue;
      // Don't place plants on the lip of a cliff; it reads as floating.
      const h = col.height;
      if (this.surfaceHeight(x + 1, z) < h - 1 || this.surfaceHeight(x - 1, z) < h - 1 ||
          this.surfaceHeight(x, z + 1) < h - 1 || this.surfaceHeight(x, z - 1) < h - 1) continue;
      const groundIdx = (lx * H + col.height) * CH + lz;
      if (chunk.blocks[groundIdx] !== GRASS) continue;
      const idx = groundIdx + CH;
      if (chunk.blocks[idx] !== AIR) continue;
      const r = rng();
      if (r < 0.48) chunk.blocks[idx] = TALLGRASS;
      else if (r < 0.70) chunk.blocks[idx] = FLOWER_DANDELION;
      else if (r < 0.88) chunk.blocks[idx] = FLOWER_ROSE;
    }
  }

  // ------------------------------------------------------------------ blocks
  idx(x, y, z) { return ((x & 15) * H + y) * CH + (z & 15); }

  getBlock(x, y, z) {
    if (y < 0 || y >= H) return AIR;
    const cx = x >> 4, cz = z >> 4;
    const chunk = this.chunks.get(this.chunkKey(cx, cz));
    if (!chunk) return AIR;
    return chunk.blocks[this.idx(x, y, z)];
  }

  setBlock(x, y, z, id) {
    if (y < 0 || y >= H) return;
    const cx = x >> 4, cz = z >> 4;
    const chunk = this.chunks.get(this.chunkKey(cx, cz));
    const pkey = POSKEY(x, y, z);
    this.edits.set(pkey, id);
    // A newly placed liquid is a source unless FluidSystem immediately assigns
    // it a flowing/falling level. Non-liquids must drop stale liquid metadata.
    if (id !== WATER && id !== LAVA) this.fluidStates.delete(pkey);
    if (chunk) {
      chunk.blocks[this.idx(x, y, z)] = id;
      chunk.dirty = true;
      const lx = x & 15, lz = z & 15;
      if (lx === 0) this._dirtyChunk(cx - 1, cz);
      if (lx === 15) this._dirtyChunk(cx + 1, cz);
      if (lz === 0) this._dirtyChunk(cx, cz - 1);
      if (lz === 15) this._dirtyChunk(cx, cz + 1);
    }
  }

  getFluidState(x, y, z) {
    const id = this.getBlock(x, y, z);
    if (id !== WATER && id !== LAVA) return null;
    const code = this.fluidStates.get(POSKEY(x, y, z));
    const c = code == null ? 0 : code;
    return {
      id,
      level: c & 7,
      falling: (c & 8) !== 0,
      code: c,
      source: c === 0,
    };
  }

  setFluidState(x, y, z, id, level = 0, falling = false) {
    if (id !== WATER && id !== LAVA) {
      this.setBlock(x, y, z, id);
      return;
    }
    const clamped = Math.max(0, Math.min(7, level | 0));
    const code = (falling ? 8 : 0) | clamped;
    this.setBlock(x, y, z, id);
    const key = POSKEY(x, y, z);
    // Source is the default state, so omit it to keep saves compact.
    if (code === 0) this.fluidStates.delete(key);
    else this.fluidStates.set(key, code);
    const chunk = this.chunks.get(this.chunkKey(x >> 4, z >> 4));
    if (chunk) chunk.dirty = true;
  }

  clearFluidState(x, y, z) {
    this.fluidStates.delete(POSKEY(x, y, z));
  }

  _dirtyChunk(cx, cz) {
    const c = this.chunks.get(this.chunkKey(cx, cz));
    if (c) c.dirty = true;
  }

  // Skylight estimate for a cell.  Five upward rays; a ray reaches the sky
  // when every visited cell is transparent (air/cave/water/leaves).
  skyLight(x, y, z) {
    const key = POSKEY(x, y, z);
    if (this.skyCache.has(key)) return this.skyCache.get(key);
    const col = this.getColumn(x, z);
    if (y >= col.height + 1) {
      this.skyCache.set(key, 1);
      return 1;
    }
    const dirs = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
    let best = 0;
    for (const [dx, dz] of dirs) {
      let yy = y + 1, xx = x, zz = z, ok = true;
      for (; yy < H + 4; yy++) {
        const hHere = this.getColumn(xx, zz).height;
        if (yy > hHere + 1) break;
        const id = this.getBlock(xx, yy, zz);
        if (isOpaque(id)) { ok = false; break; }
        xx += dx; zz += dz;
      }
      if (ok) { best = 1; break; }
    }
    const val = Math.max(0.14, best);
    this.skyCache.set(key, val);
    return val;
  }

  clearSkyCache() { this.skyCache.clear(); }
  clearColumnCache() { this.columnCache.clear(); }

  saveEdits() {
    return {
      gen: 4, seed: this.seed, edits: [...this.edits.entries()],
      fluids: [...this.fluidStates.entries()],
    };
  }

  loadEdits(data) {
    if (!data || ![2, 3, 4].includes(data.gen) || data.seed !== this.seed) return;
    this.edits = new Map(data.edits || []);
    this.fluidStates = new Map(data.fluids || []);
  }
}

export const worldKey = KEY;
