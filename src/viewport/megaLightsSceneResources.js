import { createMegaLightsGBuffer } from "../lighting/megalights/runtime/megaLightsGBuffer.js";

export function createMegaLightsSceneResources({ THREE, renderer, host }) {
  let gBuffer = null;
  let previousHost;
  let published = false;
  let attempted = false;
  let failure = "not allocated before the Future gate opens";

  function ensure() {
    if (attempted) return;
    attempted = true;
    try {
      const context = renderer?.getContext?.();
      if (!context || !renderer.capabilities?.isWebGL2) {
        failure = "WebGL2 is required for four scene attachments";
        return;
      }
      if (
        context.getParameter(context.MAX_DRAW_BUFFERS) < 4 ||
        !renderer.extensions?.has("EXT_color_buffer_float")
      ) {
        failure = "Four draw buffers and float color attachments are required";
        return;
      }
      gBuffer = createMegaLightsGBuffer({ THREE, renderer });
      host.gBuffer = gBuffer;
      failure = gBuffer.isAvailable() ? "" : gBuffer.describe().reason;
      if (typeof window !== "undefined") {
        previousHost = window.__mlLab;
        window.__mlLab = host;
        published = true;
      }
    } catch (error) {
      failure = String(error?.message || error);
    }
  }

  return {
    ensure,
    gBuffer: () => gBuffer,
    describe: () => ({
      attempted,
      published,
      available: gBuffer?.isAvailable() === true,
      reason: failure,
      target: gBuffer?.describe() || null,
    }),
    dispose() {
      const sceneInputs = host.sceneInputs;
      host.sceneInputs = null;
      sceneInputs?.dispose?.();
      gBuffer?.dispose();
      gBuffer = null;
      host.gBuffer = null;
      if (
        published &&
        typeof window !== "undefined" &&
        window.__mlLab === host
      ) {
        if (previousHost === undefined) delete window.__mlLab;
        else window.__mlLab = previousHost;
      }
      published = false;
    },
  };
}
