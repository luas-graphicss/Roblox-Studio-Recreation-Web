import { bus } from "../core/eventBus.js";
import { store } from "../core/state.js";
import { logger } from "../core/logger.js";
import { getService } from "../datamodel/index.js";
import { playtest } from "./playtest.js";
import { multiClient } from "./multiClient.js";
import { terrainStore } from "../terrain/terrainStore.js";
import { CHUNK } from "../terrain/terrainData.js";
import { VOXEL_SIZE } from "../terrain/materials.js";

const TICK_MS = 100;                                         
const BATCH_IN = 48;                                                        
const BATCH_OUT = 24;                                                     
const CHUNK_BATCH_IN = 16;
const CHUNK_BATCH_OUT = 8;
const MIN_RADIUS_MIN = 16;
const MIN_RADIUS_MAX = 2048;
const TARGET_RADIUS_MAX = 4096;
const SUPER = 2;                                                                  
const REQ_LIMIT = 5;                                                             
const REQ_WINDOW_MS = 10000;
const REQ_AREA_TTL_MS = 30000;                                       
const MAX_EXTRA_FOCI = 8;                     
const POS_LIMIT = 100000;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function num(v, fb) { const n = Number(v); return Number.isFinite(n) ? n : fb; }

function alive(inst) {
  return !!(inst && inst.__isInstance === true && (typeof inst.isDestroyed !== "function" || !inst.isDestroyed()));
}

function posOf(inst) {
  if (!alive(inst) || typeof inst.hasProperty !== "function" || !inst.hasProperty("Position")) return null;
  const p = inst.getProperty("Position");
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return null;
  return { x: p.x, y: p.y, z: p.z };
}

function modelPos(model) {
  try {
    for (const d of model.getDescendants()) {
      const p = posOf(d);
      if (p) return p;
    }
  } catch (_) {            }
  return null;
}

function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function minDist(pos, foci) {
  let d = Infinity;
  for (const f of foci) { const dd = dist(pos, f); if (dd < d) d = dd; }
  return d;
}

function makeClientState(id) {
  return {
    id,
    unloaded: new Set(),                                                           
    chunksUnloaded: new Set(),                                          
    hiddenIds: new Set(),                                                              
    hiddenDirty: true,
    extraFoci: new Set(),                             
    pendingAreas: [],                                                            
    reqTimes: [],                                          
    lastRequest: null,                                                      
    queueIn: 0,
    queueOut: 0,
    lod: new Map(),                                             
    lodCounts: { Near: 0, Mid: 0, Far: 0, Culled: 0 },
    gens: new Map(),                                                             
    loadedUnits: 0,
    totalUnits: 0,
    chunksLoaded: 0,
    chunksTotal: 0,
    estMemKB: 0,
    focusPos: null,
    persistentLoadedAt: null,
  };
}

let active = false;                               
let paused = false;
let timer = 0;
let enabledNow = false;                                              
let lastRadii = { min: 64, target: 256, behavior: "Default" };
const states = new Map();                      
let lastUnits = [];                                                            
let chunkCache = { version: -1, list: [] };
let warned = false;

function getWorkspace() {
  const dm = typeof store.getDataModel === "function" ? store.getDataModel() : null;
  return dm ? getService(dm, "Workspace") : null;
}

function listClients() {
  const out = [];
  let sessions = [];
  try { sessions = multiClient.getSessions() || []; } catch (_) { sessions = []; }
  if (sessions.length) {
    for (const s of sessions) {
      if (s.status === "disconnected") continue;
      out.push({ id: s.id, player: s.player || null, character: s.character || null });
    }
  } else {
    let player = null, character = null;
    try { player = playtest.getLocalPlayer(); character = playtest.getCharacter(); } catch (_) {            }
    out.push({ id: 1, player, character });
  }
  return out;
}

function activeClientId() {
  try {
    const sessions = multiClient.getSessions() || [];
    if (sessions.length) return multiClient.getActiveId() || 1;
  } catch (_) {            }
  return 1;
}


function collectUnits(ws, clients) {
  const units = [];
  const skip = new Set();
  for (const c of clients) if (c.character) skip.add(c.character);
  const visit = (inst, depth) => {
    if (depth > 64 || !alive(inst) || skip.has(inst)) return;
    const cls = inst.className;
    if (cls === "Camera" || cls === "Terrain") return;
    if (cls === "Folder") {
      try { for (const ch of inst.getChildren()) visit(ch, depth + 1); } catch (_) {            }
      return;
    }
    if (cls === "Model") {
      const mode = String(inst.getProperty("ModelStreamingMode") || "Default");
      if (mode === "Persistent") return;                                         
      if (mode === "Atomic" || mode === "PersistentPerPlayer") {
        units.push({ inst, mode, pos: modelPos(inst) });                      
        return;
      }

      try { for (const ch of inst.getChildren()) visit(ch, depth + 1); } catch (_) {            }
      return;
    }
    const p = posOf(inst);
    if (p) units.push({ inst, mode: "part", pos: p });


  };
  try { for (const ch of ws.getChildren()) visit(ch, 0); } catch (_) { return units; }
  return units;
}


function collectChunks() {
  let td = null;
  try { td = terrainStore.getData(); } catch (_) { td = null; }
  if (!td || td.isEmpty()) return [];
  if (chunkCache.version === td.version) return chunkCache.list;
  const supers = new Map();
  const sizeStuds = SUPER * CHUNK * VOXEL_SIZE;
  for (const e of td.getChunkEntries()) {
    const parts = e.key.split("|");
    const sx = Math.floor(Number(parts[0]) / SUPER);
    const sy = Math.floor(Number(parts[1]) / SUPER);
    const sz = Math.floor(Number(parts[2]) / SUPER);
    const key = sx + "|" + sy + "|" + sz;
    if (supers.has(key)) continue;
    supers.set(key, {
      key,
      pos: {
        x: sx * sizeStuds + sizeStuds / 2,
        y: sy * sizeStuds + sizeStuds / 2,
        z: sz * sizeStuds + sizeStuds / 2,
      },
    });
  }
  chunkCache = { version: td.version, list: [...supers.values()] };
  return chunkCache.list;
}

function readCFramePos(inst) {
  try {
    if (!alive(inst) || typeof inst.hasProperty !== "function" || !inst.hasProperty("CFrame")) return null;
    const cf = inst.getProperty("CFrame");
    if (!cf) return null;
    const p = cf.position || cf.p || cf;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) return { x: p.x, y: p.y, z: p.z };
  } catch (_) {            }
  return null;
}


function focusListFor(client, cs, ws) {
  const foci = [];
  let focus = null;
  if (alive(client.player)) {
    try { focus = client.player.getProperty("ReplicationFocus"); } catch (_) { focus = null; }
  }
  let p = posOf(focus);
  if (!p && alive(client.character)) {
    let hrp = null;
    try { hrp = client.character.getChildren().find((c) => c.name === "HumanoidRootPart") || null; } catch (_) { hrp = null; }
    p = posOf(hrp) || modelPos(client.character);
  }
  if (!p && ws) {
    let wsFocus = null;
    try { wsFocus = ws.getProperty("ReplicationFocus"); } catch (_) { wsFocus = null; }
    p = posOf(wsFocus);
    if (!p) {
      let cam = null;
      try { cam = ws.getChildren().find((c) => c.className === "Camera") || null; } catch (_) { cam = null; }
      p = readCFramePos(cam) || posOf(cam);
    }
  }
  cs.focusPos = p || null;
  if (p) foci.push(p);
  for (const part of [...cs.extraFoci]) {
    const ep = posOf(part);
    if (ep) foci.push(ep);
    else cs.extraFoci.delete(part);                                        
  }
  const now = Date.now();
  cs.pendingAreas = cs.pendingAreas.filter((a) => a.expiresAt > now);
  for (const a of cs.pendingAreas) foci.push(a.pos);
  return foci;
}

function isPersistentFor(model, player) {
  const set = model.__streamPersistentPlayers;
  return !!(set && player && set.has(player));
}

function hiddenIdsFor(cs) {
  if (!cs.hiddenDirty) return cs.hiddenIds;
  const out = new Set();
  for (const u of lastUnits) {
    if (!cs.unloaded.has(u.inst.id)) continue;
    out.add(u.inst.id);
    try { for (const d of u.inst.getDescendants()) out.add(d.id); } catch (_) {            }
  }
  cs.hiddenIds = out;
  cs.hiddenDirty = false;
  return out;
}


function bumpGen(cs, inst) {
  if (!inst || inst.__isInstance !== true) return;
  cs.gens.set(inst.id, (cs.gens.get(inst.id) || 0) + 1);
  let desc = [];
  try { desc = typeof inst.getDescendants === "function" ? inst.getDescendants() : []; } catch (_) { desc = []; }
  for (const d of desc) cs.gens.set(d.id, (cs.gens.get(d.id) || 0) + 1);
}

function tick() {
  if (!active || paused) return;
  const ws = getWorkspace();
  if (!ws) return;
  let enabled = false;
  try { enabled = ws.getProperty("StreamingEnabled") === true; } catch (_) { enabled = false; }

  const clients = listClients();
  const liveIds = new Set(clients.map((c) => c.id));
  for (const id of [...states.keys()]) if (!liveIds.has(id)) states.delete(id);
  for (const c of clients) if (!states.has(c.id)) states.set(c.id, makeClientState(c.id));

  if (!enabled) {

    let changed = enabledNow;
    enabledNow = false;
    for (const cs of states.values()) {
      if (cs.unloaded.size || cs.chunksUnloaded.size) changed = true;
      if (cs.unloaded.size) {

        const backIn = [];
        for (const u of lastUnits) if (cs.unloaded.has(u.inst.id)) backIn.push(u.inst);
        for (const b of backIn) bumpGen(cs, b);
        if (backIn.length) bus.emit("streaming:clientDiff", { clientId: cs.id, streamedIn: backIn, streamedOut: [] });
      }
      cs.unloaded.clear(); cs.chunksUnloaded.clear();
      cs.hiddenDirty = true; cs.queueIn = 0; cs.queueOut = 0;
      cs.lod.clear(); cs.lodCounts = { Near: 0, Mid: 0, Far: 0, Culled: 0 };
    }
    lastUnits = [];
    if (changed) bus.emit("streaming:changed", { enabled: false });
    return;
  }
  enabledNow = true;

  const minR = clamp(num(ws.getProperty("StreamingMinRadius"), 64), MIN_RADIUS_MIN, MIN_RADIUS_MAX);
  const targetR = clamp(num(ws.getProperty("StreamingTargetRadius"), 256), minR, TARGET_RADIUS_MAX);
  const behavior = String(ws.getProperty("StreamOutBehavior") || "Default");
  const outR = behavior === "LowMemory" ? Math.max(minR, targetR * 0.75) : targetR * 1.25;
  lastRadii = { min: minR, target: targetR, behavior };

  const units = collectUnits(ws, clients);
  lastUnits = units;
  const chunks = collectChunks();

  let anyChanged = false;


  const unitIds = new Set();
  for (const u of units) unitIds.add(u.inst.id);
  for (const cs of states.values()) {
    if (!cs.unloaded.size) continue;
    for (const id of [...cs.unloaded]) {
      if (!unitIds.has(id)) { cs.unloaded.delete(id); cs.hiddenDirty = true; anyChanged = true; }
    }
  }
  for (const c of clients) {
    const cs = states.get(c.id);
    const foci = focusListFor(c, cs, ws);
    cs.totalUnits = units.length;
    cs.chunksTotal = chunks.length;
    if (!cs.persistentLoadedAt) {
      cs.persistentLoadedAt = Date.now();
      bus.emit("streaming:persistentLoaded", { clientId: c.id, player: c.player || null });
    }
    if (!foci.length) {

      if (cs.unloaded.size || cs.chunksUnloaded.size) {
        const backIn = [];
        for (const u of units) if (cs.unloaded.has(u.inst.id)) backIn.push(u.inst);
        for (const b of backIn) bumpGen(cs, b);
        cs.unloaded.clear(); cs.chunksUnloaded.clear(); cs.hiddenDirty = true;
        anyChanged = true;
        if (backIn.length) bus.emit("streaming:clientDiff", { clientId: c.id, streamedIn: backIn, streamedOut: [] });
      }
      cs.loadedUnits = units.length;
      cs.chunksLoaded = chunks.length;
      cs.queueIn = 0; cs.queueOut = 0;
      continue;
    }
    let changed = false;


    const wantIn = [];
    const wantOut = [];
    const inInsts = [];                                                          
    const outInsts = [];                                   
    cs.lod.clear();
    const lodCounts = { Near: 0, Mid: 0, Far: 0, Culled: 0 };
    for (const u of units) {
      const id = u.inst.id;
      const isOut = cs.unloaded.has(id);
      if (!u.pos) {                                           
        if (isOut) { cs.unloaded.delete(id); inInsts.push(u.inst); changed = true; }
        continue;
      }
      const d = minDist(u.pos, foci);
      if (u.mode === "PersistentPerPlayer" && isPersistentFor(u.inst, c.player)) {

        if (isOut) { cs.unloaded.delete(id); inInsts.push(u.inst); changed = true; }
        cs.lod.set(id, "Near"); lodCounts.Near++;
        continue;
      }
      if (isOut) {
        if (d <= minR) { cs.unloaded.delete(id); inInsts.push(u.inst); changed = true; }                         
        else if (d <= targetR) { wantIn.push({ id, d, inst: u.inst }); lodCounts.Culled++; }                               
        else lodCounts.Culled++;
      } else if (d > outR) {
        wantOut.push({ id, d, inst: u.inst });
      }
      if (!cs.unloaded.has(id)) {
        const tier = d <= targetR * 0.35 ? "Near" : d <= targetR * 0.75 ? "Mid" : "Far";
        cs.lod.set(id, tier); lodCounts[tier]++;
      }
    }

    wantIn.sort((a, b) => a.d - b.d);
    wantOut.sort((a, b) => b.d - a.d);
    const nIn = Math.min(BATCH_IN, wantIn.length);
    for (let i = 0; i < nIn; i++) { cs.unloaded.delete(wantIn[i].id); inInsts.push(wantIn[i].inst); changed = true; }
    const nOut = Math.min(BATCH_OUT, wantOut.length);
    for (let i = 0; i < nOut; i++) { cs.unloaded.add(wantOut[i].id); outInsts.push(wantOut[i].inst); changed = true; }
    cs.queueIn = wantIn.length - nIn;
    cs.queueOut = wantOut.length - nOut;
    cs.lodCounts = lodCounts;
    cs.loadedUnits = units.length - cs.unloaded.size;


    const cIn = [], cOut = [];
    for (const ch of chunks) {
      const d = minDist(ch.pos, foci);
      const isOut = cs.chunksUnloaded.has(ch.key);
      if (isOut) {
        if (d <= minR) { cs.chunksUnloaded.delete(ch.key); changed = true; }
        else if (d <= targetR) cIn.push({ key: ch.key, d });
      } else if (d > outR) cOut.push({ key: ch.key, d });
    }
    cIn.sort((a, b) => a.d - b.d);
    cOut.sort((a, b) => b.d - a.d);
    for (let i = 0; i < Math.min(CHUNK_BATCH_IN, cIn.length); i++) { cs.chunksUnloaded.delete(cIn[i].key); changed = true; }
    for (let i = 0; i < Math.min(CHUNK_BATCH_OUT, cOut.length); i++) { cs.chunksUnloaded.add(cOut[i].key); changed = true; }
    cs.chunksLoaded = chunks.length - cs.chunksUnloaded.size;


    cs.estMemKB = Math.round(cs.loadedUnits * 1.5 + cs.chunksLoaded * 6);


    if (!changed && cs.unloaded.size && !cs.hiddenDirty) {
      const prevHidden = cs.hiddenIds;
      cs.hiddenDirty = true;
      const nextHidden = hiddenIdsFor(cs);
      let drift = nextHidden.size !== prevHidden.size;
      if (!drift) { for (const id of nextHidden) if (!prevHidden.has(id)) { drift = true; break; } }
      if (drift) anyChanged = true;
    }

    if (changed) { cs.hiddenDirty = true; anyChanged = true; }


    if (inInsts.length || outInsts.length) {
      for (const inst of inInsts) bumpGen(cs, inst);
      bus.emit("streaming:clientDiff", { clientId: c.id, streamedIn: inInsts, streamedOut: outInsts });
    }
  }
  if (anyChanged) bus.emit("streaming:changed", { enabled: true });
}

function reset() {
  states.clear();
  lastUnits = [];
  enabledNow = false;
  chunkCache = { version: -1, list: [] };
}

function tickSafe() {
  try { tick(); } catch (e) {
    if (!warned) {
      warned = true;
      logger.warn("Streaming: erro no tick — " + ((e && e.message) || e), { source: "Studio" });
    }
  }
}

export const streaming = {
  isRunning() { return active; },
  isStreamingActive() { return active && enabledNow; },
  getRadii() { return { ...lastRadii }; },
  getActiveClientId: activeClientId,
  tickNow() { tickSafe(); },


  isLoadedFor(clientId, inst) {
    if (!active || !enabledNow) return true;
    const cs = states.get(clientId);
    if (!cs || !alive(inst)) return true;
    const hidden = hiddenIdsFor(cs);
    let p = inst, hops = 0;
    while (p && p.__isInstance === true && hops++ < 128) {
      if (hidden.has(p.id)) return false;
      p = typeof p.getParent === "function" ? p.getParent() : null;
    }
    return true;
  },
  isLoadedForActive(inst) { return this.isLoadedFor(activeClientId(), inst); },


  genFor(clientId, inst) {
    if (!inst || inst.__isInstance !== true) return 0;
    const cs = states.get(clientId);
    if (!cs || !cs.gens.size) return 0;
    return cs.gens.get(inst.id) || 0;
  },


  getHiddenIdsForActive() {
    if (!active || !enabledNow) return null;
    const cs = states.get(activeClientId());
    return cs ? hiddenIdsFor(cs) : null;
  },
  getLodTierForActive(id) {
    if (!active || !enabledNow) return null;
    const cs = states.get(activeClientId());
    return cs ? (cs.lod.get(id) || null) : null;
  },


  isAreaLoaded(clientId, pos, radius) {
    if (!active || !enabledNow) return true;
    const cs = states.get(clientId);
    if (!cs) return true;
    const r = Number.isFinite(radius) ? radius : lastRadii.min;
    for (const u of lastUnits) {
      if (!u.pos || !cs.unloaded.has(u.inst.id)) continue;
      if (dist(u.pos, pos) <= r) return false;
    }
    return true;
  },

  clientIdForPlayer(player) {
    if (!alive(player)) return null;
    for (const c of listClients()) if (c.player === player) return c.id;
    return null;
  },


  requestStreamAround(player, pos) {
    const clientId = this.clientIdForPlayer(player);
    if (clientId == null) return { ok: false, error: "Player invalido (sem Client neste Playtest)." };
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) {
      return { ok: false, error: "posicao invalida (Vector3 esperado)." };
    }
    if (Math.abs(pos.x) > POS_LIMIT || Math.abs(pos.y) > POS_LIMIT || Math.abs(pos.z) > POS_LIMIT) {
      return { ok: false, error: "posicao fora dos limites do mundo." };
    }
    let cs = states.get(clientId);
    if (!cs) { cs = makeClientState(clientId); states.set(clientId, cs); }
    const now = Date.now();
    cs.reqTimes = cs.reqTimes.filter((t) => now - t < REQ_WINDOW_MS);
    if (cs.reqTimes.length >= REQ_LIMIT) {
      cs.lastRequest = { x: pos.x, y: pos.y, z: pos.z, t: now, status: "rate-limited" };
      return { ok: false, error: "rate limit: max " + REQ_LIMIT + " chamadas a cada " + (REQ_WINDOW_MS / 1000) + "s por jogador." };
    }
    cs.reqTimes.push(now);
    const p = { x: pos.x, y: pos.y, z: pos.z };
    cs.pendingAreas.push({ pos: p, expiresAt: now + REQ_AREA_TTL_MS });
    cs.lastRequest = { x: p.x, y: p.y, z: p.z, t: now, status: "pending" };
    if (!enabledNow) {
      cs.lastRequest.status = "no-op (StreamingEnabled off)";
      return { ok: true, clientId, pos: p, immediate: true };
    }
    return { ok: true, clientId, pos: p, immediate: false };
  },
  markRequestDone(clientId, ok) {
    const cs = states.get(clientId);
    if (cs && cs.lastRequest) cs.lastRequest.status = ok ? "ok" : "timeout";
  },

  addReplicationFocus(player, part) {
    const clientId = this.clientIdForPlayer(player);
    if (clientId == null) return { ok: false, error: "Player invalido." };
    if (!alive(part) || !posOf(part)) return { ok: false, error: "esperada uma BasePart valida." };
    let cs = states.get(clientId);
    if (!cs) { cs = makeClientState(clientId); states.set(clientId, cs); }
    if (cs.extraFoci.size >= MAX_EXTRA_FOCI && !cs.extraFoci.has(part)) {
      return { ok: false, error: "max de " + MAX_EXTRA_FOCI + " focos de replicacao por jogador." };
    }
    cs.extraFoci.add(part);
    return { ok: true };
  },
  removeReplicationFocus(player, part) {
    const clientId = this.clientIdForPlayer(player);
    if (clientId == null) return { ok: false, error: "Player invalido." };
    const cs = states.get(clientId);
    if (cs) cs.extraFoci.delete(part);
    return { ok: true };
  },


  addPersistentPlayer(model, player) {
    if (!alive(model) || model.className !== "Model") return { ok: false, error: "esperado um Model." };
    if (!alive(player) || player.className !== "Player") return { ok: false, error: "esperado um Player valido." };
    if (!model.__streamPersistentPlayers) model.__streamPersistentPlayers = new Set();
    model.__streamPersistentPlayers.add(player);
    return { ok: true };
  },
  removePersistentPlayer(model, player) {
    if (!alive(model) || model.className !== "Model") return { ok: false, error: "esperado um Model." };
    if (model.__streamPersistentPlayers) model.__streamPersistentPlayers.delete(player);
    return { ok: true };
  },
  getPersistentPlayers(model) {
    const set = alive(model) ? model.__streamPersistentPlayers : null;
    return set ? [...set].filter((p) => alive(p)) : [];
  },


  getDebugSnapshot() {
    const snap = {
      running: active,
      enabled: active && enabledNow,
      minRadius: lastRadii.min,
      targetRadius: lastRadii.target,
      behavior: lastRadii.behavior,
      activeClientId: activeClientId(),
      clients: [],
    };
    for (const c of listClients()) {
      const cs = states.get(c.id);
      if (!cs) continue;
      snap.clients.push({
        id: c.id,
        focus: cs.focusPos ? { ...cs.focusPos } : null,
        extraFoci: [...cs.extraFoci].map((p) => posOf(p)).filter(Boolean),
        loadedUnits: cs.loadedUnits,
        totalUnits: cs.totalUnits,
        chunksLoaded: cs.chunksLoaded,
        chunksTotal: cs.chunksTotal,
        queueIn: cs.queueIn,
        queueOut: cs.queueOut,
        estMemKB: cs.estMemKB,
        lodCounts: { ...cs.lodCounts },
        persistentLoadedAt: cs.persistentLoadedAt || null,
        lastRequest: cs.lastRequest ? { ...cs.lastRequest } : null,
      });
    }
    return snap;
  },

  getChunkDebugForActive() {
    if (!active || !enabledNow) return null;
    const cs = states.get(activeClientId());
    if (!cs) return null;
    const size = SUPER * CHUNK * VOXEL_SIZE;
    const out = [];
    for (const ch of collectChunks()) {
      out.push({ pos: ch.pos, size, loaded: !cs.chunksUnloaded.has(ch.key) });
    }
    return out;
  },
};


bus.on("runtime:modeChanged", (p) => {
  const on = !!(p && p.running && p.mode === "play");
  if (on === active) return;
  active = on;
  warned = false;
  paused = false;
  if (on) {
    reset();
    timer = setInterval(tickSafe, TICK_MS);
    tickSafe();
  } else {
    clearInterval(timer);
    timer = 0;
    reset();
    bus.emit("streaming:changed", { enabled: false });
  }
});
bus.on("runtime:pausedChanged", (p) => { paused = !!(p && p.paused); });

bus.on("multiclient:activeChanged", () => bus.emit("streaming:changed", { enabled: active && enabledNow }));
bus.on("multiclient:changed", () => bus.emit("streaming:changed", { enabled: active && enabledNow }));
