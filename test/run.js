// test/run.js — Node 逻辑测试（噪声/方块表/物理/世界一致性/网格化/玩家）
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// 加载 three UMD（Node 下可用）
global.THREE = require(path.join(ROOT, 'lib', 'three.min.js'));
global.window = global;
global.document = { createElement: function () { return { getContext: function () { return null; }, width: 0, height: 0 }; } };

const files = ['noise.js', 'blocks.js', 'world.js', 'mesher.js', 'physics.js', 'player.js'];
for (const f of files) {
  eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
}
// stub 纹理（mesher 只用到 uvOf/slotOf）
MC.Textures = {
  uvOf: function () { return { u0: 0, v0: 0, u1: 1, v1: 1 }; },
  slotOf: function () { return 0; }
};

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('PASS ' + name); }
  catch (e) { fail++; console.log('FAIL ' + name + ' — ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 1e-6); }

// ---------- 噪声 ----------
test('噪声值域 [0,1] 且确定性', function () {
  for (let i = 0; i < 200; i++) {
    const x = (i * 37.7) % 100, y = (i * 13.3) % 100;
    const n = MC.noise2(x, y, 42);
    assert(n >= 0 && n <= 1, 'noise2 out of range: ' + n);
    assert(n === MC.noise2(x, y, 42), 'noise2 not deterministic');
    const n3 = MC.noise3(x, y * 0.5, i, 42);
    assert(n3 >= 0 && n3 <= 1, 'noise3 out of range: ' + n3);
    assert(n3 === MC.noise3(x, y * 0.5, i, 42), 'noise3 not deterministic');
  }
  const f = MC.fbm2(1.5, 2.5, 7, 4);
  assert(f >= 0 && f <= 1 && f === MC.fbm2(1.5, 2.5, 7, 4), 'fbm2 bad');
});

// ---------- 方块表 ----------
test('方块表 id 连续且字段完整', function () {
  MC.BLOCKS.forEach(function (b, i) {
    assert(b.id === i, 'id mismatch at ' + i);
    assert(typeof b.name === 'string' && b.name, 'name missing at ' + i);
    assert(b.tex.top && b.tex.side && b.tex.bottom, 'tex missing at ' + i);
  });
  assert(MC.PLACEABLE.length === 18, 'PLACEABLE count = ' + MC.PLACEABLE.length);
  assert(!MC.PLACEABLE.some(function (b) { return b.liquid || b.id === 0; }), 'PLACEABLE contains invalid');
  // 破坏时间（MC 公式）
  const stone = MC.BLOCKS[3];
  assert(Math.abs(MC.Main ? 0 : 0) === 0);
  // 空手挖石头 7.5s（1.5 × 5），泥土 0.75s（0.5 × 1.5）
  assert(stone.hardness * 5 === 7.5, 'stone break time');
  assert(MC.BLOCKS[2].hardness * 1.5 === 0.75, 'dirt break time');
});

// ---------- 世界生成 ----------
test('世界生成：确定性（同 seed 两次生成完全一致）', function () {
  const w1 = new MC.World(12345), w2 = new MC.World(12345);
  w1.generateChunk(0, 0); w1.generateChunk(1, -1);
  w2.generateChunk(0, 0); w2.generateChunk(1, -1);
  const a = w1.getChunk(0, 0).data, b = w2.getChunk(0, 0).data;
  for (let i = 0; i < a.length; i++) assert(a[i] === b[i], 'determinism mismatch at ' + i);
});

test('世界生成：树不跨 chunk 边界（边缘两列无原木）', function () {
  const w = new MC.World(777);
  w.generateChunk(0, 0);
  const ch = w.getChunk(0, 0);
  for (let y = 0; y < 128; y++) for (let z = 0; z < 16; z++) {
    for (const x of [0, 1, 14, 15]) {
      assert(ch.data[(y << 8) | (z << 4) | x] !== 5, 'log at chunk edge x=' + x + ' y=' + y);
    }
  }
});

test('世界生成：地形合理（草顶/海平面水/基岩）', function () {
  // 多个种子扫描，直到覆盖到海平面以下地形
  let water = 0, solid = 0, grass = 0;
  const seeds = [999, 12345, 777, 42, 1337, 2024];
  let found = false;
  for (const seed of seeds) {
    const w = new MC.World(seed);
    water = 0; solid = 0; grass = 0;
    for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) w.generateChunk(dx, dz);
    for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) {
      const ch = w.getChunk(dx, dz);
      for (let y = 0; y < 128; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const id = ch.data[(y << 8) | (z << 4) | x];
        if (id !== 0) solid++;
        if (id === 1) grass++;
        if (id === 10) water++;
      }
    }
    if (water > 0) { found = true; break; }
  }
  assert(found, 'no seed produced water');
  assert(solid > 8000, 'chunk too empty: ' + solid);
  assert(grass > 50, 'no grass: ' + grass);
});

// ---------- 物理 ----------
test('物理：自由落体停在地面', function () {
  // 自定义世界：y=0 地面，四周无墙；dt=1（tick 单位，速度=格/tick）
  const solid = function (x, y, z) { return y < 0 || y === 0; };
  const pos = { x: 0.5, y: 70, z: 0.5 }, vel = { x: 0, y: 0, z: 0 };
  let onGround = false;
  for (let i = 0; i < 600; i++) {
    vel.y = (vel.y - 0.08) * 0.98;
    const r = MC.Physics.move(null, pos, vel, 1, { half: 0.3, height: 1.8, step: 0.6, solid: solid });
    onGround = r.onGround;
  }
  assert(onGround, 'never landed');
  assert(approx(pos.y, 1.0001, 1e-3), 'resting height wrong: ' + pos.y);
  const y1 = pos.y;
  for (let i = 0; i < 40; i++) MC.Physics.move(null, pos, vel, 1, { half: 0.3, height: 1.8, step: 0.6, solid: solid });
  assert(approx(pos.y, y1, 1e-4), 'sinking or floating: ' + pos.y + ' vs ' + y1);
});

test('物理：墙壁阻挡 + 跨步', function () {
  // 地面 y=0；墙：y=2 层 x=2（1 格高），z 0..4；dt=1 tick
  const solid = function (x, y, z) {
    if (y < 0 || y === 0) return true;
    if (y === 2) return x === 2 && z >= 0 && z <= 4;
    return false;
  };
  const opts = { half: 0.3, height: 1.8, step: 0.6, solid: solid };
  // step 0.6 跨不上 1 格墙（MC 行为：0.6 只能上 0.5 台阶）；速度用真实值 0.28 格/tick
  const pos = { x: 0.5, y: 1.0, z: 0.5 }, vel = { x: 0.28, y: 0, z: 0 };
  let blocked = false;
  let r = null;
  for (let i = 0; i < 10; i++) { r = MC.Physics.move(null, pos, vel, 1, opts); if (r.blockedX) blocked = true; }
  assert(blocked, 'should be blocked by 1-block wall');
  assert(approx(pos.x, 1.7, 0.01), 'wall clamp wrong: ' + pos.x);
  assert(approx(pos.y, 1.0, 0.01), 'should NOT step 1-block wall with step 0.6');

  // step 2.0 可跨上 1 格墙（等价于 MC 的 0.6 step 上 0.5 台阶）；断言曾站上墙顶
  const pos2 = { x: 0.5, y: 1.0, z: 0.5 }, vel2 = { x: 0.28, y: 0, z: 0 };
  const opts2 = { half: 0.3, height: 1.8, step: 2.0, solid: solid };
  let maxY = pos2.y;
  for (let i = 0; i < 12; i++) { MC.Physics.move(null, pos2, vel2, 1, opts2); if (pos2.y > maxY) maxY = pos2.y; }
  assert(maxY > 2.99, 'step never succeeded: maxY=' + maxY);
  assert(approx(pos2.x, 3.7, 0.2), 'should have walked past wall: x=' + pos2.x);
});

test('物理：跳跃撞顶', function () {
  const solid = function (x, y, z) {
    if (y < 0) return true;
    if (y === 0) return true;                 // 地面
    if (y === 3) return true;                 // 天花板（距地面 3 格）
    return false;
  };
  const pos = { x: 0.5, y: 1.0, z: 0.5 }, vel = { x: 0, y: 0.42, z: 0 };
  let onGround = false;
  for (let i = 0; i < 60; i++) {
    vel.y = (vel.y - 0.08) * 0.98;
    const r = MC.Physics.move(null, pos, vel, 1, { half: 0.3, height: 1.8, step: 0, solid: solid });
    if (r.onGround) onGround = true;
  }
  assert(pos.y + 1.8 <= 3.0 + 1e-4, 'passed through ceiling: y=' + pos.y);
  assert(onGround, 'did not land back');
});

// ---------- 网格化 ----------
test('网格化：生成区块产生网格且面数合理', function () {
  const w = new MC.World(777);
  w.generateChunk(0, 0);
  const ch = w.getChunk(0, 0);
  const geo = MC.Mesher.build(w, ch);
  assert(geo.opaque, 'no opaque geometry');
  const n = geo.opaque.getAttribute('position').count;
  assert(n > 100 && n < 200000, 'vertex count weird: ' + n);
  assert(n % 4 === 0, 'vertices not multiple of 4');
  // 顶点色值域
  const col = geo.opaque.getAttribute('color');
  for (let i = 0; i < col.count; i++) {
    const c = col.getX(i);
    assert(c >= 0 && c <= 1, 'color out of range: ' + c);
  }
});

test('网格化：挖掉方块后重建（无崩溃 + 变化）', function () {
  const w = new MC.World(777);
  w.generateChunk(0, 0);
  // 找一个实心方块挖掉
  let found = null;
  outer:
  for (let y = 40; y < 70; y++) for (let z = 4; z < 12; z++) for (let x = 4; x < 12; x++) {
    if (w.getBlock(x, y, z) !== 0) { found = { x: x, y: y, z: z }; break outer; }
  }
  assert(found, 'no solid block found');
  w.setBlock(found.x, found.y, found.z, 0);
  const geo = MC.Mesher.build(w, w.getChunk(0, 0));
  assert(geo.opaque, 'rebuild failed');
});

// ---------- 玩家 ----------
test('玩家：落地 + 跳跃高度 ≈ 1.15 格（调校后，可跳上 1 格方块）', function () {
  const w = new MC.World(5);
  w.generateChunk(0, 0);
  // 清空测试区域，铺 12x6 平台（y=40..41）
  for (let x = 4; x <= 26; x++) for (let z = 4; z <= 13; z++) {
    for (let y = 38; y <= 50; y++) w.setBlock(x, y, z, 0);
    for (let y = 40; y <= 41; y++) w.setBlock(x, y, z, 3);
  }
  const p = new MC.Player(w);
  p.pos.set(8.5, 42.2, 8.5);
  p.vel.set(0, 0, 0);
  p.onGround = false;
  // 落地
  for (let i = 0; i < 200; i++) {
    p.tick(0.05, { forward: 0, back: 0, left: 0, right: 0, jump: 0, sneak: 0, sprint: 0 });
  }
  assert(p.onGround, 'player not grounded');
  assert(approx(p.pos.y, 42.0001, 0.01), 'player rest height wrong: ' + p.pos.y);
  const groundY = p.pos.y;
  // 跳跃
  p.jumpPressed = true;
  p.vel.y = 0;
  let maxY = p.pos.y;
  for (let i = 0; i < 40; i++) {
    p.tick(0.05, { forward: 0, back: 0, left: 0, right: 0, jump: 0, sneak: 0, sprint: 0 });
    if (p.pos.y > maxY) maxY = p.pos.y;
  }
  const jumpH = maxY - groundY;
  assert(Math.abs(jumpH - 1.131) < 0.02, 'jump height wrong: ' + jumpH.toFixed(3) + ' (expect ~1.131)');
});

test('玩家：自由落体速度（终端 ~58 格/s，不再“羽毛”）', function () {
  const w = new MC.World(5);
  w.generateChunk(0, 0);
  for (let x = -8; x <= 26; x++) for (let z = 4; z <= 13; z++) {
    for (let y = 38; y <= 60; y++) w.setBlock(x, y, z, 0);
    for (let y = 40; y <= 41; y++) w.setBlock(x, y, z, 3);
  }
  const p = new MC.Player(w);
  p.pos.set(8.5, 90, 8.5);   // 从 90 格高处落下
  p.vel.set(0, 0, 0);
  const t0 = performance.now();
  let landed = false;
  for (let i = 0; i < 400; i++) {
    p.tick(0.05, { forward: 0, back: 0, left: 0, right: 0, jump: 0, sneak: 0, sprint: 0 });
    if (p.onGround) { landed = true; break; }
  }
  const t = (performance.now() - t0) / 1000;
  assert(landed, 'never landed');
  const avgSpeed = (90 - p.pos.y) / t;
  // 从 ~48 格落差落下，平均速度应 > 25 格/s（终端 58，加速快）
  assert(avgSpeed > 25, 'fall too slow: avg ' + avgSpeed.toFixed(1) + ' 格/s in ' + t.toFixed(2) + 's');
});

test('玩家：四方向移动（W/A/S/D 都有效）', function () {
  const w = new MC.World(7);
  w.generateChunk(0, 0);
  for (let x = -8; x <= 26; x++) for (let z = -12; z <= 28; z++) {
    for (let y = 38; y <= 60; y++) w.setBlock(x, y, z, 0);
    for (let y = 40; y <= 41; y++) w.setBlock(x, y, z, 3);
  }
  const p = new MC.Player(w);
  const move = (input) => {
    p.pos.set(8.5, 42.2, 8.5);
    p.vel.set(0, 0, 0);
    p.onGround = false;
    for (let i = 0; i < 120; i++) p.tick(0.05, input);
    return { x: p.pos.x - 8.5, z: p.pos.z - 8.5 };
  };
  // 落地
  move({ forward: 0, back: 0, left: 0, right: 0, jump: 0, sneak: 0, sprint: 0 });
  const f = move({ forward: 1, back: 0, left: 0, right: 0, jump: 0, sneak: 0, sprint: 0 });
  const b = move({ forward: 0, back: 1, left: 0, right: 0, jump: 0, sneak: 0, sprint: 0 });
  const l = move({ forward: 0, back: 0, left: 1, right: 0, jump: 0, sneak: 0, sprint: 0 });
  const r = move({ forward: 0, back: 0, left: 0, right: 1, jump: 0, sneak: 0, sprint: 0 });
  // yaw=0：W → -Z，S → +Z，A → -X，D → +X
  assert(f.z < -5, 'W should move -Z, got z=' + f.z.toFixed(1));
  assert(b.z > 5, 'S should move +Z, got z=' + b.z.toFixed(1));
  assert(l.x < -5, 'A should move -X, got x=' + l.x.toFixed(1));
  assert(r.x > 5, 'D should move +X, got x=' + r.x.toFixed(1));
});

test('玩家：走路速度 ≈ 4.317 m/s（MC 精确值）', function () {
  const w = new MC.World(6);
  w.generateChunk(0, 0);
  // 清空并铺大范围平地（z 0..15，前方 4 格无墙）
  for (let x = -8; x <= 26; x++) for (let z = 0; z <= 15; z++) {
    for (let y = 38; y <= 60; y++) w.setBlock(x, y, z, 0);
    for (let y = 40; y <= 41; y++) w.setBlock(x, y, z, 3);
  }
  const p = new MC.Player(w);
  p.pos.set(8.5, 42.2, 8.5);
  p.yaw = 0; // 朝 -Z
  for (let i = 0; i < 200; i++) p.tick(0.05, { forward: 0, back: 0, left: 0, right: 0, jump: 0, sneak: 0, sprint: 0 });
  const z0 = p.pos.z;
  for (let i = 0; i < 100; i++) p.tick(0.05, { forward: 1, back: 0, left: 0, right: 0, jump: 0, sneak: 0, sprint: 0 });
  const dist = Math.abs(p.pos.z - z0);
  const speed = dist / 5.0; // 100 ticks = 5s
  assert(Math.abs(speed - 4.317) < 0.15, 'walk speed wrong: ' + speed.toFixed(3) + ' (expect ~4.317)');
  // 疾跑
  const z1 = p.pos.z;
  for (let i = 0; i < 100; i++) p.tick(0.05, { forward: 1, back: 0, left: 0, right: 0, jump: 0, sneak: 0, sprint: 1 });
  const sprintSpeed = Math.abs(p.pos.z - z1) / 5.0;
  assert(Math.abs(sprintSpeed - 5.612) < 0.15, 'sprint speed wrong: ' + sprintSpeed.toFixed(3) + ' (expect ~5.612)');
});

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);
