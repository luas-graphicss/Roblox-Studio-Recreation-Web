export const SSM_RELEASE_SCHEMA_VERSION = 1;
export const SSM_RELEASE_MAX_GRANTS = 64;
export const SSM_RELEASE_MAX_MANIFEST_LENGTH = 262144;
export const SSM_RELEASE_CHANNELS = Object.freeze(['optIn', 'auto']);
export const SSM_RELEASE_TARGET_FIELDS = Object.freeze([
  'sourceFingerprint', 'hostFingerprint', 'deviceFingerprint',
  'renderConfigurationFingerprint', 'variantFingerprint',
  'profile', 'family', 'materialPath', 'msmMode',
]);
export const SSM_RELEASE_DIGEST_FIELDS = Object.freeze([
  'sourceFingerprint', 'hostFingerprint', 'deviceFingerprint',
  'renderConfigurationFingerprint', 'variantFingerprint',
]);
export const SSM_RELEASE_EVIDENCE_PHASES = Object.freeze({
  integration: 'SSM-F25', optical: 'SSM-F26', performance: 'SSM-F27', rollback: 'SSM-F28',
});
export const SSM_RELEASE_REQUIRED_GATES = Object.freeze({
  integration: Object.freeze(['G01', 'G12', 'G13']),
  optical: Object.freeze(['G02', 'G03', 'G04', 'G05', 'G06', 'G08']),
  performance: Object.freeze(['G09', 'G10', 'G11', 'G14']),
  rollback: Object.freeze(['G01', 'G12']),
});
export const SSM_RELEASE_ROLLBACK_CHECKS = Object.freeze([
  'oldSave', 'newSave', 'shadowMapReentry', 'futurePreserved', 'voxelPreserved',
  'classicPreserved', 'explicitOff', 'safeMode', 'contextRestore',
  'pendingWorkCancelled', 'callbacksRestored', 'resourcesReturned', 'authoredSourcePreserved',
]);
