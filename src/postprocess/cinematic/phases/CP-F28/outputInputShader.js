export const OUTPUT_INPUT_SHADER = `
vec3 cp28DecodeSrgb(vec3 value) {
  vec3 magnitude = abs(value);
  return sign(value) * mix(pow((magnitude + 0.055) / 1.055, vec3(2.4)), magnitude / 12.92, step(magnitude, vec3(0.04045)));
}
bool cp28DecodeInput(vec4 sampled, int encoded, int premultiplied, int opaque, out vec4 decoded) {
  if (!all(lessThanEqual(abs(sampled), vec4(65504.0))) || sampled.a < 0.0 || sampled.a > 1.0) return false;
  float alpha = opaque == 1 ? 1.0 : sampled.a;
  vec3 color = sampled.rgb;
  if (premultiplied == 1) color = alpha > 0.0 ? color / alpha : vec3(0.0);
  if (encoded == 1) color = cp28DecodeSrgb(color);
  if (!all(lessThanEqual(abs(color), vec3(65504.0)))) return false;
  decoded = vec4(color, alpha);
  return true;
}
`;
