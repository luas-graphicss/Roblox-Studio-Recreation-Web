export function createDepthSliceScaleBias() {
  return { scale: 0, bias: 0 };
}


export function computeDepthSliceScaleBias(near, far, sliceCount, out) {
  const result = out || createDepthSliceScaleBias();
  const logNear = Math.log(near);
  const logFar = Math.log(Math.max(far, near + 0.001));
  const scale = sliceCount / (logFar - logNear);
  result.scale = scale;
  result.bias = -logNear * scale;
  return result;
}


export function depthSliceFromScaleBias(viewZNeg, near, scale, bias, sliceCount) {
  const depth = Math.max(viewZNeg, near);
  const slice = Math.floor(scale * Math.log(depth) + bias);
  const lastSlice = sliceCount - 1;
  return slice < 0 ? 0 : slice > lastSlice ? lastSlice : slice;
}
