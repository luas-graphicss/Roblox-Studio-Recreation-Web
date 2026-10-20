export const PF_WATCHER_DEFAULTS = Object.freeze({
  dynamicSampleHz: 20,                                                              
  moveEpsilon: 0.1,                                                
  maxDynamicParts: 300,                                                     
  dynamicRadius: 250,                                                             
  maxRepathsPerSecond: 4,                                          
  repathCooldownDefault: 0.25,                                                      
  hysteresisMargin: 0.5,                                                          
});

function neutralTick() {
  return { sampled: false, dirty: false, changed: [], blocked: [], repaths: [] };
}

function finitePos(v, def) {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : def;
}


function wpInsideBox(w, p, inflate) {
  return (
    w.x >= p.minX - inflate &&
    w.x <= p.maxX + inflate &&
    w.z >= p.minZ - inflate &&
    w.z <= p.maxZ + inflate &&
    w.y > p.minY - 0.5 &&
    w.y < p.maxY - 0.1
  );
}


function occlusionIndex(waypoints, dynParts, inflate) {
  if (!waypoints || !waypoints.length || !dynParts.length) return -1;
  for (let i = 0; i < waypoints.length; i++) {
    const w = waypoints[i];
    if (!w) continue;
    for (let j = 0; j < dynParts.length; j++) {
      if (wpInsideBox(w, dynParts[j], inflate)) return i;
    }
  }
  return -1;
}


export function createPathfindingWatcher(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const pathfinder = o.pathfinder || null;
  const getGeometry = typeof o.getGeometry === "function" ? o.getGeometry : null;
  const limits = o.limits && typeof o.limits === "object" ? o.limits : {};
  const now = typeof o.now === "function" ? o.now : null;
  const sampleHzOverride = finitePos(o.sampleHz, 0) || null;
  const onDirty = typeof o.onDirty === "function" ? o.onDirty : null;
  const onBlocked = typeof o.onBlocked === "function" ? o.onBlocked : null;
  const onUnblocked = typeof o.onUnblocked === "function" ? o.onUnblocked : null;
  const onCoreBlocked = typeof o.onCoreBlocked === "function" ? o.onCoreBlocked : null;
  const onCoreUnblocked = typeof o.onCoreUnblocked === "function" ? o.onCoreUnblocked : null;
  const requestRepath = typeof o.requestRepath === "function"
    ? o.requestRepath
    : typeof o.onRepath === "function" ? o.onRepath : null;
  const warn = typeof o.warn === "function"
    ? o.warn
    : typeof o.log === "function" ? o.log : null;


  function lim(name, def) {
    return finitePos(limits[name], def);
  }
  function limSampleHz() {
    return sampleHzOverride || lim("dynamicSampleHz", PF_WATCHER_DEFAULTS.dynamicSampleHz);
  }


  function limCooldown() {
    return finitePos(
      limits.repathCooldownDefault,
      finitePos(limits.repathCooldownSec, PF_WATCHER_DEFAULTS.repathCooldownDefault),
    );
  }


  const paths = new Map();


  const partsSeen = new Map();
  const repathTimes = [];                                              
  const warnedOnce = new Set();
  let clock = 0;                                                   
  let accum = 0;                                    
  let lastSampleAt = -1;                                
  let repathCount = 0;
  let lastDynCount = 0;
  let samples = 0;                                      
  let dirtyEvents = 0;                                   
  let lastSampleMs = 0;                                                       
  let coreSnapshot = null;                                                     

  function logOnce(tag, message) {
    if (warnedOnce.has(tag)) return;
    warnedOnce.add(tag);
    if (warn) {
      try {
        warn("pathfindingWatcher: " + message);
      } catch (_) {

      }
    }
  }

  function registerPath(pathKey, info) {
    if (pathKey === undefined || pathKey === null) return;
    const inf = info && typeof info === "object" ? info : {};
    const wps = Array.isArray(inf.waypoints) ? inf.waypoints.slice() : [];

    const cd = inf.cooldownSec !== undefined ? inf.cooldownSec : inf.cooldown;
    const prev = paths.get(pathKey);
    paths.set(pathKey, {
      waypoints: wps,
      autoRepath: inf.autoRepath === true,
      cooldownSec: finitePos(cd, 0) || null,                               
      meta: inf.meta || null,
      blockedIdx: null,

      lastRepathAt: prev ? prev.lastRepathAt : -Infinity,
    });
  }

  function updatePath(pathKey, waypoints) {
    const rec = paths.get(pathKey);
    if (!rec) return;
    rec.waypoints = Array.isArray(waypoints) ? waypoints.slice() : [];

    rec.blockedIdx = null;
  }

  function unregisterPath(pathKey) {
    paths.delete(pathKey);
  }

  function hasPaths() {
    return paths.size > 0;
  }

  function reset() {
    paths.clear();
    partsSeen.clear();
    repathTimes.length = 0;
    clock = 0;
    accum = 0;
    lastSampleAt = -1;
    lastDynCount = 0;
    repathCount = 0;
    samples = 0;
    dirtyEvents = 0;
    lastSampleMs = 0;
    coreSnapshot = null;
  }

  function tick(dtSeconds) {
    const out = neutralTick();
    try {

      if (paths.size === 0) return out;
      const dt = typeof dtSeconds === "number" && Number.isFinite(dtSeconds) && dtSeconds > 0 ? dtSeconds : 0;
      clock += dt;
      accum += dt;
      const interval = 1 / limSampleHz();
      if (accum < interval) return out;

      accum = Math.min(accum - interval, interval);
      out.sampled = true;
      samples++;
      const t0 = now ? now() : 0;


      let geo = null;
      try {
        geo = getGeometry ? getGeometry() : null;
      } catch (err) {
        logOnce("geometry", "getGeometry falhou: " + err);
        return out;
      }
      const rawParts = geo && Array.isArray(geo.parts) ? geo.parts : [];
      const maxDyn = lim("maxDynamicParts", PF_WATCHER_DEFAULTS.maxDynamicParts);
      const dyn = [];
      for (let i = 0; i < rawParts.length && dyn.length < maxDyn; i++) {
        const p = rawParts[i];
        if (!p) continue;
        if (p.dynamic === true || (p.canCollide === true && p.anchored === false)) dyn.push(p);
      }
      lastDynCount = dyn.length;

      const moveEps = lim("moveEpsilon", PF_WATCHER_DEFAULTS.moveEpsilon);
      const dtSample = lastSampleAt >= 0 ? Math.max(clock - lastSampleAt, 1e-6) : 0;
      lastSampleAt = clock;


      const seen = new Set();
      const localDirtyBoxes = [];
      let appeared = 0;
      for (let i = 0; i < dyn.length; i++) {
        const p = dyn[i];
        let id;
        if (p.id !== undefined && p.id !== null && p.id !== "") id = String(p.id);
        else {
          id = "@" + i;                                                 
          logOnce("missing-id", "parte dinâmica sem id estável; usando índice como fallback");
        }
        seen.add(id);
        const cx = (p.minX + p.maxX) / 2;
        const cy = (p.minY + p.maxY) / 2;
        const cz = (p.minZ + p.maxZ) / 2;
        const hx = Math.abs(p.maxX - p.minX) / 2;
        const hz = Math.abs(p.maxZ - p.minZ) / 2;
        const rec = partsSeen.get(id);
        if (!rec) {


          appeared++;
          partsSeen.set(id, {
            bx: cx, by: cy, bz: cz,
            px: cx, py: cy, pz: cz,
            hx, hz,
            vx: typeof p.vx === "number" && Number.isFinite(p.vx) ? p.vx : 0,
            vy: typeof p.vy === "number" && Number.isFinite(p.vy) ? p.vy : 0,
            vz: typeof p.vz === "number" && Number.isFinite(p.vz) ? p.vz : 0,
          });
          continue;
        }


        if (typeof p.vx === "number" && Number.isFinite(p.vx)) {
          rec.vx = p.vx;
          rec.vy = typeof p.vy === "number" && Number.isFinite(p.vy) ? p.vy : 0;
          rec.vz = typeof p.vz === "number" && Number.isFinite(p.vz) ? p.vz : 0;
        } else if (dtSample > 0) {
          rec.vx = (cx - rec.px) / dtSample;
          rec.vy = (cy - rec.py) / dtSample;
          rec.vz = (cz - rec.pz) / dtSample;
        }
        const prevPx = rec.px, prevPz = rec.pz;
        rec.px = cx;
        rec.py = cy;
        rec.pz = cz;
        rec.hx = hx;
        rec.hz = hz;


        const moved = Math.hypot(cx - rec.bx, cy - rec.by, cz - rec.bz) > moveEps;
        if (moved) {
          rec.bx = cx;
          rec.by = cy;
          rec.bz = cz;
          out.changed.push(id);


          localDirtyBoxes.push({
            minX: Math.min(p.minX, prevPx - hx),
            maxX: Math.max(p.maxX, prevPx + hx),
            minZ: Math.min(p.minZ, prevPz - hz),
            maxZ: Math.max(p.maxZ, prevPz + hz),
          });
        }
      }

      let removed = 0;
      for (const [id, rec] of partsSeen) {
        if (!seen.has(id)) {
          partsSeen.delete(id);
          removed++;
          localDirtyBoxes.push({
            minX: rec.px - (rec.hx || 2), maxX: rec.px + (rec.hx || 2),
            minZ: rec.pz - (rec.hz || 2), maxZ: rec.pz + (rec.hz || 2),
          });
        }
      }

      out.dirty = out.changed.length > 0;
      const evalNeeded = out.dirty || appeared > 0 || removed > 0;
      let dirtyBoxes = null;


      let coreMode = false;
      if (evalNeeded && pathfinder && typeof pathfinder.diffGeometry === "function") {
        try {
          const diff = pathfinder.diffGeometry(coreSnapshot);
          if (diff && diff.snapshot) coreSnapshot = diff.snapshot;
          coreMode = true;
          if (diff && Array.isArray(diff.changed) && diff.changed.length) {
            for (let i = 0; i < diff.changed.length; i++) {
              const id = String(diff.changed[i]);
              if (out.changed.indexOf(id) < 0) out.changed.push(id);
            }
            out.dirty = true;
          }
          if (diff && Array.isArray(diff.dirty) && diff.dirty.length) dirtyBoxes = diff.dirty.slice();
        } catch (err) {
          coreMode = false;
          logOnce("core-dynamic", "núcleo dinâmico falhou; usando fallback puro: " + err);
        }
      }
      if (!dirtyBoxes && localDirtyBoxes.length) dirtyBoxes = localDirtyBoxes;


      if (out.dirty) {
        dirtyEvents++;
        if (onDirty) {
          try {
            onDirty(dirtyBoxes || [], out.changed.slice());
          } catch (err) {
            logOnce("cb-dirty", "onDirty falhou: " + err);
          }
        }
      }


      if (evalNeeded && coreMode && typeof pathfinder.reevaluateActive === "function") {
        try {
          pathfinder.reevaluateActive(
            (coreId, index) => {
              if (onCoreBlocked) onCoreBlocked(coreId, index);
            },
            (coreId, index) => {
              if (onCoreUnblocked) onCoreUnblocked(coreId, index);
            },
          );
        } catch (err) {
          coreMode = false;
          logOnce("core-reevaluate", "reevaluateActive falhou; usando fallback puro: " + err);
        }
      }


      const hyst = lim("hysteresisMargin", PF_WATCHER_DEFAULTS.hysteresisMargin);
      const maxPerSec = lim("maxRepathsPerSecond", PF_WATCHER_DEFAULTS.maxRepathsPerSecond);
      for (const [pathKey, rec] of paths) {
        if (evalNeeded) {
          if (rec.blockedIdx === null) {

            const idx = occlusionIndex(rec.waypoints, dyn, 0);
            if (idx >= 0) {
              rec.blockedIdx = idx;
              out.blocked.push({ path: pathKey, index: idx, kind: "blocked" });


              if (!coreMode && onBlocked) {
                try {
                  onBlocked(pathKey, idx);
                } catch (err) {
                  logOnce("cb-blocked", "onBlocked falhou: " + err);
                }
              }
            }
          } else {


            const idx = occlusionIndex(rec.waypoints, dyn, hyst);
            if (idx < 0) {
              const old = rec.blockedIdx;
              rec.blockedIdx = null;
              out.blocked.push({ path: pathKey, index: old, kind: "unblocked" });
              if (!coreMode && onUnblocked) {
                try {
                  onUnblocked(pathKey, old);
                } catch (err) {
                  logOnce("cb-unblocked", "onUnblocked falhou: " + err);
                }
              }
            } else {
              rec.blockedIdx = idx;                                      
            }
          }
        }


        if (rec.autoRepath && rec.blockedIdx !== null && requestRepath) {
          const cool = rec.cooldownSec || limCooldown();
          if (clock - rec.lastRepathAt >= cool) {
            while (repathTimes.length && clock - repathTimes[0] > 1) repathTimes.shift();
            if (repathTimes.length < maxPerSec) {
              repathTimes.push(clock);
              rec.lastRepathAt = clock;
              repathCount++;
              out.repaths.push(pathKey);
              try {
                requestRepath(pathKey, "Blocked", { index: rec.blockedIdx });
              } catch (err) {
                logOnce("cb-repath", "requestRepath falhou: " + err);
              }
            }
          }
        }
      }
      if (now) lastSampleMs = Math.max(0, now() - t0);
      return out;
    } catch (err) {
      logOnce("tick", "tick falhou: " + err);
      return out;
    }
  }


  function getStats() {
    return { samples, dirtyEvents, repaths: repathCount, lastSampleMs };
  }


  function getDebugSnapshot() {
    const list = [];
    for (const [pathKey, rec] of paths) {
      list.push({
        key: pathKey,
        blockedIndex: rec.blockedIdx,
        autoRepath: rec.autoRepath,
        waypointCount: rec.waypoints.length,
      });
    }
    return { dynamicParts: lastDynCount, repathCount, clock, paths: list };
  }

  return {
    registerPath,
    updatePath,
    unregisterPath,
    hasPaths,
    tick,
    reset,
    getStats,
    getDebugSnapshot,
  };
}


export function createDynamicWatcher(opts) {
  return createPathfindingWatcher(opts);
}
