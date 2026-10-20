import { PHASE_MANIFEST } from "../../contracts/phaseManifest.js";
import { PROPERTY_FIELDS, PASS_FIELDS, PROFILE_FIELDS } from "./referenceConstants.js";
import { PROPERTY_REQUIREMENTS, PASS_REQUIREMENTS, PROFILE_REQUIREMENTS } from "./referenceScope.js";
import { indexById, readFacts, isText, requireStringSet } from "./referenceValidation.js";

export function validateReferenceInventory(inventory, sources, collector) {
  const definitions = [
    ["properties", PROPERTY_FIELDS, PROPERTY_REQUIREMENTS.map(({ id }) => id)],
    ["passes", PASS_FIELDS, PASS_REQUIREMENTS.map(({ id }) => id)],
    ["profiles", PROFILE_FIELDS, [...PROFILE_REQUIREMENTS]]
  ];
  const result = {};
  const owners = new Set(PHASE_MANIFEST.map(({ id }) => id));
  for (const [kind, fields, requiredIds] of definitions) {
    const entries = indexById(inventory?.[kind], `inventory.${kind}`, collector);
    const covered = new Set();
    const originals = new Set();
    result[kind] = new Map();
    for (const [id, entry] of entries) {
      const path = `inventory.${kind}.${id}`;
      const facts = readFacts(entry.facts, fields, `${path}.facts`, sources, collector);
      collector.require(isText(facts.originalPath) && !originals.has(facts.originalPath), "INVALID_ORIGINAL_PATH", path, "Each original build path must be present and unique");
      originals.add(facts.originalPath);
      if (kind === "properties") {
        collector.require(owners.has(entry.owner), "INVALID_PHASE_OWNER", path, "A real CP phase must own each property");
        for (const field of ["positiveTest", "negativeTest"]) collector.require(isText(facts[field]), "MISSING_CASE", `${path}.${field}`, "Both positive and negative evidence cases must be identified");
        collector.require(facts.positiveTest !== facts.negativeTest, "DUPLICATE_TEST_CASE", path, "Positive and negative cases must be distinct");
      }
      if (!Array.isArray(entry.requirementIds) || !entry.requirementIds.length) collector.add("UNMAPPED_REQUIREMENT", path, "Explicit plan requirement mapping is required");
      for (const requirement of Array.isArray(entry.requirementIds) ? entry.requirementIds : []) {
        collector.require(requiredIds.includes(requirement), "UNKNOWN_REQUIREMENT", path, String(requirement));
        covered.add(requirement);
        if (kind === "properties") collector.require(PROPERTY_REQUIREMENTS.find((item) => item.id === requirement)?.owner === entry.owner, "REQUIREMENT_OWNER_MISMATCH", path, String(requirement));
      }
      result[kind].set(id, { ...entry, values: facts });
    }
    requireStringSet([...covered], requiredIds, `inventory.${kind}.coverage`, collector);
  }
  for (const [id, profile] of result.profiles) {
    const order = profile.values.passOrder;
    collector.require(Array.isArray(order) && order.length > 0 && new Set(order).size === order.length && order.every((passId) => result.passes.has(passId)), "INVALID_PROFILE_ORDER", `profiles.${id}.passOrder`, "An explicit reference pass order without duplicates or unknown passes is required");
    collector.require(Array.isArray(profile.values.sceneIds) && profile.values.sceneIds.length > 0, "MISSING_PROFILE_SCENES", `profiles.${id}.sceneIds`, "Every profile must declare its capture scenes");
    for (const [position, passId] of (Array.isArray(order) ? order : []).entries()) {
      const dependencies = result.passes.get(passId)?.values.dependencies;
      collector.require(Array.isArray(dependencies) && dependencies.every((dependency) => order.indexOf(dependency) >= 0 && order.indexOf(dependency) < position), "INVALID_PASS_DEPENDENCY", `profiles.${id}.${passId}`, "Dependencies must be explicit and precede their consumer in this profile");
    }
  }
  return result;
}
