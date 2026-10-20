import { isSubstrateSmMapPlan } from './ssmMapPlanCore.js';
import { bakeSubstrateSmOrm } from './ssmOrmBakeCore.js';

export const SSM_ORM_BAKE_ADAPTER = Object.freeze({
  accepts: plan => isSubstrateSmMapPlan(plan) && plan.orm?.mode === 'bake',
  memory: plan => plan.orm.memory,
  bake: ({ plan, loadPixels, signal, yieldControl }) => bakeSubstrateSmOrm({
    orm: plan.orm, profile: plan.profile, loadPixels, signal, yieldControl,
  }),
});
