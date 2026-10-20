import { validateFrame } from "../../contracts/frameContract.js";
import { ADAPTER_OWNER, ADAPTER_VERSION, HOST_ROUTE_RESOURCE } from "./adapterContract.js";
import { captureFrameIdentity } from "./frameDelivery.js";
import { installFutureAdapter } from "./installFutureAdapter.js";

export function createPipelineFrameBinding(pipeline) {
  let execution = null;
  let preparedIdentity = null;
  let executing = false;
  const invalidate = () => { execution = null; preparedIdentity = null; };
  function assertIdle() {
    if (executing) throw new Error("Runtime frame reentry is forbidden");
  }
  const phase = Object.freeze({ id: ADAPTER_OWNER, contractVersion: ADAPTER_VERSION, status: "implemented", install: (services) => installFutureAdapter(services, () => execution) });
  return Object.freeze({
    phase, invalidate, assertIdle,
    prepare(frame, nextExecution) {
      assertIdle();
      invalidate();
      validateFrame(frame);
      const identity = captureFrameIdentity(frame);
      executing = true;
      execution = nextExecution;
      try {
        const result = pipeline.prepare(frame);
        const consumed = result.resources[HOST_ROUTE_RESOURCE]?.value;
        if (consumed?.route?.active !== true || consumed.packageRevision !== nextExecution?.packageRevision) throw new Error("Prepared host route does not authorize this package");
        if (captureFrameIdentity(frame) !== identity) throw new Error("Preparation changed host frame identity");
        preparedIdentity = identity;
        return result;
      } finally { execution = null; executing = false; }
    },
    render(frame, inputs) {
      assertIdle();
      const identity = preparedIdentity;
      preparedIdentity = null;
      if (identity === null) throw new Error("Rendering requires a fresh prepared authorization");
      if (captureFrameIdentity(frame) !== identity) throw new Error("Prepared authorization belongs to a different frame");
      executing = true;
      try { return pipeline.render(frame, inputs); }
      finally { executing = false; }
    }
  });
}
