import { validateFrame, validateResource } from "../../contracts/frameContract.js";
import { resolveWorkingColorSpace } from "../CP-F04/workingColorSpace.js";
import { validateDepthCamera } from "../CP-F05/depthMath.js";
import { getPreExposureScale } from "../CP-F07/preExposureScale.js";
import { validateAppliedTemporalJitter } from "./temporalRasterState.js";
import { resolveTemporalExtent } from "./temporalSettings.js";

const workingColorSpace = resolveWorkingColorSpace("rec709");

function requireTexture(resource, frame, label, formats, encodings) {
  validateResource(resource, frame, `CP-F21 ${label}`);
  if (!resource.texture || !formats.includes(resource.format) || !encodings.includes(resource.encoding)) throw new Error(`CP-F21 incompatible ${label} format or encoding`);
  if (resource.width !== frame.renderSize.width || resource.height !== frame.renderSize.height || resource.origin !== "bottom-left" || resource.available === false) throw new Error(`CP-F21 ${label} must cover the current render extent`);
  if (resource.samples > 1 || resource.target?.samples > 1) throw new Error(`CP-F21 ${label} requires an explicit multisample resolve`);
  if (resource.jitterPixels && (resource.jitterPixels.length !== 2 || resource.jitterPixels.some((value, axis) => !Number.isFinite(value) || Math.abs(value - frame.jitterPixels[axis]) > 1e-7))) throw new Error(`CP-F21 ${label} jitter is misaligned`);
  return resource;
}

export function readTemporalInputs(context, bindings, settings, maximumTextureSize) {
  const { frame } = context;
  validateFrame(frame);
  if (frame.referenceMode) throw new Error("CP-F21 BLOCKED_REFERENCE: no verified UE5.9 TSR reference profile");
  const extent = resolveTemporalExtent(frame, settings, maximumTextureSize);
  const temporalResource = context.read("CP-F07.temporalFrame");
  validateResource(temporalResource, frame, "CP-F07.temporalFrame");
  const temporal = temporalResource.value;
  if (temporal?.apiVersion !== "1.0.0" || typeof temporal.histories?.acquire !== "function" || typeof temporal.histories?.releaseEffect !== "function") throw new Error("CP-F21 requires the live CP-F07 history API");
  const jitterPixels = validateAppliedTemporalJitter(frame, temporal, bindings);
  const color = requireTexture(context.read(bindings.color), frame, "color", ["rgba16f"], ["scene-linear-rec709"]);
  if (color.transfer !== undefined && color.transfer !== "linear") throw new Error("CP-F21 requires linear color, never an output transform");
  if (color.colorSpace !== undefined && (typeof color.colorSpace !== "object" || color.colorSpace === null || resolveWorkingColorSpace(color.colorSpace).signature !== workingColorSpace.signature)) throw new Error("CP-F21 supports Rec709 working primaries only");
  getPreExposureScale(1, frame.preExposure);
  const sourcePreExposure = color.preExposure === undefined ? 1 : color.preExposure;
  const sourceExposureScale = getPreExposureScale(sourcePreExposure, frame.preExposure);
  const depth = requireTexture(context.read(bindings.depth), frame, "depth", ["depth24", "r32f", "r16f", "rgba16f"], ["hardware-depth-opengl", "positive-view-depth-meters"]);
  const camera = validateDepthCamera(frame.camera);
  if (depth.nearMeters !== undefined && depth.nearMeters !== camera.nearMeters || depth.farMeters !== undefined && depth.farMeters !== camera.farMeters) throw new Error("CP-F21 depth planes disagree with the frame");
  const velocity = requireTexture(context.read(bindings.velocity), frame, "velocity", ["rgba16f"], ["uv-current-minus-previous"]);
  const motionValidity = bindings.motionValidity ? requireTexture(context.read(bindings.motionValidity), frame, "motion validity", ["rgba8", "rgba16f"], ["motion-history-visibility-and-coverage"]) : null;
  const reactiveMask = bindings.reactiveMask ? requireTexture(context.read(bindings.reactiveMask), frame, "reactive mask", ["rgba8", "r16f", "r32f", "rgba16f"], ["reactive-mask"]) : null;
  const translucencyMask = bindings.translucencyMask ? requireTexture(context.read(bindings.translucencyMask), frame, "translucency mask", ["rgba8", "r16f", "r32f", "rgba16f"], ["translucency-mask"]) : null;
  return { color, depth, velocity, motionValidity, reactiveMask, translucencyMask, temporal, camera, extent, jitterPixels, sourceExposureScale, sourcePreExposure, workingColorSpace };
}
