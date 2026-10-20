import { describeMaterialInput } from "./materialSampling.js";

export function createMaterialUniforms(definition) {
  const uniforms = {
    cp26Weight: { value: 1 }, cp26TimeSeconds: { value: 0 }, cp26FrameId: { value: 0 },
    cp26InversePreExposure: { value: 1 }, cp26OutputSize: { value: [1, 1] }
  };
  for (const name of ["Input", ...definition.inputs.map((input) => input.name)]) {
    uniforms[`cp26Texture_${name}`] = { value: null };
    uniforms[`cp26ScaleBias_${name}`] = { value: [1, 1, 0, 0] };
    uniforms[`cp26Bounds_${name}`] = { value: [0, 0, 1, 1] };
    uniforms[`cp26TextureSize_${name}`] = { value: [1, 1] };
  }
  for (const [name, parameter] of Object.entries(definition.parameters)) uniforms[`cp26Parameter_${name}`] = { value: parameter.value };
  return uniforms;
}

export function bindMaterialTexture(uniforms, name, resource, frame, expected) {
  const description = describeMaterialInput(resource, frame, name, expected);
  uniforms[`cp26Texture_${name}`].value = description.texture;
  uniforms[`cp26ScaleBias_${name}`].value = description.scaleBias;
  uniforms[`cp26Bounds_${name}`].value = description.bounds;
  uniforms[`cp26TextureSize_${name}`].value = [resource.width, resource.height];
}

export function updateMaterialUniforms(uniforms, definition, controls, context, source, extent, preExposure, externalWeight = 1) {
  bindMaterialTexture(uniforms, "Input", source, context.frame);
  for (const input of definition.inputs) bindMaterialTexture(uniforms, input.name, context.read(input.resource), context.frame, input);
  uniforms.cp26Weight.value = controls.enabled ? (definition.blendable ? controls.weight * externalWeight : controls.weight * externalWeight > 0 ? 1 : 0) : 0;
  uniforms.cp26TimeSeconds.value = context.frame.timeSeconds;
  uniforms.cp26FrameId.value = context.frame.frameId;
  uniforms.cp26InversePreExposure.value = 1 / preExposure;
  uniforms.cp26OutputSize.value = [extent.width, extent.height];
  for (const [name, value] of Object.entries(controls.parameters)) uniforms[`cp26Parameter_${name}`].value = value;
}
