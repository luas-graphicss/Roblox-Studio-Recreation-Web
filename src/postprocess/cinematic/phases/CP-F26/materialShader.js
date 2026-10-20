function samplerDeclaration(name) {
  return `uniform sampler2D cp26Texture_${name};
uniform vec4 cp26ScaleBias_${name};
uniform vec4 cp26Bounds_${name};
uniform vec2 cp26TextureSize_${name};
vec4 sample_${name}(vec2 uv) {
  vec2 textureUv = clamp(uv * cp26ScaleBias_${name}.xy + cp26ScaleBias_${name}.zw, cp26Bounds_${name}.xy, cp26Bounds_${name}.zw);
  vec2 nearestUv = (floor(textureUv * cp26TextureSize_${name}) + vec2(0.5)) / cp26TextureSize_${name};
  return texture2D(cp26Texture_${name}, nearestUv);
}`;
}

export function createMaterialShader(definition, tier) {
  const body = definition.qualityShaders[tier] ?? definition.shader;
  const declarations = [samplerDeclaration("Input"), ...definition.inputs.map((input) => samplerDeclaration(input.name))];
  for (const [name, parameter] of Object.entries(definition.parameters)) declarations.push(`uniform ${parameter.type} cp26Parameter_${name};`);
  return `varying vec2 vUv;
uniform float cp26Weight;
uniform float cp26TimeSeconds;
uniform float cp26FrameId;
uniform float cp26InversePreExposure;
uniform vec2 cp26OutputSize;
${declarations.join("\n")}
vec4 evaluateMaterial(vec2 uv, vec4 inputColor) {
${body}
}
void main() {
  vec4 inputColor = sample_Input(vUv);
  vec4 candidate = evaluateMaterial(vUv, inputColor);
  bool finiteResult = all(equal(candidate, candidate)) && all(lessThanEqual(abs(candidate), vec4(65504.0)));
  gl_FragColor = finiteResult ? mix(inputColor, candidate, cp26Weight) : ${definition.location === "replacingTonemapper" ? "vec4(1.0, 0.0, 1.0, inputColor.a)" : "inputColor"};
}`;
}

export const MATERIAL_COPY_SHADER = `varying vec2 vUv;
${samplerDeclaration("Input")}
void main() {
  gl_FragColor = sample_Input(vUv);
}`;
