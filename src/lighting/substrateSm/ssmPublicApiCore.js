import { SSM_QUALITY_NAMES, SSM_REFUSAL_CODES } from './ssmContract.js';

export const SSM_PUBLIC_API_VERSION = 1;

export const SSM_PUBLIC_API = Object.freeze({
  SubstrateSM: Object.freeze({
    type: 'boolean?',
    default: null,
    category: 'Lighting',
    description: 'Substrate SM request for ShadowMap and Realistic only. AUTO is null and remains OFF until release approval; false vetoes SSM. ON never bypasses safety, release or resource limits. Independent of SubstrateEnabled and all Future controls.',
  }),
  SubstrateSMQuality: Object.freeze({
    type: 'string',
    default: 'Auto',
    options: SSM_QUALITY_NAMES,
    category: 'Lighting',
    description: 'Requested Substrate SM quality: Auto, Lite or Moderate. Admission may reduce quality or keep the previous backend. The editor reports requested and effective quality separately. Does not change the authored material tree.',
  }),
});

export function validateSubstrateSmPropertyValue(propertyName, value) {
  if (propertyName === 'SubstrateSM') {
    return value === null || value === true || value === false
      ? { ok: true, code: null, reason: null }
      : { ok: false, code: SSM_REFUSAL_CODES.invalidFlag, reason: 'SubstrateSM requires true, false or null for AUTO.' };
  }
  if (propertyName === 'SubstrateSMQuality') {
    return SSM_QUALITY_NAMES.includes(value)
      ? { ok: true, code: null, reason: null }
      : { ok: false, code: SSM_REFUSAL_CODES.invalidQuality, reason: 'SubstrateSMQuality requires Auto, Lite or Moderate.' };
  }
  return { ok: false, code: 'SSM_UNKNOWN_PUBLIC_PROPERTY', reason: 'The property is not part of the Substrate SM API.' };
}

export function readSubstrateSmLightingSettings(lighting) {
  if (!lighting || typeof lighting.getProperty !== 'function' || lighting.isDestroyed?.() === true) {
    return Object.freeze({
      ok: false,
      available: false,
      enabled: null,
      quality: 'Auto',
      technology: null,
      renderStyle: null,
      refusals: Object.freeze([{ code: 'SSM_LIGHTING_UNAVAILABLE', reason: 'Lighting service unavailable.' }]),
    });
  }
  const enabledValue = lighting.getProperty('SubstrateSM');
  const qualityValue = lighting.getProperty('SubstrateSMQuality');
  const enabled = enabledValue === undefined ? SSM_PUBLIC_API.SubstrateSM.default : enabledValue;
  const quality = qualityValue === undefined ? SSM_PUBLIC_API.SubstrateSMQuality.default : qualityValue;
  const refusals = [];
  for (const [propertyName, value] of [['SubstrateSM', enabled], ['SubstrateSMQuality', quality]]) {
    const validation = validateSubstrateSmPropertyValue(propertyName, value);
    if (!validation.ok) refusals.push(Object.freeze({ propertyName, ...validation }));
  }
  return Object.freeze({
    ok: refusals.length === 0,
    available: true,
    enabled,
    quality,
    technology: lighting.getProperty('Technology') ?? null,
    renderStyle: lighting.getProperty('RenderStyle') ?? null,
    refusals: Object.freeze(refusals),
  });
}
