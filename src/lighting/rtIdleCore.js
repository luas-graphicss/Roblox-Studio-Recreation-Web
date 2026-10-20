export const RT_IDLE_VERSION = "rt-idle-f16";

export const RT_IDLE_DELAY_MS = 300;


export const RT_IDLE_TICK_MS = 5;
export const RT_IDLE_RAYS_MIN = 64;
export const RT_IDLE_RAYS_MAX = 4096;


export const RT_IDLE_MS_PER_RAY_DEFAULT = 0.0025;
export const RT_IDLE_EMA_ALPHA = 0.3;


export const RT_IDLE_MS_PER_RAY_MIN = 0.00001;
export const RT_IDLE_MS_PER_RAY_MAX = 5;

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}


export function rtIdleGate(input) {
  const a = input && typeof input === "object" ? input : {};
  if (a.weak !== true) return { run: true, reason: "perfil-forte", retryInMs: 0 };
  if (a.hidden === true) return { run: false, reason: "hidden", retryInMs: 0 };
  if (a.onBattery === true) return { run: false, reason: "bateria", retryInMs: 0 };
  const idleMs = num(a.idleMs, 0);
  if (!(idleMs >= RT_IDLE_DELAY_MS)) {


    return {
      run: false,
      reason: "aguardando-ocio",
      retryInMs: Math.max(16, RT_IDLE_DELAY_MS - Math.max(0, idleMs) + 16),
    };
  }
  return { run: true, reason: "ocio", retryInMs: 0 };
}


export function rtIdleRaysPerTick(msPerRayEma, budgetMs) {
  const budget = clamp(num(budgetMs, RT_IDLE_TICK_MS), 0.5, 50);
  let perRay = num(msPerRayEma, RT_IDLE_MS_PER_RAY_DEFAULT);
  if (!(perRay > 0)) perRay = RT_IDLE_MS_PER_RAY_DEFAULT;
  perRay = clamp(perRay, RT_IDLE_MS_PER_RAY_MIN, RT_IDLE_MS_PER_RAY_MAX);
  return clamp(Math.floor(budget / perRay), RT_IDLE_RAYS_MIN, RT_IDLE_RAYS_MAX);
}


export function rtIdleMsPerRayStep(prevEma, elapsedMs, rays) {
  let prev = num(prevEma, RT_IDLE_MS_PER_RAY_DEFAULT);
  if (!(prev > 0)) prev = RT_IDLE_MS_PER_RAY_DEFAULT;
  prev = clamp(prev, RT_IDLE_MS_PER_RAY_MIN, RT_IDLE_MS_PER_RAY_MAX);
  const r = num(rays, 0);
  const el = num(elapsedMs, -1);
  if (!(r >= 1) || !(el >= 0)) return prev;
  const measured = clamp(el / r, RT_IDLE_MS_PER_RAY_MIN, RT_IDLE_MS_PER_RAY_MAX);
  return prev + (measured - prev) * RT_IDLE_EMA_ALPHA;
}
