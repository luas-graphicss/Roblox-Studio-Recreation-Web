import { isSubstrateSmMaskPlan } from './ssmMaskPlanCore.js';
import { bakeSubstrateSmOrmMask } from './ssmMaskBakeCore.js';
import { SSM_ORM_BAKE_ADAPTER } from './ssmOrmBakeAdapter.js';

export const SSM_MASK_BAKE_ADAPTER = Object.freeze({
  accepts: plan => isSubstrateSmMaskPlan(plan) && plan.mode === 'bake',
  memory: plan => plan.bake.memory,
  bake: bakeSubstrateSmOrmMask,
});

export const SSM_ORM_AND_MASK_BAKE_ADAPTER = Object.freeze({
  accepts: plan => SSM_MASK_BAKE_ADAPTER.accepts(plan) || SSM_ORM_BAKE_ADAPTER.accepts(plan),
  memory: plan => (isSubstrateSmMaskPlan(plan) ? SSM_MASK_BAKE_ADAPTER : SSM_ORM_BAKE_ADAPTER).memory(plan),
  bake: input => (isSubstrateSmMaskPlan(input.plan) ? SSM_MASK_BAKE_ADAPTER : SSM_ORM_BAKE_ADAPTER).bake(input),
});
