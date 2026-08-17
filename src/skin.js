// Classic 64x64 Steve skin mapped onto the iconic six-box player model, plus
// a first-person arm with a held block cube.
import * as THREE from 'three';
import { loadImage, croppedAtlasTexture, blockFaceTiles } from './textures.js';
import { GLASS, WATER, LAVA, LEAVES_OAK, LEAVES_BIRCH, LEAVES_SPRUCE, BIOME_PLAINS, isPlant } from './blocks.js';

const P = 0.05625; // one skin texel in meters (32px model = 1.8m)

function faceTex(image, x, y, w, h) {
  const t = new THREE.Texture(image);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.repeat.set(w / image.width, h / image.height);
  t.offset.set(x / image.width, 1 - (y + h) / image.height);
  t.needsUpdate = true;
  return t;
}

// box material order: +x, -x, +y, -y, +z, -z
function boxPart(image, w, h, d, faceCoords) {
  const mats = faceCoords.map(([x, y, ww, hh]) =>
    new THREE.MeshStandardMaterial({ map: faceTex(image, x, y, ww, hh), roughness: 0.85, metalness: 0.0 }));
  const geo = new THREE.BoxGeometry(w * P, h * P, d * P);
  const mesh = new THREE.Mesh(geo, mats);
  return mesh;
}

export async function buildPlayerModel() {
  const image = await loadImage('entity/steve.png');
  const group = new THREE.Group();
  group.name = 'playerModel';

  const headPivot = new THREE.Group();
  headPivot.position.y = 1.575;
  const head = boxPart(image, 8, 8, 8, [
    [0, 8, 8, 8], [16, 8, 8, 8], [8, 0, 8, 8], [16, 0, 8, 8], [24, 8, 8, 8], [8, 8, 8, 8],
  ]);
  head.position.y = 0;
  headPivot.add(head);
  group.add(headPivot);

  const body = boxPart(image, 8, 12, 4, [
    [16, 20, 4, 12], [28, 20, 4, 12], [20, 16, 8, 4], [28, 16, 8, 4], [32, 20, 8, 12], [20, 20, 8, 12],
  ]);
  body.position.y = 1.0125;
  group.add(body);

  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(0.3375, 1.35, 0);
  const rightArm = boxPart(image, 4, 12, 4, [
    [40, 20, 4, 12], [48, 20, 4, 12], [44, 16, 4, 4], [48, 16, 4, 4], [52, 20, 4, 12], [44, 20, 4, 12],
  ]);
  rightArm.position.y = -0.3375;
  rightArmPivot.add(rightArm);
  group.add(rightArmPivot);

  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(-0.3375, 1.35, 0);
  const leftArm = boxPart(image, 4, 12, 4, [
    [40, 52, 4, 12], [32, 52, 4, 12], [36, 48, 4, 4], [40, 48, 4, 4], [44, 52, 4, 12], [36, 52, 4, 12],
  ]);
  leftArm.position.y = -0.3375;
  leftArmPivot.add(leftArm);
  group.add(leftArmPivot);

  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(0.1125, 0.675, 0);
  const rightLeg = boxPart(image, 4, 12, 4, [
    [0, 20, 4, 12], [8, 20, 4, 12], [4, 16, 4, 4], [8, 16, 4, 4], [12, 20, 4, 12], [4, 20, 4, 12],
  ]);
  rightLeg.position.y = -0.3375;
  rightLegPivot.add(rightLeg);
  group.add(rightLegPivot);

  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.set(-0.1125, 0.675, 0);
  const leftLeg = boxPart(image, 4, 12, 4, [
    [24, 52, 4, 12], [16, 52, 4, 12], [20, 48, 4, 4], [24, 48, 4, 4], [28, 52, 4, 12], [20, 52, 4, 12],
  ]);
  leftLeg.position.y = -0.3375;
  leftLegPivot.add(leftLeg);
  group.add(leftLegPivot);

  return {
    group,
    headPivot, head, body,
    rightArmPivot, rightArm, leftArmPivot, leftArm,
    rightLegPivot, rightLeg, leftLegPivot, leftLeg,
  };
}

function isLeafy(id) { return id === LEAVES_OAK || id === LEAVES_BIRCH || id === LEAVES_SPRUCE; }

export function buildHeldBlock(id, biome = BIOME_PLAINS) {
  const group = new THREE.Group();
  group.name = 'heldBlock';
  const faces = blockFaceTiles(id, biome);

  // Flowers / tall grass are item sprites in first person, not cubes whose
  // transparent texels become a black box.  A double-sided cutout plane gives
  // the classic flat 1.8 item silhouette and stays compatible with the same
  // outer ItemRenderer transform used by blocks.
  if (isPlant(id)) {
    const mat = new THREE.MeshLambertMaterial({
      map: croppedAtlasTexture(faces.side),
      transparent: true,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      depthWrite: true,
      toneMapped: true,
    });
    const item = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    item.name = 'heldPlantItem';
    // Slightly smaller than a block item, like vanilla's generated item model.
    item.scale.setScalar(0.92);
    group.add(item);
    return group;
  }

  const order = ['side', 'side', 'top', 'bottom', 'side', 'side'];
  const transparent = id === GLASS || id === WATER || id === LAVA;
  const Material = id === LAVA ? THREE.MeshBasicMaterial : THREE.MeshStandardMaterial;
  const mats = order.map(face => new Material({
    map: croppedAtlasTexture(faces[face]),
    alphaTest: isLeafy(id) ? 0.5 : 0,
    transparent,
    side: isLeafy(id) ? THREE.DoubleSide : THREE.FrontSide,
    depthWrite: !transparent,
    roughness: id === GLASS ? 0.15 : 0.9,
    metalness: 0.0,
  }));

  // Keep the model itself as a unit cube.  Minecraft applies its first-person
  // display transform outside the block model (roughly 0.4 scale, 45° yaw).
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mats);
  cube.name = 'heldBlockCube';
  group.add(cube);
  return group;
}

export async function buildFirstPersonArm() {
  const image = await loadImage('entity/steve.png');
  const group = new THREE.Group();
  group.name = 'firstPersonViewModel';

  // Item and arm use separate pivots.  The previous version attached the item
  // to the arm pivot, so the arm's ~70° resting pitch also rotated the cube and
  // created the huge diagonal block seen in the comparison screenshot.
  const itemPivot = new THREE.Group();
  itemPivot.name = 'firstPersonItemPivot';
  group.add(itemPivot);

  const armPivot = new THREE.Group();
  armPivot.name = 'firstPersonArmPivot';
  group.add(armPivot);

  const arm = boxPart(image, 4, 12, 4, [
    [40, 20, 4, 12], [48, 20, 4, 12], [44, 16, 4, 4], [48, 16, 4, 4], [52, 20, 4, 12], [44, 20, 4, 12],
  ]);
  arm.position.y = -0.3375;
  armPivot.add(arm);

  // "pivot" is kept as an alias for older call sites; new code should use
  // itemPivot / armPivot explicitly.
  return { group, pivot: itemPivot, itemPivot, armPivot, arm };
}
