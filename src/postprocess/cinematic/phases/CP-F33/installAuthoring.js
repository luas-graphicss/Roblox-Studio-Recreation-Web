import { RESOLVED_SETTINGS_RESOURCE } from "../CP-F02/index.js";
import { AUTHORING_API_VERSION, AUTHORING_SESSION_KEY, AUTHORING_RESOURCE } from "./authoringContract.js";
import { createRuntimeAuthoringBinding } from "./runtimeAuthoringBinding.js";
import { freezeAuthoringData } from "./authoringData.js";
import { callSynchronousHost } from "./synchronousHost.js";

function publishState(context, value) {
  const { frameId, viewId, generation } = context.frame;
  context.publish(AUTHORING_RESOURCE, Object.freeze({ value, frameId, viewId, generation, provenance: "synthetic" }));
}
export function installAuthoring(services, { session = services.settings?.get?.(AUTHORING_SESSION_KEY), lightingBridge, resolvedBridges = [] } = {}) {
  if (typeof services.graph?.register !== "function") throw new TypeError("CP-F33 requires the frame graph");
  if (session === undefined) return services.graph.register({
    id: "CP-F33.idleAuthoring", owner: "CP-F33", stage: "prepare", order: 10, reads: [], writes: [AUTHORING_RESOURCE], transformsColor: false,
    execute(context) { publishState(context, Object.freeze({ active: false, apiVersion: AUTHORING_API_VERSION, reason: "No session attached; existing settings and Classic are untouched" })); }
  });
  if (!Array.isArray(resolvedBridges) || resolvedBridges.some(bridge => typeof bridge?.id !== "string" || typeof bridge?.apply !== "function" || typeof bridge?.release !== "function")) throw new TypeError("Resolved bridges require id, apply and release");
  if (new Set(resolvedBridges.map(bridge => bridge.id)).size !== resolvedBridges.length) throw new Error("Resolved bridge ids must be unique");
  const binding = createRuntimeAuthoringBinding(session, services, { lightingBridge }); const registrations = [];
  let disposed = false; let preparedSnapshot;
  function dispose() {
    if (disposed) return; disposed = true;
    const errors = [];
    for (const unregister of registrations.splice(0).reverse()) { try { unregister(); } catch (error) { errors.push(error); } }
    for (const bridge of resolvedBridges) { try { callSynchronousHost(bridge, "release"); } catch (error) { errors.push(error); } }
    try { binding.dispose(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, "Authoring cleanup reported host errors");
  }
  try {
    registrations.push(services.graph.register({
      id: "CP-F33.applyAuthoring", owner: "CP-F33", stage: "prepare", order: 10, reads: [], writes: [], transformsColor: false,
      execute(context) {
        if (disposed) throw new Error("CP-F33 is disposed");
        if (context.frame.referenceMode) throw new Error("CP-F33 BLOCKED_REFERENCE: no verified authoring equivalence profile");
        preparedSnapshot = binding.prepare();
      }
    }));
    registrations.push(services.graph.register({
      id: "CP-F33.resolveAuthoring", owner: "CP-F33", stage: "prepare", order: 25, reads: [RESOLVED_SETTINGS_RESOURCE], writes: [AUTHORING_RESOURCE], transformsColor: false,
      execute(context) {
        const resolved = context.read(RESOLVED_SETTINGS_RESOURCE).value; const document = preparedSnapshot.document;
        if (resolved.schemaId !== document.settingsSchema.id || resolved.schemaVersion !== document.settingsSchema.version) throw new Error("CP-F33 resolved schema does not match authoring");
        for (const bridge of resolvedBridges) callSynchronousHost(bridge, "apply", resolved, context.frame);
        publishState(context, freezeAuthoringData({ active: true, apiVersion: AUTHORING_API_VERSION, revision: preparedSnapshot.revision, settings: resolved, materialIds: document.materials.map(material => material.id), resolvedBridges: resolvedBridges.map(bridge => bridge.id), lightingProperties: Object.keys(document.lighting), globalHistoryReset: false, referenceVerified: false }));
      }
    }));
    services.report?.({ phase: "CP-F33", event: "authoring-installed", apiVersion: AUTHORING_API_VERSION, dependencies: ["CP-F02", "CP-F03", "CP-F26", "CP-F28"], referenceStatus: "BLOCKED_REFERENCE", gpuAllocations: 0 });
  } catch (error) { dispose(); throw error; }
  return dispose;
}
