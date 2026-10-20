export function validateCaptureColorState(adapter) {
  if (!adapter?.renderer || !adapter?.THREE) throw new TypeError("A real linear scene renderer is required for CP-F04 preparation");
  if (adapter.renderer.toneMapping !== adapter.THREE.NoToneMapping) throw new Error("CP-F04 requires scene capture before tone mapping; refusing double exposure/tone mapping");
  if (adapter.renderer.outputColorSpace !== adapter.THREE.LinearSRGBColorSpace) throw new Error("CP-F04 requires linear scene capture; refusing double sRGB conversion");
}
