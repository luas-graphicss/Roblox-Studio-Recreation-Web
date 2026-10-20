import { logger } from "../core/logger.js";


export const PF_VERSION = "navmesh-dynamic-1";


export const PF_LIMITS = Object.freeze({
  maxWaypoints: 500,
  maxTotalCost: 1e6,
  agentRadiusMin: 0.5, agentRadiusMax: 50,
  agentHeightMin: 0.5, agentHeightMax: 50,
  jumpHeightMin: 0, jumpHeightMax: 200,
  slopeMin: 0, slopeMax: 89,
  spacingMin: 1, spacingMax: 100,
  computeTimeoutMs: 15000,
  maxConcurrent: 8,
  lruSize: 50,
  identicalCacheMs: 1000,
  nodesPerChunk: 256,
  maxNodes: 60000,
  worldBound: 100000,
  maxGridSpan: 400,

  dynamicSampleHz: 20,
  maxDynamicParts: 300,
  dynamicRadius: 250,
  moveEpsilon: 0.1,
  repathCooldownMin: 0.05,
  repathCooldownMax: 10,
  repathCooldownDefault: 0.25,
  maxRepathsPerSecond: 4,
});


export const PATH_STATUS = Object.freeze([
  "Success", "ClosestNoPath", "ClosestOutOfRange",
  "FailStartNotEmpty", "FailFinishNotEmpty", "NoPath",
]);
export const WAYPOINT_ACTION = Object.freeze(["Walk", "Jump", "Custom"]);


class BinaryHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(node, priority) {
    const it = this.items;
    it.push({ node, priority });
    let i = it.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (it[parent].priority <= it[i].priority) break;
      [it[parent], it[i]] = [it[i], it[parent]];
      i = parent;
    }
  }
  pop() {
    const it = this.items;
    if (it.length === 0) return null;
    const top = it[0];
    const last = it.pop();
    if (it.length > 0) {
      it[0] = last;
      let i = 0;
      const n = it.length;
      for (;;) {
        const l = i * 2 + 1, r = i * 2 + 2;
        let smallest = i;
        if (l < n && it[l].priority < it[smallest].priority) smallest = l;
        if (r < n && it[r].priority < it[smallest].priority) smallest = r;
        if (smallest === i) break;
        [it[smallest], it[i]] = [it[i], it[smallest]];
        i = smallest;
      }
    }
    return top.node;
  }
}


const BIN_SIZE = 16;                                                

function binKey(bx, bz) { return (bx << 16) ^ (bz & 0xffff); }                

function buildSpatialIndex(parts) {

  const index = new Map();
  for (const p of parts) {
    const bx0 = Math.floor(p.minX / BIN_SIZE);
    const bx1 = Math.floor(p.maxX / BIN_SIZE);
    const bz0 = Math.floor(p.minZ / BIN_SIZE);
    const bz1 = Math.floor(p.maxZ / BIN_SIZE);
    for (let bx = bx0; bx <= bx1; bx++) {
      for (let bz = bz0; bz <= bz1; bz++) {
        const k = binKey(bx, bz);
        let arr = index.get(k);
        if (!arr) { arr = []; index.set(k, arr); }
        arr.push(p);
      }
    }
  }
  return index;
}

function queryIndex(index, x, z, radius) {

  const bx0 = Math.floor((x - radius) / BIN_SIZE);
  const bx1 = Math.floor((x + radius) / BIN_SIZE);
  const bz0 = Math.floor((z - radius) / BIN_SIZE);
  const bz1 = Math.floor((z + radius) / BIN_SIZE);
  const seen = new Set();
  const result = [];
  for (let bx = bx0; bx <= bx1; bx++) {
    for (let bz = bz0; bz <= bz1; bz++) {
      const arr = index.get(binKey(bx, bz));
      if (!arr) continue;
      for (const p of arr) {
        if (!seen.has(p)) { seen.add(p); result.push(p); }
      }
    }
  }
  return result;
}


export function normalizeAgentParams(raw, warn) {
  const w = typeof warn === "function" ? warn : () => {};
  raw = raw || {};
  const numOr = (v, def) => (typeof v === "number" && Number.isFinite(v) ? v : def);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const agentRadius = clamp(numOr(raw.AgentRadius, 2), PF_LIMITS.agentRadiusMin, PF_LIMITS.agentRadiusMax);
  const agentHeight = clamp(numOr(raw.AgentHeight, 5), PF_LIMITS.agentHeightMin, PF_LIMITS.agentHeightMax);
  const agentJumpHeight = clamp(numOr(raw.AgentJumpHeight, 7), PF_LIMITS.jumpHeightMin, PF_LIMITS.jumpHeightMax);
  const agentMaxSlope = clamp(numOr(raw.AgentMaxSlope, 45), PF_LIMITS.slopeMin, PF_LIMITS.slopeMax);
  const waypointSpacing = clamp(numOr(raw.WaypointSpacing, 4), PF_LIMITS.spacingMin, PF_LIMITS.spacingMax);


  const costs = {};
  const rawCosts = raw.Costs && typeof raw.Costs === "object" ? raw.Costs : {};
  for (const key of Object.keys(rawCosts)) {
    const val = rawCosts[key];
    if (typeof val !== "number" || Number.isNaN(val)) {
      w(`Costs["${key}"] ignorado: valor não numérico.`);
      continue;
    }
    if (val < 0) {
      w(`Costs["${key}"] ignorado: custos negativos não são permitidos (use positivos ou math.huge).`);
      continue;
    }
    costs[key] = val;
  }


  const agentDynamicAvoidance = raw.AgentDynamicAvoidance === undefined ? true : !!raw.AgentDynamicAvoidance;
  const agentAutoRepath = raw.AgentAutoRepath === undefined ? false : !!raw.AgentAutoRepath;
  const agentRepathCooldown = clamp(
    numOr(raw.AgentRepathCooldown, PF_LIMITS.repathCooldownDefault),
    PF_LIMITS.repathCooldownMin, PF_LIMITS.repathCooldownMax
  );
  const agentPredictSeconds = clamp(numOr(raw.AgentPredictSeconds, 0), 0, 2);

  return {
    AgentRadius: agentRadius,
    AgentHeight: agentHeight,
    AgentCanJump: raw.AgentCanJump === undefined ? true : !!raw.AgentCanJump,
    AgentCanClimb: raw.AgentCanClimb === undefined ? false : !!raw.AgentCanClimb,
    AgentJumpHeight: agentJumpHeight,
    AgentMaxSlope: agentMaxSlope,
    WaypointSpacing: waypointSpacing,
    Costs: costs,

    AgentDynamicAvoidance: agentDynamicAvoidance,
    AgentAutoRepath: agentAutoRepath,
    AgentRepathCooldown: agentRepathCooldown,
    AgentPredictSeconds: agentPredictSeconds,
  };
}


const MATERIAL_COST = { Water: 4 };
function defaultMaterialCost(material) {
  return MATERIAL_COST[material] || 0;
}


const _activePaths = new Map();                                                           
let _activeIdSeq = 1;

export function getPathfindingDebugSnapshot() {
  const paths = [];
  for (const rec of _activePaths.values()) {
    paths.push({
      status: rec.status,
      waypoints: rec.waypoints.map((w) => ({ x: w.x, y: w.y, z: w.z, action: w.action })),
      blocked: [...rec.blocked].sort((a, b) => a - b),
      repaths: rec.repaths || 0,
    });
  }

  return { paths, dynamic: [] };
}

export function hasActivePaths() {
  return _activePaths.size > 0;
}


export function createPathfinder(opts) {
  opts = opts || {};
  const getGeometry = typeof opts.getGeometry === "function"
    ? opts.getGeometry
    : () => ({ parts: [], modifiers: [], links: [] });
  const getGeometryVersion = typeof opts.getGeometryVersion === "function"
    ? opts.getGeometryVersion
    : () => 0;
  const _now = () => Date.now();

  let _concurrent = 0;
  const _cache = new Map();                                    
  let _dynamicEnabled = true;                           
  let _totalRepaths = 0;
  let _lastBuildMs = 0;
  let _partIdSeq = 0;


  function withinWorld(p) {
    const b = PF_LIMITS.worldBound;
    return p && Math.abs(p.x) <= b && Math.abs(p.y) <= b && Math.abs(p.z) <= b;
  }


  function _dynSignature(dynamicParts) {
    if (!dynamicParts || dynamicParts.length === 0) return "";
    const q = (n) => Math.round(n / PF_LIMITS.moveEpsilon) * PF_LIMITS.moveEpsilon;
    return dynamicParts
      .slice(0, PF_LIMITS.maxDynamicParts)
      .map((p) => `${p.id}:${q(p.minX)},${q(p.maxX)},${q(p.minZ)},${q(p.maxZ)}`)
      .join("|")
  }

  function cacheKey(agent, start, finish, dynamicParts) {
    const r = (n) => Math.round(n * 4) / 4;
    const dynEnabled = _dynamicEnabled && agent.AgentDynamicAvoidance;
    return JSON.stringify([
      agent.AgentRadius, agent.AgentHeight, agent.AgentCanJump, agent.AgentCanClimb,
      agent.AgentJumpHeight, agent.AgentMaxSlope, agent.WaypointSpacing, agent.Costs,
      r(start.x), r(start.y), r(start.z), r(finish.x), r(finish.y), r(finish.z),
      dynEnabled,
      dynEnabled ? _dynSignature(dynamicParts) : "",
      dynEnabled ? agent.AgentPredictSeconds : 0,                                        
    ]);
  }

  function pruneCache() {
    if (_cache.size <= PF_LIMITS.lruSize) return;
    const excess = _cache.size - PF_LIMITS.lruSize;
    let i = 0;
    for (const k of _cache.keys()) {
      _cache.delete(k);
      if (++i >= excess) break;
    }
  }


  function normalizePart(p, idx) {
    return {
      id: p.id !== undefined ? p.id : `__auto_${idx}`,
      minX: p.minX, maxX: p.maxX,
      minY: p.minY, maxY: p.maxY,
      minZ: p.minZ, maxZ: p.maxZ,
      canCollide: p.canCollide,
      anchored: p.anchored,
      material: p.material || "Plastic",
      isTruss: !!p.isTruss,
      dynamic: p.dynamic === true || (!p.anchored && p.canCollide && p.dynamic !== false ? false : !!p.dynamic),
      vx: typeof p.vx === "number" ? p.vx : 0,
      vy: typeof p.vy === "number" ? p.vy : 0,
      vz: typeof p.vz === "number" ? p.vz : 0,
    };
  }


  function _getDynamicParts(geo) {
    const raw = geo.parts || [];
    const result = [];
    for (let i = 0; i < raw.length; i++) {
      const p = raw[i];
      if (p.canCollide && !p.anchored) {
        result.push(normalizePart(p, i));
        if (result.length >= PF_LIMITS.maxDynamicParts) break;
      }
    }
    return result;
  }


  function _inflateDynamic(p, predictSeconds) {
    if (predictSeconds <= 0) return p;
    const dt = predictSeconds;
    const ax = p.vx >= 0 ? p.vx * dt : 0, bx = p.vx < 0 ? -p.vx * dt : 0;
    const az = p.vz >= 0 ? p.vz * dt : 0, bz = p.vz < 0 ? -p.vz * dt : 0;
    return {
      ...p,
      minX: p.minX - bx, maxX: p.maxX + ax,
      minZ: p.minZ - bz, maxZ: p.maxZ + az,
    };
  }


  function buildGrid(agent, start, finish) {
    const t0 = _now();
    const geo = getGeometry();
    const radius = agent.AgentRadius;
    const cell = Math.max(1, Math.min(8, radius * 1.5));

    const minX = Math.min(start.x, finish.x) - 64;
    const maxX = Math.max(start.x, finish.x) + 64;
    const minZ = Math.min(start.z, finish.z) - 64;
    const maxZ = Math.max(start.z, finish.z) + 64;
    const cols = Math.min(PF_LIMITS.maxGridSpan, Math.ceil((maxX - minX) / cell) + 1);
    const rows = Math.min(PF_LIMITS.maxGridSpan, Math.ceil((maxZ - minZ) / cell) + 1);

    const rawParts = geo.parts || [];
    const normalParts = rawParts.map((p, i) => normalizePart(p, i));


    const floors = normalParts.filter((p) => p.canCollide && p.anchored);


    const staticBlockers = normalParts.filter((p) => p.canCollide && p.anchored);


    const useDynamic = _dynamicEnabled && agent.AgentDynamicAvoidance;
    let dynBlockers = [];
    if (useDynamic) {
      const predictSec = agent.AgentPredictSeconds || 0;
      dynBlockers = normalParts
        .filter((p) => p.canCollide && !p.anchored)
        .slice(0, PF_LIMITS.maxDynamicParts)
        .map((p) => _inflateDynamic(p, predictSec));
    }

    const allBlockers = useDynamic ? [...staticBlockers, ...dynBlockers] : staticBlockers;

    const modifiers = geo.modifiers || [];


    const floorIndex = buildSpatialIndex(floors);
    const blockerIndex = buildSpatialIndex(allBlockers);

    const cellCache = new Map();

    function colToX(c) { return minX + c * cell + cell / 2; }
    function rowToZ(r) { return minZ + r * cell + cell / 2; }
    function xToCol(x) { return Math.round((x - minX - cell / 2) / cell); }
    function zToRow(z) { return Math.round((z - minZ - cell / 2) / cell); }

    function evalCell(c, r) {
      const key = c + "," + r;
      if (cellCache.has(key)) return cellCache.get(key);
      let info = null;
      if (c >= 0 && c < cols && r >= 0 && r < rows) {
        const x = colToX(c), z = rowToZ(r);


        const candidateFloors = queryIndex(floorIndex, x, z, 0);
        let ground = -Infinity, groundMat = "Plastic", floorPart = null;
        for (const p of candidateFloors) {
          if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ) {
            if (p.maxY > ground) { ground = p.maxY; groundMat = p.material || "Plastic"; floorPart = p; }
          }
        }
        if (floorPart) {
          const headLo = ground + 0.5, headHi = ground + agent.AgentHeight;
          let blockedHead = false;


          const candidateBlockers = queryIndex(blockerIndex, x, z, radius);
          for (const p of candidateBlockers) {
            if (p === floorPart) continue;
            if (x >= p.minX - radius && x <= p.maxX + radius && z >= p.minZ - radius && z <= p.maxZ + radius) {
              if (p.maxY > headLo && p.minY < headHi) {
                if (p.maxY - ground > agent.AgentHeight * 0.5) { blockedHead = true; break; }
              }
            }
          }
          if (!blockedHead) {
            let cost = 1 + defaultMaterialCost(groundMat);
            const matOverride = agent.Costs[groundMat];
            if (typeof matOverride === "number") cost = 1 + matOverride;
            let blockedMod = false;
            for (const m of modifiers) {
              if (x >= m.minX && x <= m.maxX && z >= m.minZ && z <= m.maxZ && ground + 0.5 >= m.minY - 4 && ground <= m.maxY + 4) {
                if (m.passThrough === false) { blockedMod = true; break; }
                const lc = m.label ? agent.Costs[m.label] : undefined;
                if (lc === Infinity) { blockedMod = true; break; }
                if (typeof lc === "number") cost += lc;
              }
            }
            if (!blockedMod && Number.isFinite(cost) && cost > 0) {
              info = { ground, cost, material: groundMat };
            }
          }
        }
      }
      cellCache.set(key, info);
      return info;
    }

    _lastBuildMs = _now() - t0;
    return {
      cell, cols, rows, minX, minZ, colToX, rowToZ, xToCol, zToRow, evalCell,
      links: geo.links || [],
      dynBlockers,
    };
  }


  function buildLinkEdges(grid) {
    const edges = new Map();
    const add = (fromC, fromR, toC, toR, label) => {
      const k = fromC + "," + fromR;
      if (!edges.has(k)) edges.set(k, []);
      edges.get(k).push({ c: toC, r: toR, label: label || "" });
    };
    for (const link of grid.links) {
      const aC = grid.xToCol(link.x0), aR = grid.zToRow(link.z0);
      const bC = grid.xToCol(link.x1), bR = grid.zToRow(link.z1);
      if (grid.evalCell(aC, aR) && grid.evalCell(bC, bR)) {
        add(aC, aR, bC, bR, link.label);
        if (link.bidir) add(bC, bR, aC, aR, link.label);
      }
    }
    return edges;
  }


  function* astar(grid, agent, startCell, finishCell, deadline) {
    const heap = new BinaryHeap();
    const gScore = new Map();
    const came = new Map();
    const slopeTan = Math.tan((agent.AgentMaxSlope * Math.PI) / 180);
    const linkEdges = buildLinkEdges(grid);

    const startInfo = grid.evalCell(startCell.c, startCell.r);
    const idOf = (c, r) => c + "," + r;
    const sid = idOf(startCell.c, startCell.r);
    gScore.set(sid, 0);
    const fCol = finishCell.c, fRow = finishCell.r;
    const fInfo = grid.evalCell(fCol, fRow);
    const fx = grid.colToX(fCol), fz = grid.rowToZ(fRow), fy = fInfo ? fInfo.ground : (startInfo ? startInfo.ground : 0);
    const heur = (c, r, info) => {
      const dx = grid.colToX(c) - fx, dz = grid.rowToZ(r) - fz, dy = (info ? info.ground : fy) - fy;
      return Math.sqrt(dx * dx + dz * dz + dy * dy);
    };
    heap.push({ c: startCell.c, r: startCell.r, info: startInfo }, heur(startCell.c, startCell.r, startInfo));

    let best = { id: sid, c: startCell.c, r: startCell.r, h: heur(startCell.c, startCell.r, startInfo) };
    let expanded = 0;
    const NEI = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1],
    ];

    while (heap.size > 0) {
      const cur = heap.pop();
      const curId = idOf(cur.c, cur.r);
      const curG = gScore.get(curId);
      if (curG === undefined) continue;
      const curInfo = cur.info || grid.evalCell(cur.c, cur.r);
      if (!curInfo) continue;

      const h = heur(cur.c, cur.r, curInfo);
      if (h < best.h) best = { id: curId, c: cur.c, r: cur.r, h };
      if (cur.c === fCol && cur.r === fRow) {
        return { came, endId: curId, reached: true, gScore };
      }

      if (++expanded % PF_LIMITS.nodesPerChunk === 0) {
        if (_now() > deadline) return { came, endId: best.id, reached: false, gScore, timedOut: true };
        if (expanded > PF_LIMITS.maxNodes) return { came, endId: best.id, reached: false, gScore, overflow: true };
        yield { kind: "wait", seconds: 0 };
      }

      const candidates = [];
      for (const [dc, dr] of NEI) {
        candidates.push({ c: cur.c + dc, r: cur.r + dr, diag: dc !== 0 && dr !== 0, link: null });
      }
      const le = linkEdges.get(curId);
      if (le) for (const e of le) candidates.push({ c: e.c, r: e.r, diag: false, link: e.label });

      for (const cand of candidates) {
        let nInfo = grid.evalCell(cand.c, cand.r);
        let action = "Walk";
        let extra = 0;
        let jumped = false;
        if (!cand.link) {
          if (!nInfo) {
            if (!agent.AgentCanJump || cand.diag) continue;
            const dc = cand.c - cur.c, dr = cand.r - cur.r;
            let landed = null, steps = 0;
            for (let s = 2; s <= 3; s++) {
              const li = grid.evalCell(cur.c + dc * s, cur.r + dr * s);
              if (li) { landed = { c: cur.c + dc * s, r: cur.r + dr * s, info: li }; steps = s; break; }
            }
            if (!landed) continue;
            const horiz = steps * grid.cell;
            const vert = landed.info.ground - curInfo.ground;
            if (Math.abs(vert) > agent.AgentJumpHeight || horiz > agent.AgentJumpHeight * 1.5) continue;
            cand.c = landed.c; cand.r = landed.r; nInfo = landed.info;
            action = "Jump"; jumped = true; extra = 2;
          } else {
            const vert = nInfo.ground - curInfo.ground;
            const horiz = (cand.diag ? Math.SQRT2 : 1) * grid.cell;
            if (vert > 0) {
              const tan = vert / horiz;
              if (tan > slopeTan) {
                if (!agent.AgentCanJump || vert > agent.AgentJumpHeight) continue;
                action = "Jump"; jumped = true; extra = 1.5;
              }
            } else if (-vert > agent.AgentJumpHeight + grid.cell * 4) {
              continue;
            }
          }
        } else if (!nInfo) {
          continue;
        }
        if (cand.link) action = "Custom";

        const stepDist = (cand.diag ? Math.SQRT2 : 1) * grid.cell;
        const stepCost = stepDist * nInfo.cost + extra + (cand.link ? 1 : 0);
        const nid = idOf(cand.c, cand.r);
        const tentative = curG + stepCost;
        if (tentative > PF_LIMITS.maxTotalCost) continue;
        if (gScore.has(nid) && tentative >= gScore.get(nid)) continue;
        gScore.set(nid, tentative);
        came.set(nid, { from: curId, c: cand.c, r: cand.r, action, label: cand.link || "", jumped });
        heap.push({ c: cand.c, r: cand.r, info: nInfo }, tentative + heur(cand.c, cand.r, nInfo));
      }
    }
    return { came, endId: best.id, reached: false, gScore };
  }


  function reconstruct(grid, came, startId, endId) {
    const seq = [];
    let cur = endId;
    let guard = 0;
    while (cur && guard++ < PF_LIMITS.maxWaypoints * 4) {
      const [c, r] = cur.split(",").map(Number);
      const link = came.get(cur);
      seq.push({ c, r, action: link ? link.action : "Walk", label: link ? link.label : "" });
      if (cur === startId) break;
      cur = link ? link.from : null;
    }
    seq.reverse();
    return seq;
  }


  function lineOfSight(grid, a, b) {
    let x0 = a.c, y0 = a.r, x1 = b.c, y1 = b.r;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let prev = grid.evalCell(x0, y0);
    if (!prev) return false;
    for (;;) {
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
      const info = grid.evalCell(x0, y0);
      if (!info) return false;
      if (Math.abs(info.ground - prev.ground) > 1.5) return false;
      if (info.cost > prev.cost + 0.01) return false;
      prev = info;
    }
    return true;
  }

  function simplify(grid, seq, agent) {
    if (seq.length <= 2) return seq;
    const out = [seq[0]];
    let anchor = 0;
    for (let i = 1; i < seq.length; i++) {
      const node = seq[i];
      if (node.action !== "Walk") {
        if (out[out.length - 1] !== seq[i - 1]) out.push(seq[i - 1]);
        out.push(node);
        anchor = i;
        continue;
      }
      const next = seq[i + 1];
      if (next && next.action === "Walk" && lineOfSight(grid, seq[anchor], next)) {
        continue;
      }
      out.push(node);
      anchor = i;
    }
    if (out[out.length - 1] !== seq[seq.length - 1]) out.push(seq[seq.length - 1]);
    return out;
  }


  function enforceSpacing(waypoints, spacing) {
    if (waypoints.length <= 2) return waypoints;
    const out = [waypoints[0]];
    for (let i = 1; i < waypoints.length - 1; i++) {
      const w = waypoints[i];
      if (w.action !== "Walk") { out.push(w); continue; }
      const last = out[out.length - 1];
      const dx = w.x - last.x, dy = w.y - last.y, dz = w.z - last.z;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) >= spacing) out.push(w);
    }
    out.push(waypoints[waypoints.length - 1]);
    return out;
  }


  function toWaypoints(grid, seq, start, finish) {
    const wps = [];
    wps.push({ x: start.x, y: start.y, z: start.z, action: "Walk", label: "" });
    for (let i = 1; i < seq.length; i++) {
      const n = seq[i];
      const info = grid.evalCell(n.c, n.r);
      const y = info ? info.ground : start.y;
      wps.push({ x: grid.colToX(n.c), y, z: grid.rowToZ(n.r), action: n.action, label: n.label || "" });
    }
    const last = wps[wps.length - 1];
    last.x = finish.x; last.y = finish.y; last.z = finish.z;
    return wps;
  }


  function* computePath(agentRaw, start, finish, warn) {
    const agent = normalizeAgentParams(agentRaw, warn);

    if (!withinWorld(start) || !withinWorld(finish)) {
      return { status: "NoPath", waypoints: [], totalCost: 0, dynamicBlockers: 0 };
    }

    const geo = getGeometry();
    const rawParts = geo.parts || [];
    const dynamicParts = _dynamicEnabled && agent.AgentDynamicAvoidance
      ? rawParts.filter((p) => p.canCollide && !p.anchored).slice(0, PF_LIMITS.maxDynamicParts)
      : [];

    const version = getGeometryVersion();
    const key = cacheKey(agent, start, finish, dynamicParts);
    const cached = _cache.get(key);
    if (cached && cached.version === version && (_now() - cached.time) <= PF_LIMITS.identicalCacheMs) {
      return cloneResult(cached.result);
    }
    if (cached && cached.version === version) {
      _cache.delete(key); _cache.set(key, cached);
      return cloneResult(cached.result);
    }

    let waitedSlots = 0;
    while (_concurrent >= PF_LIMITS.maxConcurrent) {
      yield { kind: "wait", seconds: 0.03 };
      if (++waitedSlots > 2000) break;
    }
    _concurrent++;
    try {
      const deadline = _now() + PF_LIMITS.computeTimeoutMs;
      const grid = buildGrid(agent, start, finish);
      const startCell = { c: grid.xToCol(start.x), r: grid.zToRow(start.z) };
      const finishCell = { c: grid.xToCol(finish.x), r: grid.zToRow(finish.z) };

      if (!grid.evalCell(startCell.c, startCell.r)) {
        return finalize(key, version, { status: "FailStartNotEmpty", waypoints: [], totalCost: 0, dynamicBlockers: 0 });
      }
      const finishWalkable = !!grid.evalCell(finishCell.c, finishCell.r);

      const res = yield* astar(grid, agent, startCell, finishCell, deadline);
      const startId = startCell.c + "," + startCell.r;
      const seqRaw = reconstruct(grid, res.came, startId, res.endId);
      const seq = simplify(grid, seqRaw, agent);
      let wps = toWaypoints(grid, seq, start, finish);
      wps = enforceSpacing(wps, agent.WaypointSpacing);

      let status;
      if (res.reached && finishWalkable) status = "Success";
      else if (!finishWalkable && res.reached) status = "Success";
      else if (wps.length > 1) status = "ClosestNoPath";
      else status = "NoPath";
      if (!finishWalkable && status !== "NoPath" && seqRaw.length <= 1) status = "FailFinishNotEmpty";

      let totalCost = res.gScore && res.gScore.get(res.endId) || 0;
      if (wps.length > PF_LIMITS.maxWaypoints) {
        wps = wps.slice(0, PF_LIMITS.maxWaypoints);
        status = "ClosestOutOfRange";
      }
      if (res.timedOut || res.overflow) {
        status = wps.length > 1 ? "ClosestOutOfRange" : "NoPath";
      }

      const dynamicBlockers = grid.dynBlockers ? grid.dynBlockers.length : 0;
      return finalize(key, version, { status, waypoints: wps, totalCost, dynamicBlockers });
    } finally {
      _concurrent = Math.max(0, _concurrent - 1);
    }
  }

  function finalize(key, version, result) {
    _cache.set(key, { version, time: _now(), result: cloneResult(result) });
    pruneCache();
    return result;
  }

  function cloneResult(r) {
    return {
      status: r.status,
      totalCost: r.totalCost,
      dynamicBlockers: r.dynamicBlockers || 0,
      waypoints: r.waypoints.map((w) => ({ x: w.x, y: w.y, z: w.z, action: w.action, label: w.label || "" })),
    };
  }


  function _checkOcclusionAll(waypoints, startIndex) {
    if (!Array.isArray(waypoints) || waypoints.length === 0) return [];
    const geo = getGeometry();
    const rawParts = geo.parts || [];


    const staticBlockers = rawParts
      .filter((p) => p.canCollide && p.anchored)
      .map((p, i) => normalizePart(p, i));


    const dynBlockers = _dynamicEnabled
      ? rawParts
          .filter((p) => p.canCollide && !p.anchored)
          .slice(0, PF_LIMITS.maxDynamicParts)
          .map((p, i) => normalizePart(p, i))
      : [];

    const allBlockers = [...staticBlockers, ...dynBlockers];
    const modifiers = (geo.modifiers || []).filter((m) => m.passThrough === false);

    const i0 = Math.max(0, Math.floor(startIndex || 0));
    const blocked = [];
    for (let i = i0; i < waypoints.length; i++) {
      const w = waypoints[i];
      let isBlocked = false;
      for (const p of allBlockers) {
        if (w.x >= p.minX && w.x <= p.maxX && w.z >= p.minZ && w.z <= p.maxZ &&
            w.y > p.minY - 0.5 && w.y < p.maxY - 0.1) {
          isBlocked = true; break;
        }
      }
      if (!isBlocked) {
        for (const m of modifiers) {
          if (w.x >= m.minX && w.x <= m.maxX && w.z >= m.minZ && w.z <= m.maxZ &&
              w.y >= m.minY - 4 && w.y <= m.maxY + 4) {
            isBlocked = true; break;
          }
        }
      }
      if (isBlocked) blocked.push(i);
    }
    return blocked;
  }

  function checkOcclusion(waypoints, startIndex) {
    const all = _checkOcclusionAll(waypoints, startIndex);
    return all.length > 0 ? all[0] : -1;
  }


  function registerActivePath(waypoints, status, meta) {
    const id = _activeIdSeq++;
    _activePaths.set(id, {
      waypoints: waypoints.map((w) => ({ x: w.x, y: w.y, z: w.z, action: w.action })),
      status,
      blocked: new Set(),
      meta: meta || null,
      repaths: (meta && meta.repaths) || 0,
    });
    return id;
  }

  function unregisterActivePath(id) {
    _activePaths.delete(id);
  }


  function noteRepath(id) {
    const rec = _activePaths.get(id);
    if (rec) { rec.repaths = (rec.repaths || 0) + 1; _totalRepaths++; }
  }


  function reevaluateActive(onBlocked, onUnblocked) {
    let checked = 0;
    const blockedNow = [];
    for (const [id, rec] of _activePaths) {
      checked++;
      const allIndices = _checkOcclusionAll(rec.waypoints, 0);
      const nowSet = new Set(allIndices);

      for (const i of nowSet) {
        if (!rec.blocked.has(i)) {
          rec.blocked.add(i);
          if (onBlocked) onBlocked(id, i);
        }
      }

      for (const i of [...rec.blocked]) {
        if (!nowSet.has(i)) {
          rec.blocked.delete(i);
          if (onUnblocked) onUnblocked(id, i);
        }
      }
      if (rec.blocked.size > 0) {
        blockedNow.push({ id, indices: [...rec.blocked].sort((a, b) => a - b) });
      }
    }
    return { checked, blockedNow };
  }

  function invalidateCache() {
    _cache.clear();
  }


  function snapshotGeometry() {
    const geo = getGeometry();
    const version = getGeometryVersion();
    const boxes = new Map();
    const rawParts = geo.parts || [];
    for (let i = 0; i < rawParts.length; i++) {
      const p = normalizePart(rawParts[i], i);
      boxes.set(p.id, { minX: p.minX, maxX: p.maxX, minY: p.minY, maxY: p.maxY, minZ: p.minZ, maxZ: p.maxZ });
    }
    return { version, boxes };
  }


  function diffGeometry(prevSnapshot) {
    const current = snapshotGeometry();
    const changed = [];
    const dirty = [];
    const eps = PF_LIMITS.moveEpsilon;

    if (!prevSnapshot || !prevSnapshot.boxes) {
      return { changed: [], dirty: [], snapshot: current };
    }

    const prev = prevSnapshot.boxes;


    for (const [id, curBox] of current.boxes) {
      const prevBox = prev.get(id);
      if (!prevBox) {

        changed.push(id);
        dirty.push({ minX: curBox.minX, maxX: curBox.maxX, minZ: curBox.minZ, maxZ: curBox.maxZ });
      } else {

        const moved =
          Math.abs(curBox.minX - prevBox.minX) > eps ||
          Math.abs(curBox.maxX - prevBox.maxX) > eps ||
          Math.abs(curBox.minZ - prevBox.minZ) > eps ||
          Math.abs(curBox.maxZ - prevBox.maxZ) > eps;
        if (moved) {
          changed.push(id);

          dirty.push({
            minX: Math.min(curBox.minX, prevBox.minX),
            maxX: Math.max(curBox.maxX, prevBox.maxX),
            minZ: Math.min(curBox.minZ, prevBox.minZ),
            maxZ: Math.max(curBox.maxZ, prevBox.maxZ),
          });
        }
      }
    }


    for (const [id, prevBox] of prev) {
      if (!current.boxes.has(id)) {
        changed.push(id);
        dirty.push({ minX: prevBox.minX, maxX: prevBox.maxX, minZ: prevBox.minZ, maxZ: prevBox.maxZ });
      }
    }

    return { changed, dirty, snapshot: current };
  }


  function invalidateCacheRegion(box) {
    let removed = 0;
    if (!box) { _cache.clear(); return 0; }
    const keysToDelete = [];
    for (const [k] of _cache) {


      try {
        const arr = JSON.parse(k);


        if (arr.length < 14) { keysToDelete.push(k); continue; }
        const sx = arr[8], sz = arr[10], fx = arr[11], fz = arr[13];
        const pathMinX = Math.min(sx, fx), pathMaxX = Math.max(sx, fx);
        const pathMinZ = Math.min(sz, fz), pathMaxZ = Math.max(sz, fz);

        const margin = 64;
        if (pathMinX - margin <= box.maxX && pathMaxX + margin >= box.minX &&
            pathMinZ - margin <= box.maxZ && pathMaxZ + margin >= box.minZ) {
          keysToDelete.push(k);
        }
      } catch (_) {
        keysToDelete.push(k);
      }
    }
    for (const k of keysToDelete) { _cache.delete(k); removed++; }
    return removed;
  }


  function setDynamicEnabled(bool) {
    _dynamicEnabled = !!bool;
  }


  function getStats() {
    let dynamicParts = 0;
    try {
      const geo = getGeometry();
      dynamicParts = (geo.parts || []).filter((p) => p.canCollide && !p.anchored).length;
    } catch (_) {}
    return {
      concurrent: _concurrent,
      cacheSize: _cache.size,
      activePaths: _activePaths.size,
      dynamicParts,
      lastBuildMs: _lastBuildMs,
      repaths: _totalRepaths,
    };
  }


  function getDebugSnapshot() {
    const paths = [];
    for (const rec of _activePaths.values()) {
      paths.push({
        status: rec.status,
        waypoints: rec.waypoints.map((w) => ({ x: w.x, y: w.y, z: w.z, action: w.action })),
        blocked: [...rec.blocked].sort((a, b) => a - b),
        repaths: rec.repaths || 0,
      });
    }

    const dynamic = [];
    try {
      const geo = getGeometry();
      const rawParts = geo.parts || [];
      for (let i = 0; i < rawParts.length; i++) {
        const p = rawParts[i];
        if (p.canCollide && !p.anchored) {
          const np = normalizePart(p, i);
          const speed = Math.sqrt(np.vx * np.vx + np.vy * np.vy + np.vz * np.vz);
          dynamic.push({
            id: np.id,
            minX: np.minX, maxX: np.maxX,
            minY: np.minY, maxY: np.maxY,
            minZ: np.minZ, maxZ: np.maxZ,
            moving: speed > PF_LIMITS.moveEpsilon,
          });
          if (dynamic.length >= PF_LIMITS.maxDynamicParts) break;
        }
      }
    } catch (_) {}
    return { paths, dynamic };
  }

  return {
    normalizeAgentParams: (raw, warn) => normalizeAgentParams(raw, warn),
    computePath,
    checkOcclusion,
    registerActivePath,
    unregisterActivePath,
    noteRepath,
    reevaluateActive,
    invalidateCache,

    snapshotGeometry,
    diffGeometry,
    invalidateCacheRegion,
    setDynamicEnabled,
    getStats,
    getPathfindingDebugSnapshot: getDebugSnapshot,
    hasActivePaths: () => _activePaths.size > 0,
    getConcurrent: () => _concurrent,
  };
}
