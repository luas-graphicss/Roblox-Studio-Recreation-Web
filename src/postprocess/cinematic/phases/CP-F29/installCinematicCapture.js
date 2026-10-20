import { CAPTURE_OWNER, CAPTURE_ENDPOINT_SETTING, CAPTURE_BINDING_SETTING, CAPTURE_RECEIPT } from "./captureContract.js";

export function installCinematicCapture(services) {
  const sourceName = services.settings?.get?.(CAPTURE_BINDING_SETTING) ?? "$color";
  if (typeof sourceName !== "string" || !sourceName || sourceName.startsWith(`${CAPTURE_OWNER}.`)) throw new Error("Invalid capture source binding");
  let disposed = false;
  const endpoints = new Set();
  const unregister = services.graph.register({
    id: "CP-F29.captureReadback", owner: CAPTURE_OWNER, stage: "capture", order: 2900,
    reads: [sourceName], writes: [CAPTURE_RECEIPT], transformsColor: false,
    execute(context) {
      if (disposed) throw new Error("Capture phase is disposed");
      const endpoint = context.settings?.get?.(CAPTURE_ENDPOINT_SETTING);
      if (endpoint != null && typeof endpoint.consume !== "function") throw new Error("Capture endpoint must implement consume");
      if (endpoint) endpoints.add(endpoint);
      const receipt = endpoint ? endpoint.consume(context.read(sourceName), context.frame) : { status: "idle" };
      if (receipt && typeof receipt.then === "function") throw new Error("Capture submission must remain synchronous");
      context.publish(CAPTURE_RECEIPT, Object.freeze({ frameId: context.frame.frameId, viewId: context.frame.viewId, generation: context.frame.generation, provenance: "gpu", value: Object.freeze(receipt) }));
    }
  });
  return () => {
    if (disposed) return;
    disposed = true;
    unregister();
    for (const endpoint of endpoints) endpoint.cancel?.();
    endpoints.clear();
  };
}
