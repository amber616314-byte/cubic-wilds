// player.js — 第一人称玩家控制器（物理参数精确复刻 Minecraft Java 1.18）
'use strict';
window.MC = window.MC || {};

// 单位：格/tick（1 tick = 0.05s），与 MC 数值一致
MC.WALK_SPEED = 4.317 / 20;      // 走路 4.317 m/s
MC.SPRINT_SPEED = 5.612 / 20;    // 疾跑 5.612 m/s
MC.SNEAK_SPEED = 1.295 / 20;     // 潜行 1.295 m/s
MC.FLY_SPEED = 10.92 / 20;       // 创造飞行 10.92 m/s
MC.FLY_SPRINT_SPEED = 21.6 / 20; // 疾跑飞行 21.6 m/s
MC.JUMP_VELOCITY = 0.42;         // 跳跃初速 0.42 格/tick → 跳 ~1.13 格
MC.GRAVITY = 0.09;                // 重力（比 MC 0.08 大 → 起跳/下落干脆）
MC.TERMINAL_VELOCITY = -2.91;      // 终端速度 格/tick（≈58 格/s，加速快、落地干脆）
MC.GROUND_DAMP = 0.546;          // 地面水平阻尼
MC.AIR_DAMP = 0.91;              // 空中水平阻尼（有输入时）
MC.VERT_DAMP = 0.97;             // 垂直阻尼（MC 0.98，更低 → 下落干脆）
MC.ACC_GROUND = 0.1;             // 地面加速度
MC.ACC_GROUND_SPRINT = 0.13;
MC.ACC_AIR = 0.02;               // 空中加速度
MC.ACC_AIR_SPRINT = 0.026;

MC.Player = function (world) {
  this.world = world;
  this.pos = new THREE.Vector3();     // 脚底中心
  this.prevPos = new THREE.Vector3();
  this.vel = new THREE.Vector3();
  this.yaw = 0;                       // 弧度
  this.pitch = 0;
  this.half = 0.3;                    // 碰撞箱 0.6×1.8
  this.height = 1.8;
  this.onGround = false;
  this.flying = false;
  this.sneaking = false;
  this.sprinting = false;
  this.inWater = false;
  this.jumpPressed = false;           // 本 tick 内按下跳跃（含缓冲）
  this.jumpBuffer = 0;
  this.stepAccum = 0;
  this.stepTrigger = 2.9;
  this.bobPhase = 0;
  this.bobAmount = 0;
  this.onStep = null;                 // 脚步声回调
  this.onLand = null;                 // 落地回调（fallSpeed 0..1）
  this.prevOnGround = false;
  this.landKick = 0;                  // 落地镜头下沉量（厚重感）
  this.jumpKick = 0;                  // 起跳蹬地镜头下沉量
};

MC.Player.prototype.spawn = function () {
  const s = this.world.findSpawn();
  this.pos.set(s.x, s.y, s.z);
  this.prevPos.copy(this.pos);
  this.vel.set(0, 0, 0);
  this.yaw = 0; this.pitch = 0;
  this.onGround = false;
};

MC.Player.prototype.toggleFly = function () {
  this.flying = !this.flying;
  if (!this.flying) this.vel.y = 0;
};

// input: {mx, mz (归一化方向), jump(bool 按住), sneak, sprint, jumpPressed}
MC.Player.prototype.tick = function (dt, input) {
  const scale = dt / 0.05;
  const w = this.world;
  this.sneaking = !!input.sneak;
  this.sprinting = !!input.sprint;

  // 方向向量（相对相机朝向，ix=右正 iz=后正）
  const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
  const ix = input.right - input.left;
  const iz = input.back - input.forward;
  // 局部系：forward=(-sin,-cos)，right=(cos,-sin)
  // world: mx = iz*sin + ix*cos；mz = iz*cos - ix*sin
  let mx = iz * sy + ix * cy;
  let mz = iz * cy - ix * sy;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }

  // 潜行防坠落：脚下无支撑则禁止移动
  if (this.sneaking && !this.flying && (mx !== 0 || mz !== 0)) {
    const tx = this.pos.x + mx * 0.3, tz = this.pos.z + mz * 0.3;
    const y = Math.floor(this.pos.y - 0.06);
    const x0 = Math.floor(tx - this.half), x1 = Math.floor(tx + this.half - 1e-7);
    const z0 = Math.floor(tz - this.half), z1 = Math.floor(tz + this.half - 1e-7);
    let supported = false;
    outer:
    for (let zz = z0; zz <= z1; zz++) {
      for (let xx = x0; xx <= x1; xx++) {
        const id = w.getBlock(xx, y, zz);
        const b = MC.BLOCKS[id];
        if (b.solid && !b.liquid) { supported = true; break outer; }
      }
    }
    if (!supported) { mx = 0; mz = 0; }
  }

  // 水中判定
  const idFeet = w.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.1), Math.floor(this.pos.z));
  const idHead = w.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 1.5), Math.floor(this.pos.z));
  this.inWater = (MC.BLOCKS[idFeet].liquid || MC.BLOCKS[idHead].liquid) && !this.flying;

  // 水平速度（MC 顺序：先阻尼 → 再加速 → 再 clamp，稳态 = accel/(1-damp)）
  let target = this.sneaking ? MC.SNEAK_SPEED : this.sprinting ? MC.SPRINT_SPEED : MC.WALK_SPEED;
  let accel = this.onGround ? (this.sprinting ? MC.ACC_GROUND_SPRINT : MC.ACC_GROUND) : (this.sprinting ? MC.ACC_AIR_SPRINT : MC.ACC_AIR);
  if (this.inWater) { target *= 0.5; accel = 0.03; }
  const damp = this.onGround ? MC.GROUND_DAMP : MC.AIR_DAMP;
  const d = Math.pow(damp, scale);
  this.vel.x *= d; this.vel.z *= d;
  this.vel.x += mx * accel * scale;
  this.vel.z += mz * accel * scale;
  const horiz = Math.hypot(this.vel.x, this.vel.z);
  if (horiz > target) { this.vel.x *= target / horiz; this.vel.z *= target / horiz; }

  // 垂直速度
  if (this.flying) {
    let vy = 0;
    if (input.jump) vy += 1;
    if (input.sneak) vy -= 1;
    const fs = this.sprinting ? MC.FLY_SPRINT_SPEED : MC.FLY_SPEED;
    this.vel.y = vy * fs * scale;
    this.onGround = false;
  } else if (this.inWater) {
    this.vel.y = (this.vel.y - 0.02 * scale) * Math.pow(0.8, scale);
    if (this.vel.y < -0.35) this.vel.y = -0.35;
    if (input.jump) this.vel.y = Math.min(this.vel.y + 0.06 * scale, 0.3);
  } else {
    this.vel.y = (this.vel.y - MC.GRAVITY * scale) * Math.pow(MC.VERT_DAMP, scale);
    if (this.vel.y < MC.TERMINAL_VELOCITY) this.vel.y = MC.TERMINAL_VELOCITY;
  }

  // 跳跃
  if (this.jumpPressed && !this.flying && !this.inWater && this.onGround) {
    this.vel.y = MC.JUMP_VELOCITY;
    this.onGround = false;
    this.jumpKick = 0.03;             // 起跳蹬地：镜头短暂下沉
    this.bobPhase = 0;                // 重置摆臂相位，脚步一致
  }

  // 物理移动（dt 用 tick 单位：速度 = 格/tick，与 MC 一致）
  const vyBefore = this.vel.y;
  const res = MC.Physics.move(w, this.pos, this.vel, scale, {
    half: this.half,
    height: this.height,
    step: 1.0,   // 自动跨 1 格台阶（地形为整格台阶，避免频繁“卡住”）
    solid: function (x, y, z) {
      const id = w.getBlock(x, y, z);
      const b = MC.BLOCKS[id];
      return b.solid && !b.liquid;
    }
  });
  this.onGround = res.onGround;

  // 落地反馈：从空中落地且下落速度够大 → 镜头下沉 + 音效（厚重感）
  if (!this.prevOnGround && this.onGround && !this.flying && !this.inWater) {
    const fallSpeed = -vyBefore; // 落地前竖直速度（格/tick）
    if (fallSpeed > 0.45) {
      this.landKick = Math.min(0.07, fallSpeed * 0.055);
      if (this.onLand) this.onLand(Math.min(1, fallSpeed / 2.2));
    }
  }
  this.prevOnGround = this.onGround;

  // 行走动画/脚步
  const dx = this.pos.x - this.prevPos.x, dz = this.pos.z - this.prevPos.z;
  this.bobPhase += Math.hypot(dx, dz) * (this.sprinting ? 1.6 : 1.1);
  this.bobAmount = (this.onGround && !this.flying && Math.hypot(this.vel.x, this.vel.z) > 0.05) ? 1 : 0;
  if (this.onGround && !this.flying) {
    this.stepAccum += Math.hypot(dx, dz);
    const trigger = this.sneaking ? 1.1 : (this.sprinting ? 2.5 : 3.0);
    if (this.stepAccum > trigger) {
      this.stepAccum = 0;
      if (this.onStep) this.onStep();
    }
  }
  this.prevPos.copy(this.pos);
  this.jumpPressed = false;
};

// 渲染插值：alpha ∈ [0,1]，视角晃动 bob + 落地/起跳反馈
MC.Player.prototype.updateCamera = function (camera, alpha, dt) {
  const px = this.prevPos.x + (this.pos.x - this.prevPos.x) * alpha;
  const py = this.prevPos.y + (this.pos.y - this.prevPos.y) * alpha;
  const pz = this.prevPos.z + (this.pos.z - this.prevPos.z) * alpha;
  let bobY = 0, bobX = 0;
  if (this.bobAmount > 0) {
    // 摆幅加大（走路更“重”），疾跑更明显
    const amp = 0.09 * (this.sprinting ? 1.35 : 1);
    bobY = Math.sin(this.bobPhase * 2) * amp * this.bobAmount;
    bobX = Math.cos(this.bobPhase) * amp * 0.7 * this.bobAmount;
  }
  // 落地/起跳镜头反馈（指数衰减）
  if (this.landKick > 0.001) {
    this.landKick *= Math.pow(0.0005, dt);
    if (this.landKick < 0.001) this.landKick = 0;
  }
  if (this.jumpKick > 0.001) {
    this.jumpKick *= Math.pow(0.01, dt);
    if (this.jumpKick < 0.001) this.jumpKick = 0;
  }
  camera.position.set(px + bobX, py + 1.62 + bobY - this.landKick - this.jumpKick, pz);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = this.yaw;
  camera.rotation.x = this.pitch;
};

// 供手持物品动画使用：当前位置 + 摆动参数
MC.Player.prototype.handState = function () {
  return {
    bobPhase: this.bobPhase,
    bobAmount: this.bobAmount,
    sprinting: this.sprinting,
    onGround: this.onGround
  };
};
