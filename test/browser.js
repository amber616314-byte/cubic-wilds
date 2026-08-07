// test/browser.js — 真实浏览器无头测试（puppeteer-core + 系统 Chrome/Edge）
// 验证：页面加载、进入游戏、纹理加载、世界生成、移动、FPS、截图
'use strict';
const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const INDEX = 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: require('fs').existsSync(CHROME) ? CHROME : EDGE,
    headless: 'new',
    args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--disable-gpu-sandbox', '--window-size=1280,720']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });

  console.log('1. 加载页面 (file://) ...');
  await page.goto(INDEX, { waitUntil: 'load', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));

  const titleVisible = await page.evaluate(() => document.getElementById('title-screen').style.display !== 'none');
  console.log('   标题屏可见: ' + titleVisible);

  console.log('2. 点击进入世界 (seed=2025) ...');
  await page.evaluate(() => {
    document.getElementById('seed-input').value = '2025';
    document.getElementById('btn-start').click();
  });
  await new Promise(r => setTimeout(r, 4000));

  const state = await page.evaluate(() => {
    const M = window.MC && window.MC.Main;
    return {
      inGame: M ? M.inGame : false,
      chunkCount: M && M.world ? M.world.chunks.size : 0,
      playerY: M && M.player ? M.player.pos.y.toFixed(2) : null,
      onGround: M && M.player ? M.player.onGround : null,
      atlasReady: M ? !!(M.blockMat && M.blockMat.map) : false,
      handVisible: M && M.hand ? M.hand.group.visible : false,
      fps: M ? M.fps : 0
    };
  });
  console.log('   游戏中: ' + state.inGame + ', 区块: ' + state.chunkCount + ', 玩家y: ' + state.playerY + ', 落地: ' + state.onGround + ', 纹理: ' + state.atlasReady + ', 手持方块: ' + state.handVisible);

  console.log('3. 等待区块流式加载 ...');
  await new Promise(r => setTimeout(r, 6000));
  const chunkCount2 = await page.evaluate(() => window.MC.Main.world.chunks.size);
  console.log('   区块数: ' + chunkCount2);

  console.log('4. 模拟移动（按住 W 2 秒）...');
  await page.keyboard.down('KeyW');
  await new Promise(r => setTimeout(r, 1500));
  const movingVel = await page.evaluate(() => {
    const p = window.MC.Main.player;
    return Math.hypot(p.vel.x, p.vel.z).toFixed(3);
  });
  await new Promise(r => setTimeout(r, 500));
  await page.keyboard.up('KeyW');
  const moved = await page.evaluate(() => {
    const p = window.MC.Main.player;
    return { y: p.pos.y.toFixed(2), onGround: p.onGround };
  });
  console.log('   移动中速度=' + movingVel + ' (期望≈0.216 格/tick) 移动后 y=' + moved.y + ' 落地=' + moved.onGround);

  console.log('5. 模拟跳跃 ...');
  await page.keyboard.down('Space');
  await new Promise(r => setTimeout(r, 300));
  await page.keyboard.up('Space');
  const jumped = await page.evaluate(() => window.MC.Main.player.pos.y.toFixed(2));
  console.log('   跳跃后 y=' + jumped);

  console.log('6. 截图 ...');
  await page.screenshot({ path: path.join(__dirname, '..', 'screenshot.png') });
  await page.screenshot({ path: path.join(__dirname, '..', 'screenshot.png'), type: 'png' });

  // 渲染像素统计：中心区域是否非纯色（有画面）
  const pixelInfo = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 36;
    const ctx = c.getContext('2d');
    ctx.drawImage(document.querySelector('#game canvas'), 0, 0, 64, 36);
    const d = ctx.getImageData(0, 0, 64, 36).data;
    let unique = new Set();
    for (let i = 0; i < d.length; i += 4) {
      unique.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4));
    }
    return unique.size;
  });
  console.log('   画面颜色多样性(越高越丰富): ' + pixelInfo);

  console.log('7. 测试挖掘（低头看地面，左键按住 1.5 秒挖泥土）...');
  await page.evaluate(() => {
    // 低头 60° 看脚下地面
    window.MC.Main.player.pitch = -1.0;
    // 记录挖前背包（初始 64 个草方块）
    const M = window.MC.Main;
    const before = M.inventory.slots.map(s => s.id + ':' + s.count).join(',');
    window.__invBefore = before;
  });
  await new Promise(r => setTimeout(r, 300));
  await page.mouse.down({ button: 'left' });
  await new Promise(r => setTimeout(r, 1500));
  await page.mouse.up({ button: 'left' });
  const mineResult = await page.evaluate(() => {
    const I = window.MC.Main.interaction;
    const M = window.MC.Main;
    return {
      particles: I.particles.length,
      invBefore: window.__invBefore,
      invAfter: M.inventory.slots.map(s => s.id + ':' + s.count).join(','),
      feetBlock: M.world.getBlock(Math.floor(M.player.pos.x), Math.floor(M.player.pos.y - 0.3), Math.floor(M.player.pos.z))
    };
  });
  console.log('   粒子=' + mineResult.particles + ' 背包: ' + mineResult.invBefore + ' → ' + mineResult.invAfter + ' 脚下方块=' + mineResult.feetBlock);

  console.log('8. 测试右键放置（平视地面，按住右键 1.5 秒连续放置）...');
  await page.evaluate(() => {
    const M = window.MC.Main;
    M.player.pitch = -0.35;
    M.inventory.selected = 1;  // 泥土
    M.syncHand();
  });
  await new Promise(r => setTimeout(r, 300));
  const pc0 = await page.evaluate(() => window.MC.Main.inventory.slots[1].count);
  await page.mouse.down({ button: 'right' });
  await new Promise(r => setTimeout(r, 1500));
  await page.mouse.up({ button: 'right' });
  const pc1 = await page.evaluate(() => window.MC.Main.inventory.slots[1].count);
  console.log('   放置后泥土: ' + pc0 + ' → ' + pc1 + '（应减少多个）');

  const fps = await page.evaluate(() => window.MC.Main.fps);
  console.log('8. FPS: ' + fps);
  console.log('9. 页面错误: ' + (errors.length ? '\n  ' + errors.join('\n  ') : '无'));

  await browser.close();
  const ok = titleVisible && state.inGame && state.chunkCount > 3 && moved.onGround && errors.length === 0;
  console.log(ok ? '\n=== 浏览器测试通过 ===' : '\n=== 浏览器测试发现问题 ===');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FAIL: ' + e.message); process.exit(1); });
