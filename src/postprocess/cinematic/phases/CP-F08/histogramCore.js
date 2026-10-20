export const HISTOGRAM_BIN_COUNT = 64;

export function histogramBinIndex(logLuminance, minimumLog2, maximumLog2) {
  const normalized = (logLuminance - minimumLog2) / (maximumLog2 - minimumLog2);
  return Math.max(0, Math.min(HISTOGRAM_BIN_COUNT - 1, Math.floor(normalized * HISTOGRAM_BIN_COUNT)));
}

export function histogramBinCenter(index, settings) {
  return settings.histogramMinLog2 + (index + 0.5) * (settings.histogramMaxLog2 - settings.histogramMinLog2) / HISTOGRAM_BIN_COUNT;
}

export function reduceHistogramPercentiles(bins, settings) {
  if (bins?.length !== HISTOGRAM_BIN_COUNT) throw new TypeError("CP-F08 histogram must have exactly 64 bins");
  let totalWeight = 0;
  for (const weight of bins) {
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0) throw new TypeError("CP-F08 invalid histogram weight");
    totalWeight += weight;
  }
  const minimumWeight = totalWeight * settings.lowPercent / 100;
  const maximumWeight = totalWeight * settings.highPercent / 100;
  let cumulativeWeight = 0;
  let selectedWeight = 0;
  let weightedLogSum = 0;
  const selectedBins = new Float64Array(HISTOGRAM_BIN_COUNT);
  for (let index = 0; index < HISTOGRAM_BIN_COUNT; index += 1) {
    const nextWeight = cumulativeWeight + bins[index];
    const retainedWeight = Math.max(0, Math.min(nextWeight, maximumWeight) - Math.max(cumulativeWeight, minimumWeight));
    selectedBins[index] = retainedWeight;
    selectedWeight += retainedWeight;
    weightedLogSum += retainedWeight * histogramBinCenter(index, settings);
    cumulativeWeight = nextWeight;
  }
  return { totalWeight, selectedWeight, selectedBins, weightedLogSum, meanLog2: selectedWeight > 0 ? weightedLogSum / selectedWeight : null };
}
