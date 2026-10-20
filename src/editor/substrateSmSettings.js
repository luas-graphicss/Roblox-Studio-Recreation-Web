import { readSubstrateSmLightingSettings, validateSubstrateSmPropertyValue } from '../lighting/substrateSm/ssmPublicApiCore.js';

export function createSubstrateSmSettingsController({ getLighting, commandManager } = {}) {
  if (typeof getLighting !== 'function' || typeof commandManager?.execute !== 'function') {
    throw new TypeError('A Lighting reader and command manager are required.');
  }

  function read() {
    return readSubstrateSmLightingSettings(getLighting());
  }

  function set(propertyName, value) {
    const validation = validateSubstrateSmPropertyValue(propertyName, value);
    if (!validation.ok) return { ...validation, changed: false };
    const lighting = getLighting();
    if (!lighting || lighting.isDestroyed?.() === true || !lighting.hasProperty?.(propertyName)) {
      return { ok: false, changed: false, reason: 'The current Lighting service does not expose this property.' };
    }
    const previousValue = lighting.getProperty(propertyName);
    if (Object.is(previousValue, value)) return { ok: true, changed: false, reason: null };

    function write(nextValue) {
      if (getLighting() !== lighting || lighting.isDestroyed?.() === true) return false;
      if (Object.is(lighting.getProperty(propertyName), nextValue)) return true;
      return lighting.setProperty(propertyName, nextValue) === true
        && Object.is(lighting.getProperty(propertyName), nextValue);
    }

    const accepted = commandManager.execute({
      name: propertyName === 'SubstrateSM' ? 'Set Substrate SM request' : 'Set Substrate SM quality',
      do: () => write(value),
      undo: () => write(previousValue),
    }) === true;
    return { ok: accepted, changed: accepted, reason: accepted ? null : 'The Substrate SM settings command was refused.' };
  }

  return Object.freeze({ read, set });
}
