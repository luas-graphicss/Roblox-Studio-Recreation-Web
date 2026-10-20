import { BATTERY_TIER_ORDER } from "./llBatteryContract.js";
import { LOCAL_LIGHT_PHASE_TOTAL } from "./llPhaseInventoryCore.js";
import { evaluateFpsGate, evaluateOverheadGate, FPS_GATED_TIERS, WEAK_TIER } from "./llPerfGateCore.js";
import { MAX_TEXTURE_UNITS } from "./llVerdictGatesCore.js";

export const BATTERY_STEP_KINDS = Object.freeze({
  SPECS: "specs",
  IDENTITY: "identity",
  PERF: "perf",
  QA: "qa",
});

export const BATTERY_GATE_IDS = Object.freeze({
  PHASE_COVERAGE: "phase-coverage",
  SPECS_GREEN: "inherited-specs-green",
  SCENE_BATTERY_GREEN: "scene-battery-green",
  WEAK_BYTE_EXACT: "weak-tier-byte-exact",
  TEXTURE_UNITS: "texture-units-budget",
});


export function buildBatteryPlan(input) {
  const source = input || {};
  const suiteNames = Array.isArray(source.suiteNames) ? source.suiteNames.filter(Boolean) : [];
  const sceneIds = Array.isArray(source.sceneIds) ? source.sceneIds.filter(Boolean) : [];
  const tiers = Array.isArray(source.tiers) && source.tiers.length ? source.tiers.slice() : BATTERY_TIER_ORDER.slice();
  const qaIds = Array.isArray(source.qaIds) ? source.qaIds.filter(Boolean) : [];
  const identityTier = source.identityTier || tiers[0] || WEAK_TIER;

  const steps = [];
  suiteNames.forEach((suiteName) => {
    steps.push({ kind: BATTERY_STEP_KINDS.SPECS, suiteName, label: "spec " + suiteName });
  });
  sceneIds.forEach((sceneId) => {
    steps.push({
      kind: BATTERY_STEP_KINDS.IDENTITY,
      tier: identityTier,
      sceneId,
      label: "identidade e overhead " + sceneId + " (tier " + identityTier + ")",
    });
  });
  tiers.forEach((tier) => {
    sceneIds.forEach((sceneId) => {
      steps.push({ kind: BATTERY_STEP_KINDS.PERF, tier, sceneId, label: "fps " + sceneId + " (tier " + tier + ")" });
    });
  });
  qaIds.forEach((qaId) => {
    steps.push({ kind: BATTERY_STEP_KINDS.QA, qaId, label: "qa " + qaId });
  });

  return {


    sequential: true,
    identityTier,
    tiers,
    sceneIds,
    steps: steps.map((step, index) => Object.freeze(Object.assign({ index }, step))),
    totals: {
      steps: steps.length,
      specs: suiteNames.length,
      identity: sceneIds.length,
      perf: tiers.length * sceneIds.length,
      qa: qaIds.length,
    },
  };
}

function gateResult(id, title, passed, detail) {
  return { id, title, passed: passed === true, detail: detail || "" };
}

function joinIds(ids) {
  return Array.isArray(ids) && ids.length ? ids.join(", ") : "";
}


export function evaluateBattery(input) {
  const source = input || {};
  const specLane = source.specLane || {};
  const qaLane = source.qaLane || {};
  const identityLane = source.identityLane || {};
  const perfLane = source.perfLane || {};
  const coverage = source.phaseCoverage || {};
  const textureUnits = Number.isFinite(source.textureUnits) ? source.textureUnits : null;
  const specTotals = specLane.totals || {};
  const qaTotals = qaLane.totals || {};
  const identitySummary = identityLane.summary || {};
  const overheadSummary = identityLane.overhead || null;
  const perfSummaries = Array.isArray(perfLane.summaries) ? perfLane.summaries : [];

  const gates = [];

  const phasesWithBoth = Number.isFinite(coverage.phasesWithBoth) ? coverage.phasesWithBoth : 0;
  gates.push(
    gateResult(
      BATTERY_GATE_IDS.PHASE_COVERAGE,
      "As " + LOCAL_LIGHT_PHASE_TOTAL + " fases do plano com spec E QA registrados",
      coverage.complete === true,
      phasesWithBoth +
        " de " +
        (coverage.total || LOCAL_LIGHT_PHASE_TOTAL) +
        " fases com spec e QA" +
        (joinIds(coverage.missingSpec) ? "; sem spec: " + joinIds(coverage.missingSpec) : "") +
        (joinIds(coverage.missingQa) ? "; sem QA: " + joinIds(coverage.missingQa) : ""),
    ),
  );

  const specsMeasured = Number.isFinite(specTotals.ok) || Number.isFinite(specTotals.failed);
  gates.push(
    gateResult(
      BATTERY_GATE_IDS.SPECS_GREEN,
      "Specs das fases verdes, rodados um a um",
      specsMeasured && specTotals.green === true,
      specsMeasured
        ? (specTotals.ok || 0) +
            " ok, " +
            (specTotals.failed || 0) +
            " falha(s), " +
            (specTotals.skipped || 0) +
            " pulado(s) em " +
            (specTotals.suites || 0) +
            " suites"
        : "specs nao executados",
    ),
  );

  const qaMeasured = Number.isFinite(qaTotals.total) && qaTotals.total > 0;
  gates.push(
    gateResult(
      BATTERY_GATE_IDS.SCENE_BATTERY_GREEN,
      "QA vivo das cenas verde",
      qaMeasured && qaTotals.verde === true,
      qaMeasured
        ? (qaTotals.passou || 0) + " de " + qaTotals.total + " QA verdes" + (joinIds(qaLane.failures) ? "; falharam: " + joinIds(qaLane.failures) : "")
        : "QA de cena nao executado",
    ),
  );

  const identityMeasured = Number.isFinite(identitySummary.total) && identitySummary.total > 0;
  const brokenSceneIds = Array.isArray(identitySummary.brokenSceneIds) ? identitySummary.brokenSceneIds : [];
  gates.push(
    gateResult(
      BATTERY_GATE_IDS.WEAK_BYTE_EXACT,
      "GPU fraca byte a byte com tudo desligado",
      identityMeasured && identitySummary.allDeterministicIdentical === true && brokenSceneIds.length === 0,
      identityMeasured
        ? identitySummary.identical +
            " de " +
            identitySummary.total +
            " cenas identicas (" +
            identitySummary.deterministicTotal +
            " deterministicas), " +
            identitySummary.withinNoise +
            " dentro do ruido" +
            (brokenSceneIds.length ? ", QUEBRADAS: " + joinIds(brokenSceneIds) : "")
        : "identidade com tudo desligado nao medida",
    ),
  );

  const overheadGate = evaluateOverheadGate(overheadSummary);
  gates.push(gateResult(overheadGate.id, "Overhead da GPU fraca dentro do orcamento", overheadGate.passed, overheadGate.detail));

  FPS_GATED_TIERS.forEach((tier) => {
    const summary = perfSummaries.find((item) => item && item.tier === tier) || null;
    const fpsGate = evaluateFpsGate(summary, tier);
    gates.push(gateResult(fpsGate.id, "fps minimo do tier " + tier + " (" + fpsGate.gpuClass + ")", fpsGate.passed, fpsGate.detail));
  });

  gates.push(
    gateResult(
      BATTERY_GATE_IDS.TEXTURE_UNITS,
      "Orcamento de unidades de textura do fragmento",
      textureUnits !== null && MAX_TEXTURE_UNITS >= textureUnits,
      textureUnits === null ? "unidades de textura nao medidas" : textureUnits + " de " + MAX_TEXTURE_UNITS + " unidades",
    ),
  );

  const passedCount = gates.filter((gate) => gate.passed).length;
  return {
    gates,
    passedCount,
    totalCount: gates.length,
    blockers: gates.filter((gate) => !gate.passed).map((gate) => gate.id),

    sealed: passedCount === gates.length,
  };
}
