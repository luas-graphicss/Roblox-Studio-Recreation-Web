export function buildDepthSliceUniformGlsl() {
  return [
    "uniform float uDepthSliceScale;   // CL_Z/(log(far)-log(near)) vindo da CPU",
    "uniform float uDepthSliceBias;    // -log(near)*uDepthSliceScale vindo da CPU",
  ];
}

export function buildDepthSliceLookupGlsl(options) {
  const precomputed = !!(options && options.precomputed);
  if (!precomputed) {
    return [
      "  float logN = log(uNear);",
      "  float logF = log(max(uFar, uNear+0.001));",
      "  float tz = floor(RSW_CL_Z*(log(max(viewZNeg,uNear))-logN)/(logF-logN));",
    ];
  }
  return [
    "  float tz = floor(uDepthSliceScale*log(max(viewZNeg,uNear)) + uDepthSliceBias);",
  ];
}
