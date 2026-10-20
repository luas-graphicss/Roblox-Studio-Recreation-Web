export const ML_UNREAL_TARGET_VERSION = "5.9";

export const ML_SOURCE_KIND = Object.freeze({
  paper: "paper",
  officialDocumentation: "officialDocumentation",
  consoleVariable: "consoleVariable",
  engineAudit: "engineAudit",
  missing: "missing",
});


export const ML_MISSING_TARGET_VERSION_SOURCE_ID = "unrealTargetVersionDelta";

export const ML_REFERENCE_SOURCES = Object.freeze({
  siggraph2025Paper: Object.freeze({
    id: "siggraph2025Paper",
    kind: ML_SOURCE_KIND.paper,
    title: "MegaLights: Stochastic Direct Lighting in Unreal Engine 5",
    publishedIn: "SIGGRAPH 2025",
    coversUnrealVersions: Object.freeze(["5.5", "5.6", "5.7", "5.8"]),
    verifiesTargetVersion: false,
    note: "describes the architecture and the measured numbers, but predates 5.9",
  }),
  officialMegaLightsDocumentation: Object.freeze({
    id: "officialMegaLightsDocumentation",
    kind: ML_SOURCE_KIND.officialDocumentation,
    title: "Official MegaLights documentation",
    publishedIn: "Epic Games documentation",
    coversUnrealVersions: Object.freeze(["5.5", "5.6", "5.7", "5.8"]),
    verifiesTargetVersion: false,
    note: "feature level documentation; the pages consulted do not cover 5.9",
  }),
  megaLightsConsoleVariables: Object.freeze({
    id: "megaLightsConsoleVariables",
    kind: ML_SOURCE_KIND.consoleVariable,
    title: "r.MegaLights.* console variables",
    publishedIn: "Engine console variable reference",
    coversUnrealVersions: Object.freeze(["5.5", "5.6", "5.7", "5.8"]),
    verifiesTargetVersion: false,
    note: "proves a knob exists and what it does, never proves its 5.9 default",
  }),
  benchEngineAudit: Object.freeze({
    id: "benchEngineAudit",
    kind: ML_SOURCE_KIND.engineAudit,
    title: "Audit of our own engine, with file and line evidence",
    publishedIn: "mlAuditFindingsCore.js",
    coversUnrealVersions: Object.freeze([]),
    verifiesTargetVersion: false,
    note: "describes OUR side of every row; it can never verify anything about Unreal",
  }),
  [ML_MISSING_TARGET_VERSION_SOURCE_ID]: Object.freeze({
    id: ML_MISSING_TARGET_VERSION_SOURCE_ID,
    kind: ML_SOURCE_KIND.missing,
    title: "Unreal Engine " + ML_UNREAL_TARGET_VERSION + " specific deltas",
    publishedIn: "nothing public and verifiable was found",
    coversUnrealVersions: Object.freeze([]),
    verifiesTargetVersion: false,
    note: "named on purpose: every row that would need it is flagged needsVerification",
  }),
});

export function listReferenceSources() {
  return Object.keys(ML_REFERENCE_SOURCES).map((sourceId) => ML_REFERENCE_SOURCES[sourceId]);
}

export function referenceSource(sourceId) {
  return ML_REFERENCE_SOURCES[sourceId] || null;
}


export function unknownSourceIds(sourceIds) {
  return (sourceIds || []).filter((sourceId) => !ML_REFERENCE_SOURCES[sourceId]);
}


export function sourcesVerifyTargetVersion(sourceIds) {
  return (sourceIds || []).some((sourceId) => {
    const source = ML_REFERENCE_SOURCES[sourceId];
    return !!source && source.verifiesTargetVersion === true;
  });
}

export function sourcesMissingTargetVersion() {
  return listReferenceSources().filter((source) => !source.verifiesTargetVersion);
}
