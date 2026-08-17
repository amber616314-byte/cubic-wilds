// Player physics tuned to classic MC movement constants:
//   walk 4.317 m/s, sneak 1.31, sprint 5.612, fly 10.89 (sprint-fly 21.6)
//   gravity 32 m/s^2, jump speed 8.4 m/s, eye height 1.62 m
//   player AABB 0.6 x 1.8 m
import * as THREE from 'three';
import { AIR, WATER, LAVA, isSolid } from './blocks.js';

const HALF = 0.3;
const HEIGHT = 1.8;
const EYE = 1.62;
const GRAVITY = 32;
const JUMP_SPEED = 8.4;
const WALK_SPEED = 4.317;
const SNEAK_SPEED = 1.31;
const SPRINT_SPEED = 5.612;
const FLY_SPEED = 10.89;
const FLY_SPRINT_SPEED = 21.6;
const REACH = 5.5;

export class Player {
  constructor(world, spawn) {
    this.world = world;
    this.pos = new THREE.Vector3(spawn.x + 0.5, spawn.y, spawn.z + 0.5);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI * 0.25;
    this.pitch = 0;
    this.onGround = false;
    this.inWater = false;
    this.inLava = false;
    this.flying = true;
    this.fallDistance = 0;
    this.stepAccum = 0;
    this.sprintFov = 0;
    this.lastJumpPress = -10;
    this.horizontalSpeed = 0;
  }

  eyePos() { return new THREE.Vector3(this.pos.x, this.pos.y + EYE, this.pos.z); }

  forward(horizontalOnly = true) {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    return new THREE.Vector3(-sy * cp, horizontalOnly ? 0 : sp, -cy * cp);
  }

  right() {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  update(dt, input) {
    const wish = new THREE.Vector3();
    const f = this.forward();
    const r = this.right();
    wish.addScaledVector(f, (input.forward ? 1 : 0) - (input.back ? 1 : 0));
    wish.addScaledVector(r, (input.right ? 1 : 0) - (input.left ? 1 : 0));
    if (wish.lengthSq() > 0) wish.normalize();

    // double-tap space toggles flight (classic creative behaviour)
    if (input.jumpPressed && input.canFly) {
      const now = performance.now() / 1000;
      if (now - this.lastJumpPress < 0.28) this.flying = !this.flying;
      this.lastJumpPress = now;
    }

    if (this.flying) this.onGround = false;
    // Reset accumulated fall before this frame's physics; if the player lands
    // during this frame the value is still available for landing damage.
    if (this.onGround || this.flying || this.inWater) this.fallDistance = 0;
    const sneak = input.sneak && !this.flying;
    let speed = this.flying
      ? (input.sprint ? FLY_SPRINT_SPEED : FLY_SPEED)
      : input.sprint ? SPRINT_SPEED : sneak ? SNEAK_SPEED : WALK_SPEED;
    if (this.inWater && !this.flying) speed = 3.1;

    // horizontal velocity, with MC-ish snappy acceleration/friction
    const targetX = wish.x * speed, targetZ = wish.z * speed;
    const accel = this.flying ? 10 : this.onGround ? 14 : 8;
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x += (targetX - this.vel.x) * k;
    this.vel.z += (targetZ - this.vel.z) * k;
    if (wish.lengthSq() === 0 && this.onGround) {
      const fr = Math.exp(-13 * dt);
      this.vel.x *= fr; this.vel.z *= fr;
    }

    // vertical movement
    if (this.flying) {
      const vy = (input.jump ? 1 : 0) - (input.sneak ? 1 : 0);
      this.vel.y += ((vy * speed) - this.vel.y) * (1 - Math.exp(-9 * dt));
      this.fallDistance = 0;
    } else if (this.inWater) {
      this.vel.y -= 6 * dt;
      if (input.jump) this.vel.y += 18 * dt;
      if (this.vel.y < -5.5) this.vel.y = -5.5;
      if (this.vel.y > 4.2) this.vel.y = 4.2;
    } else {
      this.vel.y -= GRAVITY * dt;
      this.vel.y = Math.max(this.vel.y, -78);
      if (input.jump && this.onGround) {
        this.vel.y = JUMP_SPEED;
        this.onGround = false;
      }
    }

    this._moveWithCollisions(dt);

    // fluid detection
    const feet = this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.35), Math.floor(this.pos.z));
    const head = this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + EYE), Math.floor(this.pos.z));
    this.inWater = feet === WATER || head === WATER;
    this.inLava = feet === LAVA || head === LAVA;

    // fall tracking / sprint FOV easing
    if (!this.onGround && !this.flying && !this.inWater && this.vel.y < 0) {
      this.fallDistance += -this.vel.y * dt;
    }
    const targetFov = (input.sprint && wish.lengthSq() > 0 && !this.inWater) || this.flying ? 1 : 0;
    this.sprintFov += (targetFov - this.sprintFov) * Math.min(1, dt * 6);

    this.horizontalSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && this.horizontalSpeed > 1.2) {
      this.stepAccum += this.horizontalSpeed * dt;
    } else {
      this.stepAccum = 0;
    }
  }

  _moveWithCollisions(dt) {
    const steps = 3;
    const dx = this.vel.x * dt / steps;
    const dy = this.vel.y * dt / steps;
    const dz = this.vel.z * dt / steps;
    for (let i = 0; i < steps; i++) {
      this._collideAxis(0, dx);
      this._collideAxis(1, dy);
      this._collideAxis(2, dz);
    }
  }

  _collideAxis(axis, delta) {
    if (delta === 0) return;
    if (axis === 1 && delta < 0) this.onGround = false;
    this.pos.setComponent(axis, this.pos.getComponent(axis) + delta);
    const minX = Math.floor(this.pos.x - HALF), maxX = Math.floor(this.pos.x + HALF);
    const minY = Math.floor(this.pos.y), maxY = Math.floor(this.pos.y + HEIGHT);
    const minZ = Math.floor(this.pos.z - HALF), maxZ = Math.floor(this.pos.z + HALF);
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          if (!isSolid(this.world.getBlock(x, y, z))) continue;
          if (axis === 0) {
            if (delta > 0) this.pos.x = x - HALF - 1e-4;
            else this.pos.x = x + 1 + HALF + 1e-4;
            this.vel.x = 0;
          } else if (axis === 1) {
            if (delta > 0) { this.pos.y = y - HEIGHT - 1e-4; this.vel.y = 0; }
            else {
              this.pos.y = y + 1 + 1e-4;
              this.onGround = true;
              this.vel.y = 0;
            }
          } else {
            if (delta > 0) this.pos.z = z - HALF - 1e-4;
            else this.pos.z = z + 1 + HALF + 1e-4;
            this.vel.z = 0;
          }
        }
      }
    }
  }
}

// Amanatides & Woo voxel traversal.  Returns the first non-air block hit,
// the previous (empty) cell and the face normal.
export function raycastVoxel(world, origin, dir, maxDist = REACH) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = dir.x > 0 ? 1 : -1, stepY = dir.y > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
  const tDeltaX = Math.abs(1 / dir.x), tDeltaY = Math.abs(1 / dir.y), tDeltaZ = Math.abs(1 / dir.z);
  let tMaxX = dir.x !== 0 ? ((stepX > 0 ? x + 1 - origin.x : origin.x - x) * tDeltaX) : Infinity;
  let tMaxY = dir.y !== 0 ? ((stepY > 0 ? y + 1 - origin.y : origin.y - y) * tDeltaY) : Infinity;
  let tMaxZ = dir.z !== 0 ? ((stepZ > 0 ? z + 1 - origin.z : origin.z - z) * tDeltaZ) : Infinity;
  let nx = 0, ny = 0, nz = 0;
  let px = x, py = y, pz = z;

  for (let i = 0; i < 320; i++) {
    const id = world.getBlock(x, y, z);
    if (id !== AIR) {
      return { x, y, z, id, prev: { x: px, y: py, z: pz }, normal: { x: nx, y: ny, z: nz }, dist: Math.min(tMaxX, tMaxY, tMaxZ) };
    }
    px = x; py = y; pz = z;
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      if (tMaxX > maxDist) break;
      x += stepX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY < tMaxZ) {
      if (tMaxY > maxDist) break;
      y += stepY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
    } else {
      if (tMaxZ > maxDist) break;
      z += stepZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
    }
  }
  return null;
}

export function playerAABBIntersectsBlock(px, py, pz, bx, by, bz) {
  return px + HALF > bx && px - HALF < bx + 1 &&
         py + HEIGHT > by && py < by + 1 &&
         pz + HALF > bz && pz - HALF < bz + 1;
}
