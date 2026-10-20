export function buildMotionVertexShader(materialIndex) {
  return `
attribute vec3 previousPosition;
attribute vec2 motionMapUv${materialIndex};
attribute vec2 motionAlphaUv${materialIndex};
uniform mat4 motionCurrentViewProjection;
uniform mat4 motionPreviousViewProjection;
uniform mat4 motionCurrentView;
uniform mat4 motionPreviousView;
uniform vec2 motionJitter;
uniform vec2 motionSize;
uniform vec2 particleSizeRange;
uniform float particleSize;
uniform float previousParticleSize;
uniform float attenuateParticle;
uniform float attenuatePreviousParticle;
uniform float perspectiveCamera;
varying vec4 currentClip;
varying vec4 previousClip;
varying vec3 worldPosition;
varying vec2 mapUv;
varying vec2 alphaUv;
varying float previousPointDiameter;
void main() {
  vec4 world = vec4(position, 1.0);
  vec4 previousWorld = vec4(previousPosition, 1.0);
  currentClip = motionCurrentViewProjection * world;
  previousClip = motionPreviousViewProjection * previousWorld;
  gl_Position = currentClip;
  gl_Position.xy += 2.0 * motionJitter / motionSize * gl_Position.w;
  float currentDiameter = particleSize;
  previousPointDiameter = previousParticleSize;
  if (perspectiveCamera > 0.5) {
    if (attenuateParticle > 0.5) currentDiameter *= motionSize.y * 0.5 / max(0.000001, -(motionCurrentView * world).z);
    if (attenuatePreviousParticle > 0.5) previousPointDiameter *= motionSize.y * 0.5 / max(0.000001, -(motionPreviousView * previousWorld).z);
  }
  gl_PointSize = clamp(currentDiameter, particleSizeRange.x, particleSizeRange.y);
  previousPointDiameter = clamp(previousPointDiameter, particleSizeRange.x, particleSizeRange.y);
  worldPosition = position;
  mapUv = motionMapUv${materialIndex};
  alphaUv = motionAlphaUv${materialIndex};
}
`;
}
