// blocks.js — 方块定义表（硬度/纹理/音效类别按 Minecraft Java 1.18 数据）
'use strict';
window.MC = window.MC || {};

// sound: grass | stone | wood | sand | gravel | glass | ore | snow | water
// needsTool: 'pick' | 'axe' | null —— 空手破坏时间 = hardness * 5（无合适工具）
// drop: 掉落物方块 id；0 = 不掉落
MC.BLOCKS = [
  // 0 空气
  { id: 0, key: 'air', name: '空气', hardness: 0, solid: false, transparent: true, liquid: false, cross: false, unbreakable: false, needsTool: null, sound: 'stone', tex: { top: 'air', side: 'air', bottom: 'air' }, drop: 0 },
  // 1
  { id: 1, key: 'grass_block', name: '草方块', hardness: 0.6, solid: true, transparent: false, liquid: false, cross: false, unbreakable: false, needsTool: null, sound: 'grass', tex: { top: 'grass_block_top', side: 'grass_block_side', bottom: 'dirt' }, drop: 1 },
  // 2
  { id: 2, key: 'dirt', name: '泥土', hardness: 0.5, solid: true, transparent: false, liquid: false, cross: false, unbreakable: false, needsTool: null, sound: 'grass', tex: { top: 'dirt', side: 'dirt', bottom: 'dirt' }, drop: 2 },
  // 3
  { id: 3, key: 'stone', name: '石头', hardness: 1.5, solid: true, transparent: false, liquid: false, cross: false, unbreakable: false, needsTool: 'pick', sound: 'stone', tex: { top: 'stone', side: 'stone', bottom: 'stone' }, drop: 4 },
  // 4
  { id: 4, key: 'cobblestone', name: '圆石', hardness: 2.0, solid: true, transparent: false, liquid: false, cross: false, unbreakable: false, needsTool: 'pick', sound: 'stone', tex: { top: 'cobblestone', side: 'cobblestone', bottom: 'cobblestone' }, drop: 4 },
  // 5
  { id: 5, key: 'oak_log', name: '橡木原木', hardness: 2.0, solid: true, transparent: false, liquid: false, cross: false, unbreakable: false, needsTool: 'axe', sound: 'wood', tex: { top: 'oak_log_top', side: 'oak_log', bottom: 'oak_log_top' }, drop: 5 },
  // 6
  { id: 6, key: 'oak_leaves', name: '橡木树叶', hardness: 0.2, solid: true, transparent: true, liquid: false, cross: false, unbreakable: false, needsTool: null, sound: 'grass', tex: { top: 'oak_leaves', side: 'oak_leaves', bottom: 'oak_leaves' }, drop: 0 },
  // 7
  { id: 7, key: 'oak_planks', name: '橡木木板', hardness: 2.0, solid: true, transparent: false, liquid: false, cross: false, unbreakable: false, needsTool: 'axe', sound: 'wood', tex: { top: 'oak_planks', side: 'oak_planks', bottom: 'oak_planks' }, drop: 7 },
  // 8
  { id: 8, key: 'sand', name: '沙子', hardness: 0.5, solid: true, transparent: false, liquid: false, cross: false, unbreakable: false, needsTool: null, sound: 'sand', tex: { top: 'sand', side: 'sand', bottom: 'sand' }, drop: 8 },
  // 9
  { id: 9, key: 'gravel', name: '沙砾', hardness: 0.6, solid: true, transparent: false, liquid: false, cross: false, unbreakable: false, needsTool: null, sound: 'gravel', tex: { top: 'gravel', side: 'gravel', bottom: 'gravel' }, drop: 9 },
  // 10
  { id: 10, key: 'water', name: '水', hardness: -1, solid: false, transparent: true, liquid: true, cross: false, unbreakable: false, needsTool: null, sound: 'water', tex: { top: 'water_still', side: 'water_still', bottom: 'water_still' }, drop: 0 },
  // 11
  { id: 11, key: 'glass', name: '玻璃', hardness: 0.3, solid: true, transparent: true, liquid: false, cross: false, unbreakable: false, needsTool: null, sound: 'glass', tex: { top: 'glass', side: 'glass', bottom: 'glass' }, drop: 0 },
  // 12
  { id: 12, key: 'coal_ore', name: '煤矿石', hardness: 3.0, solid: true, transparent: false, liquid: false, cross: false, unbreakable: false, needsTool: 'pick', sound: 'ore', tex: { top: 'coal_ore', side: 'coal_ore', bottom: 'coal_ore' }, drop: 12 },
  // 13
  { id: 13, key: 'iron_ore', name: '铁矿石', hardness: 3.0, solid: true, transparent: false, liquid: false, cross: false, unbreakable: false, needsTool: 'pick', sound: 'ore', tex: { top: 'iron_ore', side: 'iron_ore', bottom: 'iron_ore' }, drop: 13 },
  // 14
  { id: 14, key: 'gold_ore', name: '金矿石', hardness: 3.0, solid: true, transparent: false, liquid: false, cross: false, unbreakable: false, needsTool: 'pick', sound: 'ore', tex: { top: 'gold_ore', side: 'gold_ore', bottom: 'gold_ore' }, drop: 14 },
  // 15
  { id: 15, key: 'diamond_ore', name: '钻石矿石', hardness: 3.0, solid: true, transparent: false, liquid: false, cross: false, unbreakable: false, needsTool: 'pick', sound: 'ore', tex: { top: 'diamond_ore', side: 'diamond_ore', bottom: 'diamond_ore' }, drop: 15 },
  // 16
  { id: 16, key: 'redstone_ore', name: '红石矿石', hardness: 3.0, solid: true, transparent: false, liquid: false, cross: false, unbreakable: false, needsTool: 'pick', sound: 'ore', tex: { top: 'redstone_ore', side: 'redstone_ore', bottom: 'redstone_ore' }, drop: 16 },
  // 17
  { id: 17, key: 'bedrock', name: '基岩', hardness: -1, solid: true, transparent: false, liquid: false, cross: false, unbreakable: true, needsTool: null, sound: 'stone', tex: { top: 'bedrock', side: 'bedrock', bottom: 'bedrock' }, drop: 0 },
  // 18
  { id: 18, key: 'snow_block', name: '雪方块', hardness: 0.2, solid: true, transparent: false, liquid: false, cross: false, unbreakable: false, needsTool: null, sound: 'snow', tex: { top: 'snow', side: 'snow', bottom: 'snow' }, drop: 18 },
  // 19
  { id: 19, key: 'short_grass', name: '高草', hardness: 0, solid: false, transparent: true, liquid: false, cross: true, unbreakable: false, needsTool: null, sound: 'grass', tex: { top: 'grass', side: 'grass', bottom: 'grass' }, drop: 0 }
];

MC.blockById = function (id) { return MC.BLOCKS[id] || MC.BLOCKS[0]; };
MC.isSolid = function (b) { return b && b.solid && !b.liquid; };
MC.isOpaque = function (b) { return b && b.solid && !b.transparent; };

// 可放置方块列表（物品栏用），排除空气/水（基岩可放置，与创造模式一致）
MC.PLACEABLE = MC.BLOCKS.filter(function (b) { return b.id !== 0 && !b.liquid; });
