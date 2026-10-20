export const PARITY_STATUS = Object.freeze({
  MATCHES: "matches",
  PARTIAL: "partial",
  MISSING: "missing",
});

const PARITY_STATUS_VALUES = Object.freeze([
  PARITY_STATUS.MATCHES,
  PARITY_STATUS.PARTIAL,
  PARITY_STATUS.MISSING,
]);

export const PARITY_LEDGER_SOURCE = "PLANO-LUZES-LOCAIS-VS-UE58.md (section 4)";
export const PARITY_LEDGER_VERSION = "LL-F1/2026-09-01";
export const PARITY_LEDGER_EXPECTED_ROW_COUNT = 22;

export function isParityStatus(value) {
  return PARITY_STATUS_VALUES.indexOf(value) >= 0;
}

function createParityRow(row) {
  return Object.freeze({
    id: row.id,
    feature: row.feature,
    engineToday: row.engineToday,
    unrealTarget: row.unrealTarget,
    planStatus: row.planStatus,
    auditedStatus: row.auditedStatus || row.planStatus,
    auditNote: row.auditNote || "",
    ownerPhases: Object.freeze((row.ownerPhases || []).slice()),
    findingIds: Object.freeze((row.findingIds || []).slice()),
  });
}

const PARITY_ROWS = [
  {
    id: 1,
    feature: "Distance falloff and attenuation window",
    engineToday:
      "three.js physical falloff pow(saturate(1 - pow(d/R,4)),2) / max(d*d, 0.01); Range works as a hard cut",
    unrealTarget:
      "Inverse square with the UE window: pow(saturate(1 - pow(d/R,4)),2) / (d*d + 1), soft edge at Range",
    planStatus: PARITY_STATUS.PARTIAL,
    ownerPhases: ["LL-F2"],
  },
  {
    id: 2,
    feature: "Photometric units",
    engineToday: "Fixed 800 lumen per Brightness unit plus Kelvin tint (photometryCore, IL-F27)",
    unrealTarget: "Selectable candela / lumen / EV plus UseIESBrightness",
    planStatus: PARITY_STATUS.PARTIAL,
    ownerPhases: ["LL-F3"],
  },
  {
    id: 3,
    feature: "Light shape in diffuse and specular",
    engineToday: "SourceRadius only feeds penumbra and the LTC rect path",
    unrealTarget: "Sphere and capsule most representative point with energy conservation",
    planStatus: PARITY_STATUS.MISSING,
    ownerPhases: ["LL-F4", "LL-F6"],
  },
  {
    id: 4,
    feature: "Spot cone profile",
    engineToday: "Single angle plus the three.js penumbra ramp",
    unrealTarget: "Inner and outer cone with quadratic falloff and radial profile",
    planStatus: PARITY_STATUS.PARTIAL,
    ownerPhases: ["LL-F5"],
  },
  {
    id: 5,
    feature: "Rect light feature set",
    engineToday: "LTC on standard and physical (4 rect strong tier, 1 medium, 0 weak), no barn doors, no source texture",
    unrealTarget: "Barn doors, SourceTexture and two sided emission",
    planStatus: PARITY_STATUS.PARTIAL,
    ownerPhases: ["LL-F7"],
  },
  {
    id: 6,
    feature: "SurfaceLight",
    engineToday: "Approximated by a rect light",
    unrealTarget: "The emitting face itself is the rect light, inside the light budget",
    planStatus: PARITY_STATUS.PARTIAL,
    ownerPhases: ["LL-F7"],
  },
  {
    id: 7,
    feature: "IES profiles and cookies",
    engineToday: "Per light, but the unrolled GLSL loop caps the effect at 8 lights",
    unrealTarget: "Per light with no practical cap",
    planStatus: PARITY_STATUS.PARTIAL,
    ownerPhases: ["LL-F20"],
    findingIds: ["ies-cookie-light-cap-is-8"],
  },
  {
    id: 8,
    feature: "Same light across every material path",
    engineToday: "Phong pools answer with roughly 10 to 20 percent wider energy (IL-F37 residual); paths diverge",
    unrealTarget: "The same light produces the same response on every material path",
    planStatus: PARITY_STATUS.MISSING,
    ownerPhases: ["LL-F8"],
  },
  {
    id: 9,
    feature: "HDR range and anti firefly",
    engineToday: "Global specular anti aliasing only",
    unrealTarget: "100k lumen without clipping and without specular flicker",
    planStatus: PARITY_STATUS.PARTIAL,
    ownerPhases: ["LL-F9"],
  },
  {
    id: 10,
    feature: "Shadow atlas for local lights",
    engineToday:
      "Atlas is AWAKE, but only inside the MegaLights cluster pass (uAtlasOn); the deterministic spot, point and surface path never samples it",
    unrealTarget: "One atlas serving spot, point and surface shadows on every path",
    planStatus: PARITY_STATUS.MISSING,
    auditedStatus: PARITY_STATUS.PARTIAL,
    auditNote:
      "LL-F10 changes scope: it is no longer 'wake the atlas from zero' but 'extend the already awake atlas to the deterministic path without touching the frozen MegaLights fragment'.",
    ownerPhases: ["LL-F10", "LL-F11"],
    findingIds: ["atlas-depth-hook-is-alive"],
  },
  {
    id: 11,
    feature: "Shadow resolution policy",
    engineToday: "Fixed ladder driven by light rank",
    unrealTarget: "Screen coverage driven with hysteresis",
    planStatus: PARITY_STATUS.MISSING,
    ownerPhases: ["LL-F12"],
  },
  {
    id: 12,
    feature: "Shadow cache",
    engineToday: "Full re-render every frame, rotation only",
    unrealTarget: "Static and dynamic pages cached per light",
    planStatus: PARITY_STATUS.MISSING,
    ownerPhases: ["LL-F13"],
  },
  {
    id: 13,
    feature: "Per light penumbra and bias",
    engineToday: "Global PCSS settings; SourceRadius only partially wired",
    unrealTarget: "Real per light source radius plus ShadowFilterSharpen",
    planStatus: PARITY_STATUS.PARTIAL,
    ownerPhases: ["LL-F14"],
  },
  {
    id: 14,
    feature: "Contact shadows",
    engineToday: "Global contact fuse gated by a cone",
    unrealTarget: "Per light contact shadow with configurable length",
    planStatus: PARITY_STATUS.PARTIAL,
    ownerPhases: ["LL-F15"],
  },
  {
    id: 15,
    feature: "Colored transmission and SSS under local lights",
    engineToday:
      "The slab tint (rswSaTint) is injected only in the MegaLights cluster fragment; the deterministic path and the SSS path still ignore local lights",
    unrealTarget: "Stained glass tint and per light SSS transmission, ray traced opt in",
    planStatus: PARITY_STATUS.MISSING,
    auditedStatus: PARITY_STATUS.PARTIAL,
    auditNote:
      "The tint is not dormant any more, it is unreachable outside MegaLights. LL-F16 starts from working code instead of dead code.",
    ownerPhases: ["LL-F16"],
    findingIds: ["transmission-tint-alive-in-cluster-pass"],
  },
  {
    id: 16,
    feature: "Local volumetric scattering",
    engineToday:
      "Unshadowed analytic in-scatter for the top N local lights (pickVolLightsJs + localInscatterJs), no per light intensity",
    unrealTarget: "Shadowed froxel volumetrics per light with VolumetricScatteringIntensity",
    planStatus: PARITY_STATUS.MISSING,
    auditedStatus: PARITY_STATUS.PARTIAL,
    auditNote:
      "LL-F17 must add occlusion and the per light knob on top of the existing in-scatter instead of creating the feature from scratch.",
    ownerPhases: ["LL-F17"],
    findingIds: ["local-volumetric-inscatter-exists-unshadowed"],
  },
  {
    id: 17,
    feature: "Local light contribution to GI",
    engineToday: "Up to 16 lights injected in the voxel GI, with no per light scale",
    unrealTarget: "IndirectLightingIntensity per light",
    planStatus: PARITY_STATUS.PARTIAL,
    ownerPhases: ["LL-F18"],
    findingIds: ["gi-local-light-cap-is-16"],
  },
  {
    id: 18,
    feature: "Light source visible in reflections",
    engineToday: "Absent",
    unrealTarget: "Rect and sphere sources visible in reflections",
    planStatus: PARITY_STATUS.MISSING,
    ownerPhases: ["LL-F19"],
  },
  {
    id: 19,
    feature: "How many local lights can shade at once",
    engineToday:
      "three.js forward shades every light per fragment; the clustered pass exists but only feeds MegaLights",
    unrealTarget: "Clustered forward shading with 100 or more local lights",
    planStatus: PARITY_STATUS.MISSING,
    ownerPhases: ["LL-F20"],
    findingIds: ["cluster-pass-feeds-megalights-only"],
  },
  {
    id: 20,
    feature: "Per light fade and culling",
    engineToday: "Global budget that pops lights in and out",
    unrealTarget: "MaxDrawDistance and FadeRange without popping",
    planStatus: PARITY_STATUS.MISSING,
    ownerPhases: ["LL-F21"],
  },
  {
    id: 21,
    feature: "API, panel, gizmo and interop",
    engineToday: "Roblox style properties plus the IL extras",
    unrealTarget: "UE units, presets and round trip interop",
    planStatus: PARITY_STATUS.PARTIAL,
    ownerPhases: ["LL-F22"],
  },
  {
    id: 22,
    feature: "Proof that the answer is yes",
    engineToday:
      "A general bench exists; the blind round never ran for local lights and there was no per scene baseline before this phase",
    unrealTarget: "8 local light scenes with a blind round at 70 percent or better",
    planStatus: PARITY_STATUS.MISSING,
    auditNote: "LL-F1 delivers the missing baseline half of this row; the blind round stays with LL-F24.",
    ownerPhases: ["LL-F1", "LL-F23", "LL-F24"],
    findingIds: ["console-errors-not-reproduced"],
  },
];

export const LOCAL_LIGHT_PARITY_LEDGER = Object.freeze(PARITY_ROWS.map(createParityRow));

export function findParityRow(rowId) {
  const wanted = Number(rowId);
  return LOCAL_LIGHT_PARITY_LEDGER.find((row) => row.id === wanted) || null;
}

export function parityRowsByPhase(phaseId) {
  return LOCAL_LIGHT_PARITY_LEDGER.filter((row) => row.ownerPhases.indexOf(phaseId) >= 0);
}

export function parityLedgerPhaseIds() {
  const seen = [];
  LOCAL_LIGHT_PARITY_LEDGER.forEach((row) => {
    row.ownerPhases.forEach((phaseId) => {
      if (seen.indexOf(phaseId) < 0) seen.push(phaseId);
    });
  });
  return seen.sort();
}

export function parityRowsByStatus(status, options) {
  const useAudited = !options || options.audited !== false;
  return LOCAL_LIGHT_PARITY_LEDGER.filter(
    (row) => (useAudited ? row.auditedStatus : row.planStatus) === status,
  );
}

export function parityStatusTotals(options) {
  const useAudited = !options || options.audited !== false;
  const totals = { matches: 0, partial: 0, missing: 0, total: LOCAL_LIGHT_PARITY_LEDGER.length };
  LOCAL_LIGHT_PARITY_LEDGER.forEach((row) => {
    const status = useAudited ? row.auditedStatus : row.planStatus;
    if (isParityStatus(status)) totals[status] += 1;
  });
  return totals;
}

export function parityRowsCorrectedByAudit() {
  return LOCAL_LIGHT_PARITY_LEDGER.filter((row) => row.auditedStatus !== row.planStatus);
}

export function parityRowsWithUnknownFinding(knownFindingIds) {
  const known = Array.isArray(knownFindingIds) ? knownFindingIds : [];
  return LOCAL_LIGHT_PARITY_LEDGER.filter((row) =>
    row.findingIds.some((findingId) => known.indexOf(findingId) < 0),
  );
}

export function buildParityLedgerReport(options) {
  const knownFindingIds = (options && options.knownFindingIds) || [];
  const correctedRows = parityRowsCorrectedByAudit().map((row) => ({
    id: row.id,
    feature: row.feature,
    from: row.planStatus,
    to: row.auditedStatus,
    note: row.auditNote,
  }));
  const rowsWithUnknownFinding = parityRowsWithUnknownFinding(knownFindingIds).map((row) => row.id);
  const rowsWithoutOwnerPhase = LOCAL_LIGHT_PARITY_LEDGER.filter(
    (row) => row.ownerPhases.length === 0,
  ).map((row) => row.id);
  return {
    version: PARITY_LEDGER_VERSION,
    source: PARITY_LEDGER_SOURCE,
    totalRows: LOCAL_LIGHT_PARITY_LEDGER.length,
    planTotals: parityStatusTotals({ audited: false }),
    auditedTotals: parityStatusTotals({ audited: true }),
    correctedRows,
    rowsWithUnknownFinding,
    rowsWithoutOwnerPhase,
    phasesCovered: parityLedgerPhaseIds(),
    complete:
      LOCAL_LIGHT_PARITY_LEDGER.length === PARITY_LEDGER_EXPECTED_ROW_COUNT &&
      rowsWithUnknownFinding.length === 0 &&
      rowsWithoutOwnerPhase.length === 0,
  };
}
