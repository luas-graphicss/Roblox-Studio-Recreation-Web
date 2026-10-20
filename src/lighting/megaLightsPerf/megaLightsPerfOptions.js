export const MEGA_LIGHTS_PERF_ALL_DISABLED = Object.freeze({
  lightBoundsCulling: false,
  hoistedScreenTraceProjection: false,
  precomputedDepthSlice: false,
  reusedUnpackedDepth: false,
  specularWeightUniformGate: false,
  sqrtFreeFalloffWindow: false,
});

export const MEGA_LIGHTS_PERF_DEFAULTS = Object.freeze({
  lightBoundsCulling: true,
  hoistedScreenTraceProjection: true,
  precomputedDepthSlice: true,
  reusedUnpackedDepth: true,
  specularWeightUniformGate: true,
  sqrtFreeFalloffWindow: true,
});


export function resolveMegaLightsPerfOptions(options) {
  if (options === true) return MEGA_LIGHTS_PERF_DEFAULTS;
  if (!options || typeof options !== "object") return MEGA_LIGHTS_PERF_ALL_DISABLED;
  return Object.freeze({
    lightBoundsCulling: options.lightBoundsCulling === true,
    hoistedScreenTraceProjection: options.hoistedScreenTraceProjection === true,
    precomputedDepthSlice: options.precomputedDepthSlice === true,
    reusedUnpackedDepth: options.reusedUnpackedDepth === true,
    specularWeightUniformGate: options.specularWeightUniformGate === true,
    sqrtFreeFalloffWindow: options.sqrtFreeFalloffWindow === true,
  });
}

export function isAnyMegaLightsPerfOptionEnabled(options) {
  const resolved = resolveMegaLightsPerfOptions(options);
  return (
    resolved.lightBoundsCulling ||
    resolved.hoistedScreenTraceProjection ||
    resolved.precomputedDepthSlice ||
    resolved.reusedUnpackedDepth ||
    resolved.specularWeightUniformGate ||
    resolved.sqrtFreeFalloffWindow
  );
}
