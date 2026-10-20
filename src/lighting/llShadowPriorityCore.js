export const PRIORITY_PHASE_ID = "LL-F12";


export const RECENCY_HALF_LIFE_PLANS = 24;


export const MIN_RECENCY_WEIGHT = 0.05;

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function finiteOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveOr(value, fallback) {
  return Math.max(finiteOr(value, fallback === undefined ? 0 : fallback), 0);
}


export function recencyWeight(input) {
  const request = asObject(input);
  const planIndex = Math.max(Math.floor(finiteOr(request.planIndex, 0)), 0);
  const lastVisiblePlanIndex = Math.floor(finiteOr(request.lastVisiblePlanIndex, planIndex));
  const halfLifePlans = Math.max(finiteOr(request.halfLifePlans, RECENCY_HALF_LIFE_PLANS), 1);
  const agePlans = Math.max(planIndex - lastVisiblePlanIndex, 0);
  const weight = Math.pow(0.5, agePlans / halfLifePlans);
  return Math.min(Math.max(weight, MIN_RECENCY_WEIGHT), 1);
}


export function normalizedIntensity(intensity, referenceIntensity) {
  const value = positiveOr(intensity);
  const reference = positiveOr(referenceIntensity);
  if (!(reference > 0)) return 1;
  return Math.min(value / reference, 1);
}

export function shadowPagePriority(input) {
  const request = asObject(input);
  const coverage = Math.min(positiveOr(request.coverage), 1);
  const intensityWeight = Math.min(positiveOr(request.intensityWeight, 1), 1);
  const recency = Math.min(positiveOr(request.recency, 1), 1);
  return coverage * intensityWeight * recency;
}

export function brightestIntensityOf(entries) {
  let brightest = 0;
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    brightest = Math.max(brightest, positiveOr(asObject(entry).intensity));
  });
  return brightest;
}


export function rankByShadowPriority(entries) {
  const source = Array.isArray(entries) ? entries : [];
  const referenceIntensity = brightestIntensityOf(source);
  const scored = source.map((entry, order) => {
    const item = asObject(entry);
    const coverage = Math.min(positiveOr(item.coverage), 1);
    const intensityWeight = normalizedIntensity(item.intensity, referenceIntensity);
    const recency = Math.min(positiveOr(item.recency, 1), 1);
    return {
      entry: item,
      order,
      key: String(item.key === undefined ? order : item.key),
      coverage,
      intensityWeight,
      recency,
      priority: shadowPagePriority({ coverage, intensityWeight, recency }),
    };
  });
  scored.sort(
    (a, b) =>
      b.priority - a.priority ||
      b.coverage - a.coverage ||
      a.key.localeCompare(b.key) ||
      a.order - b.order
  );
  return scored.map((item, rank) => ({
    key: item.key,
    rank,
    priority: item.priority,
    coverage: item.coverage,
    intensityWeight: item.intensityWeight,
    recency: item.recency,
    referenceIntensity,
    entry: item.entry,
  }));
}
