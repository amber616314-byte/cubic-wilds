// audio.js — WebAudio 合成音效（无外部音频文件，模仿 MC 音色）
'use strict';
window.MC = window.MC || {};

MC.Audio = (function () {
  let ctx = null;
  let master = null;
  let enabled = true;
  let lastTime = 0;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch (e) { ctx = null; }
  }

  function noiseBuffer(dur) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // 噪声突发（滤波）
  function noiseBurst(freq, dur, gain, q) {
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q || 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(filter); filter.connect(g); g.connect(master);
    src.start();
    src.stop(ctx.currentTime + dur + 0.02);
  }

  // 音调（正弦/方波）
  function tone(freq, dur, gain, type, slideTo) {
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g); g.connect(master);
    o.start();
    o.stop(ctx.currentTime + dur + 0.02);
  }

  // 方块音效类别 → 频率
  const SOUND_FREQ = {
    grass: 760, stone: 880, wood: 520, sand: 1050,
    gravel: 620, glass: 2100, ore: 940, snow: 780, water: 300
  };

  // 挖掘（每 0.25s 一次）
  function dig(sound) {
    if (!ctx || !enabled) return;
    const f = SOUND_FREQ[sound] || 800;
    noiseBurst(f, 0.09, 0.22, 1.6);
  }

  // 破坏完成
  function breakBlock(sound) {
    if (!ctx || !enabled) return;
    const f = SOUND_FREQ[sound] || 800;
    noiseBurst(f * 1.3, 0.22, 0.4, 1.2);
    noiseBurst(f * 0.6, 0.3, 0.3, 1.0);
  }

  // 放置
  function place(sound) {
    if (!ctx || !enabled) return;
    const f = SOUND_FREQ[sound] || 800;
    noiseBurst(f * 0.7, 0.07, 0.3, 2.0);
    tone(f * 0.5, 0.06, 0.15, 'square', f * 0.35);
  }

  // 脚步声
  function step(sound) {
    if (!ctx || !enabled) return;
    const f = SOUND_FREQ[sound] || 700;
    noiseBurst(f, 0.045, 0.1, 2.5);
  }

  // 拾取
  function pickup() {
    if (!ctx || !enabled) return;
    tone(520, 0.08, 0.2, 'sine', 780);
    tone(780, 0.12, 0.18, 'sine', 1040);
  }

  // 落地（厚重感反馈）
  function land(fallSpeed) {
    if (!ctx || !enabled) return;
    const f = 110 + fallSpeed * 70;
    noiseBurst(f, 0.13, 0.22 + fallSpeed * 0.12, 1.4);
    tone(f * 0.45, 0.11, 0.13, 'sine', f * 0.28);
  }

  // 飞行/跳跃起跳
  function jump() {
    if (!ctx || !enabled) return;
    noiseBurst(400, 0.05, 0.08, 1.5);
  }

  function setEnabled(v) { enabled = v; }
  function setVolume(v) { if (master) master.gain.value = v; }
  function isReady() { return !!ctx; }

  return {
    init: init, dig: dig, breakBlock: breakBlock, place: place,
    step: step, pickup: pickup, jump: jump, land: land,
    setEnabled: setEnabled, setVolume: setVolume, isReady: isReady,
    get enabled() { return enabled; }
  };
})();
