// environment.js — 天空/太阳/月亮/星星/云 + 昼夜循环光照
'use strict';
window.MC = window.MC || {};

MC.Environment = function (scene, camera) {
  this.scene = scene;
  this.camera = camera;
  this.time = 8000;                 // MC 时间 0..24000（6000 日出，12000 正午，18000 日落）
  this.dayLength = 4800;            // 加速：一天 4 分钟（MC 一天 24000 tick = 20 分钟）
  this.cycleEnabled = true;
  this.dayFactor = 1;               // 0 夜 … 1 昼（渲染用）

  // 天空穹顶（shader 渐变）
  this.sky = new THREE.Mesh(
    new THREE.SphereGeometry(380, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        dayFactor: { value: 1.0 },
        topColor: { value: new THREE.Color(0x3f6fd8) },
        horizonColor: { value: new THREE.Color(0xbfd8ff) },
        nightTop: { value: new THREE.Color(0x02040f) },
        nightHorizon: { value: new THREE.Color(0x0d1226) }
      },
      vertexShader: [
        'varying vec3 vPos;',
        'void main() {',
        '  vPos = position;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform float dayFactor;',
        'uniform vec3 topColor;',
        'uniform vec3 horizonColor;',
        'uniform vec3 nightTop;',
        'uniform vec3 nightHorizon;',
        'varying vec3 vPos;',
        'void main() {',
        '  vec3 dir = normalize(vPos);',
        '  float h = clamp(dir.y, -0.15, 1.0);',
        '  vec3 day = mix(horizonColor, topColor, pow(h, 0.6));',
        '  vec3 night = mix(nightHorizon, nightTop, pow(h, 0.6));',
        '  vec3 col = mix(night, day, dayFactor);',
        '  gl_FragColor = vec4(col, 1.0);',
        '}'
      ].join('\n')
    })
  );
  this.sky.renderOrder = -10;
  scene.add(this.sky);

  // 太阳 / 月亮
  this.sun = new THREE.Mesh(
    new THREE.CircleGeometry(14, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff6c8, fog: false })
  );
  this.sun.renderOrder = -9;
  this.sunGlow = new THREE.Mesh(
    new THREE.CircleGeometry(26, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff2a0, transparent: true, opacity: 0.35, fog: false })
  );
  this.sunGlow2 = new THREE.Mesh(
    new THREE.CircleGeometry(48, 24),
    new THREE.MeshBasicMaterial({ color: 0xffe8a0, transparent: true, opacity: 0.14, fog: false })
  );
  this.moon = new THREE.Mesh(
    new THREE.CircleGeometry(9, 20),
    new THREE.MeshBasicMaterial({ color: 0xe8ecf5, fog: false })
  );
  this.moon.renderOrder = -9;
  scene.add(this.sun); scene.add(this.sunGlow); scene.add(this.sunGlow2); scene.add(this.moon);

  // 星星
  const starCount = 700;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.98 + 0.01); // 上半球
    const r = 300;
    starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = r * Math.cos(phi);
    starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xffffff, size: 1.6, transparent: true, opacity: 0, fog: false,
    depthWrite: false, sizeAttenuation: false
  }));
  scene.add(this.stars);

  // 云层（跟随玩家，缓缓漂移）
  this.clouds = new THREE.Group();
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
  const cloudGeo = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 55; i++) {
    const c = new THREE.Mesh(cloudGeo, cloudMat);
    c.scale.set(6 + Math.random() * 16, 0.8 + Math.random() * 0.8, 5 + Math.random() * 14);
    c.position.set((Math.random() - 0.5) * 300, 132 + Math.random() * 6, (Math.random() - 0.5) * 300);
    this.clouds.add(c);
  }
  this.clouds.renderOrder = -8;
  scene.add(this.clouds);

  // 光照
  this.ambient = new THREE.AmbientLight(0xffffff, 0.38);
  this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x7a6f5a, 0.3);   // 天光（蓝顶/棕底）
  this.sunLight = new THREE.DirectionalLight(0xfff4d6, 0.85);
  this.sunLight.position.set(100, 120, 40);
  this.moonLight = new THREE.DirectionalLight(0x8fa8d8, 0);
  this.moonLight.position.set(-100, 60, -40);
  scene.add(this.ambient);
  scene.add(this.hemi);
  scene.add(this.sunLight);
  scene.add(this.moonLight);
  this.sunDir = new THREE.Vector3(0.3, 0.9, 0.3).normalize();   // 太阳方向（单位向量，供阴影/光效）
};

MC.Environment.prototype.setCycle = function (enabled) { this.cycleEnabled = enabled; };

MC.Environment.prototype.tick = function (dt) {
  if (this.cycleEnabled) {
    this.time = (this.time + dt / 0.05 * (24000 / this.dayLength * 1)) % 24000;
  }
  const t = this.time;
  // 太阳高度角（t=6000 日出东升，12000 正午，18000 日落）
  const ang = (t / 24000) * Math.PI * 2;
  const elev = Math.sin(ang);            // -1..1
  const horiz = Math.cos(ang);
  // 日出/日落红晕
  const dayFactor = Math.max(0, Math.min(1, (elev + 0.25) * 2.2));
  this.dayFactor = dayFactor;

  const R = 300;
  this.sun.position.set(horiz * R, elev * R, R * 0.25);
  this.sunGlow.position.copy(this.sun.position);
  this.sunGlow2.position.copy(this.sun.position);
  this.moon.position.set(-horiz * R, -elev * R, -R * 0.25);
  // 太阳方向向量（供阴影 target 与光效）
  this.sunDir.set(horiz, elev, 0.25).normalize();
  // 平行光方向跟随太阳/月亮
  this.sunLight.position.set(horiz * 80, elev * 80, 20);
  this.moonLight.position.set(-horiz * 80, -elev * 80, -20);
  // 日落色温：太阳低时暖橙
  const warm = Math.max(0, 1 - Math.abs(elev - 0.25) * 1.4);
  this.sunLight.color.setRGB(1, 0.97 - warm * 0.42, 0.85 - warm * 0.6);
  this.moonLight.color.setRGB(0.56, 0.66, 0.85);

  // 光照强度（低环境光 + 强太阳 → 受光/背光对比鲜明，暗面立体感）
  const sunI = Math.max(0, Math.min(1, elev * 1.6));
  this.sunLight.intensity = 0.25 + sunI * 1.35;
  this.ambient.intensity = 0.08 + dayFactor * 0.18;
  this.hemi.intensity = 0.06 + dayFactor * 0.16;
  this.moonLight.intensity = (1 - dayFactor) * 0.4;
  this.stars.material.opacity = (1 - dayFactor) * 0.9;

  // 天空/雾色
  this.sky.material.uniforms.dayFactor.value = dayFactor;
  const fogDay = new THREE.Color(0xa8c8ee);
  const fogNight = new THREE.Color(0x05070f);
  if (this.fog) {
    this.fog.color.copy(fogDay).lerp(fogNight, 1 - dayFactor);
  }

  // 云漂移 + 跟随玩家
  this.clouds.position.x += 0.7 * dt;
  const p = this.camera.position;
  const dx = p.x - this.clouds.position.x, dz = p.z - this.clouds.position.z;
  if (dx * dx + dz * dz > 180 * 180) {
    this.clouds.position.x = p.x;
    this.clouds.position.z = p.z;
  }
};
