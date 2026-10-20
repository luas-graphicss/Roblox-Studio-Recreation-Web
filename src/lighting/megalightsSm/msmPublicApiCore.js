export const MSM_DEFAULT_STRENGTH = 0.85;
export const MSM_VIEW_OPTIONS = Object.freeze(['Composite', 'ShadowFactor', 'LightCoverage']);
export const MSM_PHASE_OVERRIDE_NAMES = Object.freeze(['temporal', 'spatial', 'atlas', 'proxy', 'fairness', 'specular', 'screenTrace']);
export const MSM_OVERRIDE_NAMES = Object.freeze(['flag', 'mode', 'strength', 'tier', 'view', ...MSM_PHASE_OVERRIDE_NAMES]);
export const MSM_PUBLIC_API = Object.freeze({
  MegaLightsSM: Object.freeze({ type: 'boolean?', default: null,
    description: 'Auto on weak GPUs; On forces inspection; Off restores native lighting. Available in ShadowMap and eligible Future profiles.' }),
  MegaLightsSMMode: Object.freeze({ type: 'enum', default: 'A', options: Object.freeze(['A', 'B']),
    description: 'A: screen-space shadow correction. B: previous-frame RGB irradiance in supported opaque forward materials.' }),
  MegaLightsSMStrength: Object.freeze({ type: 'number', default: MSM_DEFAULT_STRENGTH, minimum: 0, maximum: 1,
    description: 'Shadow strength from 0 to 1. Zero restores the unmodified native image.' }),
  MegaLightsSMView: Object.freeze({ type: 'enum', default: 'Composite', options: MSM_VIEW_OPTIONS,
    description: 'Composite: final image. ShadowFactor and LightCoverage inspect the active MSM signal.' }),
});

export function normalizeMsmOverride(name, value) {
  if (!MSM_OVERRIDE_NAMES.includes(name)) throw new TypeError('Unknown MSM override: ' + name);
  if (value == null) return null;
  if (MSM_PHASE_OVERRIDE_NAMES.includes(name)) {
    if (typeof value !== 'boolean') throw new TypeError(name + ' must be boolean or null');
    return value;
  }
  if (name === 'strength') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
      throw new RangeError('MSM strength must be a finite number from 0 to 1');
    return value;
  }
  if (name === 'flag' && typeof value === 'boolean') return value;
  const token = String(value).trim();
  const normalized = name === 'mode' ? token.toUpperCase() : name === 'view' ? token : token.toLowerCase();
  const allowed = name === 'flag' ? ['auto', 'on', 'off'] : name === 'mode' ? ['A', 'B']
    : name === 'tier' ? ['micro', 'lite', 'low', 'medium'] : MSM_VIEW_OPTIONS;
  if (!allowed.includes(normalized)) throw new RangeError('Invalid MSM ' + name + ': ' + token);
  return normalized;
}
