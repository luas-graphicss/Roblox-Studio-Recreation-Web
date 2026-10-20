export function runGpuFoundationTests(adapter, pool, inputs) {
  const results = [];
  const baseline = pool.stats();
  const record = (name, operation) => {
    try { const detail = operation(); results.push({ name, passed: true, detail }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
  };
  record("FP16 preserves radiance above one", () => {
    const target = pool.acquire("B00QA", "B00QA.hdrProbe", { width: 4, height: 4, format: "rgba16f" });
    const material = adapter.createMaterial("void main() { gl_FragColor = vec4(0.18, 8.0, 64.0, 1.0); }");
    try {
      adapter.draw(material, target);
      const pixels = adapter.readTarget(target);
      if (Math.abs(pixels[0] - 0.18) > 0.001 || pixels[1] !== 8 || pixels[2] !== 64 || pixels[3] !== 1) throw new Error(`Unexpected HDR pixel: ${[...pixels.slice(0, 4)]}`);
      return { pixel: [...pixels.slice(0, 4)], provenance: "gpu-readback" };
    } finally { material.dispose(); pool.releaseOwner("B00QA"); }
  });
  record("Scene target contains real varied finite pixels", () => {
    const pixels = adapter.readTarget(inputs.sceneColor.target);
    let minimum = Infinity;
    let maximum = -Infinity;
    for (let index = 0; index < pixels.length; index += 4) {
      const value = pixels[index] + pixels[index + 1] + pixels[index + 2];
      if (!Number.isFinite(value)) throw new Error("Non-finite scene radiance");
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
    if (maximum - minimum < 0.1) throw new Error("Scene is empty or constant");
    return { minimumRgbSum: minimum, maximumRgbSum: maximum };
  });
  record("Normal target has geometric coverage", () => {
    const pixels = adapter.readTarget(inputs.sceneNormal.target);
    let coveredPixels = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) coveredPixels += 1;
    if (coveredPixels === 0) throw new Error("No normal coverage");
    return { coveredPixels };
  });
  record("Shader compiler rejects a negative control", () => {
    const gl = adapter.context;
    const shader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(shader, "precision highp float; void main() { gl_FragColor = missingValue; }");
    gl.compileShader(shader);
    const rejected = !gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    if (!rejected) throw new Error("Invalid shader unexpectedly compiled");
    return { rejected, diagnosticPresent: Boolean(log) };
  });
  record("Diagnostic pool resources are released", () => {
    const stats = pool.stats();
    if (stats.liveTargets !== baseline.liveTargets || stats.currentBytes !== baseline.currentBytes) throw new Error("Diagnostic probes leaked target resources");
    return stats;
  });
  return { passed: results.every((result) => result.passed), results, scope: "Foundation GPU tests only; no UE parity claim", measuredAt: new Date().toISOString() };
}
