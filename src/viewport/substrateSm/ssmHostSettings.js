import { readSubstrateSmLightingSettings } from '../../lighting/substrateSm/ssmPublicApiCore.js';

export function createSubstrateSmHostSettings(pipeline) {
  let lightingInstance = null;

  function configure(lighting, context) {
    if (lightingInstance !== null && lightingInstance !== lighting) pipeline.resetProject();
    lightingInstance = lighting;
    const settings = readSubstrateSmLightingSettings(lighting);
    return pipeline.configure({
      ...settings,
      ...context,
      settingsValid: settings.ok && settings.available,
    });
  }

  return Object.freeze({ configure });
}
