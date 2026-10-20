import { createSubstrateSmBsdfResult, evaluateSubstrateSmBsdf } from './ssmBsdfCore.js';
import { SSM_COAT_F0, SSM_COAT_F90 } from './ssmCoatContract.js';
import {
  createSubstrateSmCoatTransmissionResult,
  evaluateSubstrateSmCoatTransmission,
} from './ssmCoatTransmissionCore.js';

function dotProduct(first, second) {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

export function createSubstrateSmCoatWorkspace() {
  return {
    coatSurface: {
      diffuseReflectance: [0, 0, 0],
      specularF0: [SSM_COAT_F0, SSM_COAT_F0, SSM_COAT_F0],
      specularF90: SSM_COAT_F90,
      perceptualRoughness: 0,
    },
    coatResponse: createSubstrateSmBsdfResult(),
    transmission: createSubstrateSmCoatTransmissionResult(),
  };
}

export function evaluateSubstrateSmCoatBsdf(
  input,
  target = createSubstrateSmBsdfResult(),
  workspace = createSubstrateSmCoatWorkspace(),
) {
  const { surface, normal, viewDirection, lightDirection } = input;
  evaluateSubstrateSmCoatTransmission(
    {
      surface,
      viewCosine: dotProduct(normal, viewDirection),
      lightCosine: dotProduct(normal, lightDirection),
    },
    workspace.transmission,
  );
  evaluateSubstrateSmBsdf(input, target);
  const coverage = surface.coverage * surface.extensionWeight;
  if (coverage === 0) return target;
  workspace.coatSurface.perceptualRoughness = surface.extensionRoughness;
  evaluateSubstrateSmBsdf(
    {
      surface: workspace.coatSurface,
      normal,
      viewDirection,
      lightDirection,
    },
    workspace.coatResponse,
  );
  for (let channel = 0; channel < 3; channel += 1) {
    const transmission = workspace.transmission.baseTransmission[channel];
    target.diffuse[channel] *= transmission;
    target.specular[channel] =
      target.specular[channel] * transmission + workspace.coatResponse.specular[channel] * coverage;
    target.total[channel] = target.diffuse[channel] + target.specular[channel];
  }
  return target;
}
