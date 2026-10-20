export const VOXEL_SIZE = 4;                                           

export const TERRAIN_MATERIALS = Object.freeze([
  { name: "Grass", color: 0x5fa544, rough: 0.95 },
  { name: "Sand", color: 0xe6d6a0, rough: 1.0 },
  { name: "Rock", color: 0x8a8a8f, rough: 0.9 },
  { name: "Water", color: 0x1a7fb5, rough: 0.1, water: true },
  { name: "Sandstone", color: 0xd2a679, rough: 0.95 },
  { name: "Slate", color: 0x45474d, rough: 0.8 },
  { name: "Concrete", color: 0xb7b7b2, rough: 0.9 },
  { name: "Brick", color: 0x9e4b3a, rough: 0.9 },
  { name: "Cobblestone", color: 0x7d7d6e, rough: 0.95 },
  { name: "Basalt", color: 0x2b2b30, rough: 0.85 },
  { name: "CrackedLava", color: 0xd4452a, rough: 0.7, emissive: 0x551005 },
  { name: "Limestone", color: 0xd8cfb0, rough: 0.9 },
  { name: "Pavement", color: 0x9a9a96, rough: 0.85 },
  { name: "Glacier", color: 0xbfe6f2, rough: 0.3 },
  { name: "Snow", color: 0xf5f8fb, rough: 0.85 },
  { name: "Ground", color: 0x7a5a3a, rough: 0.95 },
  { name: "Mud", color: 0x4a3826, rough: 0.9 },







  { name: "WoodPlanks", color: 0x9b7b4f, rough: 0.9 },
  { name: "Asphalt", color: 0x737370, rough: 0.95 },
  { name: "Ice", color: 0xcbe6f2, rough: 0.2 },                                    
  { name: "LeafyGrass", color: 0x6aa844, rough: 0.95 },
  { name: "Salt", color: 0xe6e6e1, rough: 0.9 },
]);

export const MATERIAL_COUNT = TERRAIN_MATERIALS.length;
export const WATER_MATERIAL = TERRAIN_MATERIALS.findIndex((m) => m.water);

const NAME_TO_INDEX = (() => {
  const map = Object.create(null);
  TERRAIN_MATERIALS.forEach((m, i) => { map[m.name] = i; });
  return map;
})();

export function materialIndexByName(name) {
  const i = NAME_TO_INDEX[name];
  return typeof i === "number" ? i : 0;
}


export function hasMaterialName(name) {
  return typeof NAME_TO_INDEX[name] === "number";
}
export function materialName(index) {
  const m = TERRAIN_MATERIALS[index];
  return m ? m.name : "Grass";
}
export function isWaterMaterial(index) {
  const m = TERRAIN_MATERIALS[index];
  return !!(m && m.water);
}

const RGB_CACHE = TERRAIN_MATERIALS.map((m) => {
  const c = m.color >>> 0;
  return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
});
export function materialColorRGB(index) {
  return RGB_CACHE[index] || RGB_CACHE[0];
}
export function materialHex(index) {
  const m = TERRAIN_MATERIALS[index];
  const c = (m ? m.color : 0x5fa544) >>> 0;
  return "#" + c.toString(16).padStart(6, "0");                        
}
