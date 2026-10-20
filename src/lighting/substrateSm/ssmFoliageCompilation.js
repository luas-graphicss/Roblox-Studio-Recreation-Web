import { compileSubstrateSmSlab } from './ssmSlabCompilationCore.js';
import { createSubstrateSmCompiledRecipe } from './ssmCompiledRecipeCore.js';
import { copySubstrateSmImmutableData } from './ssmImmutableData.js';
import { createSubstrateSmLossEntry } from './ssmLossReportCore.js';
import { createSubstrateSmCompilationRefusal } from './ssmValidationCore.js';
import {
  SSM_FOLIAGE_MAXIMUM_PHASE,
  SSM_FOLIAGE_MAXIMUM_WRAP,
  SSM_FOLIAGE_MINIMUM_TRANSMISSION,
  SSM_FOLIAGE_RECIPE_FIELDS,
  SSM_FOLIAGE_REFERENCE_THICKNESS_MILLIMETERS,
  SSM_FOLIAGE_WRAP_REFERENCE_MEAN_FREE_PATH_MILLIMETERS,
} from './ssmFoliageContract.js';

function refuse(node, code, reason) {
  return copySubstrateSmImmutableData({
    ok: false,
    surface: null,
    losses: [],
    refusals: [createSubstrateSmCompilationRefusal(code, node?.path ?? 'root', reason)],
  });
}

function isNonnegativeFinite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function resolveSubstrateSmFoliageTransmittance(meanFreePath, albedo) {
  const raw = meanFreePath.map(value => (value > 0 ? Math.exp(-SSM_FOLIAGE_REFERENCE_THICKNESS_MILLIMETERS / value) : 0));
  const budget = albedo.map(value => Math.max(0, 1 - value));
  const clamped = raw.map((value, channel) => Math.min(value, budget[channel]));
  const budgetLimited = clamped.some((value, channel) => value < raw[channel]);
  const weight = Math.max(...clamped);
  if (weight < SSM_FOLIAGE_MINIMUM_TRANSMISSION) {
    return { weight: 0, tint: [0, 0, 0], budgetLimited };
  }
  return { weight, tint: clamped.map(value => value / weight), budgetLimited };
}

export function resolveSubstrateSmFoliageWrap(meanFreePath) {
  const mean = (meanFreePath[0] + meanFreePath[1] + meanFreePath[2]) / 3;
  return SSM_FOLIAGE_MAXIMUM_WRAP * (1 - Math.exp(-mean / SSM_FOLIAGE_WRAP_REFERENCE_MEAN_FREE_PATH_MILLIMETERS));
}

export function compileSubstrateSmFoliageSlab(node, { profile = 'Lite' } = {}) {
  if (node?.type !== 'bsdf' || node.bsdf !== 'slab' || !node.parameters) {
    return refuse(node, 'slabRequired', 'Foliage compilation requires a resolved F02 slab');
  }
  if (profile !== 'Lite' && profile !== 'Moderate') {
    return refuse(node, 'profileNotResolved', 'An effective Lite or Moderate profile is required');
  }
  const { subsurfaceMeanFreePath, subsurfacePhase } = node.parameters;
  if (!Array.isArray(subsurfaceMeanFreePath) || subsurfaceMeanFreePath.length !== 3 ||
      !subsurfaceMeanFreePath.every(isNonnegativeFinite) ||
      typeof subsurfacePhase !== 'number' || !Number.isFinite(subsurfacePhase) ||
      subsurfacePhase < -1 || subsurfacePhase > 1) {
    return refuse(node, 'invalidFoliageParameters', 'Resolved mean free path must be three nonnegative finite channels and phase must be in [-1, 1]');
  }
  if (subsurfaceMeanFreePath.every(value => value === 0)) return compileSubstrateSmSlab(node);
  const base = compileSubstrateSmSlab({
    ...node,
    parameters: { ...node.parameters, subsurfaceMeanFreePath: [0, 0, 0], subsurfacePhase: 0 },
  });
  if (!base.ok) return base;
  const transmittance = resolveSubstrateSmFoliageTransmittance(subsurfaceMeanFreePath, base.surface.parameters.diffuseReflectance);
  const forwardPhase = profile === 'Moderate' ? Math.min(SSM_FOLIAGE_MAXIMUM_PHASE, Math.max(0, subsurfacePhase)) : 0;
  const surface = {
    family: 'foliage',
    parameters: {
      ...base.surface.parameters,
      [SSM_FOLIAGE_RECIPE_FIELDS.wrap]: resolveSubstrateSmFoliageWrap(subsurfaceMeanFreePath),
      [SSM_FOLIAGE_RECIPE_FIELDS.transmissionWeight]: transmittance.weight,
      [SSM_FOLIAGE_RECIPE_FIELDS.transmissionTint]: transmittance.tint,
      [SSM_FOLIAGE_RECIPE_FIELDS.forwardRoughness]: 1 - forwardPhase,
    },
  };
  const validation = createSubstrateSmCompiledRecipe(surface, profile);
  if (!validation.ok) return copySubstrateSmImmutableData({ ...base, ok: false, surface: null, refusals: validation.refusals });
  const losses = [
    ...base.losses.filter(entry => entry.operation !== 'inactiveSlabFeatures'),
    createSubstrateSmLossEntry({
      sourcePath: node.path,
      operation: 'resolvedFoliageSlab',
      replacement: 'wrapAndThinTransmission',
      reason: `Mean free path is converted with a fixed ${SSM_FOLIAGE_REFERENCE_THICKNESS_MILLIMETERS} mm reference thickness into a bounded thin transmission and a wrap up to ${SSM_FOLIAGE_MAXIMUM_WRAP}; no volumetric transport is performed.`,
      classification: 'fitted',
    }),
  ];
  if (transmittance.budgetLimited) {
    losses.push(createSubstrateSmLossEntry({
      sourcePath: node.path,
      operation: 'foliageTransmissionEnergyBudget',
      replacement: 'transmittanceClampedToOneMinusAlbedo',
      reason: 'Reflected plus transmitted energy per channel is capped at one; the authored mean free path requested more transmission than the albedo leaves available.',
      classification: 'fitted',
    }));
  }
  if (subsurfacePhase < 0) {
    losses.push(createSubstrateSmLossEntry({
      sourcePath: node.path,
      operation: 'foliageBackScatterPhaseDropped',
      replacement: 'isotropicTransmissionShape',
      reason: 'Negative Henyey-Greenstein phase describes back scatter already covered by the front diffuse response; the transmission shape stays isotropic.',
      classification: 'fitted',
    }));
  } else if (subsurfacePhase > 0 && profile !== 'Moderate') {
    losses.push(createSubstrateSmLossEntry({
      sourcePath: node.path,
      operation: 'foliageForwardPhaseRequiresModerate',
      replacement: 'isotropicTransmissionShape',
      reason: 'Lite keeps the transmission shape isotropic; the authored forward phase is retained in the source and applied only under Moderate.',
      classification: 'fitted',
    }));
  }
  return copySubstrateSmImmutableData({ ok: true, surface, losses, refusals: [] });
}
