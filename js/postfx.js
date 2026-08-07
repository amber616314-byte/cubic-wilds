// postfx.js — 后处理：高亮 bloom（降采样模糊）+ ACES 色调映射 + 微对比度
// 纯 UMD three 实现（无 EffectComposer 依赖），3 个 pass，开销小
'use strict';
window.MC = window.MC || {};

MC.PostFX = function (renderer, width, height) {
  this.renderer = renderer;
  this.enabled = true;
  this.threshold = 0.62;   // 亮度阈值：太阳/天空/亮部产生 bloom（更低 → 光晕更明显）
  this.strength = 1.0;     // bloom 强度

  // 场景渲染目标（4x MSAA）
  this.rtScene = new THREE.WebGLRenderTarget(Math.max(2, width), Math.max(2, height), {
    samples: 4
  });
  this.rtScene.texture.minFilter = THREE.LinearFilter;
  this.rtScene.texture.magFilter = THREE.LinearFilter;

  // 半分辨率 bloom 缓冲
  this.rtBloom = new THREE.WebGLRenderTarget(Math.max(2, width >> 1), Math.max(2, height >> 1));
  this.rtBloom.texture.minFilter = THREE.LinearFilter;
  this.rtBloom.texture.magFilter = THREE.LinearFilter;

  this.orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));

  // Pass 1：高亮提取 + 降采样（5 tap）
  this.brightMat = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: this.rtScene.texture },
      threshold: { value: this.threshold },
      texel: { value: new THREE.Vector2(1 / this.rtScene.width, 1 / this.rtScene.height) }
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D tDiffuse;',
      'uniform float threshold;',
      'uniform vec2 texel;',
      'varying vec2 vUv;',
      'void main() {',
      '  vec3 c = texture2D(tDiffuse, vUv).rgb;',
      '  vec3 hdr = max(c - vec3(threshold), vec3(0.0));',
      '  hdr += max(texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb - vec3(threshold), vec3(0.0));',
      '  hdr += max(texture2D(tDiffuse, vUv + vec2(-texel.x, 0.0)).rgb - vec3(threshold), vec3(0.0));',
      '  hdr += max(texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb - vec3(threshold), vec3(0.0));',
      '  hdr += max(texture2D(tDiffuse, vUv + vec2(0.0, -texel.y)).rgb - vec3(threshold), vec3(0.0));',
      '  gl_FragColor = vec4(hdr * 0.4, 1.0);',
      '}'
    ].join('\n')
  });
  this.brightScene = new THREE.Scene();
  this.brightScene.add(new THREE.Mesh(this.quad.geometry, this.brightMat));

  // Pass 2：合成（场景 + bloom）+ ACES 色调映射
  this.compositeMat = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: this.rtScene.texture },
      tBloom: { value: this.rtBloom.texture },
      strength: { value: this.strength }
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D tDiffuse;',
      'uniform sampler2D tBloom;',
      'uniform float strength;',
      'varying vec2 vUv;',
      'vec3 aces(vec3 x) {',
      '  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);',
      '}',
      'void main() {',
      '  vec3 c = texture2D(tDiffuse, vUv).rgb;',
      '  vec3 bloom = texture2D(tBloom, vUv).rgb;',
      '  vec3 color = c + bloom * strength;',
      '  color = aces(color * 1.18);',          // 提亮补偿 ACES 压缩
      '  color = pow(color, vec3(0.95));',
      '  gl_FragColor = vec4(color, 1.0);',
      '}'
    ].join('\n')
  });
  this.compositeScene = new THREE.Scene();
  this.compositeScene.add(new THREE.Mesh(this.quad.geometry, this.compositeMat));
};

MC.PostFX.prototype.setSize = function (w, h) {
  this.rtScene.setSize(Math.max(2, w), Math.max(2, h));
  this.rtBloom.setSize(Math.max(2, w >> 1), Math.max(2, h >> 1));
  this.brightMat.uniforms.texel.value.set(1 / this.rtScene.width, 1 / this.rtScene.height);
};

// 渲染：场景 → RT → bloom → 合成到屏幕
MC.PostFX.prototype.render = function (scene, camera) {
  const r = this.renderer;
  r.setRenderTarget(this.rtScene);
  r.render(scene, camera);
  r.setRenderTarget(this.rtBloom);
  r.render(this.brightScene, this.orthoCam);
  r.setRenderTarget(null);
  r.render(this.compositeScene, this.orthoCam);
};

MC.PostFX.prototype.dispose = function () {
  this.rtScene.dispose();
  this.rtBloom.dispose();
  this.brightMat.dispose();
  this.compositeMat.dispose();
};
