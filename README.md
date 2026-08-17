<div align="center">

# VoxelCraft Reborn

**A browser-native voxel sandbox built with JavaScript and Three.js.**

程序化世界 · 区块流送 · 生存 / 创造 · 液体模拟 · 方块破坏 · 第一 / 第三人称

</div>

---

## 项目简介

VoxelCraft Reborn 是一个运行在浏览器中的独立体素沙盒实验项目。目标不是简单画出一片方块地形，而是把世界生成、区块网格、玩家碰撞、破坏与掉落、液体流动、光照、环境效果和第一人称交互组合成一套可以持续扩展的小游戏框架。

项目使用原生 JavaScript ES Modules 与 Three.js，不依赖大型前端框架。

## 当前功能

- 程序化无限地形与动态区块加载 / 卸载
- 平原、森林、白桦林、黑森林、针叶林、雪地、沙漠、热带草原、沼泽、河流、海洋、深海、沙滩、石滩、峭壁等环境
- 洞穴、矿物、岩浆池与多种树木 / 植物生成
- 创造模式与生存模式
- 方块破坏阶段、裂纹、持续碎屑、最终破碎粒子与掉落物
- 掉落物拾取与热栏同步
- 水 / 岩浆 level、向下流动、水平扩散、流向与表面高度
- 水与岩浆接触反应
- 第一人称手臂与 3D 手持方块
- 第一人称、第三人称后视、第三人称前视切换
- 第三人称相机碰撞
- F3 调试信息、方块选择、热栏与选项菜单
- 天空、太阳、月亮、3D 云、雾、阴影与环境光照
- 脚步、破坏、液体和环境音频支持（安装本地参考素材后）
- 本地世界修改与设置保存，并兼容旧版 `mc-web` localStorage 数据

## 快速开始

### 1. 环境

需要：

- Node.js 20+
- Python 3（仅用于获取本地参考素材）
- 支持 WebGL 的现代浏览器

### 2. 获取项目

```bash
git clone <repository-url>
cd voxelcraft-reborn
```

### 3. 安装依赖

```bash
npm install
```

Three.js 由 npm 管理，不再把大型第三方构建文件直接提交到仓库。

### 4. 安装本地参考素材

为了避免在公开仓库中重新分发第三方游戏资产，`assets/` 默认为空。

```bash
npm run assets
```

这个命令会调用 `tools/fetch_assets.py`，从官方 Minecraft 资源端点获取项目当前需要的兼容参考纹理与声音，仅保存在你的本地项目目录中。

### 5. 启动

```bash
npm start
```

浏览器访问：

```text
http://127.0.0.1:8080
```

Windows 也可以在素材准备完成后双击 `start.bat`。

## 操作

| 按键 | 功能 |
|---|---|
| `W A S D` | 移动 |
| 鼠标 | 视角 |
| `Space` | 跳跃；创造模式双击切换飞行 |
| `Shift` | 潜行 |
| `Ctrl` | 疾跑 |
| 左键 | 破坏方块 |
| 右键 | 放置方块 |
| 中键 | 取色 / 选取方块 |
| `1-9` / 滚轮 | 切换热栏 |
| `E` | 方块选择 |
| `F3` | 调试信息 |
| `F5` | 切换视角 |
| `G` | 切换创造 / 生存 |
| `Esc` | 菜单 |

## 项目结构

```text
voxelcraft-reborn/
├─ index.html
├─ src/
│  ├─ main.js            # 游戏编排、输入、主循环与场景系统
│  ├─ world.js           # 世界、区块与程序化生成
│  ├─ mesher.js          # 区块网格与面生成
│  ├─ fluids.js          # 水 / 岩浆模拟
│  ├─ player.js          # 玩家移动与碰撞
│  ├─ particles.js       # 粒子
│  ├─ dropped_items.js   # 掉落物
│  ├─ hud.js             # HUD / 热栏 / 调试界面
│  ├─ textures.js        # Atlas 与液体贴图
│  ├─ audio.js           # 音频管理
├─ tools/
│  ├─ server.mjs         # 零依赖本地静态服务器
│  ├─ check.mjs          # CI / 语法与品牌检查
│  └─ fetch_assets.py    # 本地参考素材获取工具
└─ assets/               # 本地生成，不提交到 Git
```

## 测试

```bash
npm test
```

当前 CI 会执行：

- 项目 JavaScript / MJS 语法检查
- 公共页面品牌资源检查
- Python 素材工具语法检查

后续计划补充世界生成确定性测试、液体传播测试、碰撞测试与存档兼容测试。

## Roadmap

- [ ] 将地形生成迁移到 Web Worker，减少高速移动时的主线程卡顿
- [ ] Greedy Meshing，降低大面积连续方块的顶点 / draw cost
- [ ] IndexedDB 分区存档，替换大世界下的单体 localStorage 存档
- [ ] 进一步拆分 `main.js`
- [ ] 自适应阴影质量与性能预设
- [ ] 昼夜 / 天气系统进一步完善
- [ ] 原创可再分发材质与音频包，使公开在线 Demo 可以脱离参考素材运行

## License

原创项目代码使用 [MIT License](LICENSE)。第三方组件和可选本地参考素材不因此自动获得 MIT 授权，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

VoxelCraft Reborn 是独立的技术 / fan-made 项目，与 Mojang Studios 或 Microsoft 无隶属、赞助或官方认可关系。
