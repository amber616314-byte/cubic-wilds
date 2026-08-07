// mesher.js — Chunk 网格化：面剔除 + 平滑光照 AO + 水/透明方块
'use strict';
window.MC = window.MC || {};

MC.Mesher = (function () {
  // 面明暗：全部 1.0（立体感由真实光影提供，无旧式固定明暗/AO）
  const BRIGHT_TOP = 1.0, BRIGHT_SIDE = 1.0, BRIGHT_BOTTOM = 1.0;

  function isOpaqueId(world, x, y, z) {
    if (y < 0) return true;
    if (y >= MC.WORLD_HEIGHT) return false;
    const id = world.getBlock(x, y, z);
    const b = MC.BLOCKS[id];
    return b.solid && !b.transparent && !b.liquid;
  }

  // 邻面可见性
  function faceVisible(neighborId, selfId) {
    if (neighborId === 0) return true;
    const nb = MC.BLOCKS[neighborId];
    if (nb.liquid) return true;
    if (nb.transparent) {
      if (neighborId === selfId) return selfId === 11; // 玻璃之间渲染，树叶之间不渲染
      return true;
    }
    return false;
  }

  // 顶点缓冲
  function Buf() {
    this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = [];
  }
  // quad：c 面中心，u/v 面内两轴（单位向量），w/h 尺寸，ao[4] 角亮度（(-,-),(+,-),(+,+),(-,+)），bright 面明暗，uv 纹理范围，nx,ny,nz 法线
  function quad(buf, c, u, v, w, h, ao, bright, uv, nx, ny, nz) {
    const base = buf.pos.length / 3;
    const corners = [
      [-1, -1], [1, -1], [1, 1], [-1, 1]
    ];
    for (let i = 0; i < 4; i++) {
      const a = corners[i][0], b = corners[i][1];
      buf.pos.push(
        c.x + (u.x * a * w + v.x * b * h) / 2,
        c.y + (u.y * a * w + v.y * b * h) / 2,
        c.z + (u.z * a * w + v.z * b * h) / 2
      );
      buf.nor.push(nx, ny, nz);
      buf.uv.push(uv.u0 + (a + 1) / 2 * (uv.u1 - uv.u0), uv.v0 + (b + 1) / 2 * (uv.v1 - uv.v0));
      const l = bright * (ao ? ao[i] : 1);
      buf.col.push(l, l, l);
    }
    buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  function build(world, chunk) {
    const cx = chunk.cx, cz = chunk.cz;
    const data = chunk.data;
    const opaque = new Buf();
    const foliage = new Buf();   // 树叶/玻璃/高草：双面 alphaTest
    const water = new Buf();
    const uvOf = MC.Textures.uvOf;

    function isFoliage(id) {
      const b = MC.BLOCKS[id];
      return b.transparent && !b.liquid;   // 树叶、玻璃、高草（含 cross）
    }

    function local(x, y, z) {
      if (x >= 0 && x < 16 && y >= 0 && y < MC.WORLD_HEIGHT && z >= 0 && z < 16) return data[(y << 8) | (z << 4) | x];
      return world.getBlock(cx * 16 + x, y, cz * 16 + z);
    }

    for (let y = 0; y <= Math.min(MC.WORLD_HEIGHT - 1, chunk.maxY + 2); y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const id = data[(y << 8) | (z << 4) | x];
          if (id === 0) continue;
          const block = MC.BLOCKS[id];
          const wx = cx * 16 + x, wz = cz * 16 + z;

          if (block.cross) {
            // 高草：交叉双面（foliage 组）
            const uv = uvOf(MC.Textures.slotOf(id, 1));
            const c = { x: wx + 0.5, y: y + 0.5, z: wz + 0.5 };
            const s = Math.SQRT1_2;
            quad(foliage, c, { x: s, y: 0, z: s }, { x: 0, y: 1, z: 0 }, Math.SQRT2, 1, null, 1, uv, 0, 1, 0);
            quad(foliage, c, { x: -s, y: 0, z: s }, { x: 0, y: 1, z: 0 }, Math.SQRT2, 1, null, 1, uv, 0, 1, 0);
            continue;
          }

          if (block.liquid) {
            // 水：顶面（略低 0.125）+ 侧面，邻居非水才渲染
            const uv = uvOf(MC.Textures.slotOf(id, 1));
            const nTop = local(x, y + 1, z);
            if (nTop !== id && faceVisible(nTop, id)) {
              quad(water, { x: wx + 0.5, y: y + 1 - 0.125, z: wz + 0.5 },
                { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 1, 1, null, 1, uv, 0, 1, 0);
            }
            const sides = [
              [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]
            ];
            for (let i = 0; i < 4; i++) {
              const dx = sides[i][0], dy = sides[i][1], dz = sides[i][2];
              const nid = local(x + dx, y + dy, z + dz);
              if (nid === id || !faceVisible(nid, id)) continue;
              // 侧面 quad：u 水平轴，v 垂直轴（上沿下沉 0.125）
              let u, v, c;
              if (dx !== 0) {
                u = { x: 0, y: 0, z: -dx };
                v = { x: 0, y: 1, z: 0 };
                c = { x: wx + (dx > 0 ? 1 : 0), y: y + 0.5 - 0.0625, z: wz + 0.5 };
              } else {
                u = { x: -dz, y: 0, z: 0 };
                v = { x: 0, y: 1, z: 0 };
                c = { x: wx + 0.5, y: y + 0.5 - 0.0625, z: wz + (dz > 0 ? 1 : 0) };
              }
              quad(water, c, u, v, 1, 1, null, BRIGHT_SIDE, uv, dx, dy, dz);
            }
            continue;
          }

          // 普通方块：6 面
          const slotTop = MC.Textures.slotOf(id, 0);
          const slotSide = MC.Textures.slotOf(id, 1);
          const slotBottom = MC.Textures.slotOf(id, 2);
          const uvT = uvOf(slotTop), uvS = uvOf(slotSide), uvB = uvOf(slotBottom);

          const faces = [
            // +Y 顶（v 轴取反使法线朝上）
            { dx: 0, dy: 1, dz: 0, bright: BRIGHT_TOP, uv: uvT, u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 0, z: -1 }, c: { x: wx + 0.5, y: y + 1, z: wz + 0.5 } },
            // -Y 底（v 轴取反使法线朝下）
            { dx: 0, dy: -1, dz: 0, bright: BRIGHT_BOTTOM, uv: uvB, u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 0, z: 1 }, c: { x: wx + 0.5, y: y, z: wz + 0.5 } },
            // +X
            { dx: 1, dy: 0, dz: 0, bright: BRIGHT_SIDE, uv: uvS, u: { x: 0, y: 0, z: -1 }, v: { x: 0, y: 1, z: 0 }, c: { x: wx + 1, y: y + 0.5, z: wz + 0.5 } },
            // -X
            { dx: -1, dy: 0, dz: 0, bright: BRIGHT_SIDE, uv: uvS, u: { x: 0, y: 0, z: 1 }, v: { x: 0, y: 1, z: 0 }, c: { x: wx, y: y + 0.5, z: wz + 0.5 } },
            // +Z
            { dx: 0, dy: 0, dz: 1, bright: BRIGHT_SIDE, uv: uvS, u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 1, z: 0 }, c: { x: wx + 0.5, y: y + 0.5, z: wz + 1 } },
            // -Z
            { dx: 0, dy: 0, dz: -1, bright: BRIGHT_SIDE, uv: uvS, u: { x: -1, y: 0, z: 0 }, v: { x: 0, y: 1, z: 0 }, c: { x: wx + 0.5, y: y + 0.5, z: wz } }
          ];

          for (let f = 0; f < 6; f++) {
            const face = faces[f];
            const nid = local(x + face.dx, y + face.dy, z + face.dz);
            if (!faceVisible(nid, id)) continue;
            const buf = block.liquid ? water : (isFoliage(id) ? foliage : opaque);
            // 无 AO/面明暗：顶点色统一 1.0（立体感由真实光影+阴影提供）
            quad(buf, face.c, face.u, face.v, 1, 1, null, face.bright, face.uv, face.dx, face.dy, face.dz);
          }
        }
      }
    }

    return {
      opaque: makeGeometry(opaque),
      foliage: makeGeometry(foliage),
      water: makeGeometry(water)
    };
  }

  function makeGeometry(b) {
    if (b.idx.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    g.setIndex(b.idx);
    return g;
  }

  return { build: build };
})();
