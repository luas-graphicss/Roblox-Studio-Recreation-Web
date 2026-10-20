import {
  SSM_COAT_F0,
  SSM_COAT_F90,
  SSM_COAT_COSINE_FLOOR,
  SSM_COAT_MAXIMUM_OPTICAL_DEPTH,
} from './ssmCoatContract.js';

export const SSM_COAT_TRANSMISSION_GLSL = `
#ifndef SSM_COAT_TRANSMISSION_V1
#define SSM_COAT_TRANSMISSION_V1

float ssmCoatInterfaceTransmission(float cosine) {
  float remaining = 1.0 - clamp(cosine, 0.0, 1.0);
  float squared = remaining * remaining;
  return ${1 - SSM_COAT_F0} - ${SSM_COAT_F90 - SSM_COAT_F0} * squared * squared * remaining;
}

float ssmCoatAbsorptionChannel(float extinction, float thickness, float inverseCosine) {
  if (extinction <= 0.0 || thickness <= 0.0) return 1.0;
  float boundedThickness = min(thickness, ${SSM_COAT_MAXIMUM_OPTICAL_DEPTH.toFixed(1)} / extinction);
  float opticalDepth = min(${SSM_COAT_MAXIMUM_OPTICAL_DEPTH.toFixed(1)}, extinction * boundedThickness * inverseCosine);
  return exp(-opticalDepth);
}

vec3 ssmCoatDirectionalTransmission(vec3 extinction, float thickness, float cosine) {
  float inverseCosine = 1.0 / max(${SSM_COAT_COSINE_FLOOR}, cosine);
  return vec3(
    ssmCoatAbsorptionChannel(extinction.r, thickness, inverseCosine),
    ssmCoatAbsorptionChannel(extinction.g, thickness, inverseCosine),
    ssmCoatAbsorptionChannel(extinction.b, thickness, inverseCosine)
  ) * ssmCoatInterfaceTransmission(cosine);
}

vec3 ssmCoatBaseTransmission(
  vec3 extinction, float thickness, float effectiveCoverage,
  float normalLight, float normalView
) {
  vec3 incoming = ssmCoatDirectionalTransmission(extinction, thickness, normalLight);
  vec3 outgoing = ssmCoatDirectionalTransmission(extinction, thickness, normalView);
  return vec3(1.0 - effectiveCoverage) + effectiveCoverage * incoming * outgoing;
}

vec3 ssmCoatEmissionTransmission(
  vec3 extinction, float thickness, float effectiveCoverage, float normalView
) {
  return vec3(1.0 - effectiveCoverage) + effectiveCoverage *
    ssmCoatDirectionalTransmission(extinction, thickness, normalView);
}

#endif
`;
