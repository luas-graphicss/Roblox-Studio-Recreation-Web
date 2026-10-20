export const HIDDEN_LIGHT_BUDGET_REFUSALS = Object.freeze([
  Object.freeze({
    code: "hiddenLightBudget.noDownWeighting",
    refuses: "lowering the weight of a hidden light instead of giving it a fixed share of the samples",
    because:
      "down weighting biases the estimator - the light comes back darker than it is, and the stronger it is the darker " +
      "it comes back - while a budget bounds how much of the pixel it may claim without touching its energy",
  }),
  Object.freeze({
    code: "hiddenLightBudget.noZeroBudgetByRounding",
    refuses: "letting integer rounding turn the budget into zero sample",
    because:
      "floor(1 sample x 0.2) is 0 for every pixel of every frame, so on the tier that draws one sample per pixel the " +
      "budget would exist on paper and never sample anything; the fractional part is drawn against blue noise so the " +
      "share survives the rounding",
  }),
  Object.freeze({
    code: "hiddenLightBudget.noPermanentRelaxation",
    refuses: "keeping the relaxed budget after the visible list has weight again and the history reprojects",
    because:
      "a relaxation that never ends is uniform sampling wearing the name of guiding: the visible light list stops paying " +
      "for itself and the variance returns to exactly what MegaLights was built to remove",
  }),
]);

export function hiddenLightBudgetRefusalCodes() {
  return HIDDEN_LIGHT_BUDGET_REFUSALS.map((refusal) => refusal.code);
}

export function hiddenLightBudgetRefusal(code) {
  return HIDDEN_LIGHT_BUDGET_REFUSALS.find((refusal) => refusal.code === code) || null;
}
