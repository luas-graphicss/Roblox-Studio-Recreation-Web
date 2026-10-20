import {
  LIGHT_FADE_REFUSAL,
  SHADOW_ROTATION_PLANS_PER_TURN,
  SHADOW_SLOT_CHALLENGER_MARGIN,
} from "./llLightFadeContract.js";

export const SHADOW_SLOT_SOURCE = Object.freeze({
  INCUMBENT: "incumbent",
  FREE_SLOT: "free-slot",
  PRIORITY_SWAP: "priority-swap",
  ROTATION_TURN: "rotation-turn",
});

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function finiteOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function wholeNumberOr(value, fallback) {
  return Math.max(Math.floor(finiteOr(value, fallback)), 0);
}


export function planActiveLightBudget(input) {
  const request = asObject(input);
  const ranked = asArray(request.ranked);
  const activeBudget = wholeNumberOr(request.activeBudget, ranked.length);
  const activeKeys = [];
  const refusals = [];
  ranked.forEach((rawItem, order) => {
    const item = asObject(rawItem);
    const key = String(item.key === undefined ? order : item.key);
    const rank = wholeNumberOr(item.rank, order);
    if (activeBudget > rank) activeKeys.push(key);
    else refusals.push(Object.freeze({ key, rank, refusal: LIGHT_FADE_REFUSAL.outOfActiveBudget }));
  });
  return Object.freeze({
    activeBudget,
    activeKeys,
    activeCount: activeKeys.length,
    refusals: Object.freeze(refusals),
  });
}

function weakestGranted(granted) {
  let weakest = null;
  granted.forEach((item) => {
    if (weakest === null || weakest.priority > item.priority) weakest = item;
  });
  return weakest;
}


export function planShadowBudget(input) {
  const request = asObject(input);
  const candidates = asArray(request.candidates).map((rawCandidate, order) => {
    const candidate = asObject(rawCandidate);
    return {
      key: String(candidate.key === undefined ? order : candidate.key),
      priority: Math.max(finiteOr(candidate.priority, 0), 0),
    };
  });
  const shadowBudget = wholeNumberOr(request.shadowBudget, 0);
  const challengerMargin = Math.max(finiteOr(request.challengerMargin, SHADOW_SLOT_CHALLENGER_MARGIN), 1);
  const rotationEnabled = request.rotationEnabled === true;
  const rotationPlansPerTurn = Math.max(wholeNumberOr(request.rotationPlansPerTurn, SHADOW_ROTATION_PLANS_PER_TURN), 1);
  const planIndex = wholeNumberOr(request.planIndex, 0);
  const incumbentKeys = new Set(asArray(request.previousShadowKeys).map(String));

  const granted = [];
  const grantedKeys = new Set();
  function grant(candidate, slotSource) {
    granted.push({ key: candidate.key, priority: candidate.priority, slotSource });
    grantedKeys.add(candidate.key);
  }


  candidates.forEach((candidate) => {
    if (shadowBudget > granted.length && incumbentKeys.has(candidate.key)) grant(candidate, SHADOW_SLOT_SOURCE.INCUMBENT);
  });
  candidates.forEach((candidate) => {
    if (shadowBudget > granted.length && !grantedKeys.has(candidate.key)) grant(candidate, SHADOW_SLOT_SOURCE.FREE_SLOT);
  });

  const waiting = candidates.filter((candidate) => !grantedKeys.has(candidate.key));
  let slotChange = null;


  if (waiting.length > 0 && shadowBudget > 0 && granted.length === shadowBudget) {
    const weakest = weakestGranted(granted);
    const bestWaiting = waiting[0];
    const beatsIncumbent = bestWaiting.priority >= weakest.priority * challengerMargin;
    const rotationTurnDue = rotationEnabled && !beatsIncumbent;
    const challenger = beatsIncumbent
      ? bestWaiting
      : rotationTurnDue
        ? waiting[Math.floor(planIndex / rotationPlansPerTurn) % waiting.length]
        : null;
    if (challenger !== null && challenger !== undefined && weakest !== null && challenger.key !== weakest.key) {
      const slotSource = beatsIncumbent ? SHADOW_SLOT_SOURCE.PRIORITY_SWAP : SHADOW_SLOT_SOURCE.ROTATION_TURN;
      const weakestIndex = granted.findIndex((item) => item.key === weakest.key);
      granted[weakestIndex] = { key: challenger.key, priority: challenger.priority, slotSource };
      grantedKeys.delete(weakest.key);
      grantedKeys.add(challenger.key);
      slotChange = Object.freeze({ inKey: challenger.key, outKey: weakest.key, slotSource });
    }
  }

  const refusals = candidates
    .filter((candidate) => !grantedKeys.has(candidate.key))
    .map((candidate) =>
      Object.freeze({
        key: candidate.key,
        priority: candidate.priority,
        refusal: rotationEnabled ? LIGHT_FADE_REFUSAL.waitingShadowRotation : LIGHT_FADE_REFUSAL.outOfShadowBudget,
      })
    );

  return Object.freeze({
    shadowBudget,
    shadowKeys: Object.freeze(granted.map((item) => item.key)),
    granted: Object.freeze(granted.map((item) => Object.freeze(item))),
    refusals: Object.freeze(refusals),
    slotChange,
    rotationEnabled,
    rotationPlansPerTurn,
    candidateCount: candidates.length,
  });
}
