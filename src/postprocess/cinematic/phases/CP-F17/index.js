import { installDirtMask } from "./installDirtMask.js";

export { createDirtMaskAsset, copyDirtMaskPixels } from "./dirtMaskAsset.js";
export { loadDirtMaskImage } from "./loadDirtMaskImage.js";
export { DEFAULT_DIRT_SETTINGS, resolveDirtMaskSettings } from "./dirtMaskSettings.js";
export { DIRT_BINDINGS_KEY, DIRT_RESOURCES } from "./dirtMaskContract.js";

export default Object.freeze({
  id: "CP-F17",
  contractVersion: "1.0.0",
  status: "implemented",
  install: installDirtMask
});
