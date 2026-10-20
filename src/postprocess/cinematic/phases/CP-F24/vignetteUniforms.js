import { resolveVignetteAxisScale } from "./vignetteMath.js";

export function createVignetteUniforms() {
  return { cp24Intensity: { value: 0 }, cp24AxisScale: { value: [1, 1] } };
}

export function updateVignetteUniforms(uniforms, settings, frame) {
  const scale = resolveVignetteAxisScale(frame.outputSize, settings.aspectRatio);
  uniforms.cp24Intensity.value = settings.enabled ? settings.intensity : 0;
  uniforms.cp24AxisScale.value[0] = scale[0];
  uniforms.cp24AxisScale.value[1] = scale[1];
}
