import { MSM_GATE_COMPARISON, MSM_REQUIREMENT_STATUS, isFiniteNumber } from "./msmGateComparisonCore.js";
import { MSM_CERTIFICATION_STATUS } from "./msmCertCore.js";
import { verdictGateByPlanId } from "./msmVerdictGatesCore.js";

export const MSM_CERT_TABLE_COLUMN_TITLES = Object.freeze([
  "Portão",
  "Métrica",
  "Alvo",
  "Medido",
  "Cenas",
  "Veredito",
]);

const MSM_NOT_MEASURED_LABEL = "não medido";

const MSM_VERDICT_LABELS = Object.freeze({
  passed: "PASSOU",
  failed: "FALHOU",
  pending: "PENDENTE",
});

const MSM_CERTIFICATION_LABELS = Object.freeze({
  certified: "CERTIFICADO",
  refused: "RECUSADO",
  pending: "PENDENTE",
});

export function requirementVerdictLabel(status) {
  return MSM_VERDICT_LABELS[status] || String(status);
}

export function certificationStatusLabel(status) {
  return MSM_CERTIFICATION_LABELS[status] || String(status);
}

function withUnit(value, unit) {
  return unit ? value + " " + unit : String(value);
}


export function formatRequirementTarget(requirement) {
  if (requirement.comparison === MSM_GATE_COMPARISON.atLeast) {
    return withUnit("≥ " + requirement.target, requirement.unit);
  }
  if (requirement.comparison === MSM_GATE_COMPARISON.atMost) {
    return withUnit("≤ " + requirement.target, requirement.unit);
  }
  if (requirement.comparison === MSM_GATE_COMPARISON.exactly) {
    return withUnit("= " + requirement.target, requirement.unit);
  }
  if (requirement.comparison === MSM_GATE_COMPARISON.insideInclusiveRange) {
    return withUnit(requirement.target + "–" + requirement.targetCeiling, requirement.unit);
  }
  if (requirement.comparison === MSM_GATE_COMPARISON.withinRelativeTolerance) {
    return "±" + requirement.target * 100 + "%";
  }
  return withUnit("±" + requirement.target, requirement.unit);
}


export function formatMeasuredValue(args) {
  const measurements = args.measurements && typeof args.measurements === "object" ? args.measurements : {};
  const observed = measurements[args.metric];
  if (!isFiniteNumber(observed)) {
    return MSM_NOT_MEASURED_LABEL;
  }
  return withUnit(observed, args.unit);
}

function escapeTableCell(text) {
  return String(text).split("|").join("\\|");
}

function tableRow(cells) {
  return "| " + cells.map(escapeTableCell).join(" | ") + " |";
}

function sceneCellFor(gate) {
  return gate.sceneNumbers.length === 0 ? "—" : gate.sceneNumbers.join(", ");
}

function requirementRows(args) {
  const rows = [];
  args.verdict.gates.gates.forEach((gateVerdict) => {
    const gate = verdictGateByPlanId(gateVerdict.planId);
    if (!gate) {
      return;
    }
    gate.requirements.forEach((requirement, index) => {
      const requirementVerdict = gateVerdict.requirements[index];
      const status = requirementVerdict ? requirementVerdict.status : MSM_REQUIREMENT_STATUS.pending;
      rows.push(
        tableRow([
          "**" + gate.planId + "**",
          "`" + requirement.metric + "`",
          formatRequirementTarget(requirement) + (requirement.targetFromPlan ? "" : " *(alvo proposto na F1)*"),
          formatMeasuredValue({ measurements: args.measurements, metric: requirement.metric, unit: requirement.unit }),
          sceneCellFor(gate),
          requirementVerdictLabel(status),
        ]),
      );
    });
  });
  return rows;
}


export function renderCertificationTable(args) {
  const header = tableRow(MSM_CERT_TABLE_COLUMN_TITLES);
  const separator = "|" + MSM_CERT_TABLE_COLUMN_TITLES.map(() => "---").join("|") + "|";
  return [header, separator].concat(requirementRows(args)).join("\n");
}

function sceneCoverageLine(verdict) {
  const coverage = verdict.sceneCoverage;
  const covered = coverage.coveredSceneNumbers.length;
  const unjudged = coverage.unjudgedSceneNumbers;
  const unjudgedNote =
    unjudged.length === 0
      ? ""
      : " Cena(s) que nenhum portão do §11 julga: " + unjudged.join(", ") + " (declarado, não escondido).";
  return (
    "- **Cenas do §10 medidas na classe " +
    verdict.referenceGpuClass +
    " @" +
    verdict.referenceResolutionScale +
    ":** " +
    covered +
    "/" +
    coverage.declaredByThePlan +
    "." +
    unjudgedNote
  );
}

function blindRoundLine(verdict) {
  return (
    "- **Rodada cega (prova cruzada em máquina forte, MSM AUTO = OFF, capture-diff byte a byte):** " +
    requirementVerdictLabel(verdict.blindRound.status) +
    " (" +
    verdict.blindRound.checks.filter((check) => check.status === MSM_REQUIREMENT_STATUS.passed).length +
    "/" +
    verdict.blindRound.totalChecks +
    " checagens)."
  );
}

function blockingReasonLines(verdict) {
  if (verdict.blockingReasons.length === 0) {
    return [];
  }
  return ["", "**O que bloqueia hoje:**"].concat(verdict.blockingReasons.map((reason) => "- " + reason));
}

function sectionZeroAnswerLabel(answer) {
  if (answer === "yes") {
    return "SIM";
  }
  if (answer === "no") {
    return "NÃO";
  }
  return "PENDENTE";
}


export function renderCertificationSection(args) {
  const verdict = args.verdict;
  const lines = ["### MegaLights-SM — certificação em GPU fraca (MSM-F34)", ""];

  if (args.roundLabel) {
    lines.push("_Rodada: " + args.roundLabel + "_", "");
  }

  lines.push(
    "**Veredito:** " +
      certificationStatusLabel(verdict.status) +
      " — o §0 responde **" +
      sectionZeroAnswerLabel(verdict.answerToSectionZero) +
      "** (" +
      verdict.gates.passed +
      "/" +
      verdict.gates.totalGates +
      " portões verdes, " +
      verdict.gates.pending +
      " pendentes, " +
      verdict.gates.failed +
      " falhados).",
    "",
    sceneCoverageLine(verdict),
    blindRoundLine(verdict),
    "",
    renderCertificationTable(args),
  );

  blockingReasonLines(verdict).forEach((line) => lines.push(line));

  lines.push(
    "",
    verdict.status === MSM_CERTIFICATION_STATUS.certified
      ? "_Pendente não existe nesta rodada: todos os números foram medidos._"
      : "_Pendente bloqueia: enquanto um número não for medido na máquina alvo, esta tabela não vira SIM._",
  );

  return lines.join("\n");
}
