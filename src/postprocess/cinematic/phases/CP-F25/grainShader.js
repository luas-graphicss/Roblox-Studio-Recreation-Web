import { FILM_GRAIN_AMPLITUDE } from "./grainContract.js";

export const FILM_GRAIN_FRAGMENT_SHADER = `
precision highp float;
precision highp int;
uniform sampler2D cp25Input;
uniform sampler2D cp25GrainTexture;
uniform bool cp25Apply;
uniform bool cp25UseTexture;
uniform vec2 cp25TileOrigin;
uniform vec2 cp25TextureSize;
uniform vec2 cp25TextureOffset;
uniform float cp25TextureSign;
uniform float cp25TexelSize;
uniform float cp25Intensity;
uniform vec3 cp25ZoneIntensities;
uniform vec3 cp25ZoneLimits;
uniform vec3 cp25Luminance;
uniform uint cp25SequenceSeed;
varying vec2 vUv;

uint cp25Hash(uint value) {
  value = (value ^ (value >> 16u)) * 0x7feb352du;
  value = (value ^ (value >> 15u)) * 0x846ca68bu;
  return value ^ (value >> 16u);
}

float cp25Uniform(uint value) {
  return ((float(cp25Hash(value) >> 8u) + 0.5) / 16777216.0) * 2.0 - 1.0;
}

float cp25Lattice(ivec2 point) {
  if (cp25UseTexture) {
    vec2 wrapped = mod(vec2(point) + cp25TextureOffset, cp25TextureSize);
    return cp25TextureSign * texelFetch(cp25GrainTexture, ivec2(wrapped), 0).r;
  }
  uint coordinate = uint(point.x) * 0x9e3779b1u ^ uint(point.y) * 0x85ebca77u ^ cp25SequenceSeed;
  return cp25Uniform(coordinate ^ 0x68bc21ebu) + cp25Uniform(coordinate ^ 0x02e5be93u) + cp25Uniform(coordinate ^ 0x967a889bu);
}

float cp25Noise(vec2 pixel) {
  vec2 coordinate = pixel / cp25TexelSize - 0.5;
  ivec2 cell = ivec2(floor(coordinate));
  vec2 fraction = fract(coordinate);
  vec4 weights = vec4((1.0 - fraction.x) * (1.0 - fraction.y), fraction.x * (1.0 - fraction.y), (1.0 - fraction.x) * fraction.y, fraction.x * fraction.y);
  vec4 samples = vec4(cp25Lattice(cell), cp25Lattice(cell + ivec2(1, 0)), cp25Lattice(cell + ivec2(0, 1)), cp25Lattice(cell + ivec2(1, 1)));
  return dot(weights, samples) / (cp25UseTexture ? 1.0 : sqrt(dot(weights, weights)));
}

void main() {
  vec4 source = texture2D(cp25Input, vUv);
  if (!cp25Apply) { gl_FragColor = source; return; }
  if (any(isnan(source)) || any(isinf(source))) { gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0); return; }
  float luminance = max(0.0, dot(source.rgb, cp25Luminance));
  float shadows = 1.0 - smoothstep(0.0, cp25ZoneLimits.x, luminance);
  float highlights = smoothstep(cp25ZoneLimits.y, cp25ZoneLimits.z, luminance);
  float intensity = cp25Intensity * dot(vec3(shadows, 1.0 - shadows - highlights, highlights), cp25ZoneIntensities);
  float multiplier = 1.0 + ${FILM_GRAIN_AMPLITUDE} * intensity * cp25Noise(gl_FragCoord.xy + cp25TileOrigin);
  vec3 result = source.rgb * multiplier;
  if (any(greaterThan(abs(result), vec3(65504.0)))) { gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0); return; }
  gl_FragColor = vec4(result, source.a);
}
`;
