import { createCinematicPostProcess } from "./createCinematicPostProcess.js";
import { readAuditedGetters } from "./readAuditedGetters.js";
import { callSynchronousMethod, requireSynchronousCallback } from "./synchronousCallbacks.js";
import { withThreeHostState } from "./threeHostState.js";

export function createFuturePostFxAdapter(options, integration) {
  const { legacy, ownLegacy = false, host, ...packageOptions } = integration;
  for (const name of ["render", "setSize", "dispose"]) requireSynchronousCallback(legacy?.[name], `Legacy ${name}`);
  if (typeof ownLegacy !== "boolean") throw new TypeError("ownLegacy must be boolean");
  const adapter = createCinematicPostProcess({ ...packageOptions, host: {
    ...host,
    readGetters: () => readAuditedGetters(options),
    renderLegacy: (width, height) => callSynchronousMethod(legacy, "render", width, height),
    withFrameState: (operation) => withThreeHostState(options, operation),
    requestRender: () => options.requestRender && callSynchronousMethod(options, "requestRender")
  } });
  let disposed = false;
  const pixelRatio = () => callSynchronousMethod(options.renderer, "getPixelRatio");
  return Object.freeze({
    render(width, height) { return disposed ? false : adapter.render(width, height, pixelRatio()).presented; },
    setSize(width, height) {
      if (disposed) return;
      adapter.resize(width, height, pixelRatio());
      callSynchronousMethod(legacy, "setSize", width, height);
    },
    configure: adapter.configure,
    resize: adapter.resize,
    reset: adapter.reset,
    snapshot: adapter.snapshot,
    dispose() {
      if (disposed) return;
      adapter.dispose();
      disposed = true;
      if (ownLegacy) callSynchronousMethod(legacy, "dispose");
    }
  });
}
