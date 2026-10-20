import { createMaterialPlan } from "./materialPlan.js";
import { requireRecord, requireNumber, requireBoolean, inherit, validateParameter } from "./materialValidation.js";

const sessions = new WeakSet();

export function createPostProcessMaterialSession(authored = []) {
  const plan = createMaterialPlan(authored);
  const controls = new Map(plan.materials.map((material) => [material.id, Object.freeze({ enabled: material.enabled, weight: material.weight, parameters: Object.freeze(Object.fromEntries(Object.entries(material.parameters).map(([name, parameter]) => [name, parameter.value]))) })]));
  let revision = 0;
  const session = Object.freeze({
    plan,
    revision: () => revision,
    get(id) {
      if (!controls.has(id)) throw new Error(`Unknown material: ${id}`);
      return controls.get(id);
    },
    update(id, patch) {
      const material = plan.materials.find((entry) => entry.id === id);
      if (!material) throw new Error(`Unknown material: ${id}`);
      requireRecord(patch, "material controls");
      for (const key of Object.keys(patch)) if (!["enabled", "weight", "parameters"].includes(key)) throw new TypeError(`Structural changes require a new material session: ${key}`);
      const current = controls.get(id);
      const enabled = Object.hasOwn(patch, "enabled") ? requireBoolean(inherit(patch.enabled, material.enabled), "enabled") : current.enabled;
      const weight = Object.hasOwn(patch, "weight") ? requireNumber(inherit(patch.weight, material.weight), "weight", 0, 1) : current.weight;
      if (material.location === "replacingTonemapper" && (!enabled || weight !== 1)) throw new Error("Replacement ownership cannot be toggled or blended across color domains; reinstall the selected tonemapper");
      const parameters = { ...current.parameters };
      for (const [name, value] of Object.entries(requireRecord(patch.parameters ?? {}, "parameters"))) {
        const definition = material.parameters[name];
        if (!definition) throw new TypeError(`Unknown material parameter: ${name}`);
        parameters[name] = validateParameter(definition.type, inherit(value, definition.value), name);
      }
      controls.set(id, Object.freeze({ enabled, weight, parameters: Object.freeze(parameters) }));
      revision += 1;
      return revision;
    },
    snapshot: () => JSON.parse(JSON.stringify({ revision, materials: plan.materials.map((material) => ({ id: material.id, ...controls.get(material.id) })), rejected: plan.rejected }))
  });
  sessions.add(session);
  return session;
}

export function requireMaterialSession(session) {
  if (!sessions.has(session)) throw new TypeError("Expected a validated CP-F26 material session");
  return session;
}
