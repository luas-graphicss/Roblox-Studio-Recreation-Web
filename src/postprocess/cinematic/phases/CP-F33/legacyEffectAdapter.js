import { createPostProcessDocument } from "./authoringDocument.js";
import { copyAuthoringData, freezeAuthoringData, requireKeys, requireRecord, requireIdentifier, reject } from "./authoringData.js";

export function createLegacyEffectAdapter({ profileId, mappings }) {
  requireIdentifier(profileId, "$.legacyProfile");
  const profile = copyAuthoringData(mappings);
  requireRecord(profile, "$.legacyMappings");
  for (const [source, mapping] of Object.entries(profile)) {
    requireIdentifier(source, "$.legacyMappings"); requireKeys(mapping, ["property", "description"], `$.legacyMappings.${source}`);
    requireIdentifier(mapping.property, "$.legacyMappings.property");
    if (typeof mapping.description !== "string" || !mapping.description.trim()) reject("missing-equivalence-note", source, "Document the control-intent mapping; optical equivalence is not implied");
  }
  if (new Set(Object.values(profile).map(mapping => mapping.property)).size !== Object.keys(profile).length) reject("legacy-collision", "$", "Two source fields cannot overwrite the same setting");
  return Object.freeze({ adapt(legacySnapshot, { mode = "classic", document = {} } = {}) {
    if (!["classic", "future-proposal"].includes(mode)) throw new TypeError("Use classic or future-proposal mode");
    const legacy = copyAuthoringData(legacySnapshot); requireRecord(legacy, "$.legacy");
    const base = copyAuthoringData(createPostProcessDocument(document)); const diagnostics = [];
    if (mode === "future-proposal") for (const [name, value] of Object.entries(legacy)) {
      if (!Object.hasOwn(profile, name)) { diagnostics.push({ code: "unmapped-legacy-control", path: name, message: "Preserved in legacy snapshot; not applied" }); continue; }
      const mapping = profile[name];
      if (Object.hasOwn(base.settings.global.overrides, mapping.property)) reject("legacy-collision", mapping.property, "Resolve the existing authored override explicitly");
      base.settings.global.overrides[mapping.property] = { value };
      diagnostics.push({ code: "control-intent-only", path: name, message: mapping.description });
    }
    if (mode === "future-proposal") base.extensions.legacyImport = { profileId, snapshot: legacy, opticalEquivalenceVerified: false };
    return freezeAuthoringData({ mode, classicSnapshot: legacy, document: createPostProcessDocument(base), diagnostics, appliedToHost: false, opticalEquivalenceVerified: false, requiresIntegratorApproval: mode === "future-proposal" });
  } });
}
