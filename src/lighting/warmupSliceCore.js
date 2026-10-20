export function dedupeCompileUnits(objs) {
  const list = Array.isArray(objs) ? objs : [];
  const seen = new Set();
  const units = [];
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (!o) continue;
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    if (!mats.length) continue;
    let morphN = 0;
    const ga = o.geometry && o.geometry.morphAttributes ? o.geometry.morphAttributes : null;
    if (ga) {
      for (const k in ga) {
        const arr = ga[k];
        if (arr && arr.length) morphN += arr.length;
      }
    }
    const objSig =
      "|i" + (o.isInstancedMesh ? (o.instanceColor ? 2 : 1) : 0) +
      "s" + (o.isSkinnedMesh ? 1 : 0) +
      "m" + morphN;
    for (let m = 0; m < mats.length; m++) {
      const mat = mats[m];
      if (!mat) continue;
      const key = String(mat.uuid || mat.id || m) + objSig;
      if (seen.has(key)) continue;
      seen.add(key);
      units.push({ object: o, material: mat, key });
    }
  }
  return units;
}


export function createCompileSlicer(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const budgetMs = Number.isFinite(Number(o.budgetMs)) && Number(o.budgetMs) > 0 ? Number(o.budgetMs) : 12;
  const minPerFrame = Math.max(1, Math.floor(Number(o.minPerFrame) || 1));


  const requestedMaximum = Number(o.maxPerFrame);
  const maxPerFrame = Number.isFinite(requestedMaximum) && requestedMaximum > 0
    ? Math.max(minPerFrame, Math.floor(requestedMaximum)) : Infinity;
  let queue = [];
  let idx = 0;
  let active = false;
  let startedAt = 0;
  let ticks = 0;
  let fails = 0;
  let worstUnitMs = 0;
  return {
    limits: { budgetMs, minPerFrame, maxPerFrame },


    arm(units, nowMs) {
      queue = Array.isArray(units) ? units.slice() : [];
      idx = 0;
      ticks = 0;
      fails = 0;
      worstUnitMs = 0;
      active = queue.length > 0;
      startedAt = Number.isFinite(Number(nowMs)) ? Number(nowMs) : 0;
      return active;
    },
    isActive() {
      return active;
    },


    tick(compileFn, nowFn) {
      if (!active) {
        return { done: true, compiled: 0, spentMs: 0, idx, total: queue.length, fails };
      }
      const now = typeof nowFn === "function" ? nowFn : () => 0;
      const fn = typeof compileFn === "function" ? compileFn : () => {};
      const t0 = now();
      let compiled = 0;
      while (idx < queue.length) {
        const uT0 = now();
        let yieldFrame = false;
        try {
          yieldFrame = fn(queue[idx])?.yieldFrame === true;
        } catch (_e) {
          fails += 1;                                                      
        }
        const uMs = now() - uT0;
        if (uMs > worstUnitMs) worstUnitMs = uMs;
        idx += 1;
        compiled += 1;
        if (yieldFrame || compiled >= maxPerFrame || (compiled >= minPerFrame && now() - t0 >= budgetMs)) break;
      }
      ticks += 1;
      const done = idx >= queue.length;
      if (done) active = false;                                            
      return { done, compiled, spentMs: now() - t0, idx, total: queue.length, fails };
    },
    cancel() {
      active = false;
      queue = [];
      idx = 0;
    },
    progress() {
      const total = queue.length;
      return { idx, total, pct: total ? idx / total : 1 };
    },
    elapsed(nowMs) {
      const n = Number(nowMs);
      return active && Number.isFinite(n) && startedAt > 0 ? Math.max(0, n - startedAt) : 0;
    },
    debug() {
      return {
        active,
        idx,
        total: queue.length,
        ticks,
        fails,
        worstUnitMs: Math.round(worstUnitMs * 10) / 10,
      };
    },
  };
}
