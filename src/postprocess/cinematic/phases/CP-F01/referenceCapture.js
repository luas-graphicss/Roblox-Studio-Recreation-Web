import { FROZEN_CAPTURE_FIELDS, REQUIRED_SCENE_IDS, CAPTURE_FORMATS } from "./referenceConstants.js";
import { indexById, readFacts, isRecord, isText } from "./referenceValidation.js";

function validSize(value) {
  return isRecord(value) && Number.isInteger(value.width) && Number.isInteger(value.height) && value.width > 0 && value.height > 0 && value.width <= 16384 && value.height <= 16384;
}

export function expectedCaptureSlots(passOrder) {
  return [...passOrder.flatMap((passId) => [`${passId}:before`, `${passId}:after`]), "scene:linearColor", "output:displayColor", "scene:depth", "scene:velocity"];
}

export function validateCaptureRuns(manifest, inventory, sources, assets, collector) {
  const runs = indexById(manifest.captureRuns, "captureRuns", collector);
  const coverage = new Set();
  const usedCaptureAssets = new Set();
  for (const [id, run] of runs) {
    const path = `captureRuns.${id}`;
    const profile = inventory.profiles.get(run.profileId);
    if (!collector.require(Boolean(profile), "UNKNOWN_CAPTURE_PROFILE", path, "Capture profile is missing")) continue;
    collector.require(REQUIRED_SCENE_IDS.includes(run.sceneId) && Array.isArray(profile.values.sceneIds) && profile.values.sceneIds.includes(run.sceneId), "UNKNOWN_CAPTURE_SCENE", path, "Capture scene must belong to the frozen profile");
    coverage.add(`${run.profileId}/${run.sceneId}`);
    const frozen = readFacts(run.frozen, FROZEN_CAPTURE_FIELDS, `${path}.frozen`, sources, collector);
    collector.require(frozen.buildId === manifest.build?.facts?.buildId?.value && isText(frozen.buildId), "CAPTURE_BUILD_MISMATCH", path, "Capture must identify the same build");
    collector.require(frozen.rhi === profile.values.rhi && isText(frozen.rhi), "CAPTURE_RHI_MISMATCH", path, "RHI must equal the frozen profile");
    collector.require(JSON.stringify(frozen.outputTransform) === JSON.stringify(profile.values.outputTransform) && frozen.outputTransform !== undefined, "CAPTURE_OUTPUT_MISMATCH", path, "Output transform must equal the profile");
    collector.require(validSize(frozen.renderSize) && validSize(frozen.outputSize), "INVALID_CAPTURE_SIZE", path, "Physical render and output extents are required");
    collector.require(isRecord(frozen.hardware) && ["cpu", "gpu", "driver", "os"].every((field) => isText(frozen.hardware[field])), "INVALID_HARDWARE", path, "CPU, GPU, driver and OS must be frozen");
    collector.require(Array.isArray(frozen.plugins) && isRecord(frozen.cvars) && Array.isArray(frozen.postVolumes) && isRecord(frozen.camera), "INVALID_CAPTURE_SETTINGS", path, "Plugins, CVars, volumes and camera must be explicit; empty collections are not missing");
    collector.require(Number.isSafeInteger(frozen.seed) && frozen.seed >= 0 && Number.isFinite(frozen.timestepSeconds) && frozen.timestepSeconds > 0 && frozen.timestepSeconds <= 1, "INVALID_CAPTURE_CLOCK", path, "A nonnegative seed and fixed positive timestep are required");
    for (const field of ["exposureWarmupFrames", "temporalWarmupFrames"]) collector.require(Number.isSafeInteger(frozen[field]) && frozen[field] >= 0, "INVALID_WARMUP", `${path}.${field}`, "Warmup must be an explicit nonnegative frame count");
    collector.require(isText(frozen.antiAliasing) && isRecord(frozen.jitter), "INVALID_SAMPLING_STATE", path, "AA and jitter must be frozen");
    const frames = run.frames;
    if (!collector.require(Array.isArray(frames) && frames.length >= 2, "MISSING_SEQUENCE", path, "A still alone is insufficient; at least two deterministic frames are required")) continue;
    const slots = expectedCaptureSlots(Array.isArray(profile.values.passOrder) ? profile.values.passOrder : []);
    for (const [frameIndex, frame] of frames.entries()) {
      const framePath = `${path}.frames[${frameIndex}]`;
      if (!isRecord(frame)) { collector.add("INVALID_CAPTURE_FRAME", framePath, "Frame metadata is required"); continue; }
      collector.require(frame.index === frameIndex && Number.isFinite(frame.timeSeconds) && Math.abs(frame.timeSeconds - frameIndex * frozen.timestepSeconds) <= 1e-9, "INVALID_SEQUENCE_CLOCK", framePath, "Frames must be contiguous from zero with the frozen timestep");
      collector.require(Array.isArray(frame.jitterPixels) && frame.jitterPixels.length === 2 && frame.jitterPixels.every(Number.isFinite) && Array.isArray(frame.events), "MISSING_FRAME_STATE", framePath, "Every frame needs explicit jitter and events");
      const actualSlots = Object.keys(isRecord(frame.captures) ? frame.captures : {});
      collector.require(slots.length === actualSlots.length && slots.every((slot) => actualSlots.includes(slot)), "MISSING_CAPTURE_SLOT", framePath, "Capture color before/after every reference pass and depth/velocity in every frame");
      for (const slot of slots) {
        const assetId = frame.captures?.[slot];
        const asset = assets.get(assetId);
        const metadata = asset?.capture;
        if (!collector.require(asset?.role === "capture" && isRecord(metadata), "MISSING_CAPTURE_ASSET", `${framePath}.${slot}`, "A real, hashed capture asset and metadata are required")) continue;
        collector.require(!usedCaptureAssets.has(assetId), "REUSED_CAPTURE_ID", framePath, "Distinct frame/slot identities are required even when their bytes match");
        usedCaptureAssets.add(assetId);
        collector.require(metadata.runId === id && metadata.profileId === run.profileId && metadata.sceneId === run.sceneId && metadata.frameIndex === frameIndex && metadata.slot === slot, "CAPTURE_STAMP_MISMATCH", framePath, "Capture stamp must match run, profile, scene, frame and slot");
        const format = CAPTURE_FORMATS[metadata.format];
        collector.require(Boolean(format) && validSize(metadata) && asset.byteLength === metadata.width * metadata.height * format?.bytesPerPixel, "CAPTURE_FORMAT_MISMATCH", framePath, "Only declared raw formats with exact byte lengths are accepted");
        const extent = metadata.sizeDomain === "render" ? frozen.renderSize : metadata.sizeDomain === "output" ? frozen.outputSize : null;
        collector.require(extent && metadata.width === extent.width && metadata.height === extent.height, "CAPTURE_EXTENT_MISMATCH", framePath, "Capture extent must match its render/output domain");
        collector.require(["bottom-left", "top-left"].includes(metadata.origin) && isText(metadata.encoding), "MISSING_CAPTURE_ENCODING", framePath, "Origin and color/vector/depth encoding must be explicit");
        if (slot === "scene:depth") collector.require(metadata.format === "r32float-le" && ["hardware-depth-opengl", "linear-depth-meters"].includes(metadata.encoding), "INVALID_DEPTH_CAPTURE", framePath, "Depth needs a declared float convention");
        if (slot === "scene:velocity") collector.require(metadata.format === "rg16float-le" && metadata.encoding === "uv-current-minus-previous-no-jitter", "INVALID_VELOCITY_CAPTURE", framePath, "Velocity needs an explicit signed float convention");
        if (!["scene:depth", "scene:velocity"].includes(slot)) collector.require(["rgba16float-le", "rgba32float-le", "rgba8unorm"].includes(metadata.format), "INVALID_COLOR_CAPTURE", framePath, "Color needs RGBA data");
        if (slot === "scene:linearColor") collector.require(["rgba16float-le", "rgba32float-le"].includes(metadata.format) && isText(metadata.encoding) && metadata.encoding.startsWith("scene-linear"), "MISSING_LINEAR_HDR", framePath, "An unclipped linear HDR capture is required");
        if (slot === "output:displayColor") collector.require(isText(metadata.encoding) && metadata.encoding.startsWith("display-"), "MISSING_DISPLAY_OUTPUT", framePath, "A distinct display-referred output capture is required");
        if (isText(metadata.encoding) && metadata.encoding.startsWith("scene-linear")) collector.require(metadata.format !== "rgba8unorm", "CLIPPED_HDR_CAPTURE", framePath, "Byte color cannot certify scene-linear HDR");
      }
    }
  }
  const requiredScenes = new Set();
  for (const [profileId, profile] of inventory.profiles) for (const sceneId of Array.isArray(profile.values.sceneIds) ? profile.values.sceneIds : []) {
    requiredScenes.add(sceneId);
    collector.require(coverage.has(`${profileId}/${sceneId}`), "MISSING_PROFILE_CAPTURE", `profiles.${profileId}.${sceneId}`, "Every declared profile/scene pair needs a sequence");
  }
  for (const sceneId of REQUIRED_SCENE_IDS) collector.require(requiredScenes.has(sceneId), "MISSING_REQUIRED_SCENE", sceneId, "The B00 scene requirement must be mapped into a reference profile");
  return { runCount: runs.size, capturedAssets: usedCaptureAssets.size };
}
