import { logger } from "../core/logger.js";
import { getLiveConnectionCount } from "../runtime/scheduler.js";
import { terrainStore } from "../terrain/terrainStore.js";

export const MAX_CONSOLE_LINES = 5000;
export const MAX_LINE_CHARS = 400;
export const COMMAND_RATE_PER_SEC = 5;


export function consoleLevelOf(entry) {
  if (!entry) return "info";
  if (entry.level === "error") return "error";
  if (entry.level === "warn") return "warn";
  return entry.source === "Script" || entry.source === "Command" ? "output" : "info";
}


export function getSessionLogs(context, sessionStartTime, clearedAfterId) {
  const ctx = context === "Client" ? "Client" : "Server";
  const since = Number(sessionStartTime) || 0;
  const minId = Number(clearedAfterId) || 0;
  const all = logger.getEntries();
  const out = [];
  for (const e of all) {
    if (e.context !== ctx) continue;
    if (e.time < since) continue;
    if (e.id <= minId) continue;
    out.push(e);
  }
  if (out.length > MAX_CONSOLE_LINES) out.splice(0, out.length - MAX_CONSOLE_LINES);
  return out;
}

export function countLogLevels(entries) {
  let errors = 0;
  let warnings = 0;
  for (const e of entries || []) {
    if (e.level === "error") errors++;
    else if (e.level === "warn") warnings++;
  }
  return { errors, warnings };
}


export function makeRateLimiter(maxPerSec) {


  const cap = Math.max(1, Math.floor(Number(maxPerSec) || COMMAND_RATE_PER_SEC));
  const stamps = [];
  return function allow(nowArg) {
    const now = typeof nowArg === "number" ? nowArg : Date.now();


    if (stamps.length && stamps[stamps.length - 1] > now) stamps.length = 0;
    while (stamps.length && now - stamps[0] >= 1000) stamps.shift();
    if (stamps.length >= cap) return false;
    stamps.push(now);
    return true;
  };
}


const KB = 1 / 1024;                      
const COST = {
  instanceKb: 2.5,
  signalKb: 0.4,
  luaEnvBaseKb: 1536,
  luaThreadKb: 24,
  luaJobKb: 2,
  collisionKb: 1.5,
  physPartKb: 3,
  meshPartKb: 350,
  basePartGeoKb: 6,
  textureKb: 512,
  particleKb: 96,
  terrainVoxelKb: 0.02,
  soundKb: 256,
  animKb: 48,
  guiKb: 1.5,
  coreMb: 96,
  untrackedBaseMb: 16,
};

const TEXTURE_CLASSES = new Set(["Decal", "Texture", "ImageLabel", "ImageButton"]);
const ANIM_CLASSES = new Set(["Animation", "KeyframeSequence", "Animator", "AnimationController"]);
const GUI_CLASSES = new Set([
  "ScreenGui", "BillboardGui", "SurfaceGui", "Frame", "ScrollingFrame", "TextLabel",
  "TextButton", "TextBox", "ImageLabel", "ImageButton", "UIListLayout", "UIGridLayout",
  "UICorner", "UIStroke", "UIPadding", "ViewportFrame",
]);
const BASEPART_CLASSES = new Set([
  "Part", "WedgePart", "CornerWedgePart", "TrussPart", "SpawnLocation", "Seat",
  "VehicleSeat", "MeshPart", "UnionOperation",
]);

function envHeapMb(env) {
  if (!env || !env.scheduler) return 0;


  const list = Array.isArray(env.scheduler.threads) ? env.scheduler.threads : null;
  let threads = 0;
  if (list) for (const t of list) { if (t && t.dead !== true) threads++; }
  const jobs = env.scheduler.jobStats && env.scheduler.jobStats.size ? env.scheduler.jobStats.size : 0;
  return (COST.luaEnvBaseKb + threads * COST.luaThreadKb + jobs * COST.luaJobKb) * KB;
}


export function terrainVoxelEstimate(dataArg) {
  try {
    const data = dataArg || terrainStore.getData();
    if (!data || data.isEmpty()) return 0;
    let occupied = 0;
    if (typeof data.getChunkEntries === "function") {
      for (const c of data.getChunkEntries()) occupied += c && Number.isFinite(c.count) && c.count > 0 ? c.count : 0;
    } else if (data.chunks && typeof data.chunks.values === "function") {
      for (const c of data.chunks.values()) occupied += c && Number.isFinite(c.count) && c.count > 0 ? c.count : 0;
    } else {

      const b = data.getBounds ? data.getBounds() : null;
      if (!b || !Array.isArray(b.min) || !Array.isArray(b.max)) return 0;
      const dx = Math.max(0, b.max[0] - b.min[0] + 1);
      const dy = Math.max(0, b.max[1] - b.min[1] + 1);
      const dz = Math.max(0, b.max[2] - b.min[2] + 1);
      occupied = dx * dy * dz;
    }


    if (!Number.isFinite(occupied)) return 0;
    return Math.min(Math.max(0, Math.floor(occupied)), 4000000);
  } catch (_) {
    return 0;
  }
}

function sortDesc(list) {
  list.sort((a, b) => b.mb - a.mb);
  return list;
}


export function collectMemory(engineLike, opts = {}) {
  const filter = typeof opts.filter === "function" ? opts.filter : null;
  const dm = engineLike && engineLike.getDataModel ? engineLike.getDataModel() : null;
  const counts = {
    instances: 0, canCollide: 0, unanchored: 0, meshParts: 0, baseParts: 0,
    textures: 0, particles: 0, sounds: 0, anims: 0, gui: 0,
  };
  if (dm && dm.getDescendants) {
    for (const inst of dm.getDescendants()) {
      if (filter) {
        let keep = true;
        try { keep = filter(inst) !== false; } catch (_) { keep = true; }
        if (!keep) continue;
      }
      counts.instances++;
      const cls = inst.className;
      if (BASEPART_CLASSES.has(cls)) {
        if (cls === "MeshPart") counts.meshParts++;
        else counts.baseParts++;
        try {
          if (inst.getProperty("CanCollide") === true) counts.canCollide++;
          if (inst.getProperty("Anchored") !== true) counts.unanchored++;
        } catch (_) {            }
      }
      if (TEXTURE_CLASSES.has(cls)) counts.textures++;
      if (cls === "ParticleEmitter") counts.particles++;
      if (cls === "Sound") counts.sounds++;
      if (ANIM_CLASSES.has(cls)) counts.anims++;
      if (GUI_CLASSES.has(cls)) counts.gui++;
    }
  }

  const luaChildren = [];
  const serverMb = envHeapMb(engineLike ? engineLike.serverEnv : null);
  if (serverMb > 0) luaChildren.push({ id: "luaheap.server", label: "LuaHeap (Server)", mb: serverMb });
  let clientMb = envHeapMb(engineLike ? engineLike.clientEnv : null);
  const extras = engineLike && Array.isArray(engineLike._extraEnvs) ? engineLike._extraEnvs : [];
  for (const env of extras) clientMb += envHeapMb(env);
  if (clientMb > 0) luaChildren.push({ id: "luaheap.client", label: "LuaHeap (Client)", mb: clientMb });
  const luaMb = luaChildren.reduce((s, c) => s + c.mb, 0);


  const liveSignals = getLiveConnectionCount();
  const placeChildren = sortDesc([
    { id: "place.instances", label: `Instances (${counts.instances})`, mb: counts.instances * COST.instanceKb * KB },
    { id: "place.signals", label: `Signals (${liveSignals})`, mb: liveSignals * COST.signalKb * KB },
    { id: "place.luaheap", label: "LuaHeap", mb: luaMb, children: sortDesc(luaChildren) },
    { id: "place.physcollision", label: "PhysicsCollision", mb: counts.canCollide * COST.collisionKb * KB },
    { id: "place.physparts", label: "PhysicsParts", mb: counts.unanchored * COST.physPartKb * KB },
    { id: "place.gfxmesh", label: "GraphicsMeshParts", mb: (counts.meshParts * COST.meshPartKb + counts.baseParts * COST.basePartGeoKb) * KB },
    { id: "place.gfxtexture", label: "GraphicsTexture", mb: counts.textures * COST.textureKb * KB },
    { id: "place.gfxparticles", label: "GraphicsParticles", mb: counts.particles * COST.particleKb * KB },
    { id: "place.gfxterrain", label: "GraphicsTerrain", mb: terrainVoxelEstimate() * COST.terrainVoxelKb * KB },
    { id: "place.sounds", label: `Sounds (${counts.sounds})`, mb: counts.sounds * COST.soundKb * KB },
    { id: "place.animation", label: `Animation (${counts.anims})`, mb: counts.anims * COST.animKb * KB },
    { id: "place.gui", label: `Gui (${counts.gui})`, mb: counts.gui * COST.guiKb * KB },
  ]);
  const placeMb = placeChildren.reduce((s, c) => s + c.mb, 0);

  let totalMb = COST.coreMb + placeMb + COST.untrackedBaseMb;
  try {
    if (typeof performance !== "undefined" && performance.memory && performance.memory.usedJSHeapSize) {
      totalMb = Math.max(totalMb, performance.memory.usedJSHeapSize / 1048576);
    }
  } catch (_) {            }
  const untrackedMb = Math.max(0, totalMb - COST.coreMb - placeMb);

  const categories = sortDesc([
    { id: "core", label: "CoreMemory", mb: COST.coreMb },
    { id: "place", label: "PlaceMemory", mb: placeMb, children: placeChildren },
    { id: "untracked", label: "UntrackedMemory", mb: untrackedMb },
  ]);

  return { totalMb, categories };
}


export function flattenMemory(tree) {
  const map = new Map();
  const walk = (cats) => {
    for (const c of cats || []) {
      map.set(c.id, c.mb);
      if (c.children) walk(c.children);
    }
  };
  if (tree) {
    map.set("total", tree.totalMb);
    walk(tree.categories);
  }
  return map;
}
