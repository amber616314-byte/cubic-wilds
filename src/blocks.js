// Block registry.  IDs are internal (they follow classic MC block ids for the
// first blocks, which makes the world format easy to reason about).

export const AIR = 0;
export const STONE = 1;
export const GRASS = 2;
export const DIRT = 3;
export const COBBLESTONE = 4;
export const PLANKS = 5;
export const BEDROCK = 7;
export const WATER = 8;
export const LAVA = 10;
export const SAND = 12;
export const GRAVEL = 13;
export const GOLD_ORE = 14;
export const IRON_ORE = 15;
export const COAL_ORE = 16;
export const LOG_OAK = 17;
export const LEAVES_OAK = 18;
export const GLASS = 20;
export const SANDSTONE = 24;
export const TALLGRASS = 31;
export const FLOWER_DANDELION = 37;
export const FLOWER_ROSE = 38;
export const BRICK = 45;
export const OBSIDIAN = 49;
export const DIAMOND_ORE = 56;
export const CRAFTING_TABLE = 58;
export const REDSTONE_ORE = 73;
export const SNOW = 78;
export const STONEBRICK = 98;
export const LOG_BIRCH = 101;
export const LOG_SPRUCE = 102;
export const LEAVES_BIRCH = 103;
export const LEAVES_SPRUCE = 104;

export const BIOME_OCEAN = 0;
export const BIOME_PLAINS = 1;
export const BIOME_DESERT = 2;
export const BIOME_FOREST = 3;
export const BIOME_TAIGA = 4;
export const BIOME_SNOWY = 5;
export const BIOME_RIVER = 6;
export const BIOME_SWAMP = 7;
export const BIOME_SAVANNA = 8;
export const BIOME_DEEP_OCEAN = 9;
export const BIOME_BEACH = 10;
export const BIOME_EXTREME_HILLS = 11;
export const BIOME_COLD_TAIGA = 12;
export const BIOME_BIRCH_FOREST = 13;
export const BIOME_ROOFED_FOREST = 14;
export const BIOME_STONE_BEACH = 15;

const BIOME_NAMES = {
  [BIOME_OCEAN]: '海洋', [BIOME_DEEP_OCEAN]: '深海', [BIOME_RIVER]: '河流',
  [BIOME_BEACH]: '沙滩', [BIOME_STONE_BEACH]: '石滩',
  [BIOME_PLAINS]: '平原', [BIOME_DESERT]: '沙漠', [BIOME_SAVANNA]: '热带草原',
  [BIOME_FOREST]: '森林', [BIOME_BIRCH_FOREST]: '白桦森林',
  [BIOME_ROOFED_FOREST]: '黑森林', [BIOME_SWAMP]: '沼泽',
  [BIOME_TAIGA]: '针叶林', [BIOME_COLD_TAIGA]: '冷针叶林',
  [BIOME_SNOWY]: '积雪冻原', [BIOME_EXTREME_HILLS]: '峭壁',
};

export function biomeName(b) { return BIOME_NAMES[b] || '未知'; }

// Grass / foliage biome tints, sampled from the classic 1.8 colour maps.
export const BIOME_TINTS = {
  [BIOME_PLAINS]: { grass: [145, 189, 89], foliage: [119, 171, 47] },
  [BIOME_FOREST]: { grass: [121, 192, 90], foliage: [89, 174, 48] },
  [BIOME_BIRCH_FOREST]: { grass: [121, 192, 90], foliage: [89, 174, 48] },
  [BIOME_ROOFED_FOREST]: { grass: [121, 192, 90], foliage: [89, 174, 48] },
  [BIOME_DESERT]: { grass: [191, 183, 85], foliage: [107, 160, 44] },
  [BIOME_TAIGA]:  { grass: [134, 183, 131], foliage: [104, 164, 100] },
  [BIOME_COLD_TAIGA]: { grass: [128, 180, 151], foliage: [96, 156, 131] },
  [BIOME_SNOWY]:  { grass: [128, 180, 151], foliage: [96, 156, 131] },
  [BIOME_EXTREME_HILLS]: { grass: [139, 177, 111], foliage: [96, 150, 66] },
  [BIOME_SWAMP]: { grass: [106, 112, 57], foliage: [76, 118, 60] },
  [BIOME_SAVANNA]: { grass: [191, 183, 85], foliage: [174, 164, 42] },
  [BIOME_RIVER]: { grass: [145, 189, 89], foliage: [119, 171, 47] },
  [BIOME_BEACH]: { grass: [145, 189, 89], foliage: [119, 171, 47] },
  [BIOME_STONE_BEACH]: { grass: [145, 189, 89], foliage: [119, 171, 47] },
  [BIOME_DEEP_OCEAN]: { grass: [145, 189, 89], foliage: [119, 171, 47] },
};

const SOUND = { GRASS: 'grass', STONE: 'stone', WOOD: 'wood', SAND: 'sand', GRAVEL: 'gravel', CLOTH: 'cloth', SNOW: 'snow' };

export const BLOCKS = {
  [STONE]:            { name: '石头', sound: SOUND.STONE, hardness: 1.5, digTime: 7.5, solid: true, opaque: true },
  [GRASS]:            { name: '草方块', sound: SOUND.GRASS, hardness: 0.6, digTime: 0.9, solid: true, opaque: true },
  [DIRT]:             { name: '泥土', sound: SOUND.GRAVEL, hardness: 0.5, digTime: 0.75, solid: true, opaque: true },
  [COBBLESTONE]:      { name: '圆石', sound: SOUND.STONE, hardness: 2.0, digTime: 10, solid: true, opaque: true },
  [PLANKS]:           { name: '橡木木板', sound: SOUND.WOOD, hardness: 2.0, digTime: 3, solid: true, opaque: true },
  [BEDROCK]:          { name: '基岩', sound: SOUND.STONE, hardness: -1, digTime: Infinity, solid: true, opaque: true, unbreakable: true },
  [WATER]:            { name: '水', sound: SOUND.CLOTH, hardness: 100, digTime: Infinity, solid: false, opaque: false, liquid: true },
  [LAVA]:             { name: '熔岩', sound: SOUND.STONE, hardness: 100, digTime: Infinity, solid: false, opaque: false, liquid: true, luminous: true },
  [SAND]:             { name: '沙子', sound: SOUND.SAND, hardness: 0.5, digTime: 0.75, solid: true, opaque: true },
  [GRAVEL]:           { name: '沙砾', sound: SOUND.GRAVEL, hardness: 0.6, digTime: 0.9, solid: true, opaque: true },
  [GOLD_ORE]:         { name: '金矿石', sound: SOUND.STONE, hardness: 3.0, digTime: 15, solid: true, opaque: true },
  [IRON_ORE]:         { name: '铁矿石', sound: SOUND.STONE, hardness: 3.0, digTime: 15, solid: true, opaque: true },
  [COAL_ORE]:         { name: '煤矿石', sound: SOUND.STONE, hardness: 3.0, digTime: 15, solid: true, opaque: true },
  [DIAMOND_ORE]:      { name: '钻石矿石', sound: SOUND.STONE, hardness: 3.0, digTime: 15, solid: true, opaque: true },
  [REDSTONE_ORE]:     { name: '红石矿石', sound: SOUND.STONE, hardness: 3.0, digTime: 15, solid: true, opaque: true },
  [LOG_OAK]:          { name: '橡木原木', sound: SOUND.WOOD, hardness: 2.0, digTime: 3, solid: true, opaque: true },
  [LOG_BIRCH]:        { name: '白桦原木', sound: SOUND.WOOD, hardness: 2.0, digTime: 3, solid: true, opaque: true },
  [LOG_SPRUCE]:       { name: '云杉原木', sound: SOUND.WOOD, hardness: 2.0, digTime: 3, solid: true, opaque: true },
  [LEAVES_OAK]:       { name: '橡树树叶', sound: SOUND.GRASS, hardness: 0.2, digTime: 0.35, solid: true, opaque: false, cutout: true },
  [LEAVES_BIRCH]:     { name: '白桦树叶', sound: SOUND.GRASS, hardness: 0.2, digTime: 0.35, solid: true, opaque: false, cutout: true },
  [LEAVES_SPRUCE]:    { name: '云杉树叶', sound: SOUND.GRASS, hardness: 0.2, digTime: 0.35, solid: true, opaque: false, cutout: true },
  [GLASS]:            { name: '玻璃', sound: SOUND.STONE, glass: true, hardness: 0.3, digTime: 0.45, solid: true, opaque: false, cutout: false, transparent: true },
  [SANDSTONE]:        { name: '砂岩', sound: SOUND.STONE, hardness: 0.8, digTime: 4, solid: true, opaque: true },
  [BRICK]:            { name: '红砖块', sound: SOUND.STONE, hardness: 2.0, digTime: 10, solid: true, opaque: true },
  [OBSIDIAN]:         { name: '黑曜石', sound: SOUND.STONE, hardness: 50, digTime: 250, solid: true, opaque: true },
  [CRAFTING_TABLE]:   { name: '工作台', sound: SOUND.WOOD, hardness: 2.5, digTime: 3.75, solid: true, opaque: true },
  [SNOW]:             { name: '雪块', sound: SOUND.SNOW, hardness: 0.2, digTime: 0.3, solid: true, opaque: true },
  [STONEBRICK]:       { name: '石砖', sound: SOUND.STONE, hardness: 1.5, digTime: 7.5, solid: true, opaque: true },
  [TALLGRASS]:        { name: '草丛', sound: SOUND.GRASS, hardness: 0, digTime: 0, solid: false, opaque: false, cutout: true, plant: true },
  [FLOWER_DANDELION]: { name: '蒲公英', sound: SOUND.GRASS, hardness: 0, digTime: 0, solid: false, opaque: false, cutout: true, plant: true },
  [FLOWER_ROSE]:      { name: '虞美人', sound: SOUND.GRASS, hardness: 0, digTime: 0, solid: false, opaque: false, cutout: true, plant: true },
};

export function isSolid(id) { const b = BLOCKS[id]; return !!b && b.solid === true; }
export function isOpaque(id) { const b = BLOCKS[id]; return !!b && b.opaque === true; }
export function isLiquid(id) { const b = BLOCKS[id]; return !!b && b.liquid === true; }
export function isPlant(id) { const b = BLOCKS[id]; return !!b && b.plant === true; }
export function blockName(id) { return BLOCKS[id]?.name || '未知方块'; }


// Basic survival drop table for the block/item set currently present in this
// project.  Where the original game would drop an item texture we do not yet
// ship (coal, diamond, redstone dust, snowballs, saplings, etc.), keep the ore
// or block itself so the drop remains usable instead of inventing a fake item.
export function blockDrop(id) {
  switch (id) {
    case AIR:
    case BEDROCK:
    case WATER:
    case LAVA:
    case GLASS:
    case TALLGRASS:
    case LEAVES_OAK:
    case LEAVES_BIRCH:
    case LEAVES_SPRUCE:
      return AIR;
    case GRASS:
      return DIRT;
    case STONE:
      return COBBLESTONE;
    default:
      return BLOCKS[id] ? id : AIR;
  }
}

export const HOTBAR = [GRASS, DIRT, STONE, COBBLESTONE, PLANKS, LOG_OAK, LEAVES_OAK, SAND, GLASS];

// All placeable blocks for the creative picker (E).
export const CREATIVE_BLOCKS = [
  GRASS, DIRT, STONE, COBBLESTONE, PLANKS, LOG_OAK, LOG_BIRCH, LOG_SPRUCE,
  LEAVES_OAK, LEAVES_BIRCH, LEAVES_SPRUCE, SAND, SANDSTONE, GRAVEL, SNOW,
  GLASS, BRICK, STONEBRICK, CRAFTING_TABLE, BEDROCK, OBSIDIAN,
  COAL_ORE, IRON_ORE, GOLD_ORE, DIAMOND_ORE, REDSTONE_ORE,
  WATER, LAVA, TALLGRASS, FLOWER_DANDELION, FLOWER_ROSE,
];

export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 128;
export const SEA_LEVEL = 62;
