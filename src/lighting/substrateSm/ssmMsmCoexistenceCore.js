export const SSM_MSM_IRRADIANCE_CONVENTION = 'linear-irradiance-with-cosine-without-brdf';

function result(mode, allowed, code, limitations = []) {
  return Object.freeze({
    mode,
    allowed,
    code,
    certification: allowed ? (mode === 'OFF' ? 'independent-forward' : 'restricted-diffuse-only') : 'blocked',
    limitations: Object.freeze(limitations),
    activatesMsm: false,
    changesLightPartition: false,
    addedSamplers: 0,
    addedPasses: 0,
    addedHistories: 0,
  });
}

function validLightKeys(keys) {
  return Array.isArray(keys) && keys.every(key => typeof key === 'string' && key.length > 0)
    && new Set(keys).size === keys.length;
}

export function classifySubstrateSmMsmCoexistence(state) {
  const mode = state?.mode;
  if (mode === 'OFF') return result(mode, true, null);
  if (mode === 'A') {
    return result(mode, false, 'SSM_MSM_A_UNSEPARATED_SCENE_COLOR', [
      'The current screen compositor also attenuates emission, ambient and already-shadowed lighting.',
    ]);
  }
  if (mode !== 'B') return result(mode ?? null, false, 'SSM_MSM_MODE_REQUIRED');
  if (state.irradianceConvention !== SSM_MSM_IRRADIANCE_CONVENTION) {
    return result(mode, false, 'SSM_MSM_IRRADIANCE_CONVENTION_REQUIRED');
  }
  const partition = state.partition;
  if (partition?.owner !== 'MSM' || !validLightKeys(partition.forwardLightKeys)
    || !validLightKeys(partition.irradianceLightKeys)) {
    return result(mode, false, 'SSM_MSM_PARTITION_REQUIRED');
  }
  const forwardLightKeys = new Set(partition.forwardLightKeys);
  if (partition.irradianceLightKeys.some(key => forwardLightKeys.has(key))) {
    return result(mode, false, 'SSM_MSM_DUPLICATE_LIGHT_ENERGY');
  }
  if (state.samplerReservation?.owner !== 'MSM' || state.samplerReservation.fragmentSamplers !== 1) {
    return result(mode, false, 'SSM_MSM_SAMPLER_RESERVATION_REQUIRED');
  }
  if (state.historyInvalidationAvailable !== true) {
    return result(mode, false, 'SSM_MSM_HISTORY_INVALIDATION_REQUIRED');
  }
  return result(mode, true, null, [
    'Directionless RGB irradiance supplies diffuse only; omitted forward specular is not reconstructed.',
    'The MSM scalar specular approximation is excluded from the Substrate SM shader only.',
    'The host owns light selection, history validity, shadow visibility and its existing sampler reservation.',
  ]);
}
