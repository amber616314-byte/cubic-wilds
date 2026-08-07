// hand.js — 第一人称手持方块：走路摆臂、挖掘挥动、放置推送
// 挂载到 scene，每帧手动同步相机变换（比 camera.add 更可靠，各环境均可见）
'use strict';
window.MC = window.MC || {};

MC.Hand = function (camera, scene) {
  this.camera = camera;
  this.currentBlockId = 0;
  this.base = { x: 0.4, y: -0.36, z: -0.58 };   // 右手位置（相机局部坐标）

  this.boxGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
  this.mat = new THREE.MeshLambertMaterial({ map: MC.Textures.atlasTexture, alphaTest: 0.5 });
  this.mesh = new THREE.Mesh(this.boxGeo, this.mat);
  this.mesh.frustumCulled = false;
  this.inner = new THREE.Group();   // 摆臂动画局部变换
  this.inner.add(this.mesh);
  this.group = new THREE.Group();   // 跟随相机（world 变换）
  this.group.add(this.inner);
  this.group.visible = false;
  scene.add(this.group);
  this.setBlock(1);
};

// 每帧同步相机变换（相机位置为插值后的渲染位置，含 bob）
MC.Hand.prototype.sync = function () {
  this.group.position.copy(this.camera.position);
  this.group.quaternion.copy(this.camera.quaternion);
};

// 切换手持方块：按方块 6 面设置图集 UV
MC.Hand.prototype.setBlock = function (blockId) {
  if (!MC.BLOCKS[blockId] || blockId === 0) blockId = 1;
  if (blockId === this.currentBlockId) return;
  this.currentBlockId = blockId;
  MC.setBoxFaceUV(this.boxGeo, blockId);
};

// state: { bobPhase, bobAmount, sprinting, onGround, mine, mineTime, placePulse }
MC.Hand.prototype.update = function (dt, state) {
  const b = this.base;
  let x = b.x, y = b.y, z = b.z;
  const moving = state.bobAmount > 0;
  const swing = Math.sin(state.bobPhase);

  if (moving) {
    // 走路摆臂：前后摆 + 左右微摆 + 上下起伏（与视角 bob 同相位）
    const amp = state.sprinting ? 1.35 : 1;
    z += swing * 0.16 * amp;
    x += Math.cos(state.bobPhase) * 0.06 * amp;
    y += Math.abs(Math.cos(state.bobPhase)) * 0.04 * amp;
    this.mesh.rotation.z = swing * 0.3 * amp;
    this.mesh.rotation.x = swing * 0.13 * amp;
  } else {
    this.mesh.rotation.z = 0;
    this.mesh.rotation.x = 0;
  }

  if (state.mine) {
    // 挖掘：前伸 + 节奏性抖动
    z += 0.2 + Math.sin(state.mineTime * 16) * 0.04;
    this.mesh.rotation.z = -0.2 + Math.sin(state.mineTime * 16) * 0.08;
    this.mesh.rotation.x = 0.1;
  } else if (state.placePulse > 0) {
    // 放置：前推后收
    z += 0.26 * state.placePulse;
    this.mesh.rotation.z = -0.32 * state.placePulse;
  }

  // 疾跑时整体略下沉 + 前倾
  if (state.sprinting && moving) {
    y -= 0.03;
    z -= 0.03;
  }

  this.inner.position.set(x, y, z);
};

MC.Hand.prototype.setVisible = function (v) { this.group.visible = v; };
