export const SCATTERING_MODEL = Object.freeze({
  hairStrand: "hairStrand",
  frontLayerTranslucency: "frontLayerTranslucency",
  opaqueSurface: "opaqueSurface",
});

export const WEIGHT_SOURCE = Object.freeze({
  phaseFunction: "phaseFunction",
  brdf: "brdf",
  tie: "tie",
});

export const HAIR_LIMITS = Object.freeze({

  neighbourCount: 4,
  neighbourRadiusInPixels: 2,
  minimumWeight: 0.0001,


  asymmetryByModel: Object.freeze({
    hairStrand: 0.6,
    frontLayerTranslucency: 0.3,
    opaqueSurface: 0,
  }),
});

const FOUR_PI = 4 * Math.PI;

function clampCosine(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (value > 1) return 1;
  if (value > -1) return value;
  return -1;
}


export function henyeyGreensteinPhase(cosineAngle, asymmetry) {
  const cosine = clampCosine(cosineAngle);
  const g = typeof asymmetry === "number" && Number.isFinite(asymmetry) ? Math.max(-0.99, Math.min(0.99, asymmetry)) : 0;
  const denominator = 1 + g * g - 2 * g * cosine;
  const safeDenominator = denominator > 0.000001 ? denominator : 0.000001;
  return (1 - g * g) / (FOUR_PI * Math.pow(safeDenominator, 1.5));
}


export function diffuseBrdfWeight(cosineAngle) {
  const cosine = clampCosine(cosineAngle);
  if (cosine > 0) return cosine / Math.PI;
  return 0;
}


export function samplingWeightFor(request) {
  const input = request || {};
  const model = input.model || SCATTERING_MODEL.opaqueSurface;
  const asymmetry =
    typeof input.asymmetry === "number" ? input.asymmetry : HAIR_LIMITS.asymmetryByModel[model] || 0;
  const phaseValue = model === SCATTERING_MODEL.opaqueSurface ? 0 : henyeyGreensteinPhase(input.cosineAngle, asymmetry);
  const brdfValue = diffuseBrdfWeight(input.cosineAngle);
  const weight = phaseValue > brdfValue ? phaseValue : brdfValue;
  let chosenBy = WEIGHT_SOURCE.tie;
  if (phaseValue > brdfValue) chosenBy = WEIGHT_SOURCE.phaseFunction;
  if (brdfValue > phaseValue) chosenBy = WEIGHT_SOURCE.brdf;
  return { weight, chosenBy, phaseValue, brdfValue, model, asymmetry };
}


export function weightFlatnessRatio(weights) {
  const values = (Array.isArray(weights) ? weights : []).filter(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
  if (values.length === 0) return 0;
  let smallest = values[0];
  let largest = values[0];
  for (let index = 0; index !== values.length; index += 1) {
    if (smallest > values[index]) smallest = values[index];
    if (values[index] > largest) largest = values[index];
  }
  if (!(largest > 0)) return 0;
  return smallest / largest;
}


export function compareFlatnessAgainstBrdfAlone(model, sampleCount) {
  const steps = typeof sampleCount === "number" && sampleCount > 3 ? Math.floor(sampleCount) : 32;
  const brdfWeights = [];
  const combinedWeights = [];
  for (let index = 0; index !== steps; index += 1) {
    const cosineAngle = 1 - (2 * index) / (steps - 1);
    brdfWeights.push(diffuseBrdfWeight(cosineAngle));
    combinedWeights.push(samplingWeightFor({ cosineAngle, model }).weight);
  }
  const brdfFlatness = weightFlatnessRatio(brdfWeights);
  const combinedFlatness = weightFlatnessRatio(combinedWeights);
  return {
    model,
    sampleCount: steps,
    brdfFlatness,
    combinedFlatness,
    flattened: combinedFlatness > brdfFlatness,
  };
}


export function neighbourOffsets(pixelX, pixelY, neighbourCount) {
  const wanted = typeof neighbourCount === "number" ? Math.max(0, Math.floor(neighbourCount)) : HAIR_LIMITS.neighbourCount;
  const radius = HAIR_LIMITS.neighbourRadiusInPixels;


  const parity = (pixelX + pixelY) % 2 === 0 ? 1 : -1;
  const candidates = [
    { x: radius * parity, y: 0 },
    { x: 0, y: radius * parity },
    { x: -radius * parity, y: 0 },
    { x: 0, y: -radius * parity },
  ];
  return candidates.slice(0, Math.min(wanted, candidates.length));
}


export function shadeFromNeighbours(request) {
  const input = request || {};
  const centre = input.centre || {};
  const centreRadiance = centre.radiance || { r: 0, g: 0, b: 0 };
  const readNeighbour = typeof input.readNeighbour === "function" ? input.readNeighbour : () => null;
  const offsets = neighbourOffsets(input.pixelX || 0, input.pixelY || 0, input.neighbourCount);

  let totalWeight = 1;
  let red = centreRadiance.r || 0;
  let green = centreRadiance.g || 0;
  let blue = centreRadiance.b || 0;
  let neighboursUsed = 0;
  let neighboursRejected = 0;

  offsets.forEach((offset) => {
    const neighbour = readNeighbour((input.pixelX || 0) + offset.x, (input.pixelY || 0) + offset.y);


    if (!neighbour || !neighbour.radiance || neighbour.model !== centre.model) {
      neighboursRejected += 1;
      return;
    }
    const weight = typeof neighbour.weight === "number" ? neighbour.weight : 1;
    if (HAIR_LIMITS.minimumWeight > weight) {
      neighboursRejected += 1;
      return;
    }
    totalWeight += weight;
    red += (neighbour.radiance.r || 0) * weight;
    green += (neighbour.radiance.g || 0) * weight;
    blue += (neighbour.radiance.b || 0) * weight;
    neighboursUsed += 1;
  });

  return {
    radiance: { r: red / totalWeight, g: green / totalWeight, b: blue / totalWeight },
    neighboursUsed,
    neighboursRejected,
    neighboursOffered: offsets.length,
    effectiveSampleCount: 1 + neighboursUsed,

    tracesSpent: 0,
  };
}

export function describeHairSampling() {
  return {
    weightRule: "max(Henyey-Greenstein phase function, normalised lambert BRDF)",
    whyMax: "a scattering medium sends light everywhere, so the flatter of the two weights is the honest importance function",
    neighbourCount: HAIR_LIMITS.neighbourCount,
    neighbourRadiusInPixels: HAIR_LIMITS.neighbourRadiusInPixels,
    asymmetryByModel: HAIR_LIMITS.asymmetryByModel,
    tracesSpentBorrowing: 0,
  };
}
