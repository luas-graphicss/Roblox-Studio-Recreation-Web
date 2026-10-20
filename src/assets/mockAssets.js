import { TYPE_COLORS } from "./thumbnails.js";
import { deriveModelKind } from "./modelFactory.js";

export const ASSET_TYPES = Object.freeze([
  "Model",
  "Decal",
  "Audio",
  "Mesh",
  "Plugin",
  "Animation",
  "Video",
  "Font",
  "Accessory",
]);

const CREATORS = [
  "Roblox",
  "BuilderBob",
  "PixelForge",
  "NovaStudios",
  "CraftKing",
  "MeshMaster",
  "SoundWave",
  "GameGenix",
  "VoxelVibe",
  "AceAssets",
];


function rnd(n) {
  const x = Math.sin((n + 1) * 99991.137) * 10000;
  return x - Math.floor(x);
}

let COUNTER = 100000;
function nextId() {
  COUNTER += 7919;                       
  return "rbxassetid://" + COUNTER;
}

const BASE_DATE = Date.UTC(2024, 0, 1);
function dateFrom(seed, spreadDays) {
  const d = Math.floor(rnd(seed) * spreadDays);
  return new Date(BASE_DATE + d * 86400000).toISOString();
}

function mk(assetType, name, seed, extra) {
  const creator =
    extra && extra.creator
      ? extra.creator
      : CREATORS[Math.floor(rnd(seed * 3.1) * CREATORS.length)];
  const created = dateFrom(seed, 540);
  const updatedOff = Math.floor(rnd(seed * 1.7) * 60);
  const updated = new Date(
    Date.parse(created) + updatedOff * 86400000,
  ).toISOString();
  const rating = Math.round((3 + rnd(seed * 2.3) * 2) * 10) / 10;            
  const uses = Math.floor(rnd(seed * 5.9) * 250000);
  const paid = rnd(seed * 7.3) > 0.78;
  const price = paid ? 25 + Math.floor(rnd(seed * 8.1) * 475) : 0;
  const asset = {
    id: nextId(),
    name: String(name),
    creator: String(creator),
    description:
      (extra && extra.description) ||
      `${name} \u2014 ${assetType.toLowerCase()} criado por ${creator}. Pronto para uso no seu jogo.`,
    assetType,
    created,
    updated,
    rating,
    uses,
    paid,
    price,
    robloxOfficial: creator === "Roblox",
    thumbColor: TYPE_COLORS[assetType] || "#888888",
  };
  if (assetType === "Model") asset.modelKind = deriveModelKind(name);
  if (extra && extra.accessoryType) asset.accessoryType = extra.accessoryType;
  if (extra && extra.layered) asset.layered = true;
  return asset;
}

const MODEL_NAMES = [
  "Racing Car",
  "Oak Tree",
  "Pine Tree",
  "Medieval House",
  "Stone Tower",
  "Wooden Bridge",
  "Treasure Chest",
  "Robot Guard",
  "Sports Car",
  "Castle Gate",
  "Campfire Kit",
  "Street Lamp",
  "Park Bench",
  "Wooden Crate",
  "Brick House",
  "Magic Fountain",
  "Old Windmill",
  "Coastal Lighthouse",
  "Cargo Truck",
  "Battle Tank",
  "Rescue Helicopter",
  "Pirate Cabin",
  "Dragon Statue",
  "Fantasy Knight",
  "Mystic Portal",
  "Mountain Boulder",
  "Happy Snowman",
  "Field Scarecrow",
  "Picnic Table",
  "Watch Tower",
  "Sky Rocket",
  "Lava Volcano",
];

const DECAL_NAMES = [
  "Brick Texture",
  "Grass Tile",
  "Wood Planks",
  "Metal Plate",
  "Smiley Face",
  "Stone Wall",
  "Graffiti Tag",
  "Camo Pattern",
  "Water Ripples",
  "Lava Crack",
  "Snow Flakes",
  "Circuit Board",
  "Caution Stripes",
  "Galaxy Sky",
  "Carbon Fiber",
  "Rusty Iron",
  "Marble Slab",
  "Sand Dune",
  "Neon Grid",
  "Leaf Canopy",
  "Cardboard",
  "Checker Flag",
];

const AUDIO_NAMES = [
  "Explosion Boom",
  "Coin Pickup",
  "Jump Whoosh",
  "Footsteps Loop",
  "Victory Fanfare",
  "Laser Blast",
  "Door Creak",
  "Rain Ambience",
  "Sword Clash",
  "Magic Sparkle",
  "Engine Rev",
  "Click Beep",
  "Crowd Cheer",
  "Wind Howl",
  "Bubble Pop",
  "Drum Loop",
];

const MESH_NAMES = [
  "Low-Poly Tree",
  "Sword Blade",
  "Shield Round",
  "Barrel Mesh",
  "Helmet Knight",
  "Crystal Cluster",
  "Rock Formation",
  "Coffee Mug",
  "Spaceship Hull",
  "Treasure Coin",
  "Wheel Rim",
  "Lantern Frame",
];

const PLUGIN_NAMES = [
  "Build Tools Pro",
  "Mesh Optimizer",
  "Tag Editor",
  "Animation Helper",
  "Terrain Brush+",
  "GUI Aligner",
  "Script Formatter",
  "Asset Cleaner",
];

const ANIMATION_NAMES = [
  "Idle Breathing",
  "Run Cycle",
  "Jump Flip",
  "Wave Hello",
  "Sword Swing",
  "Dance Party",
  "Climb Ladder",
  "Sit Relax",
];

const VIDEO_NAMES = [
  "Intro Loop",
  "Billboard Ad",
  "Loading Screen",
  "Cutscene Sky",
  "News Ticker",
  "Promo Banner",
];

const FONT_NAMES = [
  "Pixel Mono",
  "Round Sans",
  "Comic Bubble",
  "Sci-Fi Display",
  "Hand Script",
  "Bold Impact",
  "Serif Classic",
  "Neon Glow",
];

function buildList(names, type, offset) {
  return names.map((n, i) => mk(type, n, offset + i * 13));
}


const ACCESSORY_MOCKS = [
  { name: "Top Hat Classic", accessoryType: "Hat" },
  { name: "Wizard Hair", accessoryType: "Hair" },
  { name: "Cool Shades", accessoryType: "Face" },
  { name: "Adventure Backpack", accessoryType: "Back" },
  { name: "Denim Jacket LC", accessoryType: "Jacket", layered: true },
  { name: "Cargo Pants LC", accessoryType: "Pants", layered: true },
  { name: "Classic Tee LC", accessoryType: "TShirt", layered: true },
];

function buildAccessoryMocks(offset) {
  return ACCESSORY_MOCKS.map((m, i) =>
    mk("Accessory", m.name, offset + i * 17, {
      accessoryType: m.accessoryType,
      layered: !!m.layered,
      description: m.layered
        ? `${m.name} — layered clothing (${m.accessoryType}) com WrapLayer.`
        : `${m.name} — acessório rígido (${m.accessoryType}).`,
    }),
  );
}

export const MOCK_ASSETS = Object.freeze([
  ...buildList(MODEL_NAMES, "Model", 1000),
  ...buildList(DECAL_NAMES, "Decal", 2000),
  ...buildList(AUDIO_NAMES, "Audio", 3000),
  ...buildList(MESH_NAMES, "Mesh", 4000),
  ...buildList(PLUGIN_NAMES, "Plugin", 5000),
  ...buildList(ANIMATION_NAMES, "Animation", 6000),
  ...buildList(VIDEO_NAMES, "Video", 7000),
  ...buildList(FONT_NAMES, "Font", 8000),
  ...buildAccessoryMocks(9000),
]);

const BY_ID = new Map(MOCK_ASSETS.map((a) => [a.id, a]));

export function getAssetById(id) {
  return BY_ID.get(id) || null;
}

export function countByType() {
  const out = {};
  for (const a of MOCK_ASSETS) out[a.assetType] = (out[a.assetType] || 0) + 1;
  return out;
}


export const SORTS = Object.freeze([
  { id: "relevance", label: "Relev\u00e2ncia" },
  { id: "mostUsed", label: "Mais Usados" },
  { id: "recent", label: "Mais Recentes" },
  { id: "topRated", label: "Melhor Avaliados" },
]);
export const TYPE_FILTERS = Object.freeze([
  { id: "all", label: "All" },
  { id: "free", label: "Free Only" },
  { id: "paid", label: "Paid" },
]);
export const CREATOR_FILTERS = Object.freeze([
  { id: "anyone", label: "Anyone" },
  { id: "me", label: "Only Me" },
  { id: "roblox", label: "By Roblox" },
]);

function matchesSearch(asset, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    asset.name.toLowerCase().includes(needle) ||
    asset.creator.toLowerCase().includes(needle) ||
    (asset.description || "").toLowerCase().includes(needle)
  );
}

function applyFilters(asset, f) {
  if (f.assetType && asset.assetType !== f.assetType) return false;
  if (f.typeFilter === "free" && asset.paid) return false;
  if (f.typeFilter === "paid" && !asset.paid) return false;
  if (f.creatorFilter === "roblox" && !asset.robloxOfficial) return false;
  if (f.creatorFilter === "me") return false;                                     
  if (f.minRating && asset.rating < f.minRating) return false;
  if (!matchesSearch(asset, f.search)) return false;
  return true;
}

function sortBy(list, sort, q) {
  const arr = list.slice();
  if (sort === "mostUsed") arr.sort((a, b) => b.uses - a.uses);
  else if (sort === "recent")
    arr.sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated));
  else if (sort === "topRated")
    arr.sort((a, b) => b.rating - a.rating || b.uses - a.uses);
  else {

    const needle = (q || "").toLowerCase();
    arr.sort((a, b) => {
      if (needle) {
        const ai = a.name.toLowerCase().indexOf(needle);
        const bi = b.name.toLowerCase().indexOf(needle);
        const aw = ai < 0 ? 999 : ai;
        const bw = bi < 0 ? 999 : bi;
        if (aw !== bw) return aw - bw;
      }
      return b.uses - a.uses;
    });
  }
  return arr;
}


export function queryAssets(opts) {
  const o = opts || {};
  const f = {
    assetType: o.assetType || null,


    search: (o.search == null ? "" : String(o.search)).trim(),
    typeFilter: o.typeFilter || "all",
    creatorFilter: o.creatorFilter || "anyone",
    minRating: Number(o.minRating) || 0,
  };
  const filtered = MOCK_ASSETS.filter((a) => applyFilters(a, f));
  const sorted = sortBy(filtered, o.sort || "relevance", f.search);


  const pageSize = Number(o.pageSize) >= 1 ? Math.floor(o.pageSize) : 24;
  const page = Number(o.page) >= 0 ? Math.floor(o.page) : 0;
  const start = page * pageSize;
  const items = sorted.slice(start, start + pageSize);
  return {
    items,
    total: sorted.length,
    page,
    pageSize,
    hasMore: start + pageSize < sorted.length,
  };
}
