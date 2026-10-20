import { insertBeforeShaderMain, appendShaderMain } from './substrateShaderInsertion.js';

export function injectSubsurfaceConsumer(source) {
  const anchor = ' vec3 sbRuntimeWeight = max(uSbRuntimeWeights[sbRuntimeSlot], 0.0) * sbRuntimeAttenuation;';
  if (!source.includes(anchor)) throw new Error('Subsurface closure composition anchor is unavailable');
  const declarations = `
uniform float uSbScreenSubsurfaceEnabled;
uniform vec2 uSbScreenInverseSize;
uniform float uSbScreenAtlasSlots;
`;
  const sampler = /uniform\s+sampler2D\s+uSbSubsurfaceTexture\s*;/.test(source) ? '' : 'uniform sampler2D uSbSubsurfaceTexture;\n';
  const application = `
 if (uSbScreenSubsurfaceEnabled > 0.5 && max(max(sbRuntimeSlab.subsurfaceMeanFreePath.r, sbRuntimeSlab.subsurfaceMeanFreePath.g), sbRuntimeSlab.subsurfaceMeanFreePath.b) > 0.0) {
   vec2 sbScreenUv = gl_FragCoord.xy * uSbScreenInverseSize;
   vec2 sbAtlasUv = vec2(sbScreenUv.x, (sbScreenUv.y + float(sbRuntimeSlot)) / uSbScreenAtlasSlots);
   vec4 sbDiffuseDelta = texture2D(uSbSubsurfaceTexture, sbAtlasUv);
   float sbDepthTolerance = max(0.0001, abs(vViewPosition.z) * 0.0002);
   if (abs(sbDiffuseDelta.a - vViewPosition.z) < sbDepthTolerance) reflectedLight.directDiffuse += sbDiffuseDelta.rgb;
 }
`;
  return insertBeforeShaderMain(source.replace(anchor, application + anchor), sampler + declarations);
}

export function injectSubsurfaceCapture(shader, uniforms) {
  Object.assign(shader.uniforms, uniforms);
  const anchor = ' vec3 sbRuntimeWeight = max(uSbRuntimeWeights[sbRuntimeSlot], 0.0) * sbRuntimeAttenuation;';
  const composed = shader.fragmentShader.includes(anchor);
  shader.vertexShader = insertBeforeShaderMain(shader.vertexShader, 'uniform float uSbCaptureRegion;\nflat varying float vSbCaptureRegion;');
  shader.vertexShader = appendShaderMain(shader.vertexShader, `
 vSbCaptureRegion = uSbCaptureRegion;
 #ifdef USE_INSTANCING
 vSbCaptureRegion += float(gl_InstanceID);
 #endif
`);
  shader.fragmentShader = insertBeforeShaderMain(shader.fragmentShader, `
flat varying float vSbCaptureRegion;
uniform int uSbCaptureSlot;
layout(location = 1) out highp vec4 sbCaptureGeometry;
layout(location = 2) out highp vec4 sbCaptureMeanFreePath;
layout(location = 3) out highp vec4 sbCaptureAlbedoOutput;
vec3 sbCapturedDiffuse = vec3(0.0);
vec3 sbCapturedIndirect = vec3(0.0);
vec3 sbCapturedAlbedo = vec3(1.0);
vec3 sbCapturedMeanFreePath = vec3(0.0);
vec2 sbCaptureOctahedral(vec3 value) {
 value /= max(abs(value.x) + abs(value.y) + abs(value.z), 0.000001);
 vec2 octahedral = value.xy;
 if (value.z < 0.0) octahedral = (1.0 - abs(octahedral.yx)) * mix(vec2(-1.0), vec2(1.0), step(vec2(0.0), octahedral));
 return octahedral;
}
`);
  if (composed) shader.fragmentShader = shader.fragmentShader.replace(anchor, `
 if (sbRuntimeSlot == uSbCaptureSlot) {
   sbCapturedDiffuse = reflectedLight.directDiffuse;
   sbCapturedIndirect = reflectedLight.indirectDiffuse;
   sbCapturedAlbedo = clamp(material.diffuseColor, vec3(0.0), vec3(1.0));
   sbCapturedMeanFreePath = sbRuntimeSlab.subsurfaceMeanFreePath;
 }
` + anchor);
  shader.fragmentShader = appendShaderMain(shader.fragmentShader, composed ? `
 #ifdef USE_AOMAP
 sbCapturedIndirect *= ambientOcclusion;
 #endif
 sbCapturedDiffuse += sbCapturedIndirect;
 gl_FragColor = vec4(sbCapturedDiffuse / max(sbCapturedAlbedo, vec3(0.0001)), 1.0);
 sbCaptureGeometry = vec4(sbCaptureOctahedral(normalize(normal)), vViewPosition.z, vSbCaptureRegion);
 sbCaptureMeanFreePath = vec4(sbCapturedMeanFreePath, 1.0);
 sbCaptureAlbedoOutput = vec4(sbCapturedAlbedo, 1.0);
` : `
 gl_FragColor = vec4(0.0);
 sbCaptureGeometry = vec4(0.0);
 sbCaptureMeanFreePath = vec4(0.0);
 sbCaptureAlbedoOutput = vec4(0.0);
`);
}
