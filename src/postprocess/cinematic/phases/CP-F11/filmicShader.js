import { AP1_LUMINANCE } from "./filmicColorSpaces.js";

export const FILMIC_FRAGMENT_SHADER = `
uniform sampler2D cp11InputTexture;
uniform float cp11InversePreExposure;
uniform int cp11Bypass;
uniform vec4 cp11CurveLow;
uniform vec4 cp11CurveHigh;
uniform float cp11Headroom;
uniform float cp11BlueCorrection;
uniform float cp11ExpandGamut;
uniform mat3 cp11InputMatrix;
uniform mat3 cp11OutputMatrix;
uniform vec3 cp11OutputLuminance;
varying vec2 vUv;
const vec3 cp11WorkingLuminance = vec3(${AP1_LUMINANCE.join(", ")});

float cp11Sigmoid(float value) {
  return 1.0 / (1.0 + exp(clamp(-value, -80.0, 80.0)));
}

float cp11FilmCurve(float value) {
  if (value <= 0.0) return 0.0;
  float logValue = log(max(value, 1.0e-38)) / log(10.0);
  float slope = cp11CurveLow.x;
  float toeScale = cp11CurveLow.y;
  float shoulderScale = cp11CurveLow.z;
  float toeMatch = cp11CurveLow.w;
  float shoulderMatch = cp11CurveHigh.x;
  float straightValue = slope * (logValue + cp11CurveHigh.y);
  float toeValue = logValue < toeMatch
    ? -cp11CurveHigh.z + 2.0 * toeScale * cp11Sigmoid(2.0 * slope * (logValue - toeMatch) / toeScale)
    : straightValue;
  float shoulderValue = logValue > shoulderMatch
    ? cp11CurveHigh.w - 2.0 * shoulderScale * cp11Sigmoid(-2.0 * slope * (logValue - shoulderMatch) / shoulderScale)
    : straightValue;
  float separation = shoulderMatch - toeMatch;
  float blendWeight = abs(separation) < 0.0000001
    ? step(shoulderMatch, logValue)
    : clamp((logValue - toeMatch) / separation, 0.0, 1.0);
  if (separation < 0.0) blendWeight = 1.0 - blendWeight;
  blendWeight = blendWeight * blendWeight * (3.0 - 2.0 * blendWeight);
  return clamp(mix(toeValue, shoulderValue, blendWeight), 0.0, cp11Headroom);
}

vec3 cp11PrepareGamut(vec3 color) {
  color = max(color, vec3(0.0));
  float gray = dot(color, cp11WorkingLuminance);
  if (gray <= 0.0) return vec3(0.0);
  vec3 relativeChroma = color / gray - vec3(1.0);
  float highlightWeight = 1.0 - exp2(-4.0 * gray * gray);
  float expansion = 1.0 + 0.25 * cp11ExpandGamut * highlightWeight * (1.0 - exp2(-dot(relativeChroma, relativeChroma)));
  float blueDominance = max(0.0, (color.b - max(color.r, color.g)) / max(color.b, 0.000001));
  float blueDesaturation = 1.0 - 0.3 * cp11BlueCorrection * blueDominance * blueDominance * highlightWeight;
  return max(vec3(0.0), vec3(gray) + (color - vec3(gray)) * expansion * blueDesaturation * 0.96);
}

vec3 cp11CompressGamut(vec3 color) {
  float gray = clamp(dot(color, cp11OutputLuminance), 0.0, cp11Headroom);
  vec3 difference = color - vec3(gray);
  float chromaScale = 1.0;
  for (int channel = 0; channel < 3; channel++) {
    if (difference[channel] < 0.0) chromaScale = min(chromaScale, gray / -difference[channel]);
    if (difference[channel] > 0.0) chromaScale = min(chromaScale, (cp11Headroom - gray) / difference[channel]);
  }
  return clamp(vec3(gray) + difference * chromaScale, 0.0, cp11Headroom);
}

void main() {
  vec4 sampled = texture2D(cp11InputTexture, vUv);
  if (!all(lessThanEqual(abs(sampled), vec4(65504.0)))) {
    gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
    return;
  }
  if (cp11Bypass == 1) {
    gl_FragColor = sampled;
    return;
  }
  vec3 sceneLinear = sampled.rgb * cp11InversePreExposure;
  if (!all(lessThanEqual(abs(sceneLinear), vec3(3.0e+37)))) {
    gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
    return;
  }
  vec3 working = cp11PrepareGamut(cp11InputMatrix * sceneLinear);
  vec3 mapped = vec3(cp11FilmCurve(working.r), cp11FilmCurve(working.g), cp11FilmCurve(working.b));
  float gray = dot(mapped, cp11WorkingLuminance);
  mapped = vec3(gray) + (mapped - vec3(gray)) * 0.93;
  gl_FragColor = vec4(cp11CompressGamut(cp11OutputMatrix * mapped), sampled.a);
}
`;
