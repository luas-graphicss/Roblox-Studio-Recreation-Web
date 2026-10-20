import { validateSubstrateSmOwnership } from '../../lighting/substrateSm/ssmOwnershipCore.js';
import { maskSubstrateSmShaderComments } from './ssmShaderAnchors.js';

export const SSM_LEGACY_EXCLUSION_VERSION = 1;
export const SSM_LEGACY_EXCLUSION_TRANSFORM_ID = 'ssm-f12-legacy-response-exclusion';

export const SSM_EXCLUSIVE_ACTIVE_RESPONSES = Object.freeze({
  legacy: false,
  llF8: false,
  ilF11: false,
  substrateFuture: false,
  substrateSm: true,
});

const legacyResponseMarkers = Object.freeze([
  Object.freeze({
    response: 'llF8',
    symbols: /\bllMaterialParity\w*\b/,
    uniforms: Object.freeze(['uLlMaterialParityMix', 'uLlMaterialParityF0']),
  }),
  Object.freeze({
    response: 'ilF11',
    symbols: /\b(?:uRswMF\w*|rswMf\w+)\b/,
    uniforms: Object.freeze(['uRswMFOn', 'uRswMFSunDirW', 'uRswMFSunColor', 'uRswMFAmb', 'uRswMFA', 'uRswMFB', 'uRswMFTint']),
  }),
  Object.freeze({
    response: 'substrateFuture',
    symbols: /^[ \t]*#define[ \t]+SB_REAL_CLOSURES\b/m,
    uniforms: Object.freeze([]),
  }),
]);

function uniformNames(uniforms) {
  if (!uniforms || typeof uniforms !== 'object' || Array.isArray(uniforms)) return [];
  return Reflect.ownKeys(uniforms).filter(name => typeof name === 'string');
}

export function inspectSubstrateSmLegacyResponses({ fragmentShader, uniforms } = {}) {
  const source = typeof fragmentShader === 'string' && fragmentShader.length > 0 ? maskSubstrateSmShaderComments(fragmentShader) : '';
  const names = new Set(uniformNames(uniforms));
  const responses = [];
  for (const marker of legacyResponseMarkers) {
    if (marker.symbols.test(source) || marker.uniforms.some(name => names.has(name))) responses.push(marker.response);
  }
  return Object.freeze({ duplicated: responses.length > 0, responses: Object.freeze(responses) });
}

export function resolveSubstrateSmActiveResponses(inspection) {
  const detected = Object.fromEntries((inspection?.responses ?? []).map(response => [response, true]));
  return Object.freeze({ ...SSM_EXCLUSIVE_ACTIVE_RESPONSES, ...detected });
}

export function validateSubstrateSmResponseExclusion({ fragmentShader, uniforms } = {}) {
  const inspection = inspectSubstrateSmLegacyResponses({ fragmentShader, uniforms });
  const activeResponses = resolveSubstrateSmActiveResponses(inspection);
  const ownership = validateSubstrateSmOwnership('substrateSm', activeResponses);
  return Object.freeze({
    ok: ownership.ok,
    code: ownership.ok ? null : `SSM_LEGACY_RESPONSE_DUPLICATED:${inspection.responses.join(',') || ownership.conflicts.join(',')}`,
    responses: inspection.responses,
    activeResponses,
    conflicts: ownership.conflicts,
  });
}

function excludeLegacyResponses({ shader } = {}) {
  const validation = validateSubstrateSmResponseExclusion(shader);
  if (!validation.ok) return Object.freeze({ ok: false, reason: validation.code });
  return Object.freeze({ ok: true, fragmentShader: shader.fragmentShader });
}

export const SSM_LEGACY_EXCLUSION_TRANSFORM = Object.freeze({
  id: SSM_LEGACY_EXCLUSION_TRANSFORM_ID,
  transform: excludeLegacyResponses,
});

export function withSubstrateSmLegacyExclusion(transforms = []) {
  if (!Array.isArray(transforms)) throw new TypeError('SSM_BINDING_TRANSFORM_CONTRACT');
  const others = [];
  for (const extension of transforms) {
    if (extension?.id !== SSM_LEGACY_EXCLUSION_TRANSFORM_ID) {
      others.push(extension);
    } else if (extension.transform !== excludeLegacyResponses) {
      throw new Error('SSM_LEGACY_EXCLUSION_TRANSFORM_FOREIGN');
    }
  }
  return Object.freeze([...others, SSM_LEGACY_EXCLUSION_TRANSFORM]);
}
