// main.js — 主循环与系统整合
'use strict';
window.MC = window.MC || {};

MC.Main = {
  renderer: null, scene: null, camera: null,
  world: null, player: null, interaction: null, env: null,
  blockMat: null, waterMat: null,
  seed: 0,
  radius: 6,
  mode: 'survival',            // survival | creative
  sensitivity: 0.5,
  creative: false,

  keys: {},
  inventory: { slots: [], selected: 0 },

  genQueue: [],
  inQueue: new Set(),
  dirtyChunks: new Set(),
  running: false,
  inGame: false,

  // 统计
  fps: 0, frameCount: 0, fpsTime: 0,
  debugOn: false,

  // ---------- 初始化 ----------
  init: function () {
    const self = this;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // r155+ 默认物理光单位会让 Lambert 材质明显变暗，用传统光单位（MC 风格明暗）
    this.renderer.useLegacyLights = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('game').appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 900);
    this.fog = new THREE.Fog(0xa8c8ee, 55, 110);
    this.scene.fog = this.fog;

    this.env = new MC.Environment(this.scene, this.camera);
    this.env.fog = this.fog;

    // 默认热栏（初始 32 个，开箱即用；满堆叠 64 上限保留）
    this.inventory.slots = [
      { id: 1, count: 32 }, { id: 2, count: 32 }, { id: 3, count: 32 },
      { id: 4, count: 32 }, { id: 5, count: 32 }, { id: 6, count: 32 },
      { id: 7, count: 32 }, { id: 8, count: 32 }, { id: 9, count: 32 }
    ];

    // 材质（纹理图集加载完成后创建）
    MC.Textures.load(function () {
      // 主方块：单面（背面剔除，三角形减半）
      self.blockMat = new THREE.MeshLambertMaterial({
        map: MC.Textures.atlasTexture,
        vertexColors: true
      });
      // 树叶/玻璃/高草：双面 alphaTest
      self.foliageMat = new THREE.MeshLambertMaterial({
        map: MC.Textures.atlasTexture,
        vertexColors: true,
        alphaTest: 0.5,
        side: THREE.DoubleSide
      });
      // 水：Phong 高光（阳光下波光）+ 双面（水下可见水面）
      self.waterMat = new THREE.MeshPhongMaterial({
        map: MC.Textures.atlasTexture,
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        side: THREE.DoubleSide,
        color: 0x8fb8e8,
        specular: 0xffffff,
        shininess: 90
      });
      self.waterMat.needsUpdate = true;
      // 手持方块（挂 scene，每帧同步相机变换）
      self.hand = new MC.Hand(self.camera, self.scene);
      self.syncHand();
    });

    // 光影：太阳阴影 + 后处理 bloom
    this.lightFx = true;
    this.postfx = new MC.PostFX(this.renderer, window.innerWidth, window.innerHeight);
    const sl = this.env.sunLight;
    sl.castShadow = true;
    sl.shadow.mapSize.set(1024, 1024);
    sl.shadow.camera.near = 1;
    sl.shadow.camera.far = 320;
    const sd = 56;
    sl.shadow.camera.left = -sd; sl.shadow.camera.right = sd;
    sl.shadow.camera.top = sd; sl.shadow.camera.bottom = -sd;
    sl.shadow.camera.updateProjectionMatrix();
    sl.shadow.bias = -0.0015;
    sl.shadow.normalBias = 0.03;
    sl.target = new THREE.Object3D();
    this.scene.add(sl.target);

    MC.UI.init(this);
    MC.UI.showTitle();
    this.bindEvents();
    window.addEventListener('resize', function () { self.onResize(); });
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  },

  onResize: function () {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    if (this.postfx) this.postfx.setSize(window.innerWidth, window.innerHeight);
    MC.UI.resize();
  },

  // 光影开关（阴影 + bloom 后处理）
  setLightFx: function (v) {
    this.lightFx = !!v;
    if (this.env) this.env.sunLight.castShadow = this.lightFx;
    if (this.postfx) this.postfx.enabled = this.lightFx;
  },

  // ---------- 游戏生命周期 ----------
  newGame: function (seed) {
    const self = this;
    this.disposeWorld();
    this.seed = seed >>> 0;
    this.world = new MC.World(this.seed);
    this.player = new MC.Player(this.world);
    this.interaction = new MC.Interaction(this.world, this.player, this.camera, this.scene);
    this.interaction.onBlockChanged = function (x, y, z) { self.markDirty(x, y, z); };
    this.interaction.onPickup = function (blockId) {
      if (self.addToInventory(blockId)) { self.syncHand(); return true; }
      return false; // 背包满：掉落物留在地上
    };
    this.player.onStep = function () {
      if (MC.Audio && MC.Audio.enabled) {
        const p = self.player;
        const id = self.world.getBlock(Math.floor(p.pos.x), Math.floor(p.pos.y - 0.3), Math.floor(p.pos.z));
        MC.Audio.step(MC.BLOCKS[id].sound);
      }
    };
    this.player.onLand = function (fall) { if (MC.Audio && MC.Audio.enabled) MC.Audio.land(fall); };
    this.genQueue = [];
    this.inQueue = new Set();
    this.dirtyChunks = new Set();

    // 初始热栏（初始 32 个）
    this.inventory.slots = [
      { id: 1, count: 32 }, { id: 2, count: 32 }, { id: 3, count: 32 },
      { id: 4, count: 32 }, { id: 5, count: 32 }, { id: 6, count: 32 },
      { id: 7, count: 32 }, { id: 8, count: 32 }, { id: 9, count: 32 }
    ];
    this.inventory.selected = 0;
    this.syncHand();

    // 同步生成出生点所在 chunk（保证脚下有地形），其余入队分片生成
    this.world.generateChunk(0, 0);
    this.buildMesh(0, 0);
    this.player.spawn();

    MC.UI.hideAll();
    this.inGame = true;
    this.running = true;
    this.lockPointer();
    this.updateFog();
  },

  disposeWorld: function () {
    if (!this.world) return;
    this.world.chunks.forEach(function (ch) {
      if (ch.mesh) {
        if (ch.mesh.opaque) { this.scene.remove(ch.mesh.opaque); ch.mesh.opaque.geometry.dispose(); }
        if (ch.mesh.foliage) { this.scene.remove(ch.mesh.foliage); ch.mesh.foliage.geometry.dispose(); }
        if (ch.mesh.water) { this.scene.remove(ch.mesh.water); ch.mesh.water.geometry.dispose(); }
      }
    }, this);
    if (this.interaction) {
      this.interaction.drops.forEach(function (d) { this.scene.remove(d.mesh); }, this);
      this.interaction.particles.forEach(function (p) { this.scene.remove(p.mesh); }, this);
    }
  },

  toTitle: function () {
    this.inGame = false;
    this.running = false;
    this.disposeWorld();
    this.world = null;
    this.player = null;
    this.interaction = null;
    document.exitPointerLock();
    MC.UI.showTitle();
  },

  resume: function () {
    MC.UI.hideAll();
    this.lockPointer();
  },

  setMode: function (mode) {
    this.mode = mode;
    this.creative = mode === 'creative';
  },

  setHotbarBlock: function (blockId) {
    this.inventory.slots[this.inventory.selected] = { id: blockId, count: 1 };
    this.syncHand();
  },

  // 加入背包；返回是否成功（满堆叠且无空槽时不拾取，掉落物留在地上）
  addToInventory: function (blockId) {
    const slots = this.inventory.slots;
    for (let i = 0; i < 9; i++) {
      if (slots[i].id === blockId && slots[i].count < 64) { slots[i].count++; return true; }
    }
    for (let i = 0; i < 9; i++) {
      if (slots[i].id === 0) { slots[i] = { id: blockId, count: 1 }; return true; }
    }
    return false;
  },

  consumeSelected: function () {
    if (this.creative) return true;
    const s = this.inventory.slots[this.inventory.selected];
    if (!s || s.id === 0) return false;
    if (s.count > 1) s.count--;
    else { s.id = 0; s.count = 0; }
    return true;
  },

  // 同步手持方块（热栏切换时调用）
  syncHand: function () {
    if (!this.hand) return;
    const s = this.inventory.slots[this.inventory.selected];
    if (!s || s.id === 0) { this.hand.setVisible(false); if (this.interaction) this.interaction.setGhostBlock(0); return; }
    this.hand.setVisible(true);
    this.hand.setBlock(s.id);
    if (this.interaction) this.interaction.setGhostBlock(s.id);
  },

  // 放置一个方块（右键触发）
  doPlace: function () {
    const s = this.inventory.slots[this.inventory.selected];
    if (!s || s.id === 0) return;
    if (this.interaction.place(s.id, this.creative)) {
      this.consumeSelected();
      this.syncHand();
    }
  },

  // ---------- 区块管理 ----------
  markDirty: function (x, y, z) {
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
    this.dirtyChunks.add(cx + ',' + cz);
    // 边缘方块影响邻居网格
    const lx = x - cx * 16, lz = z - cz * 16;
    if (lx === 0) this.dirtyChunks.add((cx - 1) + ',' + cz);
    if (lx === 15) this.dirtyChunks.add((cx + 1) + ',' + cz);
    if (lz === 0) this.dirtyChunks.add(cx + ',' + (cz - 1));
    if (lz === 15) this.dirtyChunks.add(cx + ',' + (cz + 1));
  },

  buildMesh: function (cx, cz) {
    const ch = this.world.getChunk(cx, cz);
    if (!ch || !ch.generated) return;
    if (ch.mesh) {
      if (ch.mesh.opaque) { this.scene.remove(ch.mesh.opaque); ch.mesh.opaque.geometry.dispose(); }
      if (ch.mesh.foliage) { this.scene.remove(ch.mesh.foliage); ch.mesh.foliage.geometry.dispose(); }
      if (ch.mesh.water) { this.scene.remove(ch.mesh.water); ch.mesh.water.geometry.dispose(); }
    }
    const geo = MC.Mesher.build(this.world, ch);
    ch.mesh = {};
    if (geo.opaque) {
      ch.mesh.opaque = new THREE.Mesh(geo.opaque, this.blockMat);
      ch.mesh.opaque.castShadow = true;
      ch.mesh.opaque.receiveShadow = true;
      this.scene.add(ch.mesh.opaque);
    }
    if (geo.foliage) {
      ch.mesh.foliage = new THREE.Mesh(geo.foliage, this.foliageMat);
      ch.mesh.foliage.castShadow = true;
      ch.mesh.foliage.receiveShadow = true;
      this.scene.add(ch.mesh.foliage);
    }
    if (geo.water) {
      ch.mesh.water = new THREE.Mesh(geo.water, this.waterMat);
      ch.mesh.water.renderOrder = 2;
      this.scene.add(ch.mesh.water);
    }
    ch.meshed = true;
    ch.dirty = false;
  },

  updateChunks: function () {
    if (!this.world || !this.player) return;
    const pcx = Math.floor(this.player.pos.x / 16);
    const pcz = Math.floor(this.player.pos.z / 16);
    const r = this.radius;

    // 重建脏区块（每帧最多 1 个，防止挖放时卡顿）
    if (this.dirtyChunks.size > 0) {
      const it = this.dirtyChunks.values().next();
      this.dirtyChunks.delete(it.value);
      const p = it.value.split(',');
      this.buildMesh(parseInt(p[0], 10), parseInt(p[1], 10));
    }

    // 收集缺失区块（圆形视距）
    const missing = [];
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (dx * dx + dz * dz > r * r) continue;
        const cx = pcx + dx, cz = pcz + dz;
        const key = cx + ',' + cz;
        if (!this.world.getChunk(cx, cz) && !this.inQueue.has(key)) {
          missing.push({ cx: cx, cz: cz, d: dx * dx + dz * dz });
        }
      }
    }
    if (missing.length) {
      missing.sort(function (a, b) { return a.d - b.d; });
      for (let i = 0; i < missing.length; i++) {
        const key = missing[i].cx + ',' + missing[i].cz;
        if (!this.inQueue.has(key)) {
          this.inQueue.add(key);
          this.genQueue.push(new MC.ChunkGen(this.world.seed, missing[i].cx, missing[i].cz));
        }
      }
    }

    // 分片生成：每帧时间预算（~5ms），不阻塞渲染
    const budget = 5;
    const t0 = performance.now();
    while (this.genQueue.length && performance.now() - t0 < budget) {
      const gen = this.genQueue[0];
      gen.step();
      if (gen.done) {
        this.genQueue.shift();
        this.inQueue.delete(gen.cx + ',' + gen.cz);
        this.world.installChunk(gen);
        this.buildMesh(gen.cx, gen.cz);
      }
    }

    // 卸载远处区块
    const r2 = r + 2;
    this.world.chunks.forEach(function (ch, key) {
      const dx = ch.cx - pcx, dz = ch.cz - pcz;
      if (dx * dx + dz * dz > r2 * r2) {
        if (ch.mesh) {
          if (ch.mesh.opaque) { this.scene.remove(ch.mesh.opaque); ch.mesh.opaque.geometry.dispose(); }
          if (ch.mesh.foliage) { this.scene.remove(ch.mesh.foliage); ch.mesh.foliage.geometry.dispose(); }
          if (ch.mesh.water) { this.scene.remove(ch.mesh.water); ch.mesh.water.geometry.dispose(); }
        }
        this.world.chunks.delete(key);
      }
    }, this);
  },

  updateFog: function () {
    const d = this.radius * 16;
    this.fog.near = d * 0.55;
    this.fog.far = d * 1.05;
    this.camera.far = d * 1.2 + 300;
    this.camera.updateProjectionMatrix();
  },

  // ---------- 输入 ----------
  lockPointer: function () {
    const el = this.renderer.domElement;
    if (document.pointerLockElement === el) return;
    try { el.requestPointerLock(); } catch (e) {}
    // Chrome 解锁后有 ~1.25s 冷却，期间 requestPointerLock 会静默失败 → 自动重试
    if (!this._lockTimer) {
      const self = this;
      let tries = 0;
      this._lockTimer = setInterval(function () {
        if (document.pointerLockElement === el || tries >= 6) {
          clearInterval(self._lockTimer);
          self._lockTimer = null;
          return;
        }
        tries++;
        try { el.requestPointerLock(); } catch (e) {}
      }, 400);
    }
  },

  bindEvents: function () {
    const self = this;
    const el = this.renderer.domElement;
    let lastSpace = 0, lastW = 0;
    self.doubleW = false;

    document.addEventListener('keydown', function (e) {
      if (!self.inGame) return;
      if (e.repeat) return;
      const now = performance.now();
      // 快捷键
      if (e.code === 'F3') { self.debugOn = !self.debugOn; MC.UI.setDebugVisible(self.debugOn); return; }
      if (e.code === 'Escape') {
        if (MC.UI.isInventoryOpen()) { MC.UI.closeInventory(); self.lockPointer(); return; }
        document.exitPointerLock();
        return;
      }
      if (e.code === 'KeyE' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (MC.UI.isInventoryOpen()) { MC.UI.closeInventory(); self.lockPointer(); }
        else if (document.pointerLockElement === el) { document.exitPointerLock(); MC.UI.openInventory(); }
        return;
      }
      // 数字键选热栏
      if (e.code.indexOf('Digit') === 0) {
        const n = parseInt(e.code.slice(5), 10);
        if (n >= 1 && n <= 9) { self.inventory.selected = n - 1; self.syncHand(); return; }
      }
      self.keys[e.code] = true;
      // 双击 W 疾跑
      if (e.code === 'KeyW') {
        if (now - lastW < 300) self.doubleW = !self.doubleW;
        lastW = now;
      }
      // 双击空格飞行（仅创造模式）
      if (e.code === 'Space' && self.player) {
        if (now - lastSpace < 300 && self.creative) { self.player.toggleFly(); }
        lastSpace = now;
        self.player.jumpPressed = true;
      }
    });

    document.addEventListener('keyup', function (e) {
      self.keys[e.code] = false;
      if (e.code === 'KeyW') self.doubleW = false;
    });

    document.addEventListener('mousemove', function (e) {
      if (document.pointerLockElement !== el || !self.player) return;
      const sens = 0.0032 * (self.sensitivity / 0.5);
      self.player.yaw -= e.movementX * sens;
      self.player.pitch -= e.movementY * sens;
      const lim = Math.PI / 2 - 0.001;
      if (self.player.pitch > lim) self.player.pitch = lim;
      if (self.player.pitch < -lim) self.player.pitch = -lim;
    });

    el.addEventListener('mousedown', function (e) {
      if (!self.inGame || MC.UI.isInventoryOpen()) return;
      if (e.button === 0) self.interaction.mineHeld = true;
      else if (e.button === 2) {
        self.placing = true;
        self.placeTimer = 0;     // 本帧已立即放一次，等 0.22s 后再放下一个
        self.doPlace();
      }
    });
    document.addEventListener('mouseup', function (e) {
      if (e.button === 0 && self.interaction) self.interaction.mineHeld = false;
      if (e.button === 2) self.placing = false;
    });
    el.addEventListener('contextmenu', function (e) {
      e.preventDefault();
    });
    el.addEventListener('wheel', function (e) {
      if (!self.inGame) return;
      const n = self.inventory.slots.length;
      self.inventory.selected = (self.inventory.selected + (e.deltaY > 0 ? 1 : n - 1)) % n;
      self.syncHand();
    });

    document.addEventListener('pointerlockchange', function () {
      if (!self.inGame) return;
      if (document.pointerLockElement !== el && !MC.UI.isInventoryOpen()) {
        MC.UI.showPause();
      } else {
        MC.UI.hideAll();
      }
    });

    // 窗口失焦时清空按键（防止 keyup 丢失导致 WASD 卡住）
    window.addEventListener('blur', function () {
      self.keys = {};
      if (self.interaction) self.interaction.mineHeld = false;
      self.placing = false;
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        self.keys = {};
        if (self.interaction) self.interaction.mineHeld = false;
        self.placing = false;
      }
    });
  },

  gatherInput: function () {
    const k = this.keys;
    // MC 默认键位：Shift = 潜行，Ctrl = 疾跑（另支持双击 W 疾跑）
    const sprint = !!k['ControlLeft'] || !!k['ControlRight'] || this.doubleW;
    const sneak = !!k['ShiftLeft'] || !!k['ShiftRight'];
    return {
      forward: k['KeyW'] ? 1 : 0,
      back: k['KeyS'] ? 1 : 0,
      left: k['KeyA'] ? 1 : 0,
      right: k['KeyD'] ? 1 : 0,
      jump: k['Space'] ? 1 : 0,
      sneak: sneak ? 1 : 0,
      sprint: sprint ? 1 : 0
    };
  },

  // ---------- 主循环 ----------
  loop: function (now) {
    requestAnimationFrame(this.loop);
    if (!this.running) return;
    const dt = Math.min((now - (this.lastNow || now)) / 1000, 0.25);
    this.lastNow = now;

    if (this.world && this.player && this.interaction) {
      // 物理 tick（20Hz 固定步长）
      this.acc = (this.acc || 0) + dt;
      const TICK = 0.05;
      let ticks = 0;
      while (this.acc >= TICK && ticks < 5) {
        const input = this.gatherInput();
        this.player.tick(TICK, input);
        this.env.tick(TICK);
        this.acc -= TICK;
        ticks++;
      }
      // 区块生成/重建在渲染帧处理（分片、限时，避免卡顿）
      this.updateChunks();
      const alpha = Math.max(0, Math.min(1, this.acc / TICK));
      this.player.updateCamera(this.camera, alpha, dt);

      // 手持方块摆臂动画
      if (this.hand && this.interaction) {
        this.hand.sync();
        this.hand.update(dt, {
          bobPhase: this.player.bobPhase,
          bobAmount: this.player.bobAmount,
          sprinting: this.player.sprinting,
          onGround: this.player.onGround,
          mine: this.interaction.handMine,
          mineTime: this.interaction.mineTime,
          placePulse: this.interaction.placePulse
        });
      }

      // 按住右键连续放置（MC 行为：约 0.22s 一个）
      if (this.placing) {
        this.placeTimer = (this.placeTimer || 0) + dt;
        if (this.placeTimer > 0.22) {
          this.placeTimer = 0;
          this.doPlace();
        }
      }

      // 交互（帧级更新，射线顺滑）
      this.interaction.update(dt, this.creative);
      MC.UI.setCrossName(this.interaction.crossTarget ? this.interaction.crossTarget.name : '');

      // FOV：疾跑展开
      const targetFov = this.player.sprinting && !this.player.flying ? 78 : 70;
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 10);
      this.camera.updateProjectionMatrix();

      // F3 调试
      if (this.debugOn) {
        const p = this.player;
        MC.UI.updateDebug(
          'Minecraft Web - FPS: ' + this.fps +
          '\n种子: ' + this.seed +
          '\nXYZ: ' + p.pos.x.toFixed(2) + ' / ' + p.pos.y.toFixed(2) + ' / ' + p.pos.z.toFixed(2) +
          '\n朝向: ' + (p.yaw * 180 / Math.PI).toFixed(1) + '° / ' + (p.pitch * 180 / Math.PI).toFixed(1) + '°' +
          '\n区块: ' + Math.floor(p.pos.x / 16) + ', ' + Math.floor(p.pos.z / 16) +
          '\n模式: ' + (this.creative ? '创造' : '生存') +
          '\n飞行: ' + (p.flying ? '开' : '关') +
          '\n时间: ' + Math.floor(this.env.time) +
          '\n视距: ' + this.radius +
          '\n生成队列: ' + this.genQueue.length
        );
      }
    }

    // 阴影跟随玩家 + 太阳方向（每帧）
    if (this.lightFx && this.env) {
      this.env.sunLight.target.position.copy(this.player.pos);
      this.env.sunLight.position.copy(this.player.pos).addScaledVector(this.env.sunDir, 90);
    }

    // 渲染（光影开启时走后处理管线）
    if (this.postfx && this.lightFx && this.postfx.enabled) {
      this.postfx.render(this.scene, this.camera);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    MC.UI.draw();

    // FPS
    this.frameCount++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.frameCount / this.fpsTime);
      this.frameCount = 0;
      this.fpsTime = 0;
    }
  }
};
