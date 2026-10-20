import { SSM_LAYER_TRANSMITTANCE_FLOOR } from './ssmLayerReductionCore.js';
import { SSM_COAT_REFERENCE_THICKNESS } from './ssmCoatContract.js';

export const SSM_COAT_MAXIMUM_EXTINCTION =
  -Math.log(SSM_LAYER_TRANSMITTANCE_FLOOR) / SSM_COAT_REFERENCE_THICKNESS;

function requireFiniteRange(value, name, maximum) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(Math.fround(value)) ||
    value < 0 ||
    value > maximum
  ) {
    throw new RangeError(`SSM coat ${name} must be finite and within [0, ${maximum}]`);
  }
}

export function requireSubstrateSmCoatOptics(surface) {
  if (!surface || typeof surface !== 'object')
    throw new TypeError('SSM coat requires resolved parameters');
  requireFiniteRange(surface.coverage, 'coverage', 1);
  requireFiniteRange(surface.extensionWeight, 'extensionWeight', 1);
  requireFiniteRange(surface.extensionRoughness, 'extensionRoughness', 1);
  requireFiniteRange(surface.layerThickness, 'layerThickness', Number.MAX_VALUE);
  const extinction = surface.extinctionCoefficient;
  if (!extinction || extinction.length !== 3)
    throw new TypeError('SSM coat extinction requires three channels');
  for (let channel = 0; channel < 3; channel += 1) {
    requireFiniteRange(
      extinction[channel],
      `extinctionCoefficient[${channel}]`,
      Math.fround(SSM_COAT_MAXIMUM_EXTINCTION),
    );
  }
}

export function requireSubstrateSmCoatCosine(value, name) {
  if (!Number.isFinite(value) || value < -1.00001 || value > 1.00001) {
    throw new RangeError(`SSM coat ${name} must be a finite directional cosine`);
  }
}
