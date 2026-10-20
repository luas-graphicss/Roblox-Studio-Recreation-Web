import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { createMotionVectorPass } from "./createMotionVectorPass.js";

export { createMotionVectorPass } from "./createMotionVectorPass.js";
export { MOTION_RESOURCES, MOTION_LAYOUT } from "./motionContract.js";
export { MOTION_BINDINGS_SETTING, MOTION_ENABLED_SETTING } from "./motionInputs.js";

export default Object.freeze({
  id: "CP-F06",
  contractVersion: CONTRACT_VERSION,
  status: "implemented",
  install(services) {
    const pass = createMotionVectorPass(services);
    try {
      const unregister = services.graph.register(pass);
      let cleaned = false;
      return () => {
        if (cleaned) return;
        cleaned = true;
        unregister();
        pass.dispose();
      };
    } catch (error) {
      pass.dispose();
      throw error;
    }
  },
});
