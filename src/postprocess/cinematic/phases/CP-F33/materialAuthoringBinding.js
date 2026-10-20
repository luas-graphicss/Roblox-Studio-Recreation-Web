import { createPostProcessMaterialSession } from "../CP-F26/index.js";
import { canonicalJson } from "./authoringData.js";

export function createMaterialAuthoringBinding(definitions) {
  const session = createPostProcessMaterialSession(definitions); const signatures = new Map();
  return Object.freeze({ session, update(authored) {
    for (const material of session.plan.materials) {
      const patch = authored[material.id] ?? {};
      const controls = {
        enabled: Object.hasOwn(patch, "enabled") ? patch.enabled : null,
        weight: Object.hasOwn(patch, "weight") ? patch.weight : null,
        parameters: Object.fromEntries(Object.keys(material.parameters).map(name => [name, Object.hasOwn(patch.parameters ?? {}, name) ? patch.parameters[name] : null]))
      };
      const signature = canonicalJson(controls);
      if (signature !== signatures.get(material.id)) { session.update(material.id, controls); signatures.set(material.id, signature); }
    }
  } });
}
