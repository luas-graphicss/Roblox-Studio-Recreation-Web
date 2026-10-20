import { describeMsmTechnologyGate } from "./msmTechnologyGate.js";
import { describeMsmExclusion } from "./msmExclusionCore.js";
import { describeMsmTierPolicy } from "./msmTierPolicy.js";
import { resolveMsmFlag } from "./msmFlagResolver.js";
import { resolveMsmTierPixelBudget } from "./msmReducedPixelBudgetCore.js";


export const MSM_WAKE_DOOR = Object.freeze({
  TECHNOLOGY: "technology",
  EXCLUSION: "exclusion",
  TIER: "tier",
  FLAG: "flag",
  PIXEL_BUDGET: "pixelBudget",
});


export function describeMsmWake(input) {
  const source = input && typeof input === "object" ? input : {};

  const technology = describeMsmTechnologyGate(source.technology);
  const exclusion = describeMsmExclusion({ megaLightsWanted: source.megaLightsWanted });
  const tier = describeMsmTierPolicy(source.tier);
  const flag = resolveMsmFlag({ flag: source.flag, weakGpu: source.weakGpu });

  const viewport = source.viewport && typeof source.viewport === "object" ? source.viewport : null;
  const pixelBudget = viewport
    ? resolveMsmTierPixelBudget({ tier: source.tier, width: viewport.width, height: viewport.height })
    : null;

  const askedDoors = [
    Object.freeze({ door: MSM_WAKE_DOOR.TECHNOLOGY, open: technology.allowed, reason: technology.reason }),
    Object.freeze({ door: MSM_WAKE_DOOR.EXCLUSION, open: exclusion.allowed, reason: exclusion.reason }),
    Object.freeze({ door: MSM_WAKE_DOOR.TIER, open: tier.runs, reason: tier.reason }),
    Object.freeze({ door: MSM_WAKE_DOOR.FLAG, open: flag.active, reason: flag.reason }),
  ];

  if (pixelBudget) {
    askedDoors.push(
      Object.freeze({ door: MSM_WAKE_DOOR.PIXEL_BUDGET, open: pixelBudget.runs, reason: pixelBudget.reason }),
    );
  }

  const doors = Object.freeze(askedDoors);

  const closedDoors = doors.filter((entry) => entry.open !== true);
  const awake = closedDoors.length === 0;

  return {
    awake,
    reason: awake
      ? "MSM awake on Technology " +
        technology.technology +
        ", tier " +
        tier.tier +
        " - " +
        flag.reason
      : closedDoors[0].reason,
    vetoes: closedDoors.map((entry) => entry.door),
    doors,
    policy: awake ? tier.policy : null,
    pixelBudget,
    technology,
    exclusion,
    tier,
    flag,
  };
}


export function isMsmAwake(input) {
  return describeMsmWake(input).awake;
}
