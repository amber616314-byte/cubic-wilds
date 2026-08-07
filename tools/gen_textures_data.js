// tools/gen_textures_data.js — 把 assets/textures/*.png 转 base64 内嵌（file:// 下避免 canvas 污染）
// 用法：node tools/gen_textures_data.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const dir = path.join(ROOT, 'assets', 'textures');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort();
let out = '// 自动生成（node tools/gen_textures_data.js）：assets/textures/*.png → base64\n';
out += '// 用途：file:// 协议下 Image 加载本地 PNG 会污染 canvas，data URL 无此问题\n';
out += 'window.MC = window.MC || {};\nMC.TEXTURE_DATA = {\n';
for (const f of files) {
  const key = f.replace(/\.png$/, '');
  const b64 = fs.readFileSync(path.join(dir, f)).toString('base64');
  out += `  '${key}': '${b64}',\n`;
}
out += '};\n';
fs.writeFileSync(path.join(ROOT, 'js', 'textures_data.js'), out);
console.log('written js/textures_data.js (' + files.length + ' textures, ' + out.length + ' bytes)');
