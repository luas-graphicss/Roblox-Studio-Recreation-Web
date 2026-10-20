export function validateLensFlareCapabilities(capabilities) {
  if (capabilities?.webgl2 !== true || capabilities.floatColorBuffer !== true) {
    throw new TypeError("CP-F16 requires WebGL2 and float color buffers");
  }
  if (!Number.isInteger(capabilities.maxTextureUnits) || capabilities.maxTextureUnits < 2) {
    throw new RangeError("CP-F16 requires at least two explicitly declared texture units");
  }
  if (!Number.isInteger(capabilities.maxTextureSize) || capabilities.maxTextureSize < 1) {
    throw new RangeError("CP-F16 requires an explicitly declared positive integer maximum texture size");
  }
}
