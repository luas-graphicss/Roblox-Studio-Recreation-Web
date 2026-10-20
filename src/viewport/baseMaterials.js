import { Enums } from "../datamodel/types.js";


import { LEGACY_NEON_DIFFUSE_BOOST, neonEmissiveGain, neonPoolEmissiveHdrGain, normalizeRenderStyle, particleEmissionBoost } from "../lighting/emissiveNitsCore.js";
import { buildPbrMapsFromRgba, tuningForDef } from "../lighting/proceduralMapsCore.js";

const TILE = 128;


export const MATERIAL_DEFS = Object.freeze({
  Plastic: { cat: "Plastic", pattern: "smooth", brightness: 0.92, noise: 0.02 },
  SmoothPlastic: { cat: "Plastic", pattern: "flat", brightness: 0.96 },
  Neon: { cat: "Plastic", pattern: "flat", brightness: 1.0, neon: true },
  Wood: { cat: "Wood", pattern: "grain", brightness: 0.82 },
  WoodPlanks: { cat: "Wood", pattern: "planks", brightness: 0.8 },
  Marble: { cat: "Stone", pattern: "veins", brightness: 0.93 },
  Slate: { cat: "Stone", pattern: "strata", brightness: 0.72 },
  Concrete: { cat: "Stone", pattern: "speckle", brightness: 0.85, noise: 0.07 },
  Granite: { cat: "Stone", pattern: "speckle", brightness: 0.78, noise: 0.16, dark: true },
  Brick: { cat: "Stone", pattern: "bricks", brightness: 0.8 },
  Pebble: { cat: "Stone", pattern: "cobble", brightness: 0.82, cell: 14 },
  Cobblestone: { cat: "Stone", pattern: "cobble", brightness: 0.78, cell: 26 },
  Rock: { cat: "Stone", pattern: "facets", brightness: 0.72 },
  Sandstone: { cat: "Stone", pattern: "strata", brightness: 0.86, soft: true },
  Basalt: { cat: "Stone", pattern: "facets", brightness: 0.5 },
  CrackedLava: { cat: "Stone", pattern: "cracks", brightness: 0.45, lava: true },
  Limestone: { cat: "Stone", pattern: "speckle", brightness: 0.9, noise: 0.05 },
  Pavement: { cat: "Stone", pattern: "tiles", brightness: 0.8 },
  CorrodedMetal: { cat: "Metal", pattern: "rust", brightness: 0.65, metal: true },
  DiamondPlate: { cat: "Metal", pattern: "diamond", brightness: 0.85, metal: true },
  Foil: { cat: "Metal", pattern: "foil", brightness: 0.95, metal: true },
  Metal: { cat: "Metal", pattern: "brushed", brightness: 0.88, metal: true },
  Grass: { cat: "Organic", pattern: "blades", brightness: 0.78 },
  Sand: { cat: "Organic", pattern: "speckle", brightness: 0.9, noise: 0.06 },
  Fabric: { cat: "Fabric", pattern: "weave", brightness: 0.84 },
  Glass: { cat: "Glass", pattern: "glass", brightness: 0.97, opacity: 0.45 },
  Ice: { cat: "Glass", pattern: "icy", brightness: 0.95, opacity: 0.85 },
  Mud: { cat: "Organic", pattern: "blotch", brightness: 0.55 },
  Ground: { cat: "Organic", pattern: "blotch", brightness: 0.72, soft: true },
  Asphalt: { cat: "Stone", pattern: "speckle", brightness: 0.55, noise: 0.1 },
  Snow: { cat: "Organic", pattern: "speckle", brightness: 0.98, noise: 0.025 },
  Glacier: { cat: "Glass", pattern: "icy", brightness: 0.93, opacity: 0.95 },
  Salt: { cat: "Organic", pattern: "speckle", brightness: 0.96, noise: 0.04 },
  Cardboard: { cat: "Fabric", pattern: "fibers", brightness: 0.82 },
  Carpet: { cat: "Fabric", pattern: "weave", brightness: 0.8, noise: 0.12 },
  Plaster: { cat: "Stone", pattern: "speckle", brightness: 0.92, noise: 0.045 },
  Rubber: { cat: "Plastic", pattern: "flat", brightness: 0.62 },
  Leather: { cat: "Fabric", pattern: "creases", brightness: 0.75 },
});

export const MATERIAL_CATEGORIES = Object.freeze([
  "All", "Plastic", "Wood", "Stone", "Metal", "Organic", "Fabric", "Glass",
]);


export function listBaseMaterials() {
  return Enums.Material.filter((m) => !!MATERIAL_DEFS[m]);
}

export function getMaterialDef(name) {
  return MATERIAL_DEFS[name] || MATERIAL_DEFS.Plastic;
}


export const NEON_EMISSIVE_GAIN = 0.8;


const NEON_GAIN_UNIFORM = { value: NEON_EMISSIVE_GAIN };




const NEON_POOL_HDR_UNIFORM = { value: neonPoolEmissiveHdrGain("Classic") };       





















export function patchNeonHdrChained(mat, onUniform, keyTag) {
  if (!mat) return null;
  if (!mat.userData) mat.userData = {};
  if (mat.userData.__rswNeonHdrOn) return mat.userData.__rswNeonHdrOn;
  const gate = onUniform && typeof onUniform === "object" ? onUniform : { value: 1 };
  const hadOwnCompile = Object.prototype.hasOwnProperty.call(mat, "onBeforeCompile");
  const prevCompile = hadOwnCompile ? mat.onBeforeCompile : null;
  const hadOwnKey = Object.prototype.hasOwnProperty.call(mat, "customProgramCacheKey");
  const prevKey = hadOwnKey ? mat.customProgramCacheKey : null;
  const tag = typeof keyTag === "string" && keyTag ? keyTag : "rswNeonHdrC1";
  mat.onBeforeCompile = function (shader, rendererArg) {
    if (typeof prevCompile === "function") prevCompile.call(this, shader, rendererArg);
    try {
      if (shader && typeof shader.fragmentShader === "string" && shader.fragmentShader.indexOf("uRswNeonPoolHdr") === -1) {
        applyNeonPoolHdrPatch(shader, gate);
      }
    } catch (_e) {                                                     }
  };
  mat.customProgramCacheKey = function () {
    const base = typeof prevKey === "function" ? String(prevKey.call(this)) : "";
    return base + "|" + tag;
  };
  mat.userData.__rswNeonHdrOn = gate;
  mat.needsUpdate = true;
  return gate;
}

export function applyNeonPoolHdrPatch(shader, onUniform) {
  shader.uniforms.uRswNeonPoolHdr = NEON_POOL_HDR_UNIFORM;
  shader.uniforms.uRswNeonPoolOn  = onUniform || { value: 1 };
  const decl = "uniform float uRswNeonPoolHdr;\nuniform float uRswNeonPoolOn;\n";
  shader.fragmentShader = decl + shader.fragmentShader;
  if (shader.fragmentShader.includes("#include <emissivemap_fragment>")) {
    const boost = LEGACY_NEON_DIFFUSE_BOOST.toFixed(1);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * (uRswNeonPoolHdr * ${boost} * uRswNeonPoolOn);`
    );
  } else {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `outgoingLight += diffuseColor.rgb * (uRswNeonPoolHdr * uRswNeonPoolOn);\n\t#include <opaque_fragment>`
    );
  }
}


const neonMaterials = new Set();

function registerNeonMaterial(mat) {
  neonMaterials.add(mat);
  if (typeof mat.addEventListener === "function" && !mat.userData.__rswNeonDisposeHook) {
    mat.userData.__rswNeonDisposeHook = true;
    mat.addEventListener("dispose", () => neonMaterials.delete(mat));
  }
}

export function applyNeonEmissivePatch(shader) {

  shader.uniforms.uRswNeonGain = NEON_GAIN_UNIFORM;
  shader.fragmentShader = ("uniform float uRswNeonGain;\n" + shader.fragmentShader).replace(
    "#include <emissivemap_fragment>",
    "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * uRswNeonGain;",
  );
}


export function syncNeonEmissive(mat, r, g, b, neon) {
  if (!mat) return;
  if (!mat.userData) mat.userData = {};
  const hasChannel = !!(mat.emissive && typeof mat.emissive.setRGB === "function");
  if (neon) {


    const gain = NEON_GAIN_UNIFORM.value;
    const er = r * gain;
    const eg = g * gain;
    const eb = b * gain;
    mat.userData.__rswNeonBase = [r, g, b];
    mat.userData.__rswNeonEmissive = [er, eg, eb];
    registerNeonMaterial(mat);
    if (hasChannel) mat.emissive.setRGB(er, eg, eb);
  } else if (mat.userData.__rswNeonEmissive) {
    delete mat.userData.__rswNeonEmissive;
    delete mat.userData.__rswNeonBase;
    neonMaterials.delete(mat);
    if (hasChannel) mat.emissive.setRGB(0, 0, 0);
  }
}


let currentEmissiveStyle = "Classic";

export function setEmissiveRenderStyle(styleRaw) {
  const style = normalizeRenderStyle(styleRaw);
  if (style === currentEmissiveStyle) return style;
  currentEmissiveStyle = style;
  NEON_GAIN_UNIFORM.value = neonEmissiveGain(style);


  NEON_POOL_HDR_UNIFORM.value = neonPoolEmissiveHdrGain(style);


  for (const mat of Array.from(neonMaterials)) {
    const base = mat && mat.userData ? mat.userData.__rswNeonBase : null;
    if (!Array.isArray(base)) { neonMaterials.delete(mat); continue; }
    syncNeonEmissive(mat, base[0], base[1], base[2], true);
  }
  return style;
}

export function getEmissiveRenderStyle() { return currentEmissiveStyle; }


export function getEmissiveHdrState() {
  return {
    style: currentEmissiveStyle,
    neonGain: NEON_GAIN_UNIFORM.value,


    particleBoostFull: particleEmissionBoost(1, currentEmissiveStyle),
    neonMaterialCount: neonMaterials.size,


    neonPoolHdr: NEON_POOL_HDR_UNIFORM.value,
  };
}


console.assert(
  neonPoolEmissiveHdrGain("Classic") === 0,
  "IL-F38: pool HDR Classic !== 0 — paridade byte a byte dos pools complexos quebrada",
);


console.assert(
  neonEmissiveGain("Classic") === NEON_EMISSIVE_GAIN,
  "IL-F13: neonEmissiveGain('Classic') difere de NEON_EMISSIVE_GAIN — paridade Classic quebrada",
);


export const MATERIAL_STATE_UD_KEYS = Object.freeze(["__rswNeonEmissive", "__rswNeonBase", "__rswMatName", "__rswSubstrateSource", "__rswSbAuthoringError", "sbAuthoredTree"]);




export function transferMaterialState(src, next) {
  if (!src || !next) return next;
  if (next.color && src.color && typeof next.color.copy === "function") next.color.copy(src.color);
  next.transparent = src.transparent;
  next.opacity = src.opacity;
  if (src.side !== undefined) next.side = src.side;
  next.vertexColors = !!src.vertexColors;
  next.visible = src.visible;
  if (src.map) next.map = src.map;
  if (!next.userData) next.userData = {};
  const ud = src.userData || {};
  for (const key of MATERIAL_STATE_UD_KEYS) {
    if (ud[key] !== undefined) next.userData[key] = ud[key];
  }
  if (next.emissive && typeof next.emissive.setRGB === "function") {
    const e = next.userData.__rswNeonEmissive;
    if (Array.isArray(e)) next.emissive.setRGB(e[0], e[1], e[2]);
    else if (src.emissive && typeof next.emissive.copy === "function") next.emissive.copy(src.emissive);
  }


  if (Array.isArray(next.userData.__rswNeonEmissive)) registerNeonMaterial(next);
  return next;
}


function makeRng(seedStr) {
  let seed = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    seed ^= seedStr.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  seed = (seed >>> 0) || 1;
  return () => {
    seed = (Math.imul(seed, 48271) % 2147483647 + 2147483647) % 2147483647 || 1;
    return seed / 2147483647;
  };
}

function gray(v) {
  const n = Math.max(0, Math.min(255, Math.round(v * 255)));
  return `rgb(${n},${n},${n})`;
}


const PATTERNS = {
  flat(ctx, b) {
    ctx.fillStyle = gray(b);
    ctx.fillRect(0, 0, TILE, TILE);
  },
  smooth(ctx, b, def, rnd) {
    PATTERNS.flat(ctx, b);
    speckleNoise(ctx, rnd, def.noise || 0.02, b);
  },
  speckle(ctx, b, def, rnd) {
    PATTERNS.flat(ctx, b);
    speckleNoise(ctx, rnd, def.noise || 0.08, b);
    if (def.dark) {

      for (let i = 0; i < 320; i++) {
        ctx.fillStyle = gray(b * (0.45 + rnd() * 0.3));
        ctx.fillRect(rnd() * TILE, rnd() * TILE, 1 + rnd() * 2, 1 + rnd() * 2);
      }
    }
  },
  grain(ctx, b, def, rnd) {
    PATTERNS.flat(ctx, b);

    for (let y = 0; y < TILE; y += 2) {
      const w = 0.85 + 0.15 * Math.sin(y * 0.45 + rnd() * 0.6);
      ctx.fillStyle = gray(b * w);
      ctx.globalAlpha = 0.5;
      ctx.fillRect(0, y, TILE, 1);
      ctx.globalAlpha = 1;
    }
    for (let i = 0; i < 9; i++) {
      ctx.strokeStyle = gray(b * 0.62);
      ctx.globalAlpha = 0.5;
      const y = rnd() * TILE;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(TILE / 3, y + rnd() * 8 - 4, (2 * TILE) / 3, y - rnd() * 8 + 4, TILE, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  },
  planks(ctx, b, def, rnd) {
    PATTERNS.grain(ctx, b, def, rnd);
    ctx.fillStyle = gray(b * 0.45);
    for (let i = 0; i < 4; i++) ctx.fillRect(0, i * 32, TILE, 2);

    for (let i = 0; i < 4; i++) {
      const x = ((i * 53) % TILE + (i % 2 ? 24 : 64)) % TILE;
      ctx.fillRect(x, i * 32, 2, 32);
    }
  },
  bricks(ctx, b, def, rnd) {
    PATTERNS.flat(ctx, b);
    speckleNoise(ctx, rnd, 0.05, b);
    ctx.fillStyle = gray(b * 0.55);
    const BH = 16, BW = 32;
    for (let row = 0; row < TILE / BH; row++) {
      ctx.fillRect(0, row * BH, TILE, 2);
      const off = row % 2 ? BW / 2 : 0;
      for (let x = -1; x < TILE / BW + 1; x++) {
        ctx.fillRect(((x * BW + off) % TILE + TILE) % TILE, row * BH, 2, BH);
      }
    }
  },
  cobble(ctx, b, def, rnd) {
    PATTERNS.flat(ctx, b * 0.7);
    const cell = def.cell || 22;
    for (let cy = 0; cy <= TILE; cy += cell) {
      for (let cx = 0; cx <= TILE; cx += cell) {
        const r = cell * (0.34 + rnd() * 0.1);
        const x = (cx + cell / 2 + (rnd() - 0.5) * 4) % TILE;
        const y = (cy + cell / 2 + (rnd() - 0.5) * 4) % TILE;
        const v = b * (0.85 + rnd() * 0.25);

        for (const dx of [0, TILE, -TILE]) {
          for (const dy of [0, TILE, -TILE]) {
            const g2 = ctx.createRadialGradient(x + dx - r / 3, y + dy - r / 3, r / 4, x + dx, y + dy, r);
            g2.addColorStop(0, gray(Math.min(1, v * 1.12)));
            g2.addColorStop(1, gray(v * 0.7));
            ctx.fillStyle = g2;
            ctx.beginPath();
            ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
  },
  facets(ctx, b, def, rnd) {
    PATTERNS.flat(ctx, b);
    for (let i = 0; i < 46; i++) {
      const x = rnd() * TILE, y = rnd() * TILE, s = 8 + rnd() * 22;
      ctx.fillStyle = gray(b * (0.7 + rnd() * 0.55));
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + s, y + rnd() * s - s / 2);
      ctx.lineTo(x + rnd() * s - s / 2, y + s);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    speckleNoise(ctx, rnd, 0.05, b);
  },
  strata(ctx, b, def, rnd) {
    PATTERNS.flat(ctx, b);
    const soft = def.soft ? 0.12 : 0.3;
    for (let y = 0; y < TILE; y += 8) {
      ctx.fillStyle = gray(b * (1 - soft * rnd()));
      ctx.fillRect(0, y, TILE, 4 + rnd() * 4);
    }
    speckleNoise(ctx, rnd, 0.04, b);
  },
  veins(ctx, b, def, rnd) {
    PATTERNS.flat(ctx, b);
    ctx.strokeStyle = gray(b * 0.7);
    for (let i = 0; i < 7; i++) {
      ctx.globalAlpha = 0.4 + rnd() * 0.3;
      ctx.lineWidth = 0.6 + rnd() * 1.2;
      const y0 = rnd() * TILE;
      ctx.beginPath();
      ctx.moveTo(0, y0);
      let x = 0, y = y0;
      while (x < TILE) {
        x += 8 + rnd() * 18;
        y += (rnd() - 0.5) * 26;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },
  cracks(ctx, b, def, rnd) {


    ctx.fillStyle = "rgb(46,38,36)";
    ctx.fillRect(0, 0, TILE, TILE);
    speckleNoise(ctx, rnd, 0.05, 0.2);
    ctx.strokeStyle = "rgb(255,150,40)";
    for (let i = 0; i < 9; i++) {
      ctx.lineWidth = 1 + rnd() * 2;
      ctx.globalAlpha = 0.85;
      let x = rnd() * TILE, y = rnd() * TILE;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < 6; s++) {
        x += (rnd() - 0.5) * 44;
        y += (rnd() - 0.5) * 44;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },
  tiles(ctx, b, def, rnd) {
    PATTERNS.flat(ctx, b);
    speckleNoise(ctx, rnd, 0.06, b);
    ctx.fillStyle = gray(b * 0.6);
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(0, i * 32, TILE, 2);
      ctx.fillRect(i * 32, 0, 2, TILE);
    }
  },
  diamond(ctx, b, def, rnd) {
    PATTERNS.flat(ctx, b);

    for (let cy = 0; cy < TILE; cy += 16) {
      for (let cx = 0; cx < TILE; cx += 16) {
        const x = cx + 8, y = cy + 8 + (cx % 32 ? 4 : 0);
        ctx.fillStyle = gray(Math.min(1, b * 1.18));
        ctx.beginPath();
        ctx.ellipse(x, y % TILE, 5.5, 2.6, Math.PI / 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = gray(b * 0.7);
        ctx.beginPath();
        ctx.ellipse(x + 1.4, (y + 1.4) % TILE, 5.5, 2.2, Math.PI / 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },
  brushed(ctx, b, def, rnd) {
    PATTERNS.flat(ctx, b);
    for (let y = 0; y < TILE; y++) {
      ctx.fillStyle = gray(b * (0.92 + rnd() * 0.14));
      ctx.globalAlpha = 0.45;
      ctx.fillRect(0, y, TILE, 1);
      ctx.globalAlpha = 1;
    }

    const g2 = ctx.createLinearGradient(0, 0, TILE, TILE);
    g2.addColorStop(0, "rgba(255,255,255,0)");
    g2.addColorStop(0.5, "rgba(255,255,255,0.22)");
    g2.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, TILE, TILE);
  },
  foil(ctx, b, def, rnd) {
    PATTERNS.flat(ctx, b);
    for (let i = 0; i < 30; i++) {
      const x = rnd() * TILE, y = rnd() * TILE, s = 10 + rnd() * 26;
      ctx.fillStyle = gray(b * (0.82 + rnd() * 0.3));
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + s, y + (rnd() - 0.5) * 10);
      ctx.lineTo(x + s * 0.6, y + s * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  },
  rust(ctx, b, def, rnd) {
    PATTERNS.brushed(ctx, b, def, rnd);
    for (let i = 0; i < 34; i++) {
      const x = rnd() * TILE, y = rnd() * TILE, r = 3 + rnd() * 12;
      const g2 = ctx.createRadialGradient(x, y, 0, x, y, r);
      g2.addColorStop(0, "rgba(96,52,26,0.85)");
      g2.addColorStop(1, "rgba(96,52,26,0)");
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  blades(ctx, b, def, rnd) {
    PATTERNS.flat(ctx, b * 0.85);
    for (let i = 0; i < 900; i++) {
      const x = rnd() * TILE, y = rnd() * TILE;
      ctx.strokeStyle = gray(b * (0.65 + rnd() * 0.6));
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rnd() - 0.5) * 2, y - 3 - rnd() * 4);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  },
  weave(ctx, b, def, rnd) {
    PATTERNS.flat(ctx, b);
    for (let y = 0; y < TILE; y += 4) {
      for (let x = 0; x < TILE; x += 4) {
        const over = ((x + y) / 4) % 2 === 0;
        ctx.fillStyle = gray(b * (over ? 1.05 : 0.8));
        ctx.fillRect(x, y, 4, 4);
      }
    }
    speckleNoise(ctx, rnd, def.noise || 0.05, b);
  },
  fibers(ctx, b, def, rnd) {
    PATTERNS.flat(ctx, b);
    for (let y = 0; y < TILE; y += 3) {
      ctx.fillStyle = gray(b * (0.88 + rnd() * 0.16));
      ctx.globalAlpha = 0.6;
      ctx.fillRect(0, y, TILE, 1);
      ctx.globalAlpha = 1;
    }
  },
  creases(ctx, b, def, rnd) {
    PATTERNS.flat(ctx, b);
    speckleNoise(ctx, rnd, 0.06, b);
    ctx.strokeStyle = gray(b * 0.6);
    for (let i = 0; i < 16; i++) {
      ctx.globalAlpha = 0.35;
      let x = rnd() * TILE, y = rnd() * TILE;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < 4; s++) {
        x += (rnd() - 0.5) * 30;
        y += (rnd() - 0.5) * 30;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  },
  blotch(ctx, b, def, rnd) {
    PATTERNS.flat(ctx, b);
    for (let i = 0; i < 40; i++) {
      const x = rnd() * TILE, y = rnd() * TILE, r = 4 + rnd() * 16;
      const v = b * (def.soft ? 0.82 + rnd() * 0.3 : 0.6 + rnd() * 0.5);
      const g2 = ctx.createRadialGradient(x, y, 0, x, y, r);
      g2.addColorStop(0, gray(v));
      g2.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    speckleNoise(ctx, rnd, 0.05, b);
  },
  glass(ctx, b) {
    const g2 = ctx.createLinearGradient(0, 0, TILE, TILE);
    g2.addColorStop(0, gray(b));
    g2.addColorStop(0.5, gray(Math.min(1, b * 1.06)));
    g2.addColorStop(1, gray(b * 0.94));
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, TILE, TILE);

    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath();
    ctx.moveTo(0, TILE * 0.2);
    ctx.lineTo(TILE * 0.35, 0);
    ctx.lineTo(TILE * 0.5, 0);
    ctx.lineTo(0, TILE * 0.5);
    ctx.closePath();
    ctx.fill();
  },
  icy(ctx, b, def, rnd) {
    PATTERNS.glass(ctx, b);
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    for (let i = 0; i < 10; i++) {
      ctx.lineWidth = 0.6 + rnd();
      let x = rnd() * TILE, y = rnd() * TILE;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < 3; s++) {
        x += (rnd() - 0.5) * 40;
        y += (rnd() - 0.5) * 40;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  },
};

function speckleNoise(ctx, rnd, amount, base) {
  const count = Math.floor(TILE * TILE * Math.min(0.25, amount) * 0.6);
  for (let i = 0; i < count; i++) {
    const v = base * (0.75 + rnd() * 0.5);
    ctx.fillStyle = gray(v);
    ctx.globalAlpha = 0.6;
    ctx.fillRect(Math.floor(rnd() * TILE), Math.floor(rnd() * TILE), 1, 1);
    ctx.globalAlpha = 1;
  }
}


const canvasCache = new Map();                    
const thumbCache = new Map();                    

export function materialCanvas(name, use2022 = true) {
  const key = `${name}|${use2022 ? "2022" : "classic"}`;
  const hit = canvasCache.get(key);
  if (hit) return hit;
  if (typeof document === "undefined") return null;
  const def = getMaterialDef(name);
  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext("2d");
  const rnd = makeRng(name);
  const painter = PATTERNS[def.pattern] || PATTERNS.flat;
  painter(ctx, def.brightness, def, rnd);

  if (!use2022) {
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = gray(def.brightness);
    ctx.fillRect(0, 0, TILE, TILE);
    ctx.globalAlpha = 1;
  }
  canvasCache.set(key, canvas);
  return canvas;
}


export function materialThumbDataUri(name, size = 72) {
  const key = `${name}|${size}`;
  const hit = thumbCache.get(key);
  if (hit) return hit;
  if (typeof document === "undefined") return "";
  const tile = materialCanvas(name, true);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  ctx.drawImage(tile, 0, 0, size, size);

  const r = size * 0.34, cx = size / 2, cy = size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(tile, size * 0.18, size * 0.18, size * 0.64, size * 0.64);
  const sh = ctx.createRadialGradient(cx - r / 2.4, cy - r / 2.4, r / 6, cx, cy, r * 1.15);
  sh.addColorStop(0, "rgba(255,255,255,0.5)");
  sh.addColorStop(0.55, "rgba(255,255,255,0)");
  sh.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = sh;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  let uri = "";
  try {
    uri = canvas.toDataURL("image/png");
  } catch (_) {
    uri = "";
  }
  thumbCache.set(key, uri);
  return uri;
}


export function pbrMapsEnabled() {
  try {
    return globalThis.__rswPbrMaps === true;
  } catch (_) {
    return false;
  }
}


const pbrMapsCache = new Map();                                                  
let pbrMapsTotalMs = 0;

export function materialPbrMaps(name, use2022 = true) {
  const key = `${name}|${use2022 ? "2022" : "classic"}`;
  const hit = pbrMapsCache.get(key);
  if (hit) return hit;
  const tile = materialCanvas(name, use2022);
  if (!tile) return null;                                           
  const now = () =>
    typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  const t0 = now();
  const rgba = tile.getContext("2d").getImageData(0, 0, TILE, TILE).data;
  const params = tuningForDef(getMaterialDef(name));
  const maps = buildPbrMapsFromRgba(rgba, TILE, TILE, params);
  const rec = Object.freeze({
    normal: canvasFromRgba(maps.normalRgba),
    orm: canvasFromRgba(maps.ormRgba),
    params,
    ms: now() - t0,
  });
  pbrMapsTotalMs += rec.ms;
  pbrMapsCache.set(key, rec);
  return rec;
}


export function pbrMapsStats() {
  return { entries: pbrMapsCache.size, totalMs: pbrMapsTotalMs };
}

function canvasFromRgba(bytes) {
  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(TILE, TILE);
  img.data.set(bytes);
  ctx.putImageData(img, 0, 0);
  return canvas;
}
