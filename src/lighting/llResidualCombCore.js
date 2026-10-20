export const RESIDUAL_SEVERITY = Object.freeze({
  BLOCKING: "blocking",
  OPEN: "open",
  ACCEPTED: "accepted",
});

export const RESIDUAL_COMB_VERSION = "LL-F24/2026-09-01";

export const LOCAL_LIGHT_RESIDUALS = Object.freeze([
  Object.freeze({
    id: "nothing-ported-to-the-engine",
    phase: "LL-F24",
    severity: RESIDUAL_SEVERITY.BLOCKING,
    statement:
      "No LL phase is ported to the engine yet. Section 0 asks whether the local light OF THE ENGINE looks like Unreal 5.8, so a blind round shot with bench stills answers a different question.",
    evidence: "PLANO-LUZES-LOCAIS-VS-UE58.md section 7: every status block reads FEITA NA BANCADA, NAO portada para esta engine",
  }),
  Object.freeze({
    id: "ll-f23-not-executed",
    phase: "LL-F23",
    severity: RESIDUAL_SEVERITY.BLOCKING,
    statement:
      "The full battery of LL-F23 (specs one by one, live QA and bench on two GPU classes) was never executed, and LL-F24 declares LL-F23 as its dependency.",
    evidence: "PLANO-LUZES-LOCAIS-VS-UE58.md section 7 has no status block for LL-F23 and section 11 has no LL-F23 row",
  }),
  Object.freeze({
    id: "unreal-stills-missing",
    phase: "LL-F24",
    severity: RESIDUAL_SEVERITY.BLOCKING,
    statement:
      "The 8 Unreal 5.8 stills are exported by the owner and none is registered in the bench, so the cabin has no pair to show.",
    evidence: "PLANO-LUZES-LOCAIS-VS-UE58.md section 7, LL-F24: still UE 5.8 exportado pelo dono (mesma camera/fotometria)",
  }),
  Object.freeze({
    id: "evaluators-missing",
    phase: "LL-F24",
    severity: RESIDUAL_SEVERITY.BLOCKING,
    statement:
      "The protocol needs at least 3 human evaluators. The bench builds and serves the cabin, counts the votes and refuses to certify, but it cannot vote.",
    evidence: "PLANO-LUZES-LOCAIS-VS-UE58.md section 10, gate 4",
  }),
  Object.freeze({
    id: "performance-gates-not-measured",
    phase: "LL-F23",
    severity: RESIDUAL_SEVERITY.BLOCKING,
    statement:
      "The fps gates of the two GPU classes were never measured: the preview only gives real timing with the project active on screen, and the bench shares the screen with the engine project.",
    evidence: "DIARIO-BANCADA.md, rows LL-F2, LL-F20 and LL-F16 (pixel and fps proofs pending)",
  }),
  Object.freeze({
    id: "pixel-proofs-pending",
    phase: "LL-F2",
    severity: RESIDUAL_SEVERITY.BLOCKING,
    statement:
      "The A/B of pixels of several phases is still open because the headless capture comes back almost black, so SSIM would be comparing two black frames.",
    evidence: "DIARIO-BANCADA.md, row LL-F2: qaCena('ll-f2') gave QA 0/1 with mean luminance 0.000243",
  }),
  Object.freeze({
    id: "cluster-has-no-shadow",
    phase: "LL-F20",
    severity: RESIDUAL_SEVERITY.OPEN,
    statement:
      "The cluster path does not sample a shadow map: every light that casts shadow stays in the forward path, so the performance win is smaller in scenes full of shadow casting lights.",
    evidence: "PLANO-LUZES-LOCAIS-VS-UE58.md section 7, LL-F20, honest pendency 1",
  }),
  Object.freeze({
    id: "cluster-without-ies-cookies",
    phase: "LL-F20",
    severity: RESIDUAL_SEVERITY.OPEN,
    statement:
      "IES profiles and cookies indexed per light, the other half of the LL-F20 objective, are not done. The layout already reserves the atlasSlot field.",
    evidence: "PLANO-LUZES-LOCAIS-VS-UE58.md section 7, LL-F20, honest pendency 2",
  }),
  Object.freeze({
    id: "public-api-round-trip-on-text",
    phase: "LL-F22",
    severity: RESIDUAL_SEVERITY.OPEN,
    statement:
      "The round trip of the public API is proven on the attribute TEXT, not by writing and reading a real .rbxlx file, and the 65 frozen properties of IL_PUBLIC_API can only be checked inside the engine.",
    evidence: "PLANO-LUZES-LOCAIS-VS-UE58.md section 7, LL-F22, honest pendency 2",
  }),
  Object.freeze({
    id: "ies-multiplier-assumed-one",
    phase: "LL-F3",
    severity: RESIDUAL_SEVERITY.OPEN,
    statement:
      "The LM-63 parser of IL-F26 does not expose the candela multiplier of the header, so LL-F3 assumes multiplier 1 and a profile with a different multiplier needs an additive change in the engine.",
    evidence: "PLANO-LUZES-LOCAIS-VS-UE58.md section 7, LL-F3, residual b",
  }),
  Object.freeze({
    id: "megalights-keeps-legacy-falloff",
    phase: "LL-F2",
    severity: RESIDUAL_SEVERITY.ACCEPTED,
    statement:
      "The CPU mirror mlWeightAt of megaLightsCore keeps the legacy falloff on purpose: MegaLights is a frozen niche and the divergence is registered in the LL-F1 ledger.",
    evidence: "PLANO-LUZES-LOCAIS-VS-UE58.md section 7, LL-F2, objective and residual c",
  }),
  Object.freeze({
    id: "animated-scenes-outside-byte-gate",
    phase: "LL-F1",
    severity: RESIDUAL_SEVERITY.ACCEPTED,
    statement:
      "Animated scenes never reach SSIM 0.99999 between two captures, so the byte for byte gate is only measurable on the deterministic scenes. For the blind round it also means the still of an animated scene is one frame among many.",
    evidence: "PLANO-LUZES-LOCAIS-VS-UE58.md section 7, LL-F1, defect 2",
  }),
]);

export function residualIds() {
  return LOCAL_LIGHT_RESIDUALS.map((residual) => residual.id);
}

export function residualsForPhase(phaseId) {
  return LOCAL_LIGHT_RESIDUALS.filter((residual) => residual.phase === phaseId);
}

export function blockingResiduals() {
  return LOCAL_LIGHT_RESIDUALS.filter((residual) => residual.severity === RESIDUAL_SEVERITY.BLOCKING);
}

export function everyResidualHasEvidence() {
  return LOCAL_LIGHT_RESIDUALS.every((residual) => !!residual.evidence && !!residual.statement);
}


export function summarizeResidualComb(deliveredPhaseIds) {
  const delivered = Array.isArray(deliveredPhaseIds) ? deliveredPhaseIds : [];
  const totals = { blocking: 0, open: 0, accepted: 0 };
  LOCAL_LIGHT_RESIDUALS.forEach((residual) => {
    if (totals[residual.severity] === undefined) return;
    totals[residual.severity] += 1;
  });
  const phasesWithResiduals = [];
  LOCAL_LIGHT_RESIDUALS.forEach((residual) => {
    if (phasesWithResiduals.indexOf(residual.phase) < 0) phasesWithResiduals.push(residual.phase);
  });
  const deliveredWithoutResidual = delivered.filter((phaseId) => phasesWithResiduals.indexOf(phaseId) < 0);
  return {
    version: RESIDUAL_COMB_VERSION,
    total: LOCAL_LIGHT_RESIDUALS.length,
    totals,
    blocking: blockingResiduals().map((residual) => residual.id),
    phasesWithResiduals,
    deliveredWithoutResidual,
    everyResidualHasEvidence: everyResidualHasEvidence(),

    clear: totals.blocking === 0,
  };
}
