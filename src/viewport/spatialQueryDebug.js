const MAX_ENTRIES = 256;
const TTL_MS = 1500;

let enabled = false;
const entries = [];

export function setSpatialDebugEnabled(on) {
  const next = !!on;
  if (next === enabled) return;
  enabled = next;
  if (!enabled) entries.length = 0;
}

export function isSpatialDebugEnabled() {
  return enabled;
}

function now() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

function vec(v) {
  if (!v || typeof v !== "object") return null;
  const x = Number(v.x);
  const y = Number(v.y);
  const z = Number(v.z);
  if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return null;
  return { x, y, z };
}

function push(entry) {
  entry.t = now();
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

export function recordCast(kind, origin, direction, extra, hit) {
  if (!enabled) return;
  const o = vec(origin);
  const d = vec(direction);
  const hp = hit ? vec(hit.position) : null;
  if (!o && !d && !hp) return;
  push({
    type: "cast",
    kind,
    origin: o,
    direction: d,
    size: extra && extra.size ? vec(extra.size) : null,
    radius: extra && typeof extra.radius === "number" && isFinite(extra.radius) ? extra.radius : null,
    hit: hp ? { position: hp } : null,
  });
}

export function recordOverlap(kind, center, extra, hitCenters) {
  if (!enabled) return;
  push({
    type: "overlap",
    kind,
    center: vec(center),
    size: extra && extra.size ? vec(extra.size) : null,
    radius: extra && typeof extra.radius === "number" && isFinite(extra.radius) ? extra.radius : null,
    hits: Array.isArray(hitCenters) ? hitCenters.map(vec).filter(Boolean) : [],
  });
}

export function getSpatialQueryDebugSnapshot() {
  if (!enabled) return [];
  const cutoff = now() - TTL_MS;
  const out = [];
  for (const e of entries) {
    if (e.t >= cutoff) out.push(e);
  }
  return out;
}
