import { isSubstrateSmSpatialBlendPlan } from './ssmSpatialBlendPlan.js';
import { writeSubstrateSmRecipePayload } from './ssmRecipeLayout.js';
import { interpolateSubstrateSmSpatialValue } from './ssmSpatialChannels.js';

export function resolveSubstrateSmSpatialPayload(plan, maskValue, target) {
  if (!isSubstrateSmSpatialBlendPlan(plan)) throw new TypeError('An admitted spatial blend plan is required');
  if (typeof maskValue !== 'number' || !Number.isFinite(maskValue)) throw new TypeError('Spatial weights must be finite numbers');
  const weight = Math.max(0, Math.min(1, maskValue));
  const payload = writeSubstrateSmRecipePayload(plan.zeroRecipe.parameters, target);
  for (const channel of plan.channels) {
    const reference = channel.components[0];
    const value = interpolateSubstrateSmSpatialValue(payload[reference.offset], channel.targetValue, weight, channel.interpolation);
    for (const component of channel.components) payload[component.offset] = value;
  }
  return payload;
}
