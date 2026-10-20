import { getStageIndex } from "../../contracts/pipelineStages.js";
import { MATERIAL_LOCATIONS } from "./materialContract.js";
import { normalizeMaterialDefinition } from "./materialDefinition.js";

export function createMaterialPlan(authored) {
  if (!Array.isArray(authored) || authored.length > 128) throw new TypeError("Material list must contain at most 128 entries");
  const accepted = [];
  const rejected = [];
  const identifiers = new Set();
  for (const [index, input] of authored.entries()) {
    try {
      const material = normalizeMaterialDefinition(input);
      if (identifiers.has(material.id)) throw new Error(`Duplicate material id: ${material.id}`);
      identifiers.add(material.id);
      accepted.push(material);
    } catch (error) { rejected.push(Object.freeze({ index, id: input?.id ?? null, message: error.message })); }
  }
  const locationCounts = new Map();
  accepted.sort((left, right) => {
    const a = MATERIAL_LOCATIONS[left.location];
    const b = MATERIAL_LOCATIONS[right.location];
    return getStageIndex(a.stage) - getStageIndex(b.stage) || a.order - b.order || left.priority - right.priority || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  });
  const writers = new Map();
  for (const [index, material] of accepted.entries()) {
    if (writers.has(material.output.name)) throw new Error(`Duplicate user scene texture writer: ${material.output.name}`);
    writers.set(material.output.name, index);
  }
  if (accepted.filter((material) => material.location === "replacingTonemapper").length > 1) throw new Error("Only one tonemapper replacement is allowed");
  const passes = accepted.map((material, index) => {
    for (const input of material.reads) {
      if (writers.has(input) && writers.get(input) >= index) throw new Error(`Dependency cycle or backward resource read: ${material.id} -> ${input}`);
      if (input.startsWith("CP-F26.") && !writers.has(input)) throw new Error(`Missing user scene texture producer: ${input}`);
    }
    const location = MATERIAL_LOCATIONS[material.location];
    const offset = locationCounts.get(material.location) ?? 0;
    locationCounts.set(material.location, offset + 1);
    return Object.freeze({ material, id: `CP-F26.material.${material.id}`, owner: "CP-F26", stage: location.stage, order: location.order + offset, reads: material.reads, writes: Object.freeze([material.output.name]), transformsColor: material.output.transformsColor });
  });
  return Object.freeze({ materials: Object.freeze(accepted), passes: Object.freeze(passes), rejected: Object.freeze(rejected), tiePolicy: "location, priority ascending, identifier ascending; engineering policy, not verified UE behavior" });
}
