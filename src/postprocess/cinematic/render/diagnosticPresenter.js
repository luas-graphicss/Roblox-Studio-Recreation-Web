const FRAGMENT = `
uniform sampler2D inputTexture;
uniform float exposureEv;
uniform float nearPlane;
uniform float farPlane;
uniform int viewMode;
uniform int encodedOutput;
varying vec2 vUv;
vec3 linearToSrgb(vec3 color) {
  vec3 lower = color * 12.92;
  vec3 upper = 1.055 * pow(max(color, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(upper, lower, step(color, vec3(0.0031308)));
}
void main() {
  vec4 sampled = texture2D(inputTexture, vUv);
  vec3 color = sampled.rgb;
  if (viewMode == 1) {
    float distanceMeters = nearPlane * farPlane / max(farPlane - sampled.r * (farPlane - nearPlane), 0.00001);
    color = vec3(1.0 - log2(1.0 + distanceMeters) / log2(1.0 + farPlane));
  } else if (viewMode == 2) {
    color = sampled.rgb * sampled.a;
  } else if (viewMode == 3) {
    color = vec3(0.5 + sampled.r * 20.0, 0.5 + sampled.g * 20.0, sampled.a * 0.35);
  } else if (encodedOutput == 0) {
    color = max(color * exp2(exposureEv), vec3(0.0));
    color = linearToSrgb(color / (vec3(1.0) + color));
  }
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

export function createDiagnosticPresenter(adapter) {
  const uniforms = { inputTexture: { value: null }, exposureEv: { value: 0 }, nearPlane: { value: 0.1 }, farPlane: { value: 50 }, viewMode: { value: 0 }, encodedOutput: { value: 0 } };
  const material = adapter.createMaterial(FRAGMENT, uniforms);
  return Object.freeze({
    present(resource, frame, { view = "color", exposureEv = 0 } = {}) {
      uniforms.inputTexture.value = resource.texture;
      uniforms.exposureEv.value = exposureEv;
      uniforms.nearPlane.value = frame.camera.nearMeters;
      uniforms.farPlane.value = frame.camera.farMeters;
      uniforms.viewMode.value = ({ color: 0, depth: 1, normal: 2, velocity: 3, processed: 0 })[view] ?? 0;
      uniforms.encodedOutput.value = resource.encoding === "display-srgb" ? 1 : 0;
      adapter.draw(material, null);
    },
    dispose() { material.dispose(); }
  });
}
