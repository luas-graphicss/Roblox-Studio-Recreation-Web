export const MAX_SHAKE_STRENGTH = 10;
export const MAX_SHAKE_SPEED = 10;
export const MAX_SHAKE_OBJECTS = 400;
export const MARK_BUCKET_CAPACITY = 30;
export const MARK_REFILL_PER_SECOND = 10;

const limiter = { tokens: MARK_BUCKET_CAPACITY, lastMs: 0 };

export function clampShakeStrength(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_SHAKE_STRENGTH, Math.max(0, n));
}

export function clampShakeSpeed(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_SHAKE_SPEED, Math.max(0, n));
}

function attr(inst, name) {
  try {
    return typeof inst.getAttribute === "function" ? inst.getAttribute(name) : undefined;
  } catch (_) {
    return undefined;
  }
}

export function isWindShakeMarked(inst) {
  return !!inst && attr(inst, "WindShake") === true;
}

function isBasePartLike(inst) {
  return !!inst && typeof inst.hasProperty === "function" &&
    inst.hasProperty("Position") && inst.hasProperty("Size") && inst.hasProperty("Rotation");
}

export function seedFor(inst) {
  const s = String(inst && inst.id != null ? inst.id : "x");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function entryFor(part, fallbackStrength, fallbackSpeed) {
  const st = attr(part, "WindShakeStrength");
  const sp = attr(part, "WindShakeSpeed");
  return {
    part,
    strength: clampShakeStrength(st != null ? st : fallbackStrength),
    speed: clampShakeSpeed(sp != null ? sp : fallbackSpeed),
    seed: seedFor(part),
  };
}

export function collectWindShakeParts(root) {
  if (!root || typeof root.getChildren !== "function") return [];
  const out = [];
  const seen = new Set();
  const stack = [root];
  let guard = 0;
  while (stack.length > 0 && guard < 8000 && out.length < MAX_SHAKE_OBJECTS) {
    guard += 1;
    const node = stack.pop();
    if (!node || typeof node.getChildren !== "function") continue;
    if (node !== root && isWindShakeMarked(node)) {
      if (isBasePartLike(node)) {
        if (!seen.has(node.id)) {
          seen.add(node.id);
          out.push(entryFor(node, 1, 1));
        }
      } else {
        const mSt = attr(node, "WindShakeStrength");
        const mSp = attr(node, "WindShakeSpeed");
        const inner = [{ node: node, st: mSt, sp: mSp }];
        let g2 = 0;
        while (inner.length > 0 && g2 < 4000 && out.length < MAX_SHAKE_OBJECTS) {
          g2 += 1;
          const cur = inner.pop();
          const n2 = cur.node;
          if (!n2 || typeof n2.getChildren !== "function") continue;


          if (n2 !== node && attr(n2, "WindShake") === false) continue;




          let fSt = cur.st;
          let fSp = cur.sp;
          if (n2 !== node && !isBasePartLike(n2)) {
            const oSt = attr(n2, "WindShakeStrength");
            const oSp = attr(n2, "WindShakeSpeed");
            if (oSt != null) fSt = oSt;
            if (oSp != null) fSp = oSp;
          }
          if (isBasePartLike(n2) && !seen.has(n2.id)) {
            seen.add(n2.id);
            out.push(entryFor(n2, fSt != null ? fSt : 1, fSp != null ? fSp : 1));
          }
          for (const k of n2.getChildren()) inner.push({ node: k, st: fSt, sp: fSp });
        }
        continue;
      }
    }
    for (const k of node.getChildren()) stack.push(k);
  }
  return out;
}

export function sampleShake(seed, time, wind, strength, speed) {
  const zero = { ox: 0, oy: 0, oz: 0, rx: 0, rz: 0 };
  if (!wind) return zero;


  if (!Number.isFinite(Number(seed)) || !Number.isFinite(Number(time))) return zero;
  const st = clampShakeStrength(strength);
  const sp = clampShakeSpeed(speed);


  const hx = Number.isFinite(wind.x) ? wind.x : 0;
  const hz = Number.isFinite(wind.z) ? wind.z : 0;
  const hMag = Math.sqrt(hx * hx + hz * hz);


  if (!Number.isFinite(hMag) || hMag < 0.001 || st <= 0) return zero;
  const windScale = Math.min(1, hMag / 40);
  const amp = 0.35 * st * windScale;
  const f = 1.2 * Math.max(0.05, sp);
  const phase = seed * 6.2832;
  const s = Math.sin(time * f + phase);
  const n = Math.sin(time * f * 2.63 + phase * 3.7) * 0.4 + Math.sin(time * f * 0.31 + phase * 1.3) * 0.25;
  const sway = (s + n) / 1.65;
  const dx = hx / hMag;
  const dz = hz / hMag;
  return {
    ox: dx * sway * amp,
    oy: Math.abs(sway) * amp * 0.12,
    oz: dz * sway * amp,
    rx: dz * sway * amp * 0.25,
    rz: -dx * sway * amp * 0.25,
  };
}

export function allowWindShakeMark(nowMs) {
  const t = Number(nowMs) || 0;
  if (limiter.lastMs === 0) limiter.lastMs = t;
  const elapsed = Math.max(0, t - limiter.lastMs) / 1000;
  limiter.tokens = Math.min(MARK_BUCKET_CAPACITY, limiter.tokens + elapsed * MARK_REFILL_PER_SECOND);
  limiter.lastMs = t;
  if (limiter.tokens >= 1) {
    limiter.tokens -= 1;
    return true;
  }
  return false;
}

export function resetWindShakeLimiter() {
  limiter.tokens = MARK_BUCKET_CAPACITY;
  limiter.lastMs = 0;
}
