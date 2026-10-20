import { PHASE_MANIFEST } from "../../contracts/phaseManifest.js";
import { PROPERTY_REQUIREMENTS, PASS_REQUIREMENTS, PROFILE_REQUIREMENTS } from "../CP-F01/referenceScope.js";
import { REQUIRED_SCENE_IDS } from "../CP-F01/referenceConstants.js";
import { REQUIRED_GATES, CROSS_FEATURE_CASES, PRODUCT_CASES } from "./certificationContract.js";

export function createCertificationRequirements(referenceManifest) {
  const requirements = [];
  const add = (id, kind, owner) => requirements.push(Object.freeze({ id, kind, owner, required: true }));
  for (const phase of PHASE_MANIFEST.filter(({ id }) => id !== "CP-F36")) for (const gate of REQUIRED_GATES) add(`phase:${phase.id}:${gate}`, gate, phase.id);
  for (const property of PROPERTY_REQUIREMENTS) add(`property:${property.id}`, "conformance", property.owner);
  for (const pass of PASS_REQUIREMENTS) add(`pass:${pass.id}`, "conformance", "CP-F35");
  for (const profile of PROFILE_REQUIREMENTS) add(`quality:${typeof profile === "string" ? profile : profile.id}`, "profile", "CP-F31");
  for (const scene of REQUIRED_SCENE_IDS) add(`scene:${scene}`, "sequence", "CP-F35");
  for (const name of CROSS_FEATURE_CASES) add(`cross:${name}`, "sequence", "CP-F35");
  for (const name of PRODUCT_CASES) add(`product:${name}`, "integration", "CP-F34");
  for (const kind of ["properties", "passes", "profiles"]) {
    const entries = referenceManifest?.inventory?.[kind];
    if (Array.isArray(entries)) for (const entry of entries) if (entry && typeof entry.id === "string") add(`reference-${kind}:${entry.id}`, "conformance", entry.owner ?? "CP-F35");
  }
  return Object.freeze(requirements);
}
