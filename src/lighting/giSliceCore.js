import { GI_DIM, sanitizeGiDim } from "./voxelGiCore.js";


export const GI_LEDGER_GATE_MS = 2;

export const GI_WEAK_DIM = 32;

export const GI_WEAK_BASE_MS = 1;
export const GI_WEAK_BONUS_MS = 0.5;


export const GI_WEAK_CAP_MS = 1.5;

export const GI_WEAK_SLACK_MS = 8;

export const GI_STRONG_BUDGET_MS = 5;

function fin(v, d) {
  return Number.isFinite(v) ? v : d;
}

function clamp(v, mn, mx) {
  return v < mn ? mn : v > mx ? mx : v;
}


export const GI_HI_DIM = 96;


export const GI_HI_SKYVIS_SLICE = 3072;
export const GI_HI_PROP_SLICE = GI_HI_DIM * GI_HI_DIM * 4;
export const GI_HI_BAKE_SLICE = GI_HI_DIM * GI_HI_DIM * 8;

export function giSliceProfile(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const weak = o.weak === true;
  const tier = o.tier && typeof o.tier === "string" ? o.tier : "";
  const hiTier = !weak && (tier === "high" || tier === "ultra");
  if (!weak) {
    if (hiTier) {


      const dim = sanitizeGiDim(GI_HI_DIM);
      const dd = dim * dim;
      return Object.freeze({
        weak: false,
        hiTier: true,
        dim,
        boxesPerSlice: 400,


        sunCellsPerSlice: 4500,
        lightCellsPerSlice: 3000,
        skyvisCellsPerSlice: GI_HI_SKYVIS_SLICE,
        propCellsPerSlice: GI_HI_PROP_SLICE,


        bounceCellsPerSlice: dd * 4,
        bakeCellsPerSlice: GI_HI_BAKE_SLICE,
        baseBudgetMs: GI_STRONG_BUDGET_MS,
        bonusBudgetMs: 0,
        capBudgetMs: GI_STRONG_BUDGET_MS,
        slackMs: Infinity,
        hfSkylight: false,
        lateralRays: true,
      });
    }
    return Object.freeze({
      weak: false,
      hiTier: false,
      dim: sanitizeGiDim(fin(o.dim, GI_DIM)),
      boxesPerSlice: 400,
      sunCellsPerSlice: 4000,
      lightCellsPerSlice: 1200,
      skyvisCellsPerSlice: 6000,
      propCellsPerSlice: Infinity,
      bounceCellsPerSlice: Infinity,
      bakeCellsPerSlice: Infinity,
      baseBudgetMs: GI_STRONG_BUDGET_MS,
      bonusBudgetMs: 0,
      capBudgetMs: GI_STRONG_BUDGET_MS,
      slackMs: Infinity,
      hfSkylight: false,
      lateralRays: false,
    });
  }
  const dim = sanitizeGiDim(fin(o.dim, GI_WEAK_DIM));
  const dd = dim * dim;
  return Object.freeze({
    weak: true,
    dim,


    boxesPerSlice: 200,
    sunCellsPerSlice: 2000,
    lightCellsPerSlice: 600,
    skyvisCellsPerSlice: 3000,


    propCellsPerSlice: dd * 8,
    bounceCellsPerSlice: 4000,

    bakeCellsPerSlice: dd * 16,
    baseBudgetMs: GI_WEAK_BASE_MS,
    bonusBudgetMs: GI_WEAK_BONUS_MS,
    capBudgetMs: GI_WEAK_CAP_MS,
    slackMs: GI_WEAK_SLACK_MS,
    hfSkylight: true,


    lateralRays: false,
  });
}


export function giStepBudgetMs(profile, headroomMs) {
  const p = profile && typeof profile === "object" ? profile : null;
  if (!p || p.weak !== true) return GI_STRONG_BUDGET_MS;
  const base = clamp(fin(p.baseBudgetMs, GI_WEAK_BASE_MS), 0.25, GI_LEDGER_GATE_MS);
  const cap = clamp(fin(p.capBudgetMs, base), base, GI_LEDGER_GATE_MS);
  const bonus = Math.max(0, fin(p.bonusBudgetMs, 0));
  const slack = fin(p.slackMs, GI_WEAK_SLACK_MS);
  const h = fin(headroomMs, NaN);
  if (Number.isFinite(h) && h >= slack) return Math.min(cap, base + bonus);
  return base;
}
