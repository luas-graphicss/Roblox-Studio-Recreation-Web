import {
  SSM_CONTRACT_VERSION, SSM_FAMILY_CONTRACTS, SSM_HOST_PATH_MATRIX,
  SSM_QUALITY_NAMES, SSM_RECIPE_VERSION, SSM_REFUSAL_CODES,
  SSM_RELEASE_DEFAULTS, SSM_THREE_REVISION,
} from './ssmContract.js';
import { validateSubstrateSmCapabilities } from './ssmCapabilityCore.js';
import { evaluateSubstrateSmResourceBudget } from './ssmResourceBudgetCore.js';
import { resolveSubstrateSmOwnership } from './ssmOwnershipCore.js';

function validRevision(revision) {
  return (typeof revision === 'string' && revision.length > 0)
    || (Number.isSafeInteger(revision) && revision >= 0);
}

function previousBackend(settings) {
  return settings.safeMode === false && settings.contextAvailable === true
    && settings.technology === 'Future' && settings.futureBackendEligible === true
    ? 'substrateFuture' : 'legacy';
}

function routingResult(settings, details) {
  const backend = details.ready === true ? 'substrateSm' : previousBackend(settings);
  return Object.freeze({
    contractVersion: SSM_CONTRACT_VERSION,
    backend,
    targetBackend: details.eligible === true ? 'substrateSm' : backend,
    eligible: false,
    ready: false,
    applied: false,
    state: 'fallback',
    requestedQuality: typeof settings.quality === 'string' ? settings.quality : settings.quality == null ? 'Auto' : null,
    contextGeneration: Number.isSafeInteger(settings.contextGeneration) && settings.contextGeneration >= 0 ? settings.contextGeneration : null,
    sourceRevision: validRevision(settings.sourceRevision) ? settings.sourceRevision : null,
    materialPath: typeof settings.materialPath === 'string' ? settings.materialPath : null,
    decisionType: 'routing-plan',
    effectiveQuality: null,
    family: null,
    downgraded: false,
    attempts: Object.freeze([]),
    ownership: resolveSubstrateSmOwnership(backend),
    ...details,
  });
}

function refuseRoute(settings, code, field) {
  return routingResult(settings, { code, field });
}

function materialGate(settings) {
  const path = typeof settings.materialPath === 'string' && Object.hasOwn(SSM_HOST_PATH_MATRIX, settings.materialPath)
    ? SSM_HOST_PATH_MATRIX[settings.materialPath] : null;
  if (!path?.eligible) return { code: SSM_REFUSAL_CODES.hostPathUnsupported, field: 'materialPath' };
  if (settings.hostPathReady !== true || settings.threeRevision !== SSM_THREE_REVISION) {
    return { code: SSM_REFUSAL_CODES.hostAdapterUnavailable, field: 'hostPathReady/threeRevision' };
  }
  if (settings.materialDomain !== 'surface') return { code: SSM_REFUSAL_CODES.domainDelegated, field: 'materialDomain' };
  if (settings.blendMode !== 'opaque' && settings.blendMode !== 'alphaTest') {
    return { code: SSM_REFUSAL_CODES.blendModeDelegated, field: 'blendMode' };
  }
  return null;
}

function examineCandidate(settings, profile, candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { ok: false, code: SSM_REFUSAL_CODES.candidateUnavailable, field: profile };
  }
  const recipe = candidate.recipe;
  if (!recipe || recipe.version !== SSM_RECIPE_VERSION || recipe.profile !== profile) {
    return { ok: false, code: SSM_REFUSAL_CODES.candidateUnavailable, field: profile + '.recipe' };
  }
  if (candidate.contextGeneration !== settings.contextGeneration) {
    return { ok: false, code: SSM_REFUSAL_CODES.contextGenerationMismatch, field: profile + '.contextGeneration' };
  }
  if (candidate.sourceRevision !== settings.sourceRevision) {
    return { ok: false, code: SSM_REFUSAL_CODES.sourceRevisionMismatch, field: profile + '.sourceRevision' };
  }
  if (typeof recipe.family !== 'string' || !Object.hasOwn(SSM_FAMILY_CONTRACTS, recipe.family)) {
    return { ok: false, code: SSM_REFUSAL_CODES.familyUnsupported, field: 'family' };
  }
  if (SSM_FAMILY_CONTRACTS[recipe.family].requiresTangent && settings.tangentValid !== true) {
    return { ok: false, code: SSM_REFUSAL_CODES.tangentUnavailable, field: 'tangentValid' };
  }
  const budget = evaluateSubstrateSmResourceBudget({
    profile, family: recipe.family, capabilities: settings.capabilities,
    contextGeneration: settings.contextGeneration, hostUsage: settings.hostUsage, ssmUsage: candidate.usage,
  });
  if (!budget.ok) return { ok: false, code: budget.code, field: budget.field, budget };
  const ready = candidate.compiled === true && candidate.warmed === true;
  return {
    ok: true,
    ready,
    code: ready ? null : SSM_REFUSAL_CODES.preparationPending,
    field: ready ? null : 'compiled/warmed',
    profile,
    family: recipe.family,
    budget,
  };
}

export function resolveSubstrateSmBackend(input = {}) {
  const settings = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  if (settings.safeMode !== false) return refuseRoute(settings, SSM_REFUSAL_CODES.safeMode, 'safeMode');
  if (settings.contextAvailable !== true) return refuseRoute(settings, SSM_REFUSAL_CODES.contextUnavailable, 'contextAvailable');
  if (settings.enabled === false) return refuseRoute(settings, SSM_REFUSAL_CODES.explicitVeto, 'enabled');
  if (settings.enabled !== undefined && settings.enabled !== null && settings.enabled !== true) {
    return refuseRoute(settings, SSM_REFUSAL_CODES.invalidFlag, 'enabled');
  }
  if (settings.technology !== 'ShadowMap') return refuseRoute(settings, SSM_REFUSAL_CODES.technologyUnsupported, 'technology');
  if (settings.renderStyle !== 'Realistic') return refuseRoute(settings, SSM_REFUSAL_CODES.styleUnsupported, 'renderStyle');
  const release = settings.release ?? SSM_RELEASE_DEFAULTS;
  const releaseField = settings.enabled === true ? 'optInEnabled' : 'autoEnabled';
  if (release[releaseField] !== true) return refuseRoute(settings, SSM_REFUSAL_CODES.releaseDisabled, releaseField);
  const capability = validateSubstrateSmCapabilities(settings.capabilities, settings.contextGeneration);
  if (!capability.ok) return refuseRoute(settings, capability.code, capability.field);
  const material = materialGate(settings);
  if (material) return refuseRoute(settings, material.code, material.field);
  if (settings.sourceValidated !== true || !validRevision(settings.sourceRevision)) {
    return refuseRoute(settings, SSM_REFUSAL_CODES.sourceUnvalidated, 'sourceValidated/sourceRevision');
  }
  const quality = settings.quality ?? 'Auto';
  if (!SSM_QUALITY_NAMES.includes(quality)) return refuseRoute(settings, SSM_REFUSAL_CODES.invalidQuality, 'quality');
  const profiles = quality === 'Moderate' ? ['Moderate', 'Lite'] : ['Lite'];
  const permittedProfiles = Array.isArray(release.permittedProfiles) ? release.permittedProfiles : [];
  const attempts = [];
  let pending = null;
  for (const profile of profiles) {
    const candidate = Object.hasOwn(settings.candidates ?? {}, profile) ? settings.candidates[profile] : null;
    const result = permittedProfiles.includes(profile) ? examineCandidate(settings, profile, candidate)
      : { ok: false, code: SSM_REFUSAL_CODES.profileNotPermitted, field: profile };
    attempts.push(Object.freeze({ profile, code: result.code, field: result.field ?? null }));
    if (result.ok && !result.ready && !pending) pending = result;
    if (!result.ok || !result.ready) continue;
    return routingResult(settings, {
      state: 'ready', eligible: true, ready: true, code: null, field: null,
      effectiveQuality: profile, family: result.family, budget: result.budget,
      downgraded: quality === 'Moderate' && profile !== quality,
      attempts: Object.freeze(attempts),
    });
  }
  if (pending) {
    return routingResult(settings, {
      state: 'preparing', eligible: true, code: pending.code, field: pending.field,
      proposedQuality: pending.profile, family: pending.family, budget: pending.budget,
      attempts: Object.freeze(attempts),
    });
  }
  return routingResult(settings, {
    code: attempts[0].code, field: attempts[0].field, attempts: Object.freeze(attempts),
  });
}
