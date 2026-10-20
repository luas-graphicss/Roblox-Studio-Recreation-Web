import { METERING_SAMPLE_SHADER } from "./meteringSampleShader.js";

const histogramRange = `
uniform vec2 uHistogramRange;
int meteringBin(float logLuminance) {
  float coordinate = (logLuminance - uHistogramRange.x) / (uHistogramRange.y - uHistogramRange.x);
  return clamp(int(floor(coordinate * 64.0)), 0, 63);
}
`;

export const HISTOGRAM_GATHER_SHADER = `${METERING_SAMPLE_SHADER}${histogramRange}
void main() {
  int bin = int(gl_FragCoord.x);
  int firstPixel = int(gl_FragCoord.y) * 256;
  int pixelCount = uSourceSize.x * uSourceSize.y;
  float weight = 0.0;
  for (int offset = 0; offset < 256; offset++) {
    int index = firstPixel + offset;
    if (index >= pixelCount) break;
    vec4 sampleValue = meteringSample(ivec2(index % uSourceSize.x, index / uSourceSize.x));
    if (sampleValue.y > 0.0 && meteringBin(sampleValue.x / sampleValue.y) == bin) weight += sampleValue.y;
  }
  gl_FragColor = vec4(weight, 0.0, 0.0, 1.0);
}
`;

export const HISTOGRAM_SCATTER_VERTEX = `${METERING_SAMPLE_SHADER}${histogramRange}
uniform float uHistogramRows;
varying float vSampleWeight;
void main() {
  int index = gl_InstanceID;
  vec4 sampleValue = meteringSample(ivec2(index % uSourceSize.x, index / uSourceSize.x));
  float logLuminance = sampleValue.y > 0.0 ? sampleValue.x / sampleValue.y : uMinimumLog;
  int bin = meteringBin(logLuminance);
  vec2 location = vec2((float(bin) + 0.5) / 64.0, (float(index / 256) + 0.5) / uHistogramRows);
  gl_Position = vec4(location * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  vSampleWeight = sampleValue.y;
}
`;

export const HISTOGRAM_SCATTER_FRAGMENT = `
varying float vSampleWeight;
void main() { gl_FragColor = vec4(vSampleWeight, 0.0, 0.0, 1.0); }
`;

export const HISTOGRAM_REDUCE_SHADER = `
uniform sampler2D uPreviousLevel;
uniform int uPreviousRows;
void main() {
  int bin = int(gl_FragCoord.x);
  int firstRow = int(gl_FragCoord.y) * 16;
  float weight = 0.0;
  for (int offset = 0; offset < 16; offset++) {
    int row = firstRow + offset;
    if (row < uPreviousRows) weight += texelFetch(uPreviousLevel, ivec2(bin, row), 0).r;
  }
  gl_FragColor = vec4(weight, 0.0, 0.0, 1.0);
}
`;
