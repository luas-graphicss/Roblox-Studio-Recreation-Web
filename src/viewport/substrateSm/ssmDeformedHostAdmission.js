import { resolveSubstrateSmBackend } from '../../lighting/substrateSm/ssmBackendPolicyCore.js';
import { inspectSubstrateSmTerrainHost } from './ssmTerrainHostPolicy.js';
import { inspectSubstrateSmSkinnedHost } from './ssmSkinnedHostPolicy.js';

function resolveAdmission(host, input) {
  const settings = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const materialPath = settings.materialPath ?? host.materialPath;
  const blendMode = settings.blendMode ?? host.blendMode;
  const pathMatches = materialPath === host.materialPath;
  const blendMatches = blendMode === host.blendMode;
  const omittedHostResource = Object.entries(host.resourceFloor ?? {}).find(([field, minimum]) =>
    !Number.isSafeInteger(settings.hostUsage?.[field]) || settings.hostUsage[field] < minimum)?.[0] ?? null;
  const decision = resolveSubstrateSmBackend({ ...settings, materialPath, blendMode,
    tangentValid: false,
    hostPathReady: settings.hostPathReady === true && host.allowed && pathMatches && blendMatches && !omittedHostResource });
  return Object.freeze({ ...decision, host, pathMatches, blendMatches, omittedHostResource,
    tangentIntegrationReady: false });
}

export function resolveSubstrateSmTerrainAdmission(mesh, input = {}) {
  return resolveAdmission(inspectSubstrateSmTerrainHost(mesh), input);
}

export function resolveSubstrateSmSkinnedAdmission(mesh, input = {}) {
  return resolveAdmission(inspectSubstrateSmSkinnedHost(mesh, { paletteUniforms: input?.paletteUniforms }), input);
}
