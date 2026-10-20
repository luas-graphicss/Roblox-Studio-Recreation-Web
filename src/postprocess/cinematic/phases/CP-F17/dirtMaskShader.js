export const DIRT_MASK_FRAGMENT = `
varying vec2 vUv;
uniform sampler2D sourceTexture;
uniform sampler2D maskTexture;
uniform sampler2D firstGlareTexture;
uniform sampler2D secondGlareTexture;
uniform vec2 maskSize;
uniform vec2 maskScale;
uniform vec4 outputRect;
uniform vec3 dirtTint;
uniform float dirtIntensity;
uniform bool dirtEnabled;
uniform bool writeRangeMask;
uniform vec2 firstGlareTextureSize;
uniform vec2 firstGlareSourceSize;
uniform vec2 firstGlarePadding;
uniform float firstGlareGain;
uniform vec2 secondGlareTextureSize;
uniform vec2 secondGlareSourceSize;
uniform vec2 secondGlarePadding;
uniform float secondGlareGain;

vec3 readGlarePixel(sampler2D image, vec2 size, vec2 pixel) {
  if (any(lessThan(pixel, vec2(0.0))) || any(greaterThanEqual(pixel, size))) return vec3(0.0);
  return texture2D(image, (pixel + 0.5) / size).rgb;
}

vec3 sampleGlare(sampler2D image, vec2 size, vec2 sourceSize, vec2 padding, float gain) {
  if (gain == 0.0) return vec3(0.0);
  vec2 coordinate = vUv * sourceSize - 0.5 + padding;
  vec2 lower = floor(coordinate);
  vec2 fraction = fract(coordinate);
  vec3 bottom = mix(readGlarePixel(image, size, lower), readGlarePixel(image, size, lower + vec2(1.0, 0.0)), fraction.x);
  vec3 top = mix(readGlarePixel(image, size, lower + vec2(0.0, 1.0)), readGlarePixel(image, size, lower + vec2(1.0)), fraction.x);
  return mix(bottom, top, fraction.y) * gain;
}

vec3 readMaskPixel(vec2 pixel) {
  vec2 coordinate = clamp(pixel, vec2(0.0), maskSize - 1.0);
  return texture2D(maskTexture, (coordinate + 0.5) / maskSize).rgb;
}

vec3 sampleMask() {
  vec2 finalOutputUv = outputRect.xy + vUv * outputRect.zw;
  vec2 maskUv = (finalOutputUv - 0.5) * maskScale + 0.5;
  if (any(lessThan(maskUv, vec2(0.0))) || any(greaterThan(maskUv, vec2(1.0)))) return vec3(0.0);
  vec2 coordinate = maskUv * maskSize - 0.5;
  vec2 lower = floor(coordinate);
  vec2 fraction = fract(coordinate);
  vec3 bottom = mix(readMaskPixel(lower), readMaskPixel(lower + vec2(1.0, 0.0)), fraction.x);
  vec3 top = mix(readMaskPixel(lower + vec2(0.0, 1.0)), readMaskPixel(lower + vec2(1.0)), fraction.x);
  return mix(bottom, top, fraction.y);
}

float finiteHalf(float value) {
  if (value > 65504.0) return 65504.0;
  if (value < -65504.0) return -65504.0;
  return value == value ? value : 0.0;
}

bool validGlare(vec3 value) {
  return all(lessThanEqual(abs(value), vec3(3.402823e38))) && all(greaterThanEqual(value, vec3(0.0)));
}

void main() {
  vec4 source = texture2D(sourceTexture, vUv);
  vec3 glare = vec3(0.0);
  vec3 contribution = vec3(0.0);
  bool providersValid = true;
  if (dirtEnabled) {
    vec3 firstGlare = sampleGlare(firstGlareTexture, firstGlareTextureSize, firstGlareSourceSize, firstGlarePadding, firstGlareGain);
    vec3 secondGlare = sampleGlare(secondGlareTexture, secondGlareTextureSize, secondGlareSourceSize, secondGlarePadding, secondGlareGain);
    providersValid = validGlare(firstGlare) && validGlare(secondGlare);
    glare = firstGlare + secondGlare;
    contribution = max(glare, vec3(0.0)) * sampleMask() * dirtTint * dirtIntensity;
  }
  vec4 result = vec4(source.rgb + contribution, source.a);
  bool valid = providersValid && validGlare(glare) && all(lessThanEqual(abs(result), vec4(65504.0)));
  if (writeRangeMask) {
    gl_FragColor = vec4(valid ? 0.0 : 1.0, 0.0, 0.0, 1.0);
    return;
  }
  gl_FragColor = vec4(finiteHalf(result.r), finiteHalf(result.g), finiteHalf(result.b), finiteHalf(result.a));
}
`;
