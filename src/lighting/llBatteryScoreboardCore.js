import { BATTERY_TIER_ORDER, GPU_CLASS_BY_TIER } from "./llBatteryContract.js";

const NOT_MEASURED = "nao medido";

function formatFps(value) {
  return Number.isFinite(value) ? value.toFixed(1) : NOT_MEASURED;
}

function formatMs(value) {
  return Number.isFinite(value) ? value.toFixed(3) : NOT_MEASURED;
}

function formatVerdict(passed) {
  return passed === true ? "ok" : "FALHA";
}

function tierList(report) {
  const tiers = report && Array.isArray(report.tiers) && report.tiers.length ? report.tiers : BATTERY_TIER_ORDER;
  return tiers.slice();
}

function perfSampleOf(report, tier, sceneId) {
  const samples = report && report.perfLane && Array.isArray(report.perfLane.samples) ? report.perfLane.samples : [];
  return samples.find((sample) => sample && sample.tier === tier && sample.sceneId === sceneId) || null;
}

function qaResultsOfScene(report, sceneId) {
  const results = report && report.qaLane && Array.isArray(report.qaLane.results) ? report.qaLane.results : [];
  return results.filter((result) => result && result.cena === sceneId);
}

function identityResultOf(report, sceneId) {
  const results = report && report.identityLane && Array.isArray(report.identityLane.results) ? report.identityLane.results : [];
  return results.find((result) => result && result.sceneId === sceneId) || null;
}


export function renderScenePerfTable(report) {
  const tiers = tierList(report);
  const sceneIds = report && Array.isArray(report.sceneIds) ? report.sceneIds : [];
  const header = "| Cena | " + tiers.map((tier) => "fps " + tier).join(" | ") + " | Identidade (tudo OFF) | QA da cena |";
  const divider = "| --- |" + tiers.map(() => " --- |").join("") + " --- | --- |";
  const rows = sceneIds.map((sceneId) => {
    const fpsCells = tiers.map((tier) => {
      const sample = perfSampleOf(report, tier, sceneId);
      return sample ? formatFps(sample.fpsAverage) : NOT_MEASURED;
    });
    const identity = identityResultOf(report, sceneId);
    const identityCell = identity
      ? identity.verdict + (identity.deterministic ? "" : " (cena animada)")
      : NOT_MEASURED;
    const qaResults = qaResultsOfScene(report, sceneId);
    const qaCell = qaResults.length
      ? qaResults.filter((result) => result.passou).length + "/" + qaResults.length
      : "sem QA";
    return "| " + sceneId + " | " + fpsCells.join(" | ") + " | " + identityCell + " | " + qaCell + " |";
  });
  return [header, divider].concat(rows).join("\n");
}


export function renderTierTable(report) {
  const summaries = report && report.perfLane && Array.isArray(report.perfLane.summaries) ? report.perfLane.summaries : [];
  const header = "| Tier | Classe de GPU | Cenas medidas | fps medio | Pior cena | Piso do plano |";
  const divider = "| --- | --- | --- | --- | --- | --- |";
  const rows = summaries.map((summary) => {
    return (
      "| " +
      summary.tier +
      " | " +
      (summary.gpuClass || GPU_CLASS_BY_TIER[summary.tier] || "") +
      " | " +
      summary.measuredSceneCount +
      "/" +
      summary.sceneCount +
      " | " +
      formatFps(summary.averageFps) +
      " | " +
      (summary.worstSceneId ? summary.worstSceneId + " (" + formatFps(summary.worstSceneFps) + ")" : NOT_MEASURED) +
      " | " +
      (summary.minimumFps === null ? "overhead " + formatMs(report.identityLane && report.identityLane.overhead ? report.identityLane.overhead.budgetMs : null) + " ms" : summary.minimumFps + " fps") +
      " |"
    );
  });
  return [header, divider].concat(rows).join("\n");
}

export function renderGateTable(verdict) {
  const gates = verdict && Array.isArray(verdict.gates) ? verdict.gates : [];
  const header = "| Portao | Veredito | Medida |";
  const divider = "| --- | --- | --- |";
  const rows = gates.map((gate) => "| " + gate.title + " | " + formatVerdict(gate.passed) + " | " + gate.detail + " |");
  return [header, divider].concat(rows).join("\n");
}

export function renderSpecLaneTable(specLane) {
  const suites = specLane && Array.isArray(specLane.suites) ? specLane.suites : [];
  const header = "| Suite de spec | ok | falhas | pulados |";
  const divider = "| --- | --- | --- | --- |";
  const rows = suites.map((suite) => "| " + suite.name + " | " + suite.ok + " | " + suite.failed + " | " + suite.skipped + " |");
  return [header, divider].concat(rows).join("\n");
}


export function renderScoreboard(report) {
  if (!report) return "LL-F23: nenhuma bateria executada ainda.";
  const verdict = report.verdict || {};
  const specTotals = (report.specLane && report.specLane.totals) || {};
  const qaTotals = (report.qaLane && report.qaLane.totals) || {};
  const lines = [
    "### Placar LL-F23 - bateria de prova das luzes locais",
    "",
    "- Bateria: " +
      (report.finishedAt ? new Date(report.finishedAt).toISOString() : "em andamento") +
      " | duracao " +
      (Number.isFinite(report.durationMs) ? Math.round(report.durationMs / 1000) + " s" : NOT_MEASURED),
    "- Portoes: " + (verdict.passedCount || 0) + " de " + (verdict.totalCount || 0) + " | selo final: " + (verdict.sealed === true ? "SIM" : "NAO"),
    "- Specs: " + (specTotals.ok || 0) + " ok, " + (specTotals.failed || 0) + " falha(s), " + (specTotals.skipped || 0) + " pulado(s)",
    "- QA de cena: " + (qaTotals.passou || 0) + " de " + (qaTotals.total || 0),
    "",
    renderTierTable(report),
    "",
    renderScenePerfTable(report),
    "",
    renderGateTable(verdict),
  ];
  return lines.join("\n");
}


export function renderDiaryRow(input) {
  const source = input || {};
  const report = source.report || {};
  const verdict = report.verdict || {};
  const specTotals = (report.specLane && report.specLane.totals) || {};
  const qaTotals = (report.qaLane && report.qaLane.totals) || {};
  const summaries = (report.perfLane && report.perfLane.summaries) || [];
  const fpsText = summaries
    .map((summary) => summary.tier + " " + formatFps(summary.averageFps))
    .join(" / ");
  const overhead = report.identityLane && report.identityLane.overhead;
  const result =
    "Bateria executada: portoes " +
    (verdict.passedCount || 0) +
    "/" +
    (verdict.totalCount || 0) +
    ", specs " +
    (specTotals.ok || 0) +
    " ok e " +
    (specTotals.failed || 0) +
    " falha(s), QA " +
    (qaTotals.passou || 0) +
    "/" +
    (qaTotals.total || 0) +
    ", fps medio " +
    (fpsText || NOT_MEASURED) +
    ", overhead da GPU fraca " +
    (overhead ? formatMs(overhead.worstOverheadMs) + " ms" : NOT_MEASURED) +
    ", selo " +
    (verdict.sealed === true ? "SIM" : "NAO") +
    ". Bloqueios: " +
    ((verdict.blockers || []).join(", ") || "nenhum") +
    ".";
  return (
    "| " +
    (source.date || "") +
    " | LL-F23 | " +
    (source.author || "") +
    " | " +
    result +
    " | " +
    (source.evidence || "`__llLab.battery.result()`") +
    " |"
  );
}
