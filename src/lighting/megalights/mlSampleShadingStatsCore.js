export const SAMPLE_SHADING_ACCEPTANCE = Object.freeze({

  occludedSamplesShaded: 0,

  energyTolerance: 0.03,

  albedoBleedTolerance: 0.01,

  outputBufferCount: 2,
});

function newTotals() {
  return {
    pixels: 0,
    shadedPixels: 0,
    skyPixels: 0,
    drawnSamples: 0,
    shadedSamples: 0,
    occludedSamples: 0,
    unknownVisibilitySamples: 0,
    belowHorizonSamples: 0,
    degeneratePdfSamples: 0,
    nonPositiveWeightSamples: 0,

    occludedSamplesShaded: 0,
  };
}

function countOf(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function summarizeTotals(totals) {
  const refusedSamples =
    totals.occludedSamples +
    totals.unknownVisibilitySamples +
    totals.belowHorizonSamples +
    totals.degeneratePdfSamples +
    totals.nonPositiveWeightSamples;
  return Object.freeze(
    Object.assign({}, totals, {
      refusedSamples,
      shadedSampleShare: totals.drawnSamples > 0 ? totals.shadedSamples / totals.drawnSamples : 0,
      meetsNoOccludedShadingGate:
        totals.occludedSamplesShaded === SAMPLE_SHADING_ACCEPTANCE.occludedSamplesShaded,
    }),
  );
}


export function createSampleShadingStats() {
  let totals = newTotals();

  return {
    reset() {
      totals = newTotals();
    },


    addSkyPixel() {
      totals.pixels++;
      totals.skyPixels++;
    },


    addPixel(pixelCounters) {
      const counters = pixelCounters || {};
      totals.pixels++;
      totals.drawnSamples += countOf(counters.drawn);
      totals.shadedSamples += countOf(counters.shaded);
      totals.occludedSamples += countOf(counters.occluded);
      totals.unknownVisibilitySamples += countOf(counters.unknownVisibility);
      totals.belowHorizonSamples += countOf(counters.belowHorizon);
      totals.degeneratePdfSamples += countOf(counters.degeneratePdf);
      totals.nonPositiveWeightSamples += countOf(counters.nonPositiveWeight);
      totals.occludedSamplesShaded += countOf(counters.occludedSamplesShaded);
      if (countOf(counters.shaded) > 0) totals.shadedPixels++;
    },

    summary() {
      return summarizeTotals(totals);
    },
  };
}

export function relativeEnergyError(measuredEnergy, referenceEnergy) {
  const measured = Number(measuredEnergy);
  const reference = Number(referenceEnergy);
  if (!Number.isFinite(measured) || !Number.isFinite(reference)) return Infinity;
  if (reference === 0) return measured === 0 ? 0 : Infinity;
  return Math.abs(measured - reference) / Math.abs(reference);
}

export function energyWithinTolerance(measuredEnergy, referenceEnergy, tolerance) {
  const limit = Number.isFinite(tolerance) ? tolerance : SAMPLE_SHADING_ACCEPTANCE.energyTolerance;
  return relativeEnergyError(measuredEnergy, referenceEnergy) <= limit;
}


export function describeSampleShadingStats(summary) {
  if (!summary) return "the pass has not shaded a frame yet";
  return [
    summary.shadedSamples + " of " + summary.drawnSamples + " drawn samples reached a light",
    summary.occludedSamples + " were occluded and stayed in the divisor",
    summary.unknownVisibilitySamples + " arrived with visibility unresolved",
    summary.skyPixels + " pixels were sky and were not shaded",
    summary.occludedSamplesShaded + " occluded samples were shaded (the gate demands 0)",
  ].join("; ");
}
