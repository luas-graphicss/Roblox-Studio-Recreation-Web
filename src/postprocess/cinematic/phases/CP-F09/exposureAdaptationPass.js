import { makeTextureResource } from "../../contracts/frameContract.js";
import { EXPOSURE_HISTORY_NAME, EXPOSURE_PHASE_ID, EXPOSURE_RESOURCES, EXPOSURE_SETTINGS_KEY, EXPOSURE_STATE_ENCODING, EXPOSURE_STATE_LAYOUT } from "./exposureContract.js";
import { createExposureGpuState } from "./exposureGpuState.js";
import { resolveExposureSettings } from "./exposureSettings.js";
import { validateMeteringResource } from "./exposureBinding.js";

export function registerExposureAdaptationPass(services, binding) {
  const gpu = createExposureGpuState(services.rendererAdapter);
  let disposed = false;
  const dispose = () => { if (!disposed) { disposed = true; gpu.dispose(); } };
  try {
    return services.graph.register({
      id: "CP-F09.adaptExposure",
      owner: EXPOSURE_PHASE_ID,
      stage: "metering",
      order: binding.order,
      reads: binding.meteringResource ? [binding.meteringResource] : [],
      writes: [EXPOSURE_RESOURCES.adaptation, EXPOSURE_RESOURCES.nextPreExposure],
      transformsColor: false,
      execute(context) {
        const settings = resolveExposureSettings(services.settings.get(EXPOSURE_SETTINGS_KEY));
        const metering = binding.meteringResource ? validateMeteringResource(context.read(binding.meteringResource)) : null;
        const previous = services.history.read(EXPOSURE_PHASE_ID, EXPOSURE_HISTORY_NAME, context.frame);
        const writeIndex = previous ? 1 - previous.writeIndex : 0;
        const target = services.pool.acquire(EXPOSURE_PHASE_ID, `CP-F09.state.${encodeURIComponent(context.frame.viewId)}.${writeIndex}`, {
          width: EXPOSURE_STATE_LAYOUT.width, height: 1, format: EXPOSURE_STATE_LAYOUT.format, filter: "nearest"
        });
        gpu.render({ settings, metering, previous: previous?.resource, frame: context.frame, target });
        const resource = makeTextureResource(target, context.frame, EXPOSURE_STATE_ENCODING);
        context.publish(EXPOSURE_RESOURCES.adaptation, resource);
        context.publish(EXPOSURE_RESOURCES.nextPreExposure, Object.freeze({ ...resource, encoding: "cp-f09-next-pre-exposure-v1" }));
        services.history.write(EXPOSURE_PHASE_ID, EXPOSURE_HISTORY_NAME, context.frame, Object.freeze({ resource, writeIndex }));
      },
      dispose
    });
  } catch (error) { dispose(); throw error; }
}
