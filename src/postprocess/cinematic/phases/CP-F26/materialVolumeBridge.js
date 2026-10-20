import { validateResource } from "../../contracts/frameContract.js";
import { requireNumber } from "./materialValidation.js";
import { requireMaterialSession } from "./materialSession.js";

export function readMaterialVolumeWeight(binding, context) {
  if (!binding) return 1;
  const resource = context.read(binding.resource);
  validateResource(resource, context.frame, binding.resource);
  const values = resource.value?.values;
  if (!values || !Object.hasOwn(values, binding.property)) throw new Error(`Missing resolved volume weight: ${binding.property}`);
  return requireNumber(values[binding.property], binding.property, 0, 1);
}

export function createMaterialWeightProperties(session) {
  requireMaterialSession(session);
  return Object.freeze(session.plan.materials.filter((material) => material.location !== "replacingTonemapper").map((material) => Object.freeze({ name: `postProcess.${material.id}.weight`, kind: "number", defaultValue: 1, minimum: 0, maximum: 1 })));
}
