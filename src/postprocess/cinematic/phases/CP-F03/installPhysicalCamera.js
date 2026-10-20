import { CAMERA_PHASE_ID, CAMERA_SETTINGS_KEY, CAMERA_RESOURCE_ID, CAMERA_PASS_ID, CAMERA_HISTORY_ID, CAMERA_PREPARE_ORDER } from "./cameraIdentifiers.js";
import { plainRecord } from "./cameraValidation.js";
import { createRackFocusSequence } from "./focusSequence.js";
import { resolvePhysicalCameraState } from "./physicalCameraState.js";
import { createThreeCameraBinding } from "./threeCameraBinding.js";

export function installPhysicalCamera(services) {
  const binding = createThreeCameraBinding(services.rendererAdapter);
  const settings = services.settings;
  if (typeof settings?.get !== "function") throw new TypeError("CP-F03 requires the settings service");
  let sequenceKey = null;
  let sequence = null;
  let disposed = false;
  const unregister = services.graph.register({
    id: CAMERA_PASS_ID,
    owner: CAMERA_PHASE_ID,
    stage: "prepare",
    order: CAMERA_PREPARE_ORDER,
    reads: [],
    writes: [CAMERA_RESOURCE_ID],
    transformsColor: false,
    execute(context) {
      const frame = context.frame;
      const globalSettings = settings.get(CAMERA_SETTINGS_KEY) ?? {};
      const viewSettings = settings.get(`${CAMERA_SETTINGS_KEY}.${frame.viewId}`) ?? {};
      plainRecord(globalSettings, CAMERA_SETTINGS_KEY);
      plainRecord(viewSettings, "per-view camera settings");
      const configuration = { ...globalSettings, ...viewSettings };
      if (configuration.enabled === false) binding.restore(frame);
      const hasAuthoredSettings = Object.values(configuration).some((value) => value !== undefined && value !== null);
      const activeConfiguration = configuration.enabled === false ? { enabled: false } : configuration;
      const nextSequenceKey = activeConfiguration.focusMode === "rack" ? JSON.stringify([activeConfiguration.focusSequence, activeConfiguration.focusInterpolation ?? "smoothstep"]) : null;
      if (nextSequenceKey !== sequenceKey) {
        sequence = nextSequenceKey === null ? null : createRackFocusSequence(activeConfiguration.focusSequence, activeConfiguration.focusInterpolation ?? "smoothstep");
        sequenceKey = nextSequenceKey;
      }
      const baseline = binding.describe(frame);
      const state = resolvePhysicalCameraState(activeConfiguration, baseline, frame, sequence);
      const previous = services.history.read(CAMERA_PHASE_ID, CAMERA_HISTORY_ID, frame);
      const cutRequested = state.enabled && previous !== null && !Object.is(previous.cameraCutToken, state.cameraCutToken);
      if (cutRequested) frame.cameraCut = true;
      const result = binding.apply(frame, state, hasAuthoredSettings);
      const value = Object.freeze({ ...state, binding: Object.freeze(result), unitSource: baseline.unitSource, cameraCut: frame.cameraCut === true, historyReset: previous === null || frame.cameraCut === true });
      context.publish(CAMERA_RESOURCE_ID, Object.freeze({ value, frameId: frame.frameId, viewId: frame.viewId, generation: frame.generation, provenance: "synthetic" }));
      services.history.write(CAMERA_PHASE_ID, CAMERA_HISTORY_ID, frame, Object.freeze({ cameraCutToken: state.cameraCutToken }));
      if (previous === null || cutRequested) services.report?.({ owner: CAMERA_PHASE_ID, event: "camera-prepared", viewId: frame.viewId, frameId: frame.frameId, applied: result.applied, cameraCut: value.cameraCut, referenceVerified: false });
    }
  });
  return () => {
    if (disposed) return;
    disposed = true;
    unregister();
    binding.dispose();
    services.history.clearOwner(CAMERA_PHASE_ID);
    sequence = null;
    sequenceKey = null;
  };
}
