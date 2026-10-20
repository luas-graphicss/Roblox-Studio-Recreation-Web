export function buildMotionFragmentShader(globalPlaneCount, localPlaneCount) {
  const declarations = `${globalPlaneCount ? `uniform vec4 globalPlanes[${globalPlaneCount}];` : ""}\n${localPlaneCount ? `uniform vec4 localPlanes[${localPlaneCount}];` : ""}`;
  const globalClipping = Array.from(
    { length: globalPlaneCount },
    (_, index) => `if (dot(vec4(worldPosition, 1.0), globalPlanes[${index}]) < 0.0) discard;`,
  ).join("\n");
  const localClipping = localPlaneCount
    ? `bool clipped = localIntersection > 0.5;\n${Array.from({ length: localPlaneCount }, (_, index) => `clipped = localIntersection > 0.5 ? clipped && dot(vec4(worldPosition, 1.0), localPlanes[${index}]) < 0.0 : clipped || dot(vec4(worldPosition, 1.0), localPlanes[${index}]) < 0.0;`).join("\n")}\nif (clipped) discard;`
    : "";
  return `
precision highp float;
uniform float outputMode;
uniform float historyValid;
uniform float previousVisibilityAvailable;
uniform float isParticle;
uniform float translucent;
uniform float opacity;
uniform float alphaThreshold;
uniform float hasMap;
uniform float hasAlphaMap;
uniform float localIntersection;
uniform sampler2D colorMap;
uniform sampler2D alphaMap;
uniform sampler2D sceneDepth;
uniform sampler2D previousIdentity;
uniform sampler2D previousDepth;
uniform mat3 pointUvTransform;
uniform vec3 surfaceIdentity;
uniform vec2 motionSize;
uniform vec2 motionJitter;
uniform vec2 previousJitter;
uniform float depthTolerance;
varying vec4 currentClip;
varying vec4 previousClip;
varying vec3 worldPosition;
varying vec2 mapUv;
varying vec2 alphaUv;
varying float previousPointDiameter;
${declarations}
void main() {
  ${globalClipping}
  ${localClipping}
  float sourceDepth = texture2D(sceneDepth, gl_FragCoord.xy / motionSize).r;
  if (gl_FragCoord.z > sourceDepth + depthTolerance) discard;
  vec2 pointUv = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y);
  vec2 pointMapUv = (pointUvTransform * vec3(pointUv, 1.0)).xy;
  float alpha = opacity;
  if (hasMap > 0.5) alpha *= texture2D(colorMap, isParticle > 0.5 ? pointMapUv : mapUv).a;
  if (hasAlphaMap > 0.5) alpha *= texture2D(alphaMap, isParticle > 0.5 ? pointMapUv : alphaUv).g;
  if (alpha < alphaThreshold) discard;
  if (outputMode > 0.5 && outputMode < 1.5) {
    gl_FragColor = vec4(surfaceIdentity, 1.0);
    return;
  }
  bool valid = historyValid > 0.5 && currentClip.w > 0.0 && previousClip.w > 0.0 && abs(previousClip.z) <= previousClip.w;
  if (!valid) {
    gl_FragColor = outputMode < 0.5 ? vec4(0.0) : vec4(0.0, 0.0, 1.0, translucent);
    return;
  }
  vec2 currentUv = currentClip.xy / currentClip.w * 0.5 + 0.5;
  vec2 oldUv = previousClip.xy / previousClip.w * 0.5 + 0.5;
  if (isParticle > 0.5) {
    currentUv = (gl_FragCoord.xy - motionJitter) / motionSize;
    oldUv += (pointUv - 0.5) * previousPointDiameter / motionSize;
  }
  vec2 velocity = currentUv - oldUv;
  valid = all(lessThanEqual(abs(velocity), vec2(65504.0)));
  float oldDepth = previousClip.z / previousClip.w * 0.5 + 0.5;
  if (outputMode < 0.5) {
    gl_FragColor = valid ? vec4(velocity, oldDepth, 1.0) : vec4(0.0);
    return;
  }
  vec2 historyUv = oldUv + previousJitter / motionSize;
  bool inside = all(greaterThanEqual(historyUv, vec2(0.0))) && all(lessThan(historyUv, vec2(1.0)));
  bool visible = false;
  float slopeTolerance = fwidth(oldDepth);
  if (valid && inside && previousVisibilityAvailable > 0.5) {
    vec4 identity = texture2D(previousIdentity, historyUv);
    float depth = texture2D(previousDepth, historyUv).r;
    bool sameSurface = identity.a > 0.5 && all(lessThan(abs(identity.rgb - surfaceIdentity), vec3(0.5 / 255.0)));
    visible = sameSurface && abs(depth - oldDepth) <= depthTolerance + slopeTolerance;
  }
  gl_FragColor = vec4(visible ? 1.0 : 0.0, valid ? 1.0 : 0.0, 1.0, translucent);
}
`;
}
