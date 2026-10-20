import { validateDepthCamera } from "./depthMath.js";

const DEPTH_CONVERSION_FRAGMENT = `
varying vec2 vUv;
uniform sampler2D sourceDepth;
uniform sampler2D sourceCoverage;
uniform vec2 cameraPlanes;
uniform int sourceEncoding;
uniform bool sourceTopLeft;
uniform bool coverageTopLeft;
uniform bool coverageInAlpha;
uniform bool orthographicCamera;
uniform bool outputLinear;
void main() {
  vec2 depthUv = vec2(vUv.x, sourceTopLeft ? 1.0 - vUv.y : vUv.y);
  vec2 coverageUv = vec2(vUv.x, coverageTopLeft ? 1.0 - vUv.y : vUv.y);
  vec4 coverageSample = texture2D(sourceCoverage, coverageUv);
  float coverage = coverageInAlpha ? coverageSample.a : coverageSample.r;
  vec4 packedDepth = texture2D(sourceDepth, depthUv);
  float depth = packedDepth.r;
  if (sourceEncoding == 1) depth = dot(packedDepth, vec4(1.0 / 16777216.0, 1.0 / 65536.0, 1.0 / 256.0, 1.0) * (255.0 / 256.0));
  float nearMeters = cameraPlanes.x;
  float farMeters = cameraPlanes.y;
  float distanceMeters = depth;
  if (sourceEncoding == 2) {
    depth = orthographicCamera ? (distanceMeters - nearMeters) / (farMeters - nearMeters) : farMeters * (distanceMeters - nearMeters) / (distanceMeters * (farMeters - nearMeters));
  } else {
    distanceMeters = orthographicCamera ? nearMeters + depth * (farMeters - nearMeters) : nearMeters * farMeters / (farMeters - depth * (farMeters - nearMeters));
  }
  float result = outputLinear ? distanceMeters : depth;
  if (coverage <= 0.0) result = outputLinear ? 0.0 : 1.0;
  gl_FragColor = vec4(result, 0.0, 0.0, coverage > 0.0 ? 1.0 : 0.0);
}
`;

const ENCODING_INDICES = Object.freeze({ "hardware-depth-opengl": 0, "rgba-depth-packing-three-r161": 1, "linear-depth-meters": 2 });

export function createDepthConversionPass(adapter) {
  const uniforms = {
    sourceDepth: { value: null }, sourceCoverage: { value: null }, cameraPlanes: { value: new adapter.THREE.Vector2() },
    sourceEncoding: { value: 0 }, sourceTopLeft: { value: false }, coverageTopLeft: { value: false }, coverageInAlpha: { value: false },
    orthographicCamera: { value: false }, outputLinear: { value: true }
  };
  const material = adapter.createMaterial(DEPTH_CONVERSION_FRAGMENT, uniforms);
  return Object.freeze({
    convert({ depth, coverage, frame, target, linear = true, projection = "perspective" }) {
      if (!coverage?.texture) throw new Error("CP-F05 depth conversion requires an explicit coverage mask");
      if (!depth?.texture || !(depth.encoding in ENCODING_INDICES)) throw new Error("CP-F05 unsupported or missing source depth encoding");
      const camera = validateDepthCamera({ ...frame.camera, projection });
      for (const [label, resource] of [["depth", depth], ["coverage", coverage]]) {
        if (resource.frameId !== frame.frameId || resource.viewId !== frame.viewId || resource.generation !== frame.generation) throw new Error(`CP-F05 stale ${label} conversion input`);
        if (resource.width !== frame.renderSize.width || resource.height !== frame.renderSize.height || !["bottom-left", "top-left"].includes(resource.origin)) throw new Error(`CP-F05 ${label} conversion extent or origin mismatch`);
        if (resource.jitterPixels && resource.jitterPixels.some((value, index) => value !== frame.jitterPixels[index])) throw new Error(`CP-F05 ${label} conversion jitter mismatch`);
      }
      if (target.width !== frame.renderSize.width || target.height !== frame.renderSize.height) throw new Error("CP-F05 conversion target extent mismatch");
      if (target.texture === depth.texture || target.texture === coverage.texture) throw new Error("CP-F05 depth conversion feedback is forbidden");
      if (!["r", "a"].includes(coverage.component)) throw new Error("CP-F05 coverage component must be explicit: r or a");
      uniforms.sourceDepth.value = depth.texture;
      uniforms.sourceCoverage.value = coverage.texture;
      uniforms.cameraPlanes.value.set(camera.nearMeters, camera.farMeters);
      uniforms.sourceEncoding.value = ENCODING_INDICES[depth.encoding];
      uniforms.sourceTopLeft.value = depth.origin === "top-left";
      uniforms.coverageTopLeft.value = coverage.origin === "top-left";
      uniforms.coverageInAlpha.value = coverage.component === "a";
      uniforms.orthographicCamera.value = projection === "orthographic";
      uniforms.outputLinear.value = linear;
      adapter.draw(material, target);
    },
    dispose() { material.dispose(); }
  });
}
