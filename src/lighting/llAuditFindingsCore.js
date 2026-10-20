export const FINDING_VERDICT = Object.freeze({
  PLAN_CONFIRMED: "plan-confirmed",
  PLAN_PARTIALLY_TRUE: "plan-partially-true",
  PLAN_OUTDATED: "plan-outdated",
  NOT_REPRODUCED: "not-reproduced",
});

const FINDING_VERDICT_VALUES = Object.freeze([
  FINDING_VERDICT.PLAN_CONFIRMED,
  FINDING_VERDICT.PLAN_PARTIALLY_TRUE,
  FINDING_VERDICT.PLAN_OUTDATED,
  FINDING_VERDICT.NOT_REPRODUCED,
]);

export const AUDIT_TARGET_PROJECT = "engine web";
export const AUDIT_DATE = "2026-09-01";

export function isFindingVerdict(value) {
  return FINDING_VERDICT_VALUES.indexOf(value) >= 0;
}

function createFinding(finding) {
  return Object.freeze({
    id: finding.id,
    question: finding.question,
    verdict: finding.verdict,
    answer: finding.answer,
    impactedPhases: Object.freeze((finding.impactedPhases || []).slice()),
    scopeChange: finding.scopeChange || "",
    evidence: Object.freeze(
      (finding.evidence || []).map((item) =>
        Object.freeze({
          project: item.project || AUDIT_TARGET_PROJECT,
          file: item.file,
          lines: item.lines || "",
          note: item.note || "",
        }),
      ),
    ),
  });
}

const AUDIT_FINDINGS = [
  {
    id: "atlas-depth-hook-is-alive",
    question:
      "Section 2.2 of the plan says the shadow atlas is DORMANT because renderSceneDepth is null. Is it still dormant?",
    verdict: FINDING_VERDICT.PLAN_OUTDATED,
    answer:
      "No. Phase 19 of the shadow roadmap woke it: createAtlasDepthRenderer is a real depth hook wired into the MegaLights state, and buildAtlasGlsl is injected into the clustered fragment behind uAtlasOn. What is still missing is the deterministic path: normal spot, point and surface lights never read the atlas, so no local light gets its own atlas shadow yet.",
    impactedPhases: ["LL-F10", "LL-F11", "LL-F13", "LL-F14", "LL-F16"],
    scopeChange:
      "LL-F10 becomes 'extend the awake atlas to the deterministic path' instead of 'wake the atlas', and it must keep the MegaLights fragment byte for byte.",
    evidence: [
      { file: "src/viewport/shadowAtlas.js", lines: "313-354", note: "createAtlasDepthRenderer: real MeshDepthMaterial RGBADepthPacking pass" },
      { file: "src/viewport/shadowAtlas.js", lines: "142", note: "fail-safe: no hook means clearAllMeta()" },
      { file: "src/viewport/lightingRender.js", lines: "7442-7462", note: "megaLightsStateBuf.renderSceneDepth = atlasDepthHook" },
      { file: "src/lighting/lightClusterCore.js", lines: "396-408, 497-507", note: "atlas GLSL injected in buildClusterFrag, gated by uAtlasOn" },
      { file: "SOMBRAS-VS-UE58-ROADMAP.md", lines: "673-691", note: "phase 19 status block, including the honest pending items" },
    ],
  },
  {
    id: "transmission-tint-alive-in-cluster-pass",
    question:
      "Line 60 of the plan lists transmissionShadowCore as dormant together with the atlas. Is the colored tint dead code?",
    verdict: FINDING_VERDICT.PLAN_PARTIALLY_TRUE,
    answer:
      "It is not dead, it is unreachable outside MegaLights: rswSaTint is called inside the clustered fragment, so colored transmission already runs there, while the deterministic spot path and the SSS path still ignore local lights.",
    impactedPhases: ["LL-F16"],
    scopeChange:
      "LL-F16 starts from working colored tint code and only needs to reach the deterministic path plus the SSS response.",
    evidence: [
      { file: "src/lighting/lightClusterCore.js", lines: "507, 536", note: "rswAtlasTint = rswSaTint(P, lPos), neutral when uAtlasOn is 0" },
      { file: "PLANO-LUZES-LOCAIS-VS-UE58.md", lines: "60", note: "inventory row that says 'dormente junto com o atlas'" },
    ],
  },
  {
    id: "local-volumetric-inscatter-exists-unshadowed",
    question: "Row 16 of the parity table says local volumetric scattering is absent. Is there really nothing?",
    verdict: FINDING_VERDICT.PLAN_PARTIALLY_TRUE,
    answer:
      "There is an unshadowed version already shipping: pickVolLightsJs selects the top N local lights by intensity times range over distance and localInscatterJs integrates an isotropic in-scatter with no occlusion. Missing for parity: shadowed froxels and a per light VolumetricScatteringIntensity.",
    impactedPhases: ["LL-F17"],
    scopeChange:
      "LL-F17 adds occlusion and the per light knob on top of existing code, so its risk drops and its A/B must prove the unshadowed result did not change when the flag is off.",
    evidence: [
      { file: "src/lighting/volumetricFogCore.js", lines: "161-168", note: "localInscatterJs, analytic integral, explicitly 'sem oclusao'" },
      { file: "src/lighting/volumetricFogCore.js", lines: "170-199", note: "pickVolLightsJs, top N by weight, capped by VOL_FOG_MAX_LIGHTS" },
      { file: "src/viewport/lightingRender.js", lines: "267, 7585", note: "import and per frame call, so the path is live" },
    ],
  },
  {
    id: "gi-local-light-cap-is-16",
    question: "Row 17 says local lights reach GI with a 16 light cap and no per light scale. Confirmed?",
    verdict: FINDING_VERDICT.PLAN_CONFIRMED,
    answer: "Confirmed: the voxel GI injection is capped at 16 lights by a constant and there is no per light indirect scale anywhere in the core.",
    impactedPhases: ["LL-F18"],
    evidence: [
      { file: "src/lighting/voxelGiCore.js", lines: "26", note: "GI_MAX_LIGHTS = 16" },
      { file: "src/lighting/giBounceCore.js", lines: "32-33", note: "emissive bounce budgets, separate from the light cap" },
    ],
  },
  {
    id: "ies-cookie-light-cap-is-8",
    question: "Is the IES and cookie cap of 8 lights real, and where does it come from?",
    verdict: FINDING_VERDICT.PLAN_CONFIRMED,
    answer:
      "Confirmed and located: the injected chunk only applies the profile while the unrolled loop index is below 8, clamping the slot to 7 above that. It is a GLSL unroll limit, not a data limit, so LL-F20 must change the addressing, not the budget.",
    impactedPhases: ["LL-F20"],
    evidence: [
      { file: "src/lighting/iesCookieCore.js", lines: "395-402", note: "IDX_SPOT literal guard UNROLLED_LOOP_INDEX below 8" },
      { file: "PLANO-LUZES-LOCAIS-VS-UE58.md", lines: "30", note: "inherited residual declared in the plan" },
    ],
  },
  {
    id: "cluster-pass-feeds-megalights-only",
    question: "There is a clustered light pass in the engine. Does it already shade normal local lights?",
    verdict: FINDING_VERDICT.PLAN_CONFIRMED,
    answer:
      "No. The cluster buffers are built to stay aligned one to one with the MegaLights light texture and are consumed by that pass only; every other local light is still shaded one by one by the three.js forward path.",
    impactedPhases: ["LL-F20", "LL-F21"],
    evidence: [
      { file: "src/lighting/lightClusterCore.js", lines: "38-43", note: "CL_MAX_LIGHTS 512, 32 lights per cell, aligned with ML_MAX_LIGHTS 128" },
      { file: "src/lighting/lightClusterCore.js", lines: "148-161", note: "same filter and same order as the MegaLights pass" },
    ],
  },
  {
    id: "console-errors-not-reproduced",
    question: "Section 1 of the plan lists 4 active console errors that were never triaged. Are they still there?",
    verdict: FINDING_VERDICT.NOT_REPRODUCED,
    answer:
      "Not reproduced on 2026-09-01: both previews report zero console errors (engine web and this bench), so the LL-F1 triage closes with zero light related blockers. The console recorder stays installed in the bench so the next error is classified the moment it happens instead of being carried as folklore.",
    impactedPhases: ["LL-F1"],
    evidence: [
      { project: "engine web", file: "editor project status", lines: "2026-09-01", note: "0 console errors reported for the engine preview" },
      { project: "luzes locais", file: "editor preview console", lines: "2026-09-01", note: "only MCP relay logs, no application error" },
      { project: "engine web", file: "PLANO-LUZES-LOCAIS-VS-UE58.md", lines: "section 1", note: "original claim of 4 untriaged errors" },
    ],
  },
];

export const LOCAL_LIGHT_AUDIT_FINDINGS = Object.freeze(AUDIT_FINDINGS.map(createFinding));

export function auditFindingIds() {
  return LOCAL_LIGHT_AUDIT_FINDINGS.map((finding) => finding.id);
}

export function findAuditFinding(findingId) {
  return LOCAL_LIGHT_AUDIT_FINDINGS.find((finding) => finding.id === findingId) || null;
}

export function auditFindingsByVerdict(verdict) {
  return LOCAL_LIGHT_AUDIT_FINDINGS.filter((finding) => finding.verdict === verdict);
}

export function auditFindingsThatChangePhaseScope() {
  return LOCAL_LIGHT_AUDIT_FINDINGS.filter((finding) => finding.scopeChange !== "");
}

export function auditFindingsWithoutEvidence() {
  return LOCAL_LIGHT_AUDIT_FINDINGS.filter(
    (finding) => finding.evidence.length === 0 || finding.evidence.some((item) => !item.file),
  );
}

export function buildAuditFindingsReport() {
  const totals = {};
  FINDING_VERDICT_VALUES.forEach((verdict) => {
    totals[verdict] = auditFindingsByVerdict(verdict).length;
  });
  const scopeChanges = auditFindingsThatChangePhaseScope().map((finding) => ({
    id: finding.id,
    impactedPhases: finding.impactedPhases.slice(),
    scopeChange: finding.scopeChange,
  }));
  const withoutEvidence = auditFindingsWithoutEvidence().map((finding) => finding.id);
  return {
    auditDate: AUDIT_DATE,
    targetProject: AUDIT_TARGET_PROJECT,
    total: LOCAL_LIGHT_AUDIT_FINDINGS.length,
    totals,
    scopeChanges,
    withoutEvidence,
    everyFindingHasEvidence: withoutEvidence.length === 0,
  };
}
