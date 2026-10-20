import { BASELINE_SCENE_IDS } from "./llBaselineCore.js";
import { BLIND_ROUND_MIN_EVALUATORS } from "./llBlindRoundCore.js";
import { blockingResiduals, summarizeResidualComb } from "./llResidualCombCore.js";
import { LOCAL_LIGHT_PHASE_COUNT, evaluateFinalVerdict } from "./llVerdictGatesCore.js";

export const SECTION_0_ANSWER_NO = "AINDA NAO";
export const SECTION_0_ANSWER_YES = "SIM";


export function toVerdictBlindRound(blindGate) {
  const source = blindGate && typeof blindGate === "object" ? blindGate : {};
  return {
    hitRate: Number.isFinite(source.rate) ? source.rate : null,
    evaluators: Number.isFinite(source.evaluators) ? source.evaluators : 0,
    scenes: Number.isFinite(source.scenesCovered) ? source.scenesCovered : 0,
  };
}

function blocker(id, statement, action) {
  return { id, statement, action };
}

export function evaluateFinalSeal(input) {
  const source = input && typeof input === "object" ? input : {};
  const blindGate = source.blindGate && typeof source.blindGate === "object" ? source.blindGate : {};
  const stills = source.stillManifest && typeof source.stillManifest === "object" ? source.stillManifest : {};
  const deliveredPhaseIds = Array.isArray(source.deliveredPhaseIds) ? source.deliveredPhaseIds : [];
  const verdictState = {
    ...(source.verdictState && typeof source.verdictState === "object" ? source.verdictState : {}),
    blindRound: toVerdictBlindRound(blindGate),
  };
  const verdict = evaluateFinalVerdict(verdictState);
  const comb = summarizeResidualComb(deliveredPhaseIds);
  const blockers = [];

  verdict.gates.forEach((gate) => {
    if (gate.passed) return;
    blockers.push(
      blocker(
        "gate:" + gate.id,
        "Portao da secao 10 aberto - " + gate.title + " (" + (gate.detail || gate.requirement) + ").",
        "Fechar o portao " + gate.id + " antes de tocar na secao 0.",
      ),
    );
  });

  if (blindGate.verdict !== "PASS") {
    blockers.push(
      blocker(
        "blind-round:" + String(blindGate.verdict || "SEM RODADA"),
        "A rodada cega esta " +
          String(blindGate.verdict || "sem nenhuma cedula") +
          ": " +
          (Array.isArray(blindGate.reasons) && blindGate.reasons.length > 0
            ? blindGate.reasons.join("; ")
            : "nenhuma cedula registrada") +
          ".",
        "Rodar a cabine com pelo menos " + BLIND_ROUND_MIN_EVALUATORS + " avaliadores nas 8 cenas.",
      ),
    );
  }

  if (!stills.ready) {
    const missing = Array.isArray(stills.missing) ? stills.missing.length : BASELINE_SCENE_IDS.length;
    const mismatched = Array.isArray(stills.mismatched) ? stills.mismatched.length : 0;
    blockers.push(
      blocker(
        "stills:incomplete",
        "As laminas nao estao completas: " +
          missing +
          " cena(s) sem par e " +
          mismatched +
          " cena(s) com par invalido.",
        "Capturar o still da engine e importar o still UE 5.8 de cada cena, na mesma camera.",
      ),
    );
  } else if (!stills.everyEngineStillFromEngineBuild) {
    blockers.push(
      blocker(
        "stills:bench-build",
        "Os stills do lado 'engine' vieram da BANCADA. A secao 0 pergunta pela luz local DA ENGINE, entao uma rodada tirada da bancada responde outra pergunta.",
        "Portar as fases para a engine e recapturar os stills la antes de fechar o selo.",
      ),
    );
  }

  blockingResiduals().forEach((residual) => {
    blockers.push(
      blocker(
        "residual:" + residual.id,
        "Residual bloqueante de " + residual.phase + " - " + residual.statement,
        "Resolver ou rebaixar o residual " + residual.id + " com prova, nao com texto.",
      ),
    );
  });

  const canFlipSection0 = blockers.length === 0;
  const nextActions = [];
  blockers.forEach((item) => {
    if (item.action && nextActions.indexOf(item.action) < 0) nextActions.push(item.action);
  });

  return {
    canFlipSection0,
    answer: canFlipSection0 ? SECTION_0_ANSWER_YES : SECTION_0_ANSWER_NO,
    phasesExpected: LOCAL_LIGHT_PHASE_COUNT,
    verdict,
    residualComb: comb,
    stills: {
      ready: stills.ready === true,
      readyScenes: Array.isArray(stills.readySceneIds) ? stills.readySceneIds.length : 0,
      expected: Number.isFinite(stills.expected) ? stills.expected : BASELINE_SCENE_IDS.length,
      everyEngineStillFromEngineBuild: stills.everyEngineStillFromEngineBuild === true,
    },
    blindVerdict: blindGate.verdict || "PENDENTE",
    blockers,
    nextActions,
  };
}
