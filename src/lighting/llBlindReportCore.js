import { BASELINE_SCENE_IDS } from "./llBaselineCore.js";
import { BLIND_ROUND_MIN_EVALUATORS, BLIND_ROUND_MIN_HIT_RATE } from "./llBlindRoundCore.js";


export const BLIND_SCENE_LABELS = Object.freeze({
  cena1: "Quarto noturno (abajur)",
  cena2: "Bar com 24 spots",
  cena3: "Museu (cookies/gobos)",
  cena4: "Estudio (softbox)",
  cena5: "Corredor com 120 luzes",
  cena6: "Noite de chuva (postes)",
  cena7: "Vitral e cortina (SSS)",
  cena8: "Oficina (estatica + 1 movel)",
});

export function formatRate(rate) {
  if (!Number.isFinite(rate)) return "-";
  return (Math.round(rate * 1000) / 10).toFixed(1) + "%";
}

function sceneVerdict(bucket) {
  if (!bucket || bucket.total === 0) return "PENDENTE";
  return bucket.meetsGate ? "PASSA" : "REPROVA";
}


export function buildBlindRoundTable(gate) {
  const source = gate && typeof gate === "object" ? gate : {};
  const perScene = source.perScene && typeof source.perScene === "object" ? source.perScene : {};
  const lines = [];
  lines.push("| Cena | Nome | Respostas | Confusoes | Taxa | Gate (>= " + formatRate(BLIND_ROUND_MIN_HIT_RATE) + ") |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  BASELINE_SCENE_IDS.forEach((sceneId) => {
    const bucket = perScene[sceneId];
    lines.push(
      "| " +
        sceneId +
        " | " +
        (BLIND_SCENE_LABELS[sceneId] || "-") +
        " | " +
        (bucket ? bucket.total : 0) +
        " | " +
        (bucket ? bucket.confused : 0) +
        " | " +
        formatRate(bucket ? bucket.rate : null) +
        " | " +
        sceneVerdict(bucket) +
        " |",
    );
  });
  lines.push(
    "| GLOBAL | 8 cenas | " +
      (source.total || 0) +
      " | " +
      (source.confused || 0) +
      " | " +
      formatRate(source.rate) +
      " | " +
      (source.verdict || "PENDENTE") +
      " |",
  );
  return lines.join("\n");
}

export function buildProtocolLine(gate) {
  const source = gate && typeof gate === "object" ? gate : {};
  return (
    "Protocolo " +
    (source.scoringVersion || "?") +
    ": " +
    (source.evaluators || 0) +
    "/" +
    BLIND_ROUND_MIN_EVALUATORS +
    " avaliadores, " +
    (source.scenesCovered || 0) +
    "/" +
    (source.scenesExpected || BASELINE_SCENE_IDS.length) +
    " cenas cobertas, taxa global " +
    formatRate(source.rate) +
    "."
  );
}


export function buildDiaryRow(fields) {
  const source = fields && typeof fields === "object" ? fields : {};
  const cell = (value) => String(value === undefined || value === null ? "-" : value).replace(/\|/g, "/");
  return (
    "| " +
    cell(source.date) +
    " | " +
    cell(source.phase) +
    " | " +
    cell(source.author) +
    " | " +
    cell(source.result) +
    " | " +
    cell(source.evidence) +
    " |"
  );
}


export function buildSealStatement(seal) {
  const source = seal && typeof seal === "object" ? seal : {};
  const blockers = Array.isArray(source.blockers) ? source.blockers : [];
  if (source.canFlipSection0) {
    return (
      "SIM - a rodada cega passou em 8/8 cenas com pelo menos " +
      BLIND_ROUND_MIN_EVALUATORS +
      " avaliadores e todos os portoes da secao 10 estao verdes."
    );
  }
  if (blockers.length === 0) return "AINDA NAO - o selo nao foi avaliado.";
  return "AINDA NAO - " + blockers.map((blocker) => blocker.statement || blocker.id || String(blocker)).join(" ");
}

export function buildBlindRoundReport(input) {
  const source = input && typeof input === "object" ? input : {};
  const gate = source.gate || {};
  const stills = source.stillManifest || {};
  const seal = source.seal || {};
  const parts = [];
  parts.push("### LL-F24 - rodada cega contra Unreal 5.8");
  parts.push("");
  parts.push(buildProtocolLine(gate));
  parts.push("");
  parts.push(buildBlindRoundTable(gate));
  parts.push("");
  parts.push(
    "Laminas prontas: " +
      (Array.isArray(stills.readySceneIds) ? stills.readySceneIds.length : 0) +
      "/" +
      (stills.expected || BASELINE_SCENE_IDS.length) +
      " cenas com o par engine + UE 5.8 na mesma camera.",
  );
  parts.push("");
  parts.push("Selo da secao 0: " + buildSealStatement(seal));
  return parts.join("\n");
}
