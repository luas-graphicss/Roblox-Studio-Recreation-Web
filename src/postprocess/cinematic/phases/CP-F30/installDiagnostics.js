import { DIAGNOSTICS_PHASE, DIAGNOSTICS_SETTING, DIAGNOSTICS_SESSION, DIAGNOSTICS_RESOURCE } from "./diagnosticsContract.js";
import { createDiagnosticsSession } from "./createDiagnosticsSession.js";

export function installDiagnostics(services) {
  if (!services.graph?.register || !services.settings?.get || !services.settings?.set) throw new TypeError("CP-F30 requires graph and settings services");
  const authored = services.settings.get(DIAGNOSTICS_SETTING);
  if (authored != null && (typeof authored !== "object" || Array.isArray(authored))) throw new TypeError("CP-F30 settings must be an object or AUTO");
  const settings = authored ?? {};
  const session = createDiagnosticsSession({ rendererAdapter: services.rendererAdapter, pool: services.pool, bindings: settings.bindings, maxPixels: settings.maxPixels, maxSnapshotBytes: settings.maxSnapshotBytes });
  const previousSession = services.settings.get(DIAGNOSTICS_SESSION);
  let unregister;
  try {
    unregister = services.graph.register({
      id: "CP-F30.inspectBuffers", owner: DIAGNOSTICS_PHASE, stage: "debug", order: 3000,
      reads: [...new Set(session.bindings.map((binding) => binding.resource))], writes: [DIAGNOSTICS_RESOURCE], transformsColor: false,
      execute(context) {
        const resources = Object.fromEntries(session.bindings.map((binding) => [binding.resource, context.read(binding.resource)]));
        let inspection;
        try { inspection = session.observe(context.frame, resources); }
        catch (error) { inspection = session.describe(context.frame); services.report?.({ phase: DIAGNOSTICS_PHASE, type: "diagnostic-blocked", reason: error.message }); }
        context.publish(DIAGNOSTICS_RESOURCE, Object.freeze({ frameId: context.frame.frameId, viewId: context.frame.viewId, generation: context.frame.generation, provenance: "synthetic", value: inspection }));
      }
    });
    services.settings.set(DIAGNOSTICS_SESSION, session);
    services.report?.({ phase: DIAGNOSTICS_PHASE, type: "diagnostics-installed", sessionSetting: DIAGNOSTICS_SESSION, readback: "explicit-capture-only", referenceCertified: false });
  } catch (error) {
    unregister?.();
    session.dispose();
    if (services.settings.get(DIAGNOSTICS_SESSION) === session) services.settings.set(DIAGNOSTICS_SESSION, previousSession ?? null);
    throw error;
  }
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    unregister();
    session.dispose();
    if (services.settings.get(DIAGNOSTICS_SESSION) === session) services.settings.set(DIAGNOSTICS_SESSION, previousSession ?? null);
  };
}
