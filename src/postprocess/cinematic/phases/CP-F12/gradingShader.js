export const GRADING_FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uSceneColor;
uniform bool uNeutral;
uniform bool uWhiteBalanceNeutral;
uniform bool uUniformZones;
uniform mat3 uWhiteBalance;
uniform vec4 uRanges;
uniform float uPreExposure;
uniform vec3 uSaturation[3];
uniform vec3 uContrast[3];
uniform vec3 uGamma[3];
uniform vec3 uGain[3];
uniform vec3 uOffset[3];

float signedPower(float value, float exponent) {
  if (exponent == 1.0 || value == 0.0) return value;
  return sign(value) * exp2(clamp(log2(abs(value)) * exponent, -120.0, 100.0));
}

float gradeChannel(float channel, float luminance, float saturation, float contrast, float gamma, float gain, float offset) {
  float saturated = saturation == 1.0 ? channel : luminance + (channel - luminance) * saturation;
  float contrasted = contrast == 1.0 ? saturated : signedPower(saturated / 0.18, contrast) * 0.18;
  return signedPower(contrasted, 1.0 / gamma) * gain + offset;
}

vec3 gradeZone(vec3 color, vec3 saturation, vec3 contrast, vec3 gamma, vec3 gain, vec3 offset) {
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  return vec3(
    gradeChannel(color.r, luminance, saturation.r, contrast.r, gamma.r, gain.r, offset.r),
    gradeChannel(color.g, luminance, saturation.g, contrast.g, gamma.g, gain.g, offset.g),
    gradeChannel(color.b, luminance, saturation.b, contrast.b, gamma.b, gain.b, offset.b)
  );
}

void main() {
  vec4 source = texture2D(uSceneColor, vUv);
  if (uNeutral) { gl_FragColor = source; return; }
  vec3 sceneColor = source.rgb / uPreExposure;
  vec3 balanced = uWhiteBalanceNeutral ? sceneColor : uWhiteBalance * sceneColor;
  vec3 shadows = gradeZone(balanced, uSaturation[0], uContrast[0], uGamma[0], uGain[0], uOffset[0]);
  vec3 graded = shadows;
  if (!uUniformZones) {
    vec3 midtones = gradeZone(balanced, uSaturation[1], uContrast[1], uGamma[1], uGain[1], uOffset[1]);
    vec3 highlights = gradeZone(balanced, uSaturation[2], uContrast[2], uGamma[2], uGain[2], uOffset[2]);
    float luminance = dot(balanced, vec3(0.2126, 0.7152, 0.0722));
    float shadowWeight = 1.0 - smoothstep(uRanges.x, uRanges.y, luminance);
    float highlightWeight = smoothstep(uRanges.z, uRanges.w, luminance);
    float midtoneWeight = 1.0 - shadowWeight - highlightWeight;
    graded = balanced + shadowWeight * (shadows - balanced) + midtoneWeight * (midtones - balanced) + highlightWeight * (highlights - balanced);
  }
  gl_FragColor = vec4(clamp(graded * uPreExposure, vec3(-65504.0), vec3(65504.0)), source.a);
}
`;
