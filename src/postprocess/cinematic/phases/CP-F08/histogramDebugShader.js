export const HISTOGRAM_DEBUG_SHADER = `
uniform sampler2D uSceneColor;
uniform sampler2D uHistogram;
uniform sampler2D uExposure;
uniform bool uHistogramAvailable;
varying vec2 vUv;
vec3 diagnosticDisplay(vec3 radiance) {
  vec3 mapped = max(radiance, vec3(0.0)) / (vec3(1.0) + max(radiance, vec3(0.0)));
  return mix(12.92 * mapped, 1.055 * pow(mapped, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), mapped));
}
void main() {
  vec3 outputColor;
  if (vUv.y > 0.37) {
    vec2 sourceUv = vec2(fract(vUv.x * 2.0), (vUv.y - 0.37) / 0.63);
    float exposure = vUv.x < 0.5 ? 1.0 : texelFetch(uExposure, ivec2(2, 0), 0).r;
    outputColor = diagnosticDisplay(texture2D(uSceneColor, sourceUv).rgb * exposure);
    if (abs(vUv.x - 0.5) < 0.002) outputColor = vec3(0.09);
  } else {
    int bin = clamp(int(vUv.x * 64.0), 0, 63);
    float maximumWeight = 0.0;
    for (int index = 0; index < 64; index++) maximumWeight = max(maximumWeight, texelFetch(uHistogram, ivec2(index, 0), 0).r);
    float height = maximumWeight > 0.0 ? texelFetch(uHistogram, ivec2(bin, 0), 0).r / maximumWeight : 0.0;
    float coordinate = (vUv.y - 0.04) / 0.28;
    bool isBar = uHistogramAvailable && maximumWeight > 0.0 && coordinate > 0.0 && coordinate < height && fract(vUv.x * 64.0) > 0.12;
    outputColor = isBar ? vec3(0.34, 0.64, 0.95) : vec3(0.075, 0.09, 0.12);
    if (abs(coordinate) < 0.008) outputColor = vec3(0.35);
  }
  gl_FragColor = vec4(outputColor, 1.0);
}
`;
