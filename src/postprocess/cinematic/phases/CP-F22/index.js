import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { installMotionBlur } from "./installMotionBlur.js";

export default Object.freeze({
  id: "CP-F22",
  contractVersion: CONTRACT_VERSION,
  status: "implemented",
  install: installMotionBlur,
});
export { resolveMotionBlurSettings } from "./motionBlurSettings.js";
export {
  resolveMotionBlurShutter,
  shutterDisplacement,
} from "./motionBlurShutter.js";
export {
  MOTION_BLUR_RESOURCES,
  MOTION_BLUR_LAYOUT,
  resolveMotionBlurBindings,
} from "./motionBlurContract.js";
export { resolveMotionBlurCapture } from "./motionBlurCapture.js";
