import { serializeSubstrateSmKeyDescriptor } from '../../lighting/substrateSm/ssmKeySerialization.js';

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|lavapipe|software|offscreen|microsoft basic render/i;
const MATERIAL_SAMPLER_SLOTS = Object.freeze([
  'map', 'normalMap', 'emissiveMap', 'alphaMap', 'aoMap', 'lightMap', 'bumpMap',
  'displacementMap', 'envMap', 'specularMap', 'roughnessMap', 'metalnessMap',
]);
const HOST_SHADOW_SAMPLERS = 6;
const HOST_EXTRA_SAMPLERS = 4;
const HOST_FRAGMENT_UNIFORM_VECTORS = 200;
const HOST_VERTEX_UNIFORM_VECTORS = 200;
const HOST_VARYING_VECTORS = 12;
const HOST_ATTRIBUTES = 12;
const HOST_MAX_TEXTURE_SIZE = 4096;

function readInteger(context, name) {
  const value = Number(context.getParameter(context[name]));
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function readSubstrateSmHostCapabilities(renderer, contextGeneration) {
  const context = renderer?.getContext?.();
  if (!context || typeof context.getParameter !== 'function' || context.isContextLost?.() === true) return null;
  if (!Number.isSafeInteger(contextGeneration) || contextGeneration < 0) return null;
  const precision = context.getShaderPrecisionFormat?.(context.FRAGMENT_SHADER, context.HIGH_FLOAT);
  const debug = typeof context.getExtension === 'function' ? context.getExtension('WEBGL_debug_renderer_info') : null;
  let rendererString = '';
  try {
    rendererString = String(context.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : context.RENDERER) || '');
  } catch {
    rendererString = '';
  }
  const capabilities = Object.freeze({
    contextGeneration,
    fragmentHighp: Number(precision?.precision ?? 0) > 0,
    fragmentSamplers: readInteger(context, 'MAX_TEXTURE_IMAGE_UNITS'),
    vertexSamplers: readInteger(context, 'MAX_VERTEX_TEXTURE_IMAGE_UNITS'),
    combinedSamplers: readInteger(context, 'MAX_COMBINED_TEXTURE_IMAGE_UNITS'),
    fragmentUniformVectors: readInteger(context, 'MAX_FRAGMENT_UNIFORM_VECTORS'),
    vertexUniformVectors: readInteger(context, 'MAX_VERTEX_UNIFORM_VECTORS'),
    varyingVectors: readInteger(context, 'MAX_VARYING_VECTORS'),
    attributes: readInteger(context, 'MAX_VERTEX_ATTRIBS'),
    maxTextureSize: readInteger(context, 'MAX_TEXTURE_SIZE'),
  });
  return Object.freeze({
    capabilities,
    capabilityKey: serializeSubstrateSmKeyDescriptor(capabilities),
    softwareRenderer: SOFTWARE_RENDERER.test(rendererString),
    rendererString,
    webgl2: typeof WebGL2RenderingContext !== 'undefined' && context instanceof WebGL2RenderingContext,
  });
}

export function estimateSubstrateSmHostUsage(material, capabilities, contextGeneration) {
  let materialSamplers = 0;
  for (const slot of MATERIAL_SAMPLER_SLOTS) if (material?.[slot]) materialSamplers += 1;
  const clamp = (value, limit, reserve = 0) => Math.max(0, Math.min(value, limit - reserve));
  return Object.freeze({
    contextGeneration,
    fragmentSamplers: clamp(materialSamplers + HOST_SHADOW_SAMPLERS + HOST_EXTRA_SAMPLERS, capabilities.fragmentSamplers, 1),
    vertexSamplers: clamp(1, capabilities.vertexSamplers),
    fragmentUniformVectors: clamp(HOST_FRAGMENT_UNIFORM_VECTORS, capabilities.fragmentUniformVectors, 8),
    vertexUniformVectors: clamp(HOST_VERTEX_UNIFORM_VECTORS, capabilities.vertexUniformVectors),
    varyingVectors: clamp(HOST_VARYING_VECTORS, capabilities.varyingVectors),
    attributes: clamp(HOST_ATTRIBUTES, capabilities.attributes),
    maxTextureSize: clamp(HOST_MAX_TEXTURE_SIZE, capabilities.maxTextureSize),
  });
}
