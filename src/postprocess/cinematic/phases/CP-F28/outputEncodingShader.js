import { OUTPUT_INPUT_SHADER } from "./outputInputShader.js";

export const OUTPUT_ENCODING_SHADER = `
uniform sampler2D cp28Linear;
uniform sampler2D cp28Original;
uniform mat3 cp28Matrix;
uniform vec3 cp28Luminance;
uniform float cp28Maximum;
uniform float cp28Black;
uniform float cp28PaperWhite;
uniform int cp28Transfer;
uniform int cp28Mapping;
uniform int cp28Premultiplied;
uniform int cp28SourceEncoded;
uniform int cp28SourceOpaque;
uniform int cp28Copy;
uniform int cp28Dither;
uniform vec2 cp28DitherOffset;
varying vec2 vUv;
${OUTPUT_INPUT_SHADER}
vec3 cp28MapGamut(vec3 color) {
  if (cp28Mapping == 0) return color;
  if (cp28Mapping == 1) return clamp(color, 0.0, cp28Maximum);
  float gray = clamp(dot(color, cp28Luminance), 0.0, cp28Maximum);
  vec3 difference = color - gray;
  float saturation = 1.0;
  for (int channel = 0; channel < 3; channel++) {
    if (difference[channel] > 0.0) saturation = min(saturation, (cp28Maximum - gray) / difference[channel]);
    else if (difference[channel] < 0.0) saturation = min(saturation, -gray / difference[channel]);
  }
  return clamp(vec3(gray) + saturation * difference, 0.0, cp28Maximum);
}
vec3 cp28Encode(vec3 color) {
  if (cp28Transfer == 4) return color * (cp28PaperWhite / 80.0);
  if (cp28Transfer == 3) {
    vec3 normalized = pow(clamp(color * (cp28PaperWhite / 10000.0), 0.0, 1.0), vec3(2610.0 / 16384.0));
    return pow((3424.0 / 4096.0 + (2413.0 / 128.0) * normalized) / (1.0 + (2392.0 / 128.0) * normalized), vec3(2523.0 / 32.0));
  }
  if (cp28Transfer == 2) return mix(1.099 * pow(max(color, vec3(0.0)), vec3(0.45)) - 0.099, color * 4.5, step(color, vec3(0.018)));
  if (cp28Transfer == 1) return mix(1.055 * pow(max(color, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, color * 12.92, step(color, vec3(0.0031308)));
  return color;
}
float cp28DitherValue() {
  vec2 position = mod(floor(gl_FragCoord.xy) + cp28DitherOffset, 8.0);
  float rank = 0.0;
  for (int bit = 0; bit < 3; bit++) {
    vec2 digit = mod(position, 2.0);
    rank = rank * 4.0 + (digit.x != digit.y ? 2.0 : 0.0) + digit.y;
    position = floor(position * 0.5);
  }
  return ((rank + 0.5) / 64.0 - 0.5) / 255.0;
}
void main() {
  vec4 original = texture2D(cp28Original, vUv);
  vec4 decoded;
  if (!cp28DecodeInput(original, cp28SourceEncoded, cp28Premultiplied, cp28SourceOpaque, decoded)) {
    gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
    return;
  }
  if (cp28Copy == 1) {
    gl_FragColor = vec4(original.rgb, decoded.a);
    return;
  }
  vec4 sampled = texture2D(cp28Linear, vUv);
  vec3 color = cp28MapGamut(cp28Matrix * sampled.rgb);
  color = vec3(cp28Black) + color * (1.0 - cp28Black / cp28Maximum);
  color = cp28Encode(color);
  if (cp28Dither == 1) {
    float offset = cp28DitherValue();
    for (int channel = 0; channel < 3; channel++) if (color[channel] > 0.0 && color[channel] < 1.0) color[channel] = clamp(color[channel] + offset, 0.0, 1.0);
  }
  if (cp28Premultiplied == 1) color *= sampled.a;
  gl_FragColor = all(lessThanEqual(abs(color), vec3(65504.0))) ? vec4(color, sampled.a) : vec4(1.0, 0.0, 1.0, 1.0);
}
`;
