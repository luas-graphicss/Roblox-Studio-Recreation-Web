import { DIAGNOSTIC_READBACK_FRAGMENT } from "./diagnosticReadbackShader.js";
import { DIAGNOSTICS_PHASE } from "./diagnosticsContract.js";
import { validatePixels } from "./diagnosticValidation.js";

export function createDiagnosticReadback(adapter, pool) {
  let material = null;
  let disposed = false;
  const key = "CP-F30.readback";

  function assertHealthy() {
    if (disposed) throw new Error("Diagnostic readback is disposed");
    if (!adapter?.capabilities?.webgl2 || !adapter.capabilities.floatColorBuffer || !pool?.acquire || !pool?.release) throw new Error("WebGL2 floating-point readback and a resource pool are required");
    if (typeof adapter.errors !== "function") throw new Error("Shader-error telemetry is required for verified capture");
    if (adapter.context?.isContextLost()) throw new Error("WebGL context is lost");
    if (adapter.errors().length) throw new Error("Shader compilation or link failure; capture is blocked");
  }

  return Object.freeze({
    read(resource) {
      assertHealthy();
      if (resource.isAlive && !resource.isAlive()) throw new Error("Source resource is no longer alive");
      if (resource.width > adapter.capabilities.maxTextureSize || resource.height > adapter.capabilities.maxTextureSize) throw new RangeError("Capture exceeds GPU texture dimensions");
      const target = pool.acquire(DIAGNOSTICS_PHASE, key, { width: resource.width, height: resource.height, format: "r32f", filter: "nearest" });
      try {
        if (target.texture === resource.texture) throw new Error("Diagnostic read/write texture feedback");
        material ??= adapter.createMaterial(DIAGNOSTIC_READBACK_FRAGMENT, { sourceTexture: { value: null }, sourceSize: { value: [1, 1] }, channelIndex: { value: 0 } });
        material.uniforms.sourceTexture.value = resource.texture;
        material.uniforms.sourceSize.value = [resource.width, resource.height];
        const pixels = new Float32Array(resource.width * resource.height * 4);
        for (let channel = 0; channel < 4; channel += 1) {
          material.uniforms.channelIndex.value = channel;
          adapter.draw(material, target);
          assertHealthy();
          const readback = adapter.readTarget(target);
          if (!(readback instanceof Float32Array) || readback.length !== pixels.length) throw new Error("Incomplete R32F GPU readback");
          for (let offset = 0; offset < pixels.length; offset += 4) pixels[offset + channel] = readback[offset];
        }
        assertHealthy();
        return validatePixels(pixels, resource.width, resource.height);
      } finally { pool.release(key); }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      material?.dispose();
      pool?.release?.(key);
    }
  });
}
