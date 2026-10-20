import { FRAME_GAP_MS } from "./shadowBudget.js";
import {
  TIER_TARGET_MS,
  TIER_DOWN_RATIO,
  TIER_UP_RATIO,
  TIER_MIN_HOLD_MS,
  TIER_UP_HOLD_MS,
  TIER_COST_ALPHA,
  TIER_COST_CLAMP_MS,
  TIER_PANIC_RATIO,
  tierConfig,
  tierFarEnabled,
  tierFitsTexUnits,
} from "./shadowTierCore.js";


export const FEATURE_PRIORITY = Object.freeze([
  "csm",
  "ao",
  "sscs",
  "far",
  "vidro",
  "gi-extra",
  "rt-ocio",
]);


export const KILL_FRAME_MS = 150;
export const KILL_FRAMES = 3;
export const KILL_DROP = 2;


export const BUY_SAFETY = 1.25;


export const MIN_MEASURED_MS = 0.05;


export const FEATURE_DEFS = Object.freeze({


  csm: Object.freeze({
    patch: Object.freeze({ csm: true, csmCascades: 4 }),
    estMs: 3,
    passes: Object.freeze([["sombra-raster", 1], ["sombra-paginas", 1]]),
  }),
  ao: Object.freeze({
    patch: Object.freeze({ gtao: true, gtaoLite: false, temporal: true, motionTaps: 4 }),
    estMs: 2.5,
    passes: Object.freeze([["ao-sscs", 0.6]]),
  }),
  sscs: Object.freeze({
    patch: Object.freeze({ contact: true, contactSteps: 12 }),
    estMs: 1.5,
    passes: Object.freeze([["ao-sscs", 0.4]]),
  }),
  far: Object.freeze({
    patch: Object.freeze({ far: true }),
    estMs: 1.5,
    passes: Object.freeze([["far", 1]]),
  }),
  vidro: Object.freeze({
    patch: Object.freeze({ trans: true }),
    estMs: 0.5,
    passes: Object.freeze([["vidro", 1]]),
  }),
  "gi-extra": Object.freeze({
    patch: Object.freeze({ giExtra: true }),
    estMs: 2,
    passes: Object.freeze([["gi", 0.5]]),
  }),
  "rt-ocio": Object.freeze({
    patch: Object.freeze({ rtIdle: true }),
    estMs: 0.3,
    passes: Object.freeze([["rt-cpu", 1]]),
  }),
});

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function r1(v) {
  return Math.round(num(v, 0) * 10) / 10;
}


export function featureCostMs(id, ledger) {
  const def = FEATURE_DEFS[id];
  if (!def) return 0;
  const passes = ledger && typeof ledger === "object" && Array.isArray(ledger.passes) ? ledger.passes : null;
  if (passes) {
    let sum = 0;
    for (const pair of def.passes) {
      const pid = pair[0];
      const share = pair[1];
      for (const p of passes) {
        if (p && p.id === pid && num(p.samples, 0) > 0) {
          sum += Math.max(0, num(p.emaMs, 0)) * share;
          break;
        }
      }
    }
    if (sum >= MIN_MEASURED_MS) return sum;
  }
  return def.estMs;
}


export function composeFeatureConfig(baseCfg, ids) {
  const base = baseCfg && typeof baseCfg === "object" ? baseCfg : tierConfig();
  const list = Array.isArray(ids) ? ids : [];
  let any = false;
  for (const id of FEATURE_PRIORITY) {
    if (list.indexOf(id) !== -1 && FEATURE_DEFS[id]) {
      any = true;
      break;
    }
  }
  if (!any) return base;
  const out = {};
  for (const k in base) out[k] = base[k];
  for (const id of FEATURE_PRIORITY) {
    if (list.indexOf(id) === -1) continue;
    const def = FEATURE_DEFS[id];
    if (!def) continue;
    const patch = def.patch;
    for (const k in patch) out[k] = patch[k];
  }
  return Object.freeze(out);
}


export function sceneKeyFor(info) {
  const o = info && typeof info === "object" ? info : {};
  const b = (v) => {
    const n = Math.max(0, num(v, 0));
    return n <= 0 ? 0 : Math.round(Math.log2(1 + n) * 2);
  };
  return "L" + b(o.lights) + "S" + b(o.shadowLights) + "P" + b(o.parts) + "A" + b(o.aabbSize);
}

export function createFeatureGovernor(options) {
  const opts = options && typeof options === "object" ? options : {};


  const weak = opts.weak === true;
  const maxTextures = num(opts.maxTextures, 16);


  const farUnits = num(opts.farUnits, 2) === 1 ? 1 : 2;
  const targetMs = Math.max(1, num(opts.targetMs, TIER_TARGET_MS));
  const minHoldMs = Math.max(0, num(opts.minHoldMs, TIER_MIN_HOLD_MS));
  const upHoldMs = Math.max(minHoldMs, num(opts.upHoldMs, TIER_UP_HOLD_MS));
  const killFrameMs = Math.max(1, num(opts.killFrameMs, KILL_FRAME_MS));
  const killFrames = Math.max(1, Math.floor(num(opts.killFrames, KILL_FRAMES)));
  const killDrop = Math.max(1, Math.floor(num(opts.killDrop, KILL_DROP)));
  const getLedger = typeof opts.getLedger === "function" ? opts.getLedger : null;


  const upCadenceMs = Math.max(0, num(opts.upCadenceMs, 0));
  const maxLevel = FEATURE_PRIORITY.length;

  let level = 0;
  let lastChangeMs = -Infinity;                                              
  let streak = 0;
  let costEma = 0;
  let killStreak = 0;
  let killTrips = 0;
  let changes = 0;
  let lastReason = "";
  let blocked = "";
  let sceneKey = "";
  const sceneMemo = new Map();
  let active = false;


  let composedCache = null;
  let composedBase = null;
  let composedLevel = -1;

  function featuresAt(n) {
    return FEATURE_PRIORITY.slice(0, Math.max(0, Math.min(maxLevel, n)));
  }

  function configFor(base, n) {
    if (n <= 0) return base;
    if (composedCache && composedBase === base && composedLevel === n) return composedCache;
    composedCache = composeFeatureConfig(base, featuresAt(n));
    composedBase = base;
    composedLevel = n;
    return composedCache;
  }



  function fitsAt(base, n) {
    const cfg = n <= 0 ? base : composeFeatureConfig(base, featuresAt(n));
    const farOn = cfg.far === true || tierFarEnabled(cfg, weak);
    return tierFitsTexUnits(cfg, maxTextures, { far: farOn, farUnits, rt: cfg.rt === true });
  }

  function result(base, changed, direction, reason, kill) {
    return {
      active,
      level,
      features: featuresAt(level),
      config: active ? configFor(base, level) : base,
      changed: !!changed,
      direction: direction || "none",
      reason: reason || "",
      killSwitch: !!kill,
    };
  }

  function commit(direction, reason, now, kill) {
    changes += 1;
    lastChangeMs = now;
    streak = 0;
    lastReason = reason;
    if (kill) killTrips += 1;
  }

  function safeLedger() {
    if (!getLedger) return null;
    try {
      return getLedger();
    } catch (_e) {
      return null;
    }
  }


  function sample(input) {
    const a = input && typeof input === "object" ? input : {};
    const base = a.baseCfg && typeof a.baseCfg === "object" ? a.baseCfg : tierConfig();
    active = weak && a.flag === true;
    if (!active) {
      streak = 0;
      killStreak = 0;
      blocked = "";
      return result(base, false, "none", "");
    }
    const now = num(a.nowMs, 0);


    const key = typeof a.sceneKey === "string" && a.sceneKey ? a.sceneKey : "";
    if (key && key !== sceneKey) {
      if (sceneKey) sceneMemo.set(sceneKey, level);
      sceneKey = key;
      streak = 0;
      if (sceneMemo.has(key)) {
        let n = Math.max(0, Math.min(maxLevel, Math.floor(num(sceneMemo.get(key), 0))));
        while (n > 0 && !fitsAt(base, n)) n--;
        if (n !== level) {
          const from = level;
          level = n;
          const dir = n > from ? "up" : "down";
          commit(dir, "memória da cena " + key + ": nível " + from + " → " + n + " (aprendido antes)", now, false);
          killStreak = 0;
          return result(base, true, dir, lastReason);
        }
      }
    }
    if (a.hold) {


      streak = 0;
      killStreak = 0;
      return result(base, false, "none", "");
    }
    const cost = num(a.costMs, 0);
    const costOk = cost > 0;
    if (costOk) {
      const c = Math.min(cost, TIER_COST_CLAMP_MS);
      costEma = costEma > 0 ? costEma * (1 - TIER_COST_ALPHA) + c * TIER_COST_ALPHA : c;
    }


    if (costOk && cost > killFrameMs) {
      killStreak += 1;
      if (killStreak >= killFrames && level > 0) {
        const drop = Math.min(killDrop, level);
        const from = level;
        level -= drop;
        killStreak = 0;
        commit("down", "kill-switch anti-TDR: " + killFrames + " frames seguidos > " + killFrameMs + " ms — derrubadas " + drop + " prioridade(s) (nível " + from + " → " + level + ")", now, true);
        return result(base, true, "down", lastReason, true);
      }
    } else if (costOk) {
      killStreak = 0;                                          
    }
    const dt = num(a.dtMs, 0);
    const dtOk = dt > 0 && dt <= FRAME_GAP_MS;
    if (!dtOk && !costOk) {
      streak = 0;
      return result(base, false, "none", "");
    }
    const ema = num(a.emaMs, 0);

    const press = Math.max(dtOk && ema > 0 ? ema : 0, costOk ? costEma : 0);
    streak += 1;
    if (streak < 2 || press <= 0) return result(base, false, "none", "");
    const downAt = targetMs * TIER_DOWN_RATIO;
    const upAt = targetMs * TIER_UP_RATIO;
    const panic = press >= targetMs * TIER_PANIC_RATIO;
    if (press > downAt && level > 0 && (panic || now - lastChangeMs >= minHoldMs)) {
      const sold = FEATURE_PRIORITY[level - 1];
      const from = level;
      level -= 1;
      commit("down", "pressão " + r1(press) + " ms > " + r1(downAt) + " ms" + (panic ? " (pânico ≥3×)" : "") + " — vendendo '" + sold + "' (nível " + from + " → " + level + ")", now, false);
      return result(base, true, "down", lastReason);
    }


    const classicOk = dtOk && ema > 0;
    const classicUp = classicOk && press < upAt;


    const cadenceUp =
      upCadenceMs > 0 && dtOk && ema > 0 && ema <= upCadenceMs && costOk && costEma > 0 && costEma < upAt;
    if ((classicUp || cadenceUp) && level < maxLevel && now - lastChangeMs >= upHoldMs) {
      const nextId = FEATURE_PRIORITY[level];
      if (!fitsAt(base, level + 1)) {
        blocked = "'" + nextId + "' não cabe nas " + maxTextures + " texture units (pré-condição dura)";
        return result(base, false, "none", "");
      }
      const nextCost = featureCostMs(nextId, safeLedger());


      const buyPress = classicUp ? press : costEma;
      if (buyPress + nextCost * BUY_SAFETY > targetMs) {
        blocked = "sem folga no ledger para '" + nextId + "': pressão " + r1(buyPress) + " + custo " + r1(nextCost) + "×" + BUY_SAFETY + " > alvo " + targetMs + " ms";
        return result(base, false, "none", "");
      }
      blocked = "";
      const from = level;
      level += 1;
      commit("up", "folga sustentada" + (classicUp ? "" : " (cadência F36)") + ": pressão " + r1(buyPress) + " ms + custo de '" + nextId + "' (" + r1(nextCost) + " ms ×" + BUY_SAFETY + ") cabe no alvo " + targetMs + " ms — comprando (nível " + from + " → " + level + ")", now, false);
      return result(base, true, "up", lastReason);
    }
    return result(base, false, "none", "");
  }


  function getState() {
    return {
      active,
      weakProfile: weak,
      level,
      features: featuresAt(level),
      maxLevel,
      changes,
      killTrips,
      killStreak,
      lastReason,
      blocked,
      sceneKey,
      scenesLearned: sceneMemo.size,
      costEmaMs: r1(costEma),
      targetMs,
      upCadenceMs,
    };
  }

  function reset(n) {
    level = Math.max(0, Math.min(maxLevel, Math.floor(num(n, 0))));
    lastChangeMs = -Infinity;
    streak = 0;
    costEma = 0;
    killStreak = 0;
    blocked = "";
  }

  return { sample, getState, reset };
}
