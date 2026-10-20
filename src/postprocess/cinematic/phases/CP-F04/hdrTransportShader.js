const transportDeclarations = `
precision highp float;
uniform sampler2D sourceTexture;
uniform mat3 colorMatrix;
uniform float exposureRatio;
uniform float maximumStorage;
uniform bool decodeSrgb;
uniform bool clampNegative;
uniform bool sdrFallback;
varying vec2 vUv;

float decodeSrgbValue(float encoded) {
  float magnitude = abs(encoded);
  float linearValue = magnitude <= 0.04045 ? magnitude / 12.92 : pow((magnitude + 0.055) / 1.055, 2.4);
  return sign(encoded) * linearValue;
}

vec3 transportColor(vec3 sourceColor) {
  vec3 linearColor = decodeSrgb ? vec3(decodeSrgbValue(sourceColor.r), decodeSrgbValue(sourceColor.g), decodeSrgbValue(sourceColor.b)) : sourceColor;
  vec3 workingColor = colorMatrix * linearColor * exposureRatio;
  if (clampNegative) workingColor = max(workingColor, vec3(0.0));
  return workingColor;
}

bool finiteValue(float value) {
  return value <= 3.402823e38 && value >= -3.402823e38;
}
`;

export const HDR_TRANSPORT_FRAGMENT = `${transportDeclarations}
void main() {
  vec4 sampled = texture2D(sourceTexture, vUv);
  vec3 workingColor = transportColor(sampled.rgb);
  if (sdrFallback) workingColor = clamp(workingColor, vec3(0.0), vec3(1.0));
  gl_FragColor = vec4(workingColor, sampled.a);
}
`;

export const HDR_VALIDATION_FRAGMENT = `${transportDeclarations}
void main() {
  vec4 sampled = texture2D(sourceTexture, vUv);
  vec3 workingColor = transportColor(sampled.rgb);
  bool inputFinite = finiteValue(sampled.r) && finiteValue(sampled.g) && finiteValue(sampled.b) && finiteValue(sampled.a);
  bool outputFinite = finiteValue(workingColor.r) && finiteValue(workingColor.g) && finiteValue(workingColor.b);
  bool overflow = !sdrFallback && (any(greaterThan(abs(workingColor), vec3(maximumStorage))));
  bool alphaInvalid = !(sampled.a >= 0.0 && sampled.a <= 1.0);
  gl_FragColor = vec4(inputFinite && outputFinite ? 0.0 : 1.0, overflow ? 1.0 : 0.0, alphaInvalid ? 1.0 : 0.0, 1.0);
}
`;
