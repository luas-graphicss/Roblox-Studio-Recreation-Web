import { SSM_CONTRACT_VERSION, SSM_RECIPE_VERSION, SSM_RELEASE_DEFAULTS, SSM_THREE_REVISION } from './ssmContract.js';
import { serializeSubstrateSmKeyDescriptor } from './ssmKeySerialization.js';
import { copySubstrateSmImmutableData } from './ssmImmutableData.js';
import { SSM_RELEASE_SCHEMA_VERSION, SSM_RELEASE_MAX_GRANTS, SSM_RELEASE_MAX_MANIFEST_LENGTH } from './ssmReleaseContract.js';
import { evaluateSubstrateSmReleaseGrant, getSubstrateSmReleaseTargetSignature, isSubstrateSmReleaseLabel } from './ssmReleaseEvidenceCore.js';
import { SSM_RELEASE_MANIFEST } from './ssmReleaseManifest.js';

function readInputValue(input, name) {
  const descriptor = Object.getOwnPropertyDescriptor(input, name);
  if (descriptor && !Object.hasOwn(descriptor, 'value')) throw new TypeError('SSM_RELEASE_INPUT_INVALID');
  return descriptor?.value;
}

function readDevelopmentChannel(manifest) {
  if (manifest.status !== 'development') return null;
  const channel = manifest.development;
  if (!channel || typeof channel !== 'object' || channel.channel !== 'optIn'
    || !Array.isArray(channel.permittedProfiles) || channel.permittedProfiles.length === 0
    || channel.permittedProfiles.some(profile => !['Lite', 'Moderate'].includes(profile))) return null;
  return Object.freeze({
    channel: 'optIn',
    permittedProfiles: Object.freeze(['Lite', 'Moderate'].filter(profile => channel.permittedProfiles.includes(profile))),
    allowSoftwareRenderer: channel.allowSoftwareRenderer === true,
  });
}

function inspectManifest(value) {
  try {
    const serialized = serializeSubstrateSmKeyDescriptor(value);
    if (serialized.length > SSM_RELEASE_MAX_MANIFEST_LENGTH) throw new RangeError('Manifest too large');
    const manifest = copySubstrateSmImmutableData(JSON.parse(serialized));
    if (manifest?.schemaVersion !== SSM_RELEASE_SCHEMA_VERSION || manifest.contractVersion !== SSM_CONTRACT_VERSION
      || manifest.recipeVersion !== SSM_RECIPE_VERSION || manifest.threeRevision !== SSM_THREE_REVISION
      || !isSubstrateSmReleaseLabel(manifest.releaseId) || !Number.isSafeInteger(manifest.revision) || manifest.revision < 0
      || !['held', 'released', 'revoked', 'development'].includes(manifest.status)
      || !Array.isArray(manifest.grants) || manifest.grants.length > SSM_RELEASE_MAX_GRANTS) {
      return { manifest: null, grants: [], blockers: ['SSM_RELEASE_MANIFEST_INVALID'], grantDiagnostics: [] };
    }
    const identifiers = new Set();
    const grants = [];
    const grantDiagnostics = [];
    for (const grant of manifest.grants) {
      if (identifiers.has(grant?.id)) return { manifest, grants: [], blockers: ['SSM_RELEASE_GRANT_DUPLICATE'], grantDiagnostics: [] };
      identifiers.add(grant?.id);
      const assessment = evaluateSubstrateSmReleaseGrant(grant, manifest);
      grantDiagnostics.push(Object.freeze({ grantId: grant?.id ?? null, blockers: assessment.blockers }));
      if (assessment.eligible) grants.push({ ...grant, targetSignature: assessment.targetSignature });
    }
    const development = readDevelopmentChannel(manifest);
    const blockers = manifest.status === 'released' || development ? [] : [`SSM_RELEASE_${manifest.status.toUpperCase()}`];
    if (grants.length === 0 && !development) blockers.push('SSM_RELEASE_NO_CERTIFIED_TARGETS');
    return { manifest, grants, blockers, grantDiagnostics, development };
  } catch {
    return { manifest: null, grants: [], blockers: ['SSM_RELEASE_MANIFEST_INVALID'], grantDiagnostics: [] };
  }
}

export function createSubstrateSmReleasePolicy(manifest = SSM_RELEASE_MANIFEST) {
  const inspected = inspectManifest(manifest);
  const snapshot = copySubstrateSmImmutableData({
    schemaVersion: SSM_RELEASE_SCHEMA_VERSION,
    releaseId: inspected.manifest?.releaseId ?? null,
    revision: inspected.manifest?.revision ?? null,
    status: inspected.manifest?.status ?? 'invalid',
    readyGrantCount: inspected.blockers.length ? 0 : inspected.grants.length,
    development: inspected.development ?? null,
    blockers: inspected.blockers,
    grantDiagnostics: inspected.grantDiagnostics,
  });

  function result(code, release = SSM_RELEASE_DEFAULTS, grantIds = []) {
    return Object.freeze({
      decisionType: 'release-permission', applied: false,
      status: code === null ? 'permitted' : 'blocked', code,
      releaseId: snapshot.releaseId, revision: snapshot.revision,
      release, grantIds: Object.freeze(grantIds),
    });
  }

  function resolve(input = {}) {
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)) return result('SSM_RELEASE_INPUT_INVALID');
      const enabled = readInputValue(input, 'enabled');
      if (enabled === false) return result('SSM_RELEASE_EXPLICIT_OFF');
      if (enabled !== true && enabled !== null && enabled !== undefined) return result('SSM_RELEASE_FLAG_INVALID');
      const rollback = readInputValue(input, 'rollback');
      if (rollback !== undefined && rollback !== false) return result('SSM_RELEASE_ROLLBACK');
      if (snapshot.blockers.length) return result(snapshot.blockers[0]);
      const softwareRenderer = readInputValue(input, 'softwareRenderer');
      if (inspected.development) {
        if (enabled !== true) return result('SSM_RELEASE_DEVELOPMENT_AUTO_OFF');
        if (softwareRenderer !== false && !inspected.development.allowSoftwareRenderer) return result('SSM_RELEASE_PHYSICAL_DEVICE_REQUIRED');
        return result(null, Object.freeze({
          optInEnabled: true, autoEnabled: false, permittedProfiles: inspected.development.permittedProfiles,
          channel: 'development', certified: false, softwareRenderer: softwareRenderer !== false,
        }), []);
      }
      if (softwareRenderer !== false) return result('SSM_RELEASE_PHYSICAL_DEVICE_REQUIRED');
      const rawTargets = readInputValue(input, 'targets');
      if (!Array.isArray(rawTargets) || rawTargets.length === 0 || rawTargets.length > 2) return result('SSM_RELEASE_TARGET_INVALID');
      const targets = JSON.parse(serializeSubstrateSmKeyDescriptor(rawTargets));
      const profiles = new Set();
      const signatures = [];
      for (const target of targets) {
        const signature = getSubstrateSmReleaseTargetSignature(target);
        if (!signature || profiles.has(target.profile)) return result('SSM_RELEASE_TARGET_INVALID');
        profiles.add(target.profile);
        signatures.push({ target, signature });
      }
      const channel = enabled === true ? 'optIn' : 'auto';
      const admitted = [];
      const grantIds = [];
      for (const { target, signature } of signatures) {
        if (channel === 'auto' && target.profile !== 'Lite') continue;
        const grant = inspected.grants.find(candidate => candidate.targetSignature === signature && candidate.channels.includes(channel));
        if (!grant) continue;
        admitted.push(target.profile);
        grantIds.push(grant.id);
      }
      if (admitted.length === 0) return result('SSM_RELEASE_TARGET_NOT_CERTIFIED');
      const permittedProfiles = Object.freeze(['Lite', 'Moderate'].filter(profile => admitted.includes(profile)));
      return result(null, Object.freeze({
        optInEnabled: channel === 'optIn', autoEnabled: channel === 'auto', permittedProfiles,
      }), grantIds);
    } catch {
      return result('SSM_RELEASE_INPUT_INVALID');
    }
  }

  function getSnapshot() { return snapshot; }
  return Object.freeze({ resolve, getSnapshot });
}

const defaultPolicy = createSubstrateSmReleasePolicy();

export function resolveSubstrateSmRelease(input) {
  return defaultPolicy.resolve(input);
}

export function getSubstrateSmReleaseSnapshot() {
  return defaultPolicy.getSnapshot();
}
