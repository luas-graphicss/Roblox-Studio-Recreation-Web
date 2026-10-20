const COVERAGE_FRAGMENT = `
varying vec2 vUv;
uniform sampler2D normalCoverage;
void main() {
  float coverage = texture2D(normalCoverage, vUv).a;
  gl_FragColor = vec4(coverage, coverage, coverage, 1.0);
}
`;

export function createCoverageExtractionPass(adapter) {
  const uniforms = { normalCoverage: { value: null } };
  const material = adapter.createMaterial(COVERAGE_FRAGMENT, uniforms);
  return Object.freeze({
    draw(source, target) {
      if (source.texture === target.texture) throw new Error("CP-F05 coverage extraction feedback is forbidden");
      uniforms.normalCoverage.value = source.texture;
      adapter.draw(material, target);
    },
    dispose() { material.dispose(); }
  });
}
