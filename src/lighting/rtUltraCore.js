export const RT_ULTRA_VERSION = "rt-ultra-20a";


export const RT_ULTRA_TIER = "ultra";


export const RT_AB_RAYS_PER_FRAME = 4096;
export const RT_AB_MIN_TEXELS = 64;
export const RT_AB_MAX_SAMPLES = 16;

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}


export function decideFullResGate(args) {
  const a = args && typeof args === "object" ? args : {};
  if (a.failed === true) return { on: false, reason: "latch-falha" };
  if (a.weak === true) return { on: false, reason: "perfil-fraco" };
  if (a.gpuReady !== true) return { on: false, reason: "webgpu-ausente" };
  if (a.forced === true) return { on: true, reason: "forcado" };
  const tier = typeof a.tier === "string" ? a.tier.toLowerCase() : "";
  if (tier === RT_ULTRA_TIER) return { on: true, reason: "ok" };
  return { on: false, reason: "tier" };
}


export function traceAbChunk(args) {
  const a = args && typeof args === "object" ? args : {};
  const rays = Math.max(1, Math.round(num(a.raysPerFrame, RT_AB_RAYS_PER_FRAME)));
  const samples = clamp(Math.round(num(a.samples, 1)) || 1, 1, RT_AB_MAX_SAMPLES);
  return Math.max(RT_AB_MIN_TEXELS, Math.floor(rays / samples));
}



export function traceAbStep(args) {
  const a = args && typeof args === "object" ? args : {};
  const total = Math.max(0, Math.floor(num(a.total, 0)));
  const cursor = clamp(Math.floor(num(a.cursor, 0)), 0, total);
  const chunk = Math.max(1, Math.floor(num(a.chunk, RT_AB_MIN_TEXELS)));
  const take = Math.min(chunk, total - cursor);
  return { from: cursor, take, done: cursor + take >= total };
}
