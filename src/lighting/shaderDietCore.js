export const DIET_GATES = Object.freeze({
  frameReductionMin: 0.15,
  frameReductionMax: 0.25,
  ssimMin: 0.98,
});


export const DIET_SIGNALS = Object.freeze(["mask", "color", "depth"]);


export function dietProfile(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  let active;
  if (o.flag === false) active = false;
  else if (o.flag === true) active = true;
  else active = !!o.weak;
  return Object.freeze({
    active,


    maskPrecision: active ? "mediump" : "highp",
    depthPrecision: "highp",                                       

    rtMaskFormat: active ? "byte" : "half",
    anisotropy: 1,
    generateMipmaps: false,
  });
}


export function precisionForSignal(signal, profile) {
  const p = profile && typeof profile === "object" ? profile : dietProfile({});
  if (signal === "depth") return "highp";
  if (signal === "mask" || signal === "color") {
    return p.maskPrecision === "mediump" ? "mediump" : "highp";
  }
  return "highp";
}


export function maskPrecisionHeader(profile) {
  return "#define RSW_DIET_MP " + precisionForSignal("mask", profile);
}


export function maskRtOptions(profile) {
  const p = profile && typeof profile === "object" ? profile : dietProfile({});
  return {
    type: p.active ? "byte" : "half",
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  };
}


export function applyTextureBudget(tex, profile) {
  const out = { changedAniso: false, changedMips: false };
  if (!tex || typeof tex !== "object") return out;
  const p = profile && typeof profile === "object" ? profile : dietProfile({});
  if (!p.active) return out;
  if (typeof tex.anisotropy === "number" && tex.anisotropy > 1) {
    tex.anisotropy = 1;
    out.changedAniso = true;
  }
  if (tex.generateMipmaps === true) {
    tex.generateMipmaps = false;
    out.changedMips = true;
  }
  return out;
}


export function createRebindAudit() {
  const last = new Map();                                                   
  let binds = 0;
  let redundant = 0;
  const byKind = new Map();                                
  let frames = 0;

  function note(kind, key, id) {
    if (typeof kind !== "string" || kind.length === 0) return;
    const k = kind + (key === undefined || key === null ? "" : ":" + String(key));
    binds++;
    let kk = byKind.get(kind);
    if (!kk) {
      kk = { binds: 0, redundant: 0 };
      byKind.set(kind, kk);
    }
    kk.binds++;


    if (last.has(k) && last.get(k) === id) {
      redundant++;
      kk.redundant++;
    }
    last.set(k, id);
  }

  function endFrame() {
    frames++;
  }

  function get() {
    const kinds = {};
    for (const [kind, v] of byKind) kinds[kind] = { binds: v.binds, redundant: v.redundant };
    const f = Math.max(1, frames);
    return {
      frames,
      binds,
      redundant,
      bindsPerFrame: Math.round((binds / f) * 10) / 10,
      redundantPerFrame: Math.round((redundant / f) * 10) / 10,
      kinds,
    };
  }

  function reset() {
    last.clear();
    byKind.clear();
    binds = 0;
    redundant = 0;
    frames = 0;
  }

  return { note, endFrame, get, reset };
}
