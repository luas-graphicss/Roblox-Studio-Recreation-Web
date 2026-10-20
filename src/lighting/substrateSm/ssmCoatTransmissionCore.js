import {
  SSM_COAT_F0,
  SSM_COAT_F90,
  SSM_COAT_COSINE_FLOOR,
  SSM_COAT_MAXIMUM_OPTICAL_DEPTH,
} from './ssmCoatContract.js';
import { requireSubstrateSmCoatOptics, requireSubstrateSmCoatCosine } from './ssmCoatValidation.js';

function interfaceTransmission(cosine) {
  const clampedCosine = Math.max(0, Math.min(1, cosine));
  return 1 - SSM_COAT_F0 - (SSM_COAT_F90 - SSM_COAT_F0) * (1 - clampedCosine) ** 5;
}

function absorption(extinction, thickness, inverseCosine) {
  if (extinction === 0 || thickness === 0) return 1;
  const boundedThickness = Math.min(thickness, SSM_COAT_MAXIMUM_OPTICAL_DEPTH / extinction);
  return Math.exp(
    -Math.min(SSM_COAT_MAXIMUM_OPTICAL_DEPTH, extinction * boundedThickness * inverseCosine),
  );
}

export function createSubstrateSmCoatTransmissionResult() {
  return { baseTransmission: [1, 1, 1], emissionTransmission: [1, 1, 1] };
}

export function evaluateSubstrateSmCoatTransmission(
  { surface, lightCosine, viewCosine },
  target = createSubstrateSmCoatTransmissionResult(),
) {
  requireSubstrateSmCoatOptics(surface);
  requireSubstrateSmCoatCosine(lightCosine, 'lightCosine');
  requireSubstrateSmCoatCosine(viewCosine, 'viewCosine');
  const coverage = surface.coverage * surface.extensionWeight;
  const uncovered = 1 - coverage;
  const incomingInterface = interfaceTransmission(lightCosine);
  const outgoingInterface = interfaceTransmission(viewCosine);
  const inverseLightCosine = 1 / Math.max(SSM_COAT_COSINE_FLOOR, lightCosine);
  const inverseViewCosine = 1 / Math.max(SSM_COAT_COSINE_FLOOR, viewCosine);
  for (let channel = 0; channel < 3; channel += 1) {
    const extinction = surface.extinctionCoefficient[channel];
    const incoming =
      absorption(extinction, surface.layerThickness, inverseLightCosine) * incomingInterface;
    const outgoing =
      absorption(extinction, surface.layerThickness, inverseViewCosine) * outgoingInterface;
    target.baseTransmission[channel] = uncovered + coverage * incoming * outgoing;
    target.emissionTransmission[channel] = uncovered + coverage * outgoing;
  }
  return target;
}
