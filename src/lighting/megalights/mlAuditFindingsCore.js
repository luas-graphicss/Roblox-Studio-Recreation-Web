function auditFinding(definition) {
  return Object.freeze({
    id: definition.id,
    title: definition.title,
    engineFile: definition.engineFile,
    evidence: definition.evidence || null,
    observation: definition.observation,
    consequence: definition.consequence,
    parityTermNumbers: Object.freeze(definition.parityTermNumbers.slice()),
    confirmed: definition.confirmed === true,
    verificationNote: definition.verificationNote || "",
  });
}

export const ML_AUDIT_FINDINGS = Object.freeze([
  auditFinding({
    id: "liteCeilingIsOneHundredTwentyEightLights",
    title: "The lite path stops at 128 lights",
    engineFile: "src/lighting/megaLightsCore.js",
    evidence: "src/lighting/megaLightsCore.js:15",
    observation: "ML_MAX_LIGHTS is 128 and sizes the data texture that feeds the whole lite path",
    consequence: "the ceiling of 512 area lights cannot be reached by widening the lite buffer alone",
    parityTermNumbers: [39],
    confirmed: true,
  }),
  auditFinding({
    id: "litePacksTwoTexelsPerLight",
    title: "The lite light buffer stores two texels per light",
    engineFile: "src/lighting/megaLightsCore.js",
    evidence: "src/lighting/megaLightsCore.js:16",
    observation: "ML_TEX_WIDTH is ML_MAX_LIGHTS times two, that is two RGBA float texels per light",
    consequence: "the bench contract reserves four texels per light, so ML-F4 writes a different layout and the lite reader cannot be pointed at the new buffer",
    parityTermNumbers: [11],
    confirmed: true,
  }),
  auditFinding({
    id: "liteUsesGoldenRatioHashInsteadOfBlueNoise",
    title: "Sample dithering is a golden ratio hash",
    engineFile: "src/lighting/megaLightsCore.js",
    evidence: "src/lighting/megaLightsCore.js:17",
    observation: "ML_GOLDEN is 0.61803398875 and drives the per pixel dither",
    consequence: "the noise is not spatio temporal blue noise, so the denoiser faces a harder error spectrum",
    parityTermNumbers: [4],
    confirmed: true,
  }),
  auditFinding({
    id: "liteReservoirDrawsASingleSample",
    title: "The reservoir keeps a single sample and ignores the BRDF",
    engineFile: "src/lighting/megaLightsCore.js",
    evidence: "src/lighting/megaLightsCore.js:89",
    observation: "reservoirPick walks the weights once and returns one index, and mlWeightAt weighs luminance times an attenuation window with no BRDF term",
    consequence: "cost still scales with the number of lights and the weight is not Log2Luminance(BRDF) plus one",
    parityTermNumbers: [5, 6],
    confirmed: true,
  }),
  auditFinding({
    id: "liteAppliesOneScalarShadowFactor",
    title: "One scalar multiplies the already shaded colour",
    engineFile: "src/lighting/megaLightsCore.js",
    evidence: "src/lighting/megaLightsCore.js:107",
    observation: "mlShadowFactor(blocked, wsum, base, strength) returns a single scalar",
    consequence: "diffuse and specular cannot be separated and albedo cannot be factored out, because the shading already happened",
    parityTermNumbers: [23, 24, 25],
    confirmed: true,
  }),
  auditFinding({
    id: "liteBuildsItsOwnFragmentAndOnlyDarkens",
    title: "The lite path darkens the buffer instead of replacing shading",
    engineFile: "src/lighting/megaLightsCore.js",
    evidence: "src/lighting/megaLightsCore.js:118",
    observation: "buildMegaLightsFrag assembles a fragment that consumes the already lit buffer",
    consequence: "this is the structural reason parity is estimated at roughly eight percent: the feature is cosmetic, not a lighting path",
    parityTermNumbers: [1, 23, 40],
    confirmed: true,
  }),
  auditFinding({
    id: "shadowAtlasHookIsStillNull",
    title: "The shadow atlas is complete and dormant",
    engineFile: "src/viewport/shadowAtlas.js",
    evidence: "SOMBRAS-VS-UE58-ROADMAP.md:64",
    observation: "buildAtlasGlsl, rswSaVis and uAtlasOn are injected into no real shader and the renderSceneDepth hook is still null",
    consequence: "ML-F15 is the gate of the whole port: shipping later phases without it means porting code that compiles and lights nothing",
    parityTermNumbers: [20],
    confirmed: true,
  }),
  auditFinding({
    id: "shadowAtlasDormancyProvenByProjectWideSearch",
    title: "Dormancy was proven by a project wide search, not assumed",
    engineFile: "SOMBRAS-VS-UE58-ROADMAP.md",
    evidence: "SOMBRAS-VS-UE58-ROADMAP.md:570",
    observation: "an honesty note records that a project wide search found no real shader receiving the atlas GLSL",
    consequence: "the atlas infrastructure is tested but unreachable, so its only cost today is memory",
    parityTermNumbers: [20],
    confirmed: true,
  }),
  auditFinding({
    id: "shadowAtlasAllocatesMemoryWhileDormant",
    title: "A dormant phase already holds video memory",
    engineFile: "SOMBRAS-VS-UE58-ROADMAP.md",
    evidence: "SOMBRAS-VS-UE58-ROADMAP.md:566",
    observation: "a 4096 squared render target with depth is allocated eagerly while renderSceneDepth stays null",
    consequence: "ML-F15 must wake the atlas or release the allocation; paying for an unused target is a declared residue, not a feature",
    parityTermNumbers: [20],
    confirmed: true,
  }),
  auditFinding({
    id: "lightClusterIsSinglePassWithoutHierarchicalDepth",
    title: "The froxel cluster is one pass and never consults depth",
    engineFile: "src/lighting/lightClusterCore.js",
    evidence: "PLANO-MEGALIGHTS-UE59-FUTURE.md:99",
    observation: "the cluster is 16 by 9 by 24, that is 3456 cells, built in a single pass and feeding only the lite path",
    consequence: "ML-F5 must extend this structure with a coarse pass and hierarchical depth culling, never replace it",
    parityTermNumbers: [10, 11],
    confirmed: true,
  }),
  auditFinding({
    id: "iesProfilesAreStoredPerLight",
    title: "IES profiles are stored per light, with a ceiling of eight",
    engineFile: "src/lighting/iesCookieCore.js",
    evidence: "PLANO-MEGALIGHTS-UE59-FUTURE.md:110",
    observation: "cookies and IES profiles live per light instead of in a shared atlas",
    consequence: "the target of 64 profiles in one texture unit requires the atlas of ML-F6",
    parityTermNumbers: [16, 17],
    confirmed: true,
  }),
  auditFinding({
    id: "areaLightTablesAlreadyCostTwoTextureUnits",
    title: "Area lights already spend two texture units",
    engineFile: "src/lighting/ltcCore.js",
    evidence: "PLANO-MEGALIGHTS-UE59-FUTURE.md:109",
    observation: "the linearly transformed cosine tables occupy two of the sixteen guaranteed fragment texture units",
    consequence: "every phase that wants a texture reserves it in the contract; crossing the ceiling does not degrade, the shader fails to link",
    parityTermNumbers: [12, 13, 14],
    confirmed: true,
  }),
  auditFinding({
    id: "lightingRenderHasTwoBranches",
    title: "The lighting renderer has two branches that must be patched together",
    engineFile: "src/lighting/lightingRender.js",
    evidence: null,
    observation: "the file carries one path for an individual piece and another for the instanced pool, and the per light loop lives in both",
    consequence: "a patch applied to only one branch lights the same scene in two different ways depending on how the piece was created",
    parityTermNumbers: [1],
    confirmed: false,
    verificationNote: "the two branches come from the plan audit; the exact line of each branch still has to be read in the 454 KB file",
  }),
  auditFinding({
    id: "publicLightingApiIsFrozenUntilPhaseTwentySeven",
    title: "The public lighting API is frozen until ML-F27",
    engineFile: "src/lighting/publicApiCore.js",
    evidence: null,
    observation: "the public surface exposes 65 properties that existing scenes already depend on",
    consequence: "no phase before ML-F27 may rename or remove a property, so MegaLights grows behind the existing surface",
    parityTermNumbers: [40],
    confirmed: false,
    verificationNote: "the count of 65 properties comes from the bench bridge document and was not counted line by line",
  }),
]);

export function listAuditFindings() {
  return ML_AUDIT_FINDINGS;
}

export function auditFindingById(findingId) {
  return ML_AUDIT_FINDINGS.find((finding) => finding.id === findingId) || null;
}

export function auditFindingsForParityTerm(termNumber) {
  return ML_AUDIT_FINDINGS.filter((finding) => finding.parityTermNumbers.indexOf(termNumber) >= 0);
}

export function confirmedAuditFindings() {
  return ML_AUDIT_FINDINGS.filter((finding) => finding.confirmed);
}


export function unconfirmedAuditFindings() {
  return ML_AUDIT_FINDINGS.filter((finding) => !finding.confirmed);
}

export function auditFindingsSummary() {
  const coveredTermNumbers = [];
  ML_AUDIT_FINDINGS.forEach((finding) => {
    finding.parityTermNumbers.forEach((termNumber) => {
      if (coveredTermNumbers.indexOf(termNumber) < 0) {
        coveredTermNumbers.push(termNumber);
      }
    });
  });
  return {
    totalFindings: ML_AUDIT_FINDINGS.length,
    confirmed: confirmedAuditFindings().length,
    unconfirmed: unconfirmedAuditFindings().length,
    parityTermsCovered: coveredTermNumbers.sort((first, second) => first - second),
  };
}
