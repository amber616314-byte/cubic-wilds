// physics.js — 体素 AABB 碰撞（分轴移动 + 自动跨步），纯函数可单测
// 单位约定：速度 = 格/tick，dt = tick 数（1 tick = 0.05s，与 MC 一致）
'use strict';
window.MC = window.MC || {};

MC.Physics = (function () {
  // 返回与 AABB 重叠的所有 solid 方块 [{x,y,z}, ...]（空数组 = 无碰撞）
  function findCollisions(px, py, pz, half, height, solid) {
    const x0 = Math.floor(px - half), x1 = Math.floor(px + half - 1e-7);
    const y0 = Math.floor(py), y1 = Math.floor(py + height - 1e-7);
    const z0 = Math.floor(pz - half), z1 = Math.floor(pz + half - 1e-7);
    const out = [];
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (solid(x, y, z)) out.push({ x: x, y: y, z: z });
        }
      }
    }
    return out;
  }

  function collidesAt(px, py, pz, half, height, solid) {
    return findCollisions(px, py, pz, half, height, solid).length > 0;
  }

  /**
   * 移动玩家（分轴：x → z → y）
   * pos: {x,y,z} 脚底中心；vel: {x,y,z}（格/tick）；dt: tick 数
   * opts: { half, height, step, solid(x,y,z)->bool }
   * 返回 { onGround, blockedX, blockedZ }
   */
  function move(world, pos, vel, dt, opts) {
    const half = opts.half, height = opts.height;
    const solid = opts.solid || function (x, y, z) {
      const b = MC.BLOCKS[world.getBlock(x, y, z)];
      return b.solid && !b.liquid;
    };
    const eps = 1e-4;
    let onGround = false;
    let blockedX = false, blockedZ = false;

    // 保存移动前位置与速度（跨步用）
    const startX = pos.x, startZ = pos.z;
    const vx0 = vel.x, vz0 = vel.z;

    // X 轴
    pos.x += vel.x * dt;
    let colls = findCollisions(pos.x, pos.y, pos.z, half, height, solid);
    if (colls.length) {
      if (vel.x > 0) {
        let minX = Infinity;
        for (let i = 0; i < colls.length; i++) if (colls[i].x < minX) minX = colls[i].x;
        pos.x = minX - half - eps;
      } else if (vel.x < 0) {
        let maxX = -Infinity;
        for (let i = 0; i < colls.length; i++) if (colls[i].x > maxX) maxX = colls[i].x;
        pos.x = maxX + 1 + half + eps;
      }
      vel.x = 0;
      blockedX = true;
    }
    // Z 轴
    pos.z += vel.z * dt;
    colls = findCollisions(pos.x, pos.y, pos.z, half, height, solid);
    if (colls.length) {
      if (vel.z > 0) {
        let minZ = Infinity;
        for (let i = 0; i < colls.length; i++) if (colls[i].z < minZ) minZ = colls[i].z;
        pos.z = minZ - half - eps;
      } else if (vel.z < 0) {
        let maxZ = -Infinity;
        for (let i = 0; i < colls.length; i++) if (colls[i].z > maxZ) maxZ = colls[i].z;
        pos.z = maxZ + 1 + half + eps;
      }
      vel.z = 0;
      blockedZ = true;
    }
    // Y 轴
    pos.y += vel.y * dt;
    colls = findCollisions(pos.x, pos.y, pos.z, half, height, solid);
    if (colls.length) {
      if (vel.y > 0) {
        let minY = Infinity;
        for (let i = 0; i < colls.length; i++) if (colls[i].y < minY) minY = colls[i].y;
        pos.y = minY - height - eps;   // 头撞顶
      } else if (vel.y < 0) {
        let maxY = -Infinity;
        for (let i = 0; i < colls.length; i++) if (colls[i].y > maxY) maxY = colls[i].y;
        pos.y = maxY + 1 + eps;        // 落地
        onGround = true;
      }
      vel.y = 0;
    } else if (vel.y === 0) {
      // 稳定站立检测（MC 行为）：脚底紧贴地面也算 onGround
      if (findCollisions(pos.x, pos.y - 0.001, pos.z, half, 0.002, solid).length > 0) {
        onGround = true;
      }
    }

    // 自动跨步：水平被挡且在地面 → 抬升 step 后重试水平位移
    if (opts.step > 0 && (blockedX || blockedZ) && onGround) {
      const sy = pos.y;
      pos.y += opts.step;
      if (collidesAt(pos.x, pos.y, pos.z, half, height, solid)) {
        pos.y = sy; // 头顶有东西，跨不上去
      } else {
        let nx = pos.x, nz = pos.z;
        if (blockedX) {
          nx = startX + vx0 * dt;
          if (collidesAt(nx, pos.y, nz, half, height, solid)) nx = pos.x;
        }
        if (blockedZ) {
          nz = startZ + vz0 * dt;
          if (collidesAt(nx, pos.y, nz, half, height, solid)) nz = pos.z;
        }
        if (nx === pos.x && nz === pos.z) {
          pos.y = sy; // 跨不过去（前方仍是障碍），还原高度
        } else {
          pos.x = nx; pos.z = nz;
          vel.x = vx0; vel.z = vz0; // 恢复水平速度（跨步成功）
        }
      }
    }

    return { onGround: onGround, blockedX: blockedX, blockedZ: blockedZ };
  }

  return { move: move, findCollisions: findCollisions, collidesAt: collidesAt };
})();
