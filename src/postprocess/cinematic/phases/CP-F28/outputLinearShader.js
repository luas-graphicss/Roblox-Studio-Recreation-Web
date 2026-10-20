import { OUTPUT_INPUT_SHADER } from "./outputInputShader.js";

export const OUTPUT_LINEAR_SHADER = `
uniform sampler2D cp28Source;
uniform int cp28SourceEncoded;
uniform int cp28SourcePremultiplied;
uniform int cp28SourceOpaque;
varying vec2 vUv;
${OUTPUT_INPUT_SHADER}
void main() {
  vec4 decoded;
  bool valid = cp28DecodeInput(texture2D(cp28Source, vUv), cp28SourceEncoded, cp28SourcePremultiplied, cp28SourceOpaque, decoded);
  gl_FragColor = valid ? decoded : vec4(1.0, 0.0, 1.0, 1.0);
}
`;
