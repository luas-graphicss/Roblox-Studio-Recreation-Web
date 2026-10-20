export const FLATTEN_VELOCITY_FRAGMENT = `
uniform sampler2D colorTexture;
uniform sampler2D velocityTexture;
uniform sampler2D depthTexture;
uniform sampler2D validityTexture;
uniform sampler2D objectSizeTexture;
uniform sampler2D cameraVelocityTexture;
uniform vec2 outputSize;
uniform vec2 geometryJitterPixels;
uniform float velocityScale;
uniform float maximumLength;
uniform float nearMeters;
uniform float farMeters;
uniform float objectSizeThreshold;
uniform int linearDepth;
uniform int orthographicDepth;
uniform int hasValidity;
uniform int preserveSky;
uniform int preserveTranslucency;
uniform int filterObjectSize;

bool finiteVector(vec4 value) {
  return !any(isnan(value)) && !any(isinf(value));
}

void invalidPixel(float code) {
  gl_FragColor = vec4(0.0, 0.0, 0.0, code);
}

void main() {
  ivec2 outputPixel = ivec2(gl_FragCoord.xy);
  ivec2 inputSize = textureSize(velocityTexture, 0);
  ivec2 inputPixel = clamp(ivec2(floor(gl_FragCoord.xy / outputSize * vec2(inputSize) + geometryJitterPixels)), ivec2(0), inputSize - 1);
  vec4 color = texelFetch(colorTexture, outputPixel, 0);
  vec4 velocity = texelFetch(velocityTexture, inputPixel, 0);
  vec4 masks = hasValidity == 1 ? texelFetch(validityTexture, inputPixel, 0) : vec4(1.0, velocity.a, 1.0, 0.0);
  float rawDepth = texelFetch(depthTexture, inputPixel, 0).r;
  if (!finiteVector(color) || color.a < 0.0 || color.a > 1.0) { invalidPixel(-4.0); return; }
  if (!finiteVector(velocity) || velocity.a < 0.0 || velocity.a > 1.0) { invalidPixel(-1.0); return; }
  if (!finiteVector(masks) || any(lessThan(masks, vec4(0.0))) || any(greaterThan(masks, vec4(1.0)))) { invalidPixel(-3.0); return; }
  if (isnan(rawDepth) || isinf(rawDepth) || rawDepth < 0.0 || (linearDepth == 0 && rawDepth > 1.0) || (linearDepth == 1 && rawDepth <= 0.0)) { invalidPixel(-2.0); return; }
  bool sky = linearDepth == 0 && rawDepth >= 1.0;
  bool translucent = masks.a > 0.0 || color.a < 0.99999 || (!sky && masks.b < 0.99999);
  if (velocity.a < 0.5 || masks.g < 0.5 || (sky && preserveSky == 1) || (translucent && preserveTranslucency == 1)) { invalidPixel(0.0); return; }
  if (filterObjectSize == 1) {
    float objectSize = texelFetch(objectSizeTexture, inputPixel, 0).r;
    if (isnan(objectSize) || isinf(objectSize) || objectSize < 0.0) { invalidPixel(-3.0); return; }
    if (objectSize < objectSizeThreshold && !sky) {
      velocity = texelFetch(cameraVelocityTexture, inputPixel, 0);
      if (!finiteVector(velocity) || velocity.a < 0.5) { invalidPixel(-1.0); return; }
    }
  }
  float depthMeters = linearDepth == 1 ? rawDepth : rawDepth >= 1.0 ? farMeters : orthographicDepth == 1 ? mix(nearMeters, farMeters, rawDepth) : nearMeters / (1.0 - rawDepth * (1.0 - nearMeters / farMeters));
  vec2 displacement = velocity.xy * outputSize * velocityScale;
  float largest = max(abs(displacement.x), abs(displacement.y));
  if (largest > 0.0) {
    vec2 normalized = displacement / largest;
    float magnitude = largest * length(normalized);
    if (magnitude > maximumLength) displacement = normalized * (maximumLength / length(normalized));
  }
  gl_FragColor = vec4(displacement, log2(max(depthMeters, 0.000001)), sky ? 2.0 : translucent ? 3.0 : 1.0);
}
`;
