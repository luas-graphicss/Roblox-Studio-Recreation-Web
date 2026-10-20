const vertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragmentShader = `
uniform sampler2D tDiffuse;
uniform vec2 uInverseResolution;
varying vec2 vUv;

float luminance(vec4 color) {
  return dot(color.rgb, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec4 center = texture2D(tDiffuse, vUv);
  vec4 northWest = texture2D(tDiffuse, vUv + vec2(-1.0, -1.0) * uInverseResolution);
  vec4 northEast = texture2D(tDiffuse, vUv + vec2(1.0, -1.0) * uInverseResolution);
  vec4 southWest = texture2D(tDiffuse, vUv + vec2(-1.0, 1.0) * uInverseResolution);
  vec4 southEast = texture2D(tDiffuse, vUv + vec2(1.0, 1.0) * uInverseResolution);
  float centerLuma = luminance(center);
  float northWestLuma = luminance(northWest);
  float northEastLuma = luminance(northEast);
  float southWestLuma = luminance(southWest);
  float southEastLuma = luminance(southEast);
  float minimumLuma = min(centerLuma, min(min(northWestLuma, northEastLuma), min(southWestLuma, southEastLuma)));
  float maximumLuma = max(centerLuma, max(max(northWestLuma, northEastLuma), max(southWestLuma, southEastLuma)));
  if (maximumLuma - minimumLuma < max(0.0312, maximumLuma * 0.125)) {
    gl_FragColor = center;
    return;
  }
  vec2 direction = vec2(
    -(northWestLuma + northEastLuma - southWestLuma - southEastLuma),
    northWestLuma + southWestLuma - northEastLuma - southEastLuma
  );
  float averageLuma = (northWestLuma + northEastLuma + southWestLuma + southEastLuma) * 0.25;
  float directionReduction = max(averageLuma * 0.03125, 0.0078125);
  float inverseDirection = 1.0 / (min(abs(direction.x), abs(direction.y)) + directionReduction);
  direction = clamp(direction * inverseDirection, vec2(-8.0), vec2(8.0)) * uInverseResolution;
  vec4 innerBlend = 0.5 * (
    texture2D(tDiffuse, vUv - direction / 6.0) +
    texture2D(tDiffuse, vUv + direction / 6.0)
  );
  vec4 outerBlend = innerBlend * 0.5 + 0.25 * (
    texture2D(tDiffuse, vUv - direction * 0.5) +
    texture2D(tDiffuse, vUv + direction * 0.5)
  );
  float blendedLuma = luminance(outerBlend);
  gl_FragColor = blendedLuma < minimumLuma || blendedLuma > maximumLuma ? innerBlend : outerBlend;
}
`;

export function createSpatialAntialiasingPass({ THREE, ShaderPass }) {
  const pass = new ShaderPass({
    name: "ViewportSpatialAntialiasing",
    uniforms: {
      tDiffuse: { value: null },
      uInverseResolution: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader,
    fragmentShader,
  });
  pass.material.depthTest = false;
  pass.material.depthWrite = false;
  pass.material.blending = THREE.NoBlending;
  pass.material.toneMapped = false;
  pass.setSize = (width, height) => {
    pass.uniforms.uInverseResolution.value.set(
      1 / Math.max(1, Math.floor(width)),
      1 / Math.max(1, Math.floor(height)),
    );
  };
  return pass;
}
