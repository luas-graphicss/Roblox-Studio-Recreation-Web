import { configurationKey, integer } from "./qualityContract.js";

export function createFrameTimingRegistry({ capacity = 1024 } = {}) {
  integer(capacity, "timing registry capacity", 1, 65536);
  const frames = new Map();
  const keyFor = (frame, key) => configurationKey([frame.generation, frame.frameId, key]);
  return Object.freeze({
    remember(frame, key, { eligible, deviceEpoch }) {
      if (typeof eligible !== "boolean") throw new TypeError("Timing eligibility must be explicit");
      integer(deviceEpoch, "device epoch");
      frames.set(keyFor(frame, key), Object.freeze({ eligible, deviceEpoch }));
      if (frames.size > capacity) frames.delete(frames.keys().next().value);
    },
    qualify(sample, device) {
      const frame = frames.get(keyFor(sample, sample.configurationKey));
      if (!frame) throw new Error("Timing must identify a previously rendered view and frame");
      const eligible = frame.eligible && device?.state === "ready" && device.epoch === frame.deviceEpoch;
      return { ...sample, productionEligible: eligible && sample.productionEligible === true };
    },
    clear() { frames.clear(); },
    size: () => frames.size
  });
}
