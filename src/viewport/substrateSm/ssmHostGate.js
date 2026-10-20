const configurationFields = Object.freeze([
  'enabled', 'quality', 'technology', 'renderStyle', 'safeMode',
  'contextAvailable', 'webgl2', 'contextGeneration', 'projectGeneration', 'settingsValid',
]);

export function readSubstrateSmHostConfiguration(input = {}) {
  return Object.freeze({
    enabled: input.enabled,
    quality: input.quality === undefined ? 'Auto' : input.quality,
    technology: input.technology,
    renderStyle: input.renderStyle,
    safeMode: input.safeMode !== false,
    contextAvailable: input.contextAvailable === true,
    webgl2: input.webgl2 === true,
    contextGeneration: input.contextGeneration ?? 0,
    projectGeneration: input.projectGeneration ?? 0,
    settingsValid: input.settingsValid !== false,
  });
}

export function sameSubstrateSmHostConfiguration(previous, next) {
  return previous !== null && configurationFields.every(field => Object.is(previous[field], next[field]));
}

export function resolveSubstrateSmHostGate(configuration, manifest) {
  if (configuration.safeMode) return 'SSM_SAFE_MODE';
  if (!configuration.contextAvailable) return 'SSM_CONTEXT_UNAVAILABLE';
  if (!configuration.settingsValid) return 'SSM_HOST_SETTINGS_INVALID';
  if (configuration.enabled === false) return 'SSM_EXPLICIT_VETO';
  if (configuration.enabled !== true && configuration.enabled != null) return 'SSM_INVALID_FLAG';
  if (configuration.technology !== 'ShadowMap') return 'SSM_TECHNOLOGY_UNSUPPORTED';
  if (configuration.renderStyle !== 'Realistic') return 'SSM_STYLE_UNSUPPORTED';
  if (!['Auto', 'Lite', 'Moderate'].includes(configuration.quality)) return 'SSM_INVALID_QUALITY';
  if (!configuration.webgl2) return 'SSM_CAPABILITY_UNSUPPORTED';
  if (!Number.isSafeInteger(configuration.contextGeneration) || configuration.contextGeneration < 0
    || !Number.isSafeInteger(configuration.projectGeneration) || configuration.projectGeneration < 0) {
    return 'SSM_HOST_GENERATION_INVALID';
  }
  const development = manifest?.status === 'development' && manifest.development?.channel === 'optIn';
  const released = manifest?.status === 'released' && Array.isArray(manifest.grants) && manifest.grants.length > 0;
  if (!released && !development) return 'SSM_RELEASE_DISABLED';
  if (development && configuration.enabled !== true) return 'SSM_RELEASE_DEVELOPMENT_AUTO_OFF';
  return null;
}
