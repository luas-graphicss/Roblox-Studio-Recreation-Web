export function createChromaticUniforms() {
  return {
    cp23Source: { value: null },
    cp23SourceSize: { value: [1, 1] },
    cp23OutputSize: { value: [1, 1] },
    cp23Crop: { value: [0, 0, 1, 1] },
    cp23AxisScale: { value: [1, 1] },
    cp23Center: { value: [0.5, 0.5] },
    cp23Intensity: { value: 0 },
    cp23StartOffset: { value: 0 },
    cp23ExactCopy: { value: true },
    cp23Premultiplied: { value: false },
    cp23EdgeMode: { value: 0 },
  };
}

export function updateChromaticUniforms(uniforms, source, settings, geometry) {
  uniforms.cp23Source.value = source.texture;
  uniforms.cp23SourceSize.value[0] = source.width;
  uniforms.cp23SourceSize.value[1] = source.height;
  uniforms.cp23OutputSize.value[0] = geometry.width;
  uniforms.cp23OutputSize.value[1] = geometry.height;
  for (let index = 0; index < 4; index += 1) uniforms.cp23Crop.value[index] = geometry.crop[index];
  for (let index = 0; index < 2; index += 1) {
    uniforms.cp23AxisScale.value[index] = geometry.axisScale[index];
    uniforms.cp23Center.value[index] = settings.center[index];
  }
  uniforms.cp23Intensity.value = settings.enabled ? settings.intensity : 0;
  uniforms.cp23StartOffset.value = settings.startOffset;
  uniforms.cp23ExactCopy.value = geometry.exactCopy;
  uniforms.cp23Premultiplied.value = source.alphaMode === "premultiplied";
  uniforms.cp23EdgeMode.value = settings.edgeMode === "transparent" ? 1 : 0;
}
