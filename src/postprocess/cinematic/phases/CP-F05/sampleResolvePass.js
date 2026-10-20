function validateSampleResource(resource, frame, label) {
  if (!resource?.texture || resource.frameId !== frame.frameId || resource.viewId !== frame.viewId || resource.generation !== frame.generation) throw new Error(`CP-F05 missing or stale sample ${label}`);
  if (resource.width !== frame.renderSize.width || resource.height !== frame.renderSize.height || resource.origin !== "bottom-left") throw new Error(`CP-F05 sample extent or origin mismatch: ${label}`);
  if (resource.jitterPixels?.some((value, index) => value !== frame.jitterPixels[index])) throw new Error(`CP-F05 sample jitter mismatch: ${label}`);
}

export function createSampleResolvePass(adapter, sampleCount) {
  if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 8) throw new TypeError("CP-F05 GPU resolve requires 1..8 explicit single-sample layers");
  if (adapter.capabilities.maxTextureUnits < sampleCount + 1) throw new Error("CP-F05 insufficient texture units for correlated sample resolve");
  const depthUniforms = { outputDepth: { value: true } };
  const attributeUniforms = { sampleSelection: { value: null }, normalAttribute: { value: false } };
  for (let index = 0; index < sampleCount; index += 1) {
    depthUniforms[`depthSample${index}`] = { value: null };
    attributeUniforms[`attributeSample${index}`] = { value: null };
  }
  const declarations = Array.from({ length: sampleCount }, (_, index) => `uniform sampler2D depthSample${index};`).join("\n");
  const selectionSteps = Array.from({ length: sampleCount }, (_, index) => `
    vec4 sample${index} = texture2D(depthSample${index}, vUv);
    totalCoverage += sample${index}.a;
    if (sample${index}.a > 0.0 && (selectedIndex < 0.0 || sample${index}.r < selectedDepth)) {
      selectedDepth = sample${index}.r;
      selectedIndex = ${index}.0;
    }
  `).join("\n");
  const depthMaterial = adapter.createMaterial(`
varying vec2 vUv;
uniform bool outputDepth;
${declarations}
void main() {
  float selectedDepth = 1.0;
  float selectedIndex = -1.0;
  float totalCoverage = 0.0;
  ${selectionSteps}
  float coverage = totalCoverage / ${sampleCount}.0;
  gl_FragColor = outputDepth ? vec4(selectedDepth, 0.0, 0.0, coverage > 0.0 ? 1.0 : 0.0) : vec4(selectedIndex, coverage, 0.0, coverage > 0.0 ? 1.0 : 0.0);
}
`, depthUniforms);
  const attributeDeclarations = Array.from({ length: sampleCount }, (_, index) => `uniform sampler2D attributeSample${index};`).join("\n");
  const attributeSelection = Array.from({ length: sampleCount }, (_, index) => `if (selection.r == ${index}.0) result = texture2D(attributeSample${index}, vUv);`).join("\n");
  const attributeMaterial = adapter.createMaterial(`
varying vec2 vUv;
uniform sampler2D sampleSelection;
uniform bool normalAttribute;
${attributeDeclarations}
void main() {
  vec4 selection = texture2D(sampleSelection, vUv);
  vec4 result = vec4(0.0);
  ${attributeSelection}
  if (selection.r >= 0.0) {
    if (normalAttribute) result.rgb = normalize(result.rgb * 2.0 - 1.0) * 0.5 + 0.5;
    result.a = 1.0;
  }
  gl_FragColor = result;
}
`, attributeUniforms);
  return Object.freeze({
    resolve({ samples, frame, targets }) {
      if (!Array.isArray(samples) || samples.length !== sampleCount) throw new Error("CP-F05 sample count disagrees with the resolve profile");
      const attributes = ["normal", "objectId", "materialId", "stencil"];
      const sampledTextures = new Set();
      for (const [index, sample] of samples.entries()) {
        for (const name of ["depthCoverage", ...attributes]) {
          validateSampleResource(sample[name], frame, `${index}.${name}`);
          sampledTextures.add(sample[name].texture);
        }
        if (sample.depthCoverage.encoding !== "hardware-depth-coverage-alpha") throw new Error("CP-F05 per-sample depth and coverage must have explicit correlated encoding");
      }
      for (const name of ["depth", "selection", ...attributes]) {
        const target = targets[name];
        if (!target?.texture || target.width !== frame.renderSize.width || target.height !== frame.renderSize.height) throw new Error(`CP-F05 invalid resolve target: ${name}`);
        if (sampledTextures.has(target.texture)) throw new Error("CP-F05 sample resolve feedback is forbidden");
      }
      if (new Set(Object.values(targets).map((target) => target.texture)).size !== Object.keys(targets).length) throw new Error("CP-F05 resolve targets must be distinct");
      if (targets.depth.userData.format !== "r32f" || targets.selection.userData.format !== "rgba16f") throw new Error("CP-F05 resolve depth requires R32F and selection requires RGBA16F");
      samples.forEach((sample, index) => { depthUniforms[`depthSample${index}`].value = sample.depthCoverage.texture; });
      depthUniforms.outputDepth.value = true;
      adapter.draw(depthMaterial, targets.depth);
      depthUniforms.outputDepth.value = false;
      adapter.draw(depthMaterial, targets.selection);
      attributeUniforms.sampleSelection.value = targets.selection.texture;
      for (const name of attributes) {
        samples.forEach((sample, index) => { attributeUniforms[`attributeSample${index}`].value = sample[name].texture; });
        attributeUniforms.normalAttribute.value = name === "normal";
        adapter.draw(attributeMaterial, targets[name]);
      }
      return Object.freeze({ sampleCount, policy: "nearest-covered-depth-stable-first-sample", coverage: "covered-sample-fraction", categoricalValuesAveraged: false });
    },
    dispose() { depthMaterial.dispose(); attributeMaterial.dispose(); }
  });
}
