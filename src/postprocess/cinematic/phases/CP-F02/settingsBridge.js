import { createSettingsSession, requireSettingsSession } from "./settingsSession.js";
import { createVolumeResolver } from "./volumeResolver.js";
import { readCameraWorldPosition } from "./cameraWorldPosition.js";

export const SETTINGS_SOURCE_KEY = "CP-F02.settingsSession";
export const RESOLVED_SETTINGS_RESOURCE = "CP-F02.resolvedSettings";
export const SETTINGS_PASS_ID = "CP-F02.resolveSettings";

export function attachSettingsSession(settings, session) {
  requireSettingsSession(session);
  if (typeof settings?.get !== "function" || typeof settings?.set !== "function") throw new TypeError("Settings store requires get and set");
  const previous = settings.get(SETTINGS_SOURCE_KEY);
  settings.set(SETTINGS_SOURCE_KEY, session);
  let detached = false;
  return () => {
    if (detached) return;
    detached = true;
    if (settings.get(SETTINGS_SOURCE_KEY) === session) settings.set(SETTINGS_SOURCE_KEY, previous);
  };
}

export function installSettingsPhase(services) {
  if (typeof services.settings?.get !== "function") throw new TypeError("CP-F02 requires the B00 settings store");
  const defaultSession = createSettingsSession();
  const position = new Float64Array(3);
  let currentSession = null;
  let resolver = null;
  let disposed = false;
  const unregister = services.graph.register({
    id: SETTINGS_PASS_ID,
    owner: "CP-F02",
    stage: "prepare",
    order: 20,
    reads: [],
    writes: [RESOLVED_SETTINGS_RESOURCE],
    transformsColor: false,
    execute(context) {
      if (disposed) throw new Error("CP-F02 phase is disposed");
      if (context.frame.referenceMode) throw new Error("CP-F02 BLOCKED_REFERENCE: settings semantics require verified CP-F01 reference evidence");
      const source = context.settings.get(SETTINGS_SOURCE_KEY);
      const session = requireSettingsSession(source === undefined ? defaultSession : source);
      if (session !== currentSession) {
        resolver?.dispose();
        resolver = createVolumeResolver(session);
        currentSession = session;
      }
      if (resolver.needsPosition()) readCameraWorldPosition(context.frame, position);
      const value = resolver.resolve({ viewId: context.frame.viewId, position });
      context.publish(RESOLVED_SETTINGS_RESOURCE, Object.freeze({ value, frameId: context.frame.frameId, viewId: context.frame.viewId, generation: context.frame.generation, provenance: "synthetic" }));
    }
  });
  services.report?.({ phase: "CP-F02", event: "settings-installed", source: SETTINGS_SOURCE_KEY, resource: RESOLVED_SETTINGS_RESOURCE, referenceStatus: "BLOCKED_REFERENCE", gpuAllocations: 0 });
  return () => {
    if (disposed) return;
    disposed = true;
    unregister();
    resolver?.dispose();
    currentSession = null;
  };
}
