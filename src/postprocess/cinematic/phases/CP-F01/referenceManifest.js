import { REFERENCE_SCHEMA_VERSION, BUILD_FIELDS, PROPERTY_FIELDS, PASS_FIELDS, PROFILE_FIELDS, REQUIRED_SCENE_IDS } from "./referenceConstants.js";
import { PROPERTY_REQUIREMENTS, PASS_REQUIREMENTS, PROFILE_REQUIREMENTS, SCOPE_SOURCE } from "./referenceScope.js";

function unresolvedFacts(names) {
  return Object.fromEntries(names.map((name) => [name, null]));
}

export function createReferenceManifest() {
  return {
    schemaVersion: REFERENCE_SCHEMA_VERSION,
    target: { engine: "Unreal Engine", version: "5.9" },
    bundleId: null,
    preparedBy: null,
    capturedBy: null,
    provenance: "unmeasured",
    status: "BLOCKED_REFERENCE",
    unresolvedMeaning: "Null fact records mean unknown, not an engine default of null. A sourced null value uses { value: null, sourceId, locator }.",
    limitation: "Plan-derived requirements are not an exhaustive UE5.9 property export. No UE5.9 build, golden captures or independent reference approval is supplied.",
    build: { identityAssetId: null, facts: unresolvedFacts(BUILD_FIELDS) },
    sources: [structuredClone(SCOPE_SOURCE)],
    assets: [],
    inventory: {
      completeness: "unresolved",
      exportAssetId: null,
      properties: PROPERTY_REQUIREMENTS.map((entry) => ({ id: entry.id, owner: entry.owner, requirementIds: [entry.id], requirementSource: entry.source, facts: unresolvedFacts(PROPERTY_FIELDS) })),
      passes: PASS_REQUIREMENTS.map((entry) => ({ id: `reference.${entry.id}`, requirementIds: [entry.id], requirementSource: entry.source, facts: unresolvedFacts(PASS_FIELDS) })),
      profiles: PROFILE_REQUIREMENTS.map((quality) => ({ id: `reference.${quality}`, requirementIds: [quality], requirementSource: "docs/PLAN.md#CP-F31", facts: unresolvedFacts(PROFILE_FIELDS) }))
    },
    captureRequirements: { sceneIds: [...REQUIRED_SCENE_IDS], minimumSequenceFrames: 2, colorBeforeAndAfterEveryPass: true, depthAndVelocityEveryFrame: true },
    captureRuns: []
  };
}
