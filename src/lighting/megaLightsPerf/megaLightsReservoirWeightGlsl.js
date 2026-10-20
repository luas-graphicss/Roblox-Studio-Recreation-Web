const LEGACY_RESERVOIR_WEIGHT = [
  "      float wDiff = lum*win*win/max(d2,0.01);",
  "      float dSpec = sqrt(max(d2,0.01)); dSpec = max(dSpec*sqrt(dSpec),0.001);",
  "      float wSpec = uSpecStrength*lum*win*win/dSpec;",
  "      float w = wDiff + wSpec;",
];

const UNIFORM_GATED_RESERVOIR_WEIGHT = [
  "      float w = lum*win*win/max(d2,0.01);",
  "      if (uSpecStrength > 0.0) {",
  "        float dSpec = sqrt(max(d2,0.01)); dSpec = max(dSpec*sqrt(dSpec),0.001);",
  "        w += uSpecStrength*lum*win*win/dSpec;",
  "      }",
];

export function buildReservoirWeightGlsl(options) {
  const specularWeightUniformGate = !!(options && options.specularWeightUniformGate);
  return (
    specularWeightUniformGate ? UNIFORM_GATED_RESERVOIR_WEIGHT : LEGACY_RESERVOIR_WEIGHT
  ).slice();
}
