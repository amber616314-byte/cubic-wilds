// Lightweight Minecraft 1.8-style liquid simulation.
//
// The world stores only block IDs, so flowing metadata is kept separately in
// World.fluidStates using the classic 0..7 / 8..15 convention.  We schedule
// only liquids affected by player edits (plus their neighbours), which keeps a
// browser world fast while still giving placed water/lava the familiar MC
// behaviour: downward priority, stepped horizontal spread, water source
// renewal, slow lava, slope-seeking, and water/lava mixing.
import {
  AIR, WATER, LAVA, COBBLESTONE, OBSIDIAN,
  BLOCKS, isSolid,
} from './blocks.js';

const HORIZONTAL = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];
const AROUND = [
  [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
  [0, 1, 0], [0, -1, 0],
];
const keyOf = (x, y, z) => `${x},${y},${z}`;

export class FluidSystem {
  constructor(world, audio = null, onFizz = null) {
    this.world = world;
    this.audio = audio;
    this.onFizz = onFizz;
    this.time = 0;
    this.scheduled = new Map();
    this.lastFizz = -10;
  }

  tickRate(id) {
    // Classic scheduled-tick feel: water updates rapidly, overworld lava much
    // more deliberately.  One MC tick is 50 ms.
    return id === WATER ? 0.25 : 1.50;
  }

  _loaded(x, z) {
    return this.world.hasChunk(x >> 4, z >> 4);
  }

  schedule(x, y, z, id = null, delay = null) {
    if (y < 0 || y >= 128 || !this._loaded(x, z)) return;
    id = id ?? this.world.getBlock(x, y, z);
    if (id !== WATER && id !== LAVA) return;
    const due = this.time + (delay == null ? this.tickRate(id) : delay);
    const key = keyOf(x, y, z);
    const old = this.scheduled.get(key);
    if (!old || due < old.due) this.scheduled.set(key, { x, y, z, id, due });
  }

  scheduleAround(x, y, z, immediate = false) {
    const delay = immediate ? 0.001 : null;
    const here = this.world.getBlock(x, y, z);
    if (here === WATER || here === LAVA) this.schedule(x, y, z, here, delay);
    for (const [dx, dy, dz] of AROUND) {
      const id = this.world.getBlock(x + dx, y + dy, z + dz);
      if (id === WATER || id === LAVA) this.schedule(x + dx, y + dy, z + dz, id, delay);
    }
  }

  placeSource(x, y, z, id) {
    this.world.setFluidState(x, y, z, id, 0, false);
    this.schedule(x, y, z, id, 0.01);
    this.scheduleAround(x, y, z, true);
  }

  notifyBlockChanged(x, y, z) {
    this.scheduleAround(x, y, z, true);
  }

  bootstrapFromSave() {
    // Reactivate edited liquids after a reload. Natural oceans/lava pockets are
    // intentionally dormant until disturbed, just like unloaded scheduled
    // ticks in a real world.
    for (const [k, id] of this.world.edits) {
      if (id !== WATER && id !== LAVA) continue;
      const [x, y, z] = k.split(',').map(Number);
      if (this._loaded(x, z)) this.schedule(x, y, z, id, 0.05 + Math.random() * 0.15);
    }
  }

  activateChunk(cx, cz) {
    // Chunks are streamed in after the World is constructed. Re-arm saved
    // liquid edits belonging to this chunk once their block data actually
    // exists, otherwise scheduled ticks would be discarded while unloaded.
    for (const [k, id] of this.world.edits) {
      if (id !== WATER && id !== LAVA) continue;
      const [x, y, z] = k.split(',').map(Number);
      if ((x >> 4) !== cx || (z >> 4) !== cz) continue;
      this.schedule(x, y, z, id, 0.04 + Math.random() * 0.10);
    }
  }

  update(dt) {
    this.time += Math.min(dt, 0.1);
    let budget = 96;
    // Map iteration is stable and the active set is normally tiny.  A hard
    // budget prevents a lava/water experiment from stalling the render thread.
    for (const [key, e] of this.scheduled) {
      if (budget <= 0) break;
      if (e.due > this.time) continue;
      this.scheduled.delete(key);
      if (this.world.getBlock(e.x, e.y, e.z) !== e.id) continue;
      this._tick(e.x, e.y, e.z, e.id);
      budget--;
    }
  }

  _state(x, y, z, id) {
    if (this.world.getBlock(x, y, z) !== id) return null;
    return this.world.getFluidState(x, y, z);
  }

  _effectiveLevel(state) {
    if (!state) return 99;
    // Falling liquid behaves as a high-flow column for side propagation.
    return state.falling ? 0 : state.level;
  }

  _replaceable(id) {
    return id === AIR || id === WATER || id === LAVA || BLOCKS[id]?.plant;
  }

  _canEnter(x, y, z, fluidId, newLevel = 7) {
    if (y < 0 || y >= 128 || !this._loaded(x, z)) return false;
    const id = this.world.getBlock(x, y, z);
    if (id === AIR || BLOCKS[id]?.plant) return true;
    if (id === (fluidId === WATER ? LAVA : WATER)) return true;
    if (id !== fluidId) return false;
    const s = this.world.getFluidState(x, y, z);
    if (!s || s.source) return false;
    return s.falling || s.level > newLevel;
  }

  _setFlow(x, y, z, id, level, falling) {
    if (!this._loaded(x, z)) return false;
    const existing = this.world.getBlock(x, y, z);
    const opposite = id === WATER ? LAVA : WATER;
    if (existing === opposite) {
      this._mixAt(x, y, z, opposite, id);
      return true;
    }
    if (existing !== AIR && !BLOCKS[existing]?.plant && existing !== id) return false;

    if (existing === id) {
      const cur = this.world.getFluidState(x, y, z);
      if (cur?.source) return false;
      if (cur && cur.falling === falling && cur.level <= level) return false;
    }

    this.world.setFluidState(x, y, z, id, level, falling);
    this.schedule(x, y, z, id);
    this.scheduleAround(x, y, z, false);
    return true;
  }

  _removeFlow(x, y, z, id) {
    const s = this._state(x, y, z, id);
    if (!s || s.source) return;
    this.world.setBlock(x, y, z, AIR);
    this.world.clearFluidState(x, y, z);
    this.scheduleAround(x, y, z, true);
  }

  _mixAt(x, y, z, lavaId, incomingId = WATER) {
    // x/y/z is always the lava cell when possible.  Source lava touched by
    // water becomes obsidian; flowing/falling lava becomes cobblestone.
    let lx = x, ly = y, lz = z;
    if (this.world.getBlock(lx, ly, lz) !== LAVA) return false;
    const s = this.world.getFluidState(lx, ly, lz);
    const product = s && s.source ? OBSIDIAN : COBBLESTONE;
    this.world.setBlock(lx, ly, lz, product);
    this.world.clearFluidState(lx, ly, lz);
    this.world.clearSkyCache();
    this.scheduleAround(lx, ly, lz, true);
    if (this.time - this.lastFizz > 0.07) {
      this.lastFizz = this.time;
      this.audio?.playLavaPop?.();
    }
    this.onFizz?.(lx + 0.5, ly + 0.9, lz + 0.5);
    return true;
  }

  _checkLavaMix(x, y, z) {
    if (this.world.getBlock(x, y, z) !== LAVA) return false;
    // Vanilla mixing checks the sides and the block above; water below does
    // not instantly freeze a lava source until the two flows actually meet.
    const checks = [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0]];
    for (const [dx,dy,dz] of checks) {
      if (this.world.getBlock(x + dx, y + dy, z + dz) === WATER) {
        return this._mixAt(x, y, z, LAVA, WATER);
      }
    }
    return false;
  }

  _sourceNeighbours(x, y, z, id) {
    let n = 0;
    for (const [dx, dz] of HORIZONTAL) {
      const s = this._state(x + dx, y, z + dz, id);
      if (s?.source) n++;
    }
    return n;
  }

  _desiredState(x, y, z, id, state) {
    if (state.source) return state;

    const above = this._state(x, y + 1, z, id);
    if (above) {
      return { id, level: this._effectiveLevel(above), falling: true, source: false };
    }

    const inc = id === WATER ? 1 : 2;
    let min = 99;
    for (const [dx, dz] of HORIZONTAL) {
      const n = this._state(x + dx, y, z + dz, id);
      if (!n) continue;
      min = Math.min(min, this._effectiveLevel(n));
    }

    if (id === WATER && this._sourceNeighbours(x, y, z, WATER) >= 2) {
      const below = this.world.getBlock(x, y - 1, z);
      const bs = this._state(x, y - 1, z, WATER);
      if (isSolid(below) || bs?.source) {
        return { id, level: 0, falling: false, source: true };
      }
    }

    const level = min + inc;
    if (min === 99 || level > 7) return null;
    return { id, level, falling: false, source: false };
  }

  _flowCost(x, y, z, id, depth, fromDx, fromDz) {
    const maxDepth = id === WATER ? 4 : 2;
    if (depth >= maxDepth) return 1000;
    let best = 1000;
    for (const [dx, dz] of HORIZONTAL) {
      if (dx === -fromDx && dz === -fromDz) continue;
      const nx = x + dx, nz = z + dz;
      const bid = this.world.getBlock(nx, y, nz);
      if (isSolid(bid) || (bid === id && this.world.getFluidState(nx, y, nz)?.source)) continue;
      if (!this._replaceable(bid)) continue;
      const below = this.world.getBlock(nx, y - 1, nz);
      if (!isSolid(below) && below !== id) return depth;
      best = Math.min(best, this._flowCost(nx, y, nz, id, depth + 1, dx, dz));
    }
    return best;
  }

  _bestHorizontal(x, y, z, id, nextLevel) {
    let minCost = 1000;
    const result = [];
    for (const [dx, dz] of HORIZONTAL) {
      const nx = x + dx, nz = z + dz;
      if (!this._canEnter(nx, y, nz, id, nextLevel)) continue;
      const below = this.world.getBlock(nx, y - 1, nz);
      const cost = (!isSolid(below) && below !== id)
        ? 0 : this._flowCost(nx, y, nz, id, 1, dx, dz);
      if (cost < minCost) {
        minCost = cost;
        result.length = 0;
        result.push([dx, dz]);
      } else if (cost === minCost) result.push([dx, dz]);
    }
    return result;
  }

  _tick(x, y, z, id) {
    if (!this._loaded(x, z)) return;
    if (id === LAVA && this._checkLavaMix(x, y, z)) return;

    let state = this.world.getFluidState(x, y, z);
    if (!state) return;

    const desired = this._desiredState(x, y, z, id, state);
    if (!desired) {
      this._removeFlow(x, y, z, id);
      return;
    }
    if (!state.source && (desired.source || desired.level !== state.level || desired.falling !== state.falling)) {
      this.world.setFluidState(x, y, z, id, desired.level, desired.falling);
      state = this.world.getFluidState(x, y, z);
    }

    // Gravity wins. A falling column inherits the effective depth of the cell
    // feeding it and does not fan out until it reaches a floor.
    const belowY = y - 1;
    const below = this.world.getBlock(x, belowY, z);
    const opposite = id === WATER ? LAVA : WATER;
    if (below === opposite) {
      if (below === LAVA) this._mixAt(x, belowY, z, LAVA, id);
      else {
        // Lava entering water creates cobblestone at the contact cell; the
        // feeding lava remains, matching the classic generator setup.
        this.world.setBlock(x, belowY, z, COBBLESTONE);
        this.world.clearFluidState(x, belowY, z);
        this.world.clearSkyCache();
        this.audio?.playLavaPop?.();
        this.onFizz?.(x + 0.5, belowY + 0.9, z + 0.5);
        this.scheduleAround(x, belowY, z, true);
      }
      this.schedule(x, y, z, id);
      return;
    }

    if (this._canEnter(x, belowY, z, id, this._effectiveLevel(state))) {
      this._setFlow(x, belowY, z, id, this._effectiveLevel(state), true);
      this.schedule(x, y, z, id);
      return;
    }

    const inc = id === WATER ? 1 : 2;
    const base = state.falling ? 0 : state.level;
    const nextLevel = base + inc;
    if (nextLevel <= 7) {
      const dirs = this._bestHorizontal(x, y, z, id, nextLevel);
      for (const [dx, dz] of dirs) {
        const nx = x + dx, nz = z + dz;
        const target = this.world.getBlock(nx, y, nz);
        if (target === opposite) {
          if (target === LAVA) this._mixAt(nx, y, nz, LAVA, id);
          else {
            this.world.setBlock(nx, y, nz, COBBLESTONE);
            this.world.clearFluidState(nx, y, nz);
            this.world.clearSkyCache();
            this.audio?.playLavaPop?.();
            this.onFizz?.(nx + 0.5, y + 0.9, nz + 0.5);
            this.scheduleAround(nx, y, nz, true);
          }
        } else {
          this._setFlow(nx, y, nz, id, nextLevel, false);
        }
      }
    }

    // Keep flowing cells alive so they recalculate when their feeder changes.
    if (!state.source) this.schedule(x, y, z, id);
  }
}
