import { buildMotionVertexShader } from "./motionVertexShader.js";
import { buildMotionFragmentShader } from "./motionFragmentShader.js";

export function buildMotionShaders(materialIndex, globalPlaneCount = 0, localPlaneCount = 0) {
  for (const value of [materialIndex, globalPlaneCount, localPlaneCount])
    if (!Number.isSafeInteger(value) || value < 0)
      throw new TypeError("CP-F06 shader indices and plane counts must be nonnegative integers");
  return {
    vertex: buildMotionVertexShader(materialIndex),
    fragment: buildMotionFragmentShader(globalPlaneCount, localPlaneCount),
  };
}
