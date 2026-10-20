import { EXPOSURE_METERING_ENCODING } from "./exposureContract.js";

const EV100_LAYOUT = Object.freeze({ width: 1, evUv: Object.freeze([0.5, 0.5]), requiresPositiveWeight: false });
const CP_F08_LAYOUT = Object.freeze({ width: 4, evUv: Object.freeze([0.375, 0.5]), requiresPositiveWeight: true });

export function validateMeteringResource(resource) {
  const layout = resource?.encoding === EXPOSURE_METERING_ENCODING ? EV100_LAYOUT : resource?.encoding === "metering-result-r32f-v1" ? CP_F08_LAYOUT : null;
  if (!layout) throw new TypeError("Exposure requires EV100 metering or the CP-F08 packed R32F result");
  if (resource.texture) {
    if (resource.width !== layout.width || resource.height !== 1 || resource.format !== "r32f" || resource.origin !== "bottom-left") throw new TypeError("Exposure metering texture does not match its declared EV100 layout");
    return { texture: resource.texture, value: 0, evUv: layout.evUv, requiresPositiveWeight: layout.requiresPositiveWeight };
  }
  if (layout !== EV100_LAYOUT || typeof resource.value?.ev100 !== "number" || !Number.isFinite(resource.value.ev100) || Math.abs(resource.value.ev100) > 64) throw new TypeError("Exposure metering value requires finite ev100 in [-64, 64]");
  return { texture: null, value: resource.value.ev100, evUv: EV100_LAYOUT.evUv, requiresPositiveWeight: false };
}
