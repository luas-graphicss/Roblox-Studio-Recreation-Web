export const BRIDGE_OWNER = "CP-F27";
export const BRIDGE_VERSION = "1.0.0";
export const BRIDGE_CONFIGURATION = "CP-F27.configuration";
export const BRIDGE_ENABLED = "CP-F27.enabled";
export const BRIDGE_BOUNDARY = "CP-F27.lightingBoundary";
export const BRIDGE_STAGES = Object.freeze(["beforeDof", "afterDof", "afterMotionBlur"]);
export const BRIDGE_FEATURES = Object.freeze(["ambientOcclusion", "ambientCubemap", "globalIllumination", "reflections", "fog", "refraction", "substrate", "particles", "water", "sky", "pathTracing", "megaLights"]);
export const BRIDGE_DOMAINS = Object.freeze(["opaque", "masked", "translucent", "particle", "water", "sky", "substrate"]);
export const BRIDGE_SIGNAL_ENCODINGS = Object.freeze({ coverage: "coverage", reactive: "reactive-mask", velocity: "uv-current-minus-previous" });
export const BRIDGE_COMPOSITION_POLICY = Object.freeze({ color: "premultiplied-over", coverage: "independent-coverage-over", reactive: "maximum-with-invalid-motion-rejection", velocity: "frontmost-contributing-layer-or-invalid", radiance: "scene-linear-rec709", ownership: "borrowed-inputs-owned-outputs", reference: "BLOCKED_REFERENCE" });

export function bridgeStageResources(stage) {
  if (!BRIDGE_STAGES.includes(stage)) throw new TypeError(`Unsupported CP-F27 stage: ${stage}`);
  return Object.freeze(Object.fromEntries(["color", "coverage", "reactive", "velocity", "validation"].map((kind) => [kind, `${BRIDGE_OWNER}.${stage}.${kind}`])));
}
