import { resolveBloomSettings } from "../CP-F14/bloomSettings.js";
import { createScopedSettingsBinding } from "./scopedSettingsBinding.js";
import { canonicalJson } from "./authoringData.js";

export function createStandardBloomAuthoringBridge(settings, baseSettings = {}) {
  const base = resolveBloomSettings(baseSettings); const scoped = createScopedSettingsBinding(settings); let previousSignature;
  return Object.freeze({
    id: "CP-F33.standardBloomBridge",
    apply(resolved) {
      const values = resolved.values;
      for (const property of ["bloom.enabled", "bloom.intensity", "bloom.method"]) if (!Object.hasOwn(values, property)) throw new Error(`Bloom bridge requires ${property}`);
      if (values["bloom.method"] !== "standard" && values["bloom.enabled"] && values["bloom.intensity"] > 0) throw new Error("Convolution bloom requires a CP-F15 bridge; standard is not an equivalent fallback");
      const next = resolveBloomSettings({ ...base, enabled: values["bloom.enabled"], intensity: values["bloom.intensity"] });
      scoped.verify(); const signature = canonicalJson(next);
      if (signature !== previousSignature) { scoped.write("CP-F14", next); previousSignature = signature; }
    },
    release() { scoped.restore("CP-F14"); previousSignature = undefined; }
  });
}
