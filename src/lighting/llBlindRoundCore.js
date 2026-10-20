import { BASELINE_SCENE_IDS } from "./llBaselineCore.js";
import {
  BLIND_GUESS_ENGINE,
  BLIND_GUESS_INDISTINGUISHABLE,
  BLIND_GUESS_UNREAL,
  BLIND_ROUND_DEFAULT_SEED,
  BLIND_TRUTH_ENGINE,
  BLIND_TRUTH_UNREAL,
} from "./llBlindRoundContract.js";
import {
  buildPairPlan,
  CENA_IDS_LUZ,
  confusionRateLuz,
  countAvaliadores,
  gateIlF43,
  IL_F43_VERSION,
  MIN_AVALIADORES,
  normalizeTrialLuz,
} from "./blindParityCore.js";


export const BLIND_ROUND_SCORING_VERSION = IL_F43_VERSION;


export const BLIND_ROUND_MIN_EVALUATORS = MIN_AVALIADORES;
export const BLIND_ROUND_MIN_HIT_RATE = 0.7;

export const BLIND_TRUTH_OPTIONS = Object.freeze([BLIND_TRUTH_ENGINE, BLIND_TRUTH_UNREAL]);
export const BLIND_GUESS_OPTIONS = Object.freeze([
  BLIND_GUESS_ENGINE,
  BLIND_GUESS_UNREAL,
  BLIND_GUESS_INDISTINGUISHABLE,
]);


export function sceneIdMapProblems() {
  const problems = [];
  if (BASELINE_SCENE_IDS.length !== CENA_IDS_LUZ.length) {
    problems.push(
      "the bench has " +
        BASELINE_SCENE_IDS.length +
        " scenes and the IL-F43 scoring has " +
        CENA_IDS_LUZ.length,
    );
  }
  return problems;
}

export function blindSceneIdFor(benchSceneId) {
  const index = BASELINE_SCENE_IDS.indexOf(benchSceneId);
  return index < 0 ? "" : CENA_IDS_LUZ[index];
}

export function benchSceneIdFor(blindSceneId) {
  const index = CENA_IDS_LUZ.indexOf(String(blindSceneId));
  return index < 0 ? "" : BASELINE_SCENE_IDS[index];
}


export function createBallot(input) {
  const source = input && typeof input === "object" ? input : {};
  const trial = toEngineTrial(source);
  if (!trial) return null;
  return Object.freeze({
    sceneId: String(source.sceneId),
    truth: trial.truth,
    guess: trial.guess,
    evaluator: trial.avaliador || "",
    slideIndex: Number.isFinite(source.slideIndex) ? source.slideIndex : null,
    answeredAt: Number.isFinite(source.answeredAt) ? source.answeredAt : null,
  });
}


export function toEngineTrial(ballot) {
  const source = ballot && typeof ballot === "object" ? ballot : {};
  const known = blindSceneIdFor(source.sceneId);
  const sceneId = known || source.sceneId;
  return normalizeTrialLuz({
    sceneId,
    truth: source.truth,
    guess: source.guess,
    avaliador: source.evaluator || source.avaliador,
  });
}

export function toEngineTrials(ballots) {
  const list = Array.isArray(ballots) ? ballots : [];
  const trials = [];
  list.forEach((ballot) => {
    const trial = toEngineTrial(ballot);
    if (trial) trials.push(trial);
  });
  return trials;
}

export function unknownSceneIds(ballots) {
  const list = Array.isArray(ballots) ? ballots : [];
  const unknown = [];
  list.forEach((ballot) => {
    const sceneId = ballot && ballot.sceneId;
    if (typeof sceneId !== "string" || blindSceneIdFor(sceneId)) return;
    if (unknown.indexOf(String(sceneId)) < 0) unknown.push(String(sceneId));
  });
  return unknown;
}

function perSceneByBenchId(perScene) {
  const source = perScene && typeof perScene === "object" ? perScene : {};
  const out = {};
  BASELINE_SCENE_IDS.forEach((benchSceneId) => {
    const bucket = source[blindSceneIdFor(benchSceneId)];
    const total = bucket && Number.isFinite(bucket.total) ? bucket.total : 0;
    const confused = bucket && Number.isFinite(bucket.confused) ? bucket.confused : 0;
    out[benchSceneId] = {
      total,
      confused,
      rate: total > 0 ? confused / total : null,
      meetsGate: total > 0 && confused / total >= BLIND_ROUND_MIN_HIT_RATE,
    };
  });
  return out;
}


export function scenesBelowGate(perSceneByBench) {
  const source = perSceneByBench && typeof perSceneByBench === "object" ? perSceneByBench : {};
  return BASELINE_SCENE_IDS.filter((sceneId) => {
    const bucket = source[sceneId];
    return !!bucket && bucket.total > 0 && !bucket.meetsGate;
  });
}

export function scoreBlindRound(ballots) {
  const trials = toEngineTrials(ballots);
  const score = confusionRateLuz(trials);
  const perScene = perSceneByBenchId(score.perScene);
  return {
    scoringVersion: BLIND_ROUND_SCORING_VERSION,
    total: score.total,
    confused: score.confused,
    rate: score.rate,
    scenesCovered: score.scenesCovered,
    scenesExpected: BASELINE_SCENE_IDS.length,
    pass70: score.pass70,
    evaluators: countAvaliadores(trials),
    perScene,
    scenesBelowGate: scenesBelowGate(perScene),
    unknownSceneIds: unknownSceneIds(ballots),
  };
}


export function evaluateBlindRoundGate(ballots, options) {
  const trials = toEngineTrials(ballots);
  const gate = gateIlF43(trials, options);
  const perScene = perSceneByBenchId(gate.perScene);
  return {
    scoringVersion: BLIND_ROUND_SCORING_VERSION,
    verdict: gate.verdict,
    rate: gate.rate,
    total: gate.total,
    confused: gate.confused,
    scenesCovered: gate.scenesCovered,
    scenesExpected: BASELINE_SCENE_IDS.length,
    evaluators: gate.avaliadores,
    minEvaluators: gate.minAvaliadores,
    minHitRate: BLIND_ROUND_MIN_HIT_RATE,
    reasons: gate.reasons,
    warnings: gate.warnings,
    perScene,
    scenesBelowGate: scenesBelowGate(perScene),
    unknownSceneIds: unknownSceneIds(ballots),
  };
}


export function buildBlindSlidePlan(options) {
  const source = options && typeof options === "object" ? options : {};
  const seed = Number.isFinite(source.seed) ? source.seed : BLIND_ROUND_DEFAULT_SEED;
  const plan = buildPairPlan({ seed, sceneIds: CENA_IDS_LUZ });
  return {
    seed: plan.seed,
    slides: plan.slides.map((slide, index) =>
      Object.freeze({
        index,
        blindSceneId: slide.sceneId,
        benchSceneId: benchSceneIdFor(slide.sceneId),
        truth: slide.truth,
      }),
    ),
  };
}


export function pendingSlidesFor(plan, ballots, evaluator) {
  const slides = plan && Array.isArray(plan.slides) ? plan.slides : [];
  const name = String(evaluator || "").trim().toLowerCase();
  const answered = {};
  (Array.isArray(ballots) ? ballots : []).forEach((ballot) => {
    const trial = toEngineTrial(ballot);
    if (!trial) return;
    const who = String((ballot && (ballot.evaluator || ballot.avaliador)) || "").trim().toLowerCase();
    if (who !== name) return;
    answered[String(ballot.sceneId) + "|" + trial.truth] = true;
  });
  return slides.filter((slide) => !answered[slide.benchSceneId + "|" + slide.truth]);
}
