import { ADAPTER_OWNER, ADAPTER_VERSION, HOST_BINDING_SETTING, HOST_ROUTE_RESOURCE } from "./adapterContract.js";

export function installFutureAdapter(services, getExecution) {
  let disposed = false;
  const unregister = services.graph.register({
    id: "CP-F34.resolveHostRoute", owner: ADAPTER_OWNER, stage: "prepare", order: 3400,
    reads: [], writes: [HOST_ROUTE_RESOURCE], transformsColor: false,
    execute({ frame, settings, publish }) {
      const binding = getExecution ?? settings?.get?.(HOST_BINDING_SETTING);
      const execution = typeof binding === "function" ? binding(frame) : null;
      const value = execution
        ? Object.freeze({ ...execution, contractVersion: ADAPTER_VERSION })
        : Object.freeze({ route: { active: false, reason: "host-not-bound" }, contractVersion: ADAPTER_VERSION });
      publish(HOST_ROUTE_RESOURCE, Object.freeze({ value, frameId: frame.frameId, viewId: frame.viewId, generation: frame.generation, provenance: "synthetic" }));
      services.report?.({ owner: ADAPTER_OWNER, type: "host-route", frameId: frame.frameId, viewId: frame.viewId, active: value.route?.active === true, reason: value.route?.reason });
    }
  });
  return () => { if (disposed) return; disposed = true; unregister(); };
}
