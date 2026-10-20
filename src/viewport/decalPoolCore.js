export const DECAL_FACES = {
  Front: { dir: [0, 0, -1], rot: [0, Math.PI, 0], u: "x", v: "y", n: "z" },
  Back: { dir: [0, 0, 1], rot: [0, 0, 0], u: "x", v: "y", n: "z" },
  Right: { dir: [1, 0, 0], rot: [0, Math.PI / 2, 0], u: "z", v: "y", n: "x" },
  Left: { dir: [-1, 0, 0], rot: [0, -Math.PI / 2, 0], u: "z", v: "y", n: "x" },
  Top: { dir: [0, 1, 0], rot: [-Math.PI / 2, 0, 0], u: "x", v: "z", n: "y" },
  Bottom: { dir: [0, -1, 0], rot: [Math.PI / 2, 0, 0], u: "x", v: "z", n: "y" },
};


export const FACE_PUSH = 1.004;


export const MAX_CARRIER_POOLS = 128;
export const MAX_POOL_LAYERS_PER_PART = 6;

function num(v, fallback) {
  return Number.isFinite(v) ? v : fallback;
}


export function isLayersOnly(appearance) {
  if (!appearance || appearance.special || appearance.surface) return false;
  return Array.isArray(appearance.layers) && appearance.layers.length > 0;
}


export function poolableLayers(appearance) {
  if (!isLayersOnly(appearance)) return null;
  const out = [];
  const seenFace = new Set();
  for (const layer of appearance.layers) {
    if (!layer) return null;
    if (num(layer.transparency, 0) >= 1) continue;                          
    if (typeof layer.texture !== "string") return null;                          
    if (!layer.texture) continue;                                            
    const face = DECAL_FACES[layer.face] ? layer.face : "Front";
    if (seenFace.has(face)) return null;                                   
    seenFace.add(face);
    out.push(layer);
    if (out.length > MAX_POOL_LAYERS_PER_PART) return null;
  }
  return out;
}


export function carrierKeyFor(layer) {
  return `${layer.type === "texture" ? "tx" : "dc"}|${layer.texture}`;
}


export function partSignature(layers) {
  let sig = "";
  for (const layer of layers) sig += carrierKeyFor(layer) + "|" + layer.face + "\u0001";
  return sig;
}


export function layerPlacement(layer, size) {
  const f = DECAL_FACES[layer && layer.face] || DECAL_FACES.Front;
  const s = size || { x: 1, y: 1, z: 1 };
  const dimU = Math.max(0.05, num(s[f.u], 1));
  const dimV = Math.max(0.05, num(s[f.v], 1));
  const dimN = Math.max(0.05, num(s[f.n], 1));
  const push = 0.5 * dimN * FACE_PUSH;
  return {
    offset: [f.dir[0] * push, f.dir[1] * push, f.dir[2] * push],
    rot: f.rot,
    scale: [dimU, dimV],
  };
}


export function layerUv(layer, size) {
  if (!layer || layer.type !== "texture") return { repU: 1, repV: 1, offU: 0, offV: 0 };
  const f = DECAL_FACES[layer.face] || DECAL_FACES.Front;
  const s = size || { x: 1, y: 1, z: 1 };
  const dimU = Math.max(0.05, num(s[f.u], 1));
  const dimV = Math.max(0.05, num(s[f.v], 1));
  const su = Math.max(0.05, num(layer.studsPerTileU, 2));
  const sv = Math.max(0.05, num(layer.studsPerTileV, 2));
  return {
    repU: dimU / su,
    repV: dimV / sv,
    offU: -(num(layer.offsetStudsU, 0) / su) % 1,
    offV: -(num(layer.offsetStudsV, 0) / sv) % 1,
  };
}


export function layerTintAlpha(layer) {
  const c = layer && layer.color && typeof layer.color === "object" ? layer.color : null;
  const clamp01 = (v, d) => Math.min(1, Math.max(0, num(v, d)));
  return {
    r: clamp01(c ? c.r : 1, 1),
    g: clamp01(c ? c.g : 1, 1),
    b: clamp01(c ? c.b : 1, 1),
    alpha: 1 - clamp01(layer ? layer.transparency : 0, 0),
  };
}
