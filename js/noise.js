// noise.js — 确定性整数哈希噪声（值噪声 + fbm），跨 chunk 一致
'use strict';
window.MC = window.MC || {};

(function () {
  // 整数混合哈希，输出 [0,1)
  function hash2i(x, y, seed) {
    let h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function hash3i(x, y, z, seed) {
    let h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function smooth(t) { return t * t * (3 - 2 * t); }

  // 2D 值噪声 [0,1]
  function noise2(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const a = hash2i(xi, yi, seed);
    const b = hash2i(xi + 1, yi, seed);
    const c = hash2i(xi, yi + 1, seed);
    const d = hash2i(xi + 1, yi + 1, seed);
    const u = smooth(xf), v = smooth(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  // 3D 值噪声 [0,1]
  function noise3(x, y, z, seed) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = smooth(xf), v = smooth(yf), w = smooth(zf);
    const h = (ix, iy, iz) => hash3i(ix, iy, iz, seed);
    // 8 角三线性插值
    const c000 = h(xi, yi, zi), c100 = h(xi + 1, yi, zi);
    const c010 = h(xi, yi + 1, zi), c110 = h(xi + 1, yi + 1, zi);
    const c001 = h(xi, yi, zi + 1), c101 = h(xi + 1, yi, zi + 1);
    const c011 = h(xi, yi + 1, zi + 1), c111 = h(xi + 1, yi + 1, zi + 1);
    const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u;
    const x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
    const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
    return y0 + (y1 - y0) * w;
  }

  // 分形布朗运动，输出 [0,1]
  function fbm2(x, y, seed, octaves) {
    let amp = 0.5, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += noise2(x * freq, y * freq, seed + i * 1013) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }
  function fbm3(x, y, z, seed, octaves) {
    let amp = 0.5, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += noise3(x * freq, y * freq, z * freq, seed + i * 1013) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  MC.hash2i = hash2i;
  MC.hash3i = hash3i;
  MC.noise2 = noise2;
  MC.noise3 = noise3;
  MC.fbm2 = fbm2;
  MC.fbm3 = fbm3;
})();
