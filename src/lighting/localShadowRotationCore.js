export const LSR_MAX_PER_FRAME = 1;                                              
export const LSR_RES_NEAR = 512;                                     
export const LSR_RES_FAR = 256;                                     

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}


export function lsrResFor(rank) {
  const r = Math.max(0, Math.floor(num(rank, 0)));
  return r === 0 ? LSR_RES_NEAR : LSR_RES_FAR;
}


export function createShadowRotation() {
  let frame = 0;
  const state = new Map();

  function ensure(id) {
    let s = state.get(id);
    if (!s) {

      s = { lastRendered: 0, stale: true, moved: false };
      state.set(id, s);
    }
    return s;
  }


  function markAllStale() {
    for (const s of state.values()) s.stale = true;
  }


  function plan(candidates, maxPerFrame) {
    frame += 1;
    const mpf = Math.max(0, Math.floor(num(maxPerFrame, LSR_MAX_PER_FRAME)));
    const render = [];
    if (!Array.isArray(candidates) || candidates.length === 0) {
      state.clear();
      return { render, pending: 0 };
    }
    const seen = new Set();
    const pool = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (!c || c.id === undefined || c.id === null) continue;
      const id = String(c.id);
      if (seen.has(id)) continue;                                    
      seen.add(id);
      const s = ensure(id);
      if (c.moved) {
        s.stale = true;
        s.moved = true;
      }
      if (!c.hasMap) {


        s.stale = false;
        s.moved = false;
        s.lastRendered = frame;
        render.push(id);
        continue;
      }
      if (s.stale) {
        pool.push({ id, rank: Math.max(0, Math.floor(num(c.rank, 0))), s });
      }
    }

    for (const id of state.keys()) {
      if (!seen.has(id)) state.delete(id);
    }


    pool.sort((a, b) => {
      if (a.s.moved !== b.s.moved) return a.s.moved ? -1 : 1;
      if (a.s.lastRendered !== b.s.lastRendered) {
        return a.s.lastRendered - b.s.lastRendered;
      }
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const slots = Math.max(0, mpf - render.length);
    for (let i = 0; i < pool.length && i < slots; i++) {
      const p = pool[i];
      p.s.stale = false;
      p.s.moved = false;
      p.s.lastRendered = frame;
      render.push(p.id);
    }
    let pending = 0;
    for (const s of state.values()) {
      if (s.stale) pending += 1;
    }
    return { render, pending };
  }

  function getStats() {
    let stale = 0;
    for (const s of state.values()) {
      if (s.stale) stale += 1;
    }
    return { tracked: state.size, stale, frame };
  }

  function reset() {
    frame = 0;
    state.clear();
  }

  return { plan, markAllStale, getStats, reset };
}
