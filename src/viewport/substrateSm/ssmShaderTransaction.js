import { SSM_THREE_REVISION } from '../../lighting/substrateSm/ssmContract.js';
import { SSM_RECIPE_UNIFORM_NAME, buildSubstrateSmRecipeUniformDeclarations } from '../../lighting/substrateSm/ssmRecipeLayoutGlsl.js';
import { SSM_BASE_UNIFORM_VECTOR_COUNT, SSM_SHADER_CONTRACT } from './ssmShaderContract.js';
import { buildSubstrateSmSurfaceDeclarations, buildSubstrateSmSurfaceResolution, buildSubstrateSmHostMaterialResolution } from './ssmSurfaceGlsl.js';
import { maskSubstrateSmShaderComments, findSubstrateSmShaderAnchor, expandSubstrateSmShaderChunk, locateSubstrateSmShaderChunk, requireSubstrateSmStockFunction, requireSubstrateSmShaderOrder } from './ssmShaderAnchors.js';
import { createSubstrateSmReadOnlyUniforms } from './ssmShaderUniforms.js';
import { beginSubstrateSmShaderOwnership, rollbackSubstrateSmShaderOwnership } from './ssmShaderOwnership.js';

const candidates = new WeakMap();
const shaderFields = ['vertexShader', 'fragmentShader', 'uniforms'];
const reservedSymbols = /\b(?:uSsm\w*|ssm\w*|Ssm\w*|SSM_\w*)\b/;

function refusal(reason) {
  return Object.freeze({ ok: false, applied: false, code: 'SSM_SHADER_TRANSACTION_REFUSED', reason });
}

function requireShader(shader) {
  maskSubstrateSmShaderComments(shader?.vertexShader);
  maskSubstrateSmShaderComments(shader?.fragmentShader);
  if (!shader.uniforms || typeof shader.uniforms !== 'object' || Array.isArray(shader.uniforms)) {
    throw new TypeError('SSM_SHADER_UNIFORMS_REQUIRED');
  }
  for (const name of shaderFields) {
    const property = Object.getOwnPropertyDescriptor(shader, name);
    if (!property || !Object.hasOwn(property, 'value') || property.writable !== true) {
      throw new TypeError(`SSM_SHADER_WRITABLE_FIELD_REQUIRED:${name}`);
    }
  }
}

function requireRecipeUniform(uniform) {
  const value = uniform?.value;
  if (!(value instanceof Float32Array) || value.length !== SSM_BASE_UNIFORM_VECTOR_COUNT * 4
    || !value.every(Number.isFinite) || value[27] !== 0) throw new TypeError('SSM_RECIPE_UNIFORM_PREFIX_REQUIRED');
}

function prepareSource({ THREE, shader, hostBackend, emissionMode, tintMode }) {
  const chunkName = hostBackend === 'standard' ? 'lights_physical' : 'lights_phong';
  const materialType = hostBackend === 'standard' ? 'PhysicalMaterial' : 'BlinnPhongMaterial';
  const directFunction = hostBackend === 'standard' ? 'RE_Direct_Physical' : 'RE_Direct_BlinnPhong';
  let source = expandSubstrateSmShaderChunk(shader.fragmentShader, THREE.ShaderChunk, `${chunkName}_pars_fragment`);
  source = expandSubstrateSmShaderChunk(source, THREE.ShaderChunk, `${chunkName}_fragment`);
  requireSubstrateSmStockFunction(source, THREE.ShaderChunk[`${chunkName}_pars_fragment`], directFunction);
  const directMacro = findSubstrateSmShaderAnchor(source, new RegExp(`^[ \\t]*#define[ \\t]+RE_Direct[ \\t]+${directFunction}[ \\t]*$`), 'direct-response', 0);
  const main = findSubstrateSmShaderAnchor(source, /\bvoid\s+main\s*\(\s*\)\s*\{/, 'main', 0);
  const normal = locateSubstrateSmShaderChunk(source, THREE.ShaderChunk, 'normal_fragment_maps', 1);
  const emission = locateSubstrateSmShaderChunk(source, THREE.ShaderChunk, 'emissivemap_fragment', 1);
  const material = findSubstrateSmShaderAnchor(source, new RegExp(`\\b${materialType}\\s+material\\s*;`), 'host-material', 1);
  const loopExpression = /#include\s+<lights_fragment_begin>|\bvec3\s+geometryPosition\s*=\s*-\s*vViewPosition\s*;/;
  const lights = findSubstrateSmShaderAnchor(source, loopExpression, 'light-loop', 1);
  requireSubstrateSmShaderOrder([directMacro, main, normal, emission, material, lights]);
  source = source.slice(0, lights.start) + buildSubstrateSmHostMaterialResolution(hostBackend) + source.slice(lights.start);
  source = source.slice(0, material.start) + buildSubstrateSmSurfaceResolution({ emissionMode, tintMode }) + source.slice(material.start);
  return source.slice(0, main.start) + buildSubstrateSmSurfaceDeclarations(hostBackend) + source.slice(main.start);
}

function validateCandidate(candidate, baseUniforms, validateResources) {
  const source = maskSubstrateSmShaderComments(candidate.fragmentShader);
  if (typeof candidate.vertexShader !== 'string') throw new TypeError('SSM_TRANSFORM_VERTEX_SOURCE_REQUIRED');
  findSubstrateSmShaderAnchor(source, /^uniform vec4 uSsmRecipe\[7\];$/, 'recipe-declaration', 0);
  findSubstrateSmShaderAnchor(source, /^#define SSM_SURFACE_READY 1$/, 'surface-ready', 1);
  findSubstrateSmShaderAnchor(source, /^#define SSM_HOST_MATERIAL_READY 1$/, 'host-ready', 1);
  findSubstrateSmShaderAnchor(source, /^#define SSM_RESPONSE_READY 1$/, 'response-ready', 0);
  const additionalUniforms = Object.keys(candidate.uniforms).filter(name => !Object.hasOwn(baseUniforms, name) && name !== SSM_RECIPE_UNIFORM_NAME);
  const introducesVertexSymbols = reservedSymbols.test(maskSubstrateSmShaderComments(candidate.vertexShader));
  const declarations = [...source.matchAll(/\buniform\s+\w+\s+(uSsm\w+)/g)];
  for (const declaration of declarations) {
    if (!Object.hasOwn(candidate.uniforms, declaration[1])) throw new Error(`SSM_SHADER_UNBOUND_UNIFORM:${declaration[1]}`);
  }
  if (additionalUniforms.length || introducesVertexSymbols) {
    if (typeof validateResources !== 'function') throw new Error('SSM_EXTENSION_RESOURCE_CONTRACT_REQUIRED');
  }
  if (validateResources !== undefined) {
    const inspection = createSubstrateSmReadOnlyUniforms(candidate.uniforms);
    const result = validateResources(Object.freeze({ ...candidate, uniforms: inspection.view, additionalUniforms: Object.freeze(additionalUniforms) }));
    if (result?.ok !== true) throw new Error(result?.reason || 'SSM_SHADER_RESOURCES_REFUSED');
  }
  if (!source.includes(buildSubstrateSmRecipeUniformDeclarations(SSM_BASE_UNIFORM_VECTOR_COUNT))) {
    throw new Error('SSM_SHADER_LAYOUT_CHANGED');
  }
}

export function createSubstrateSmShaderCandidate({ THREE, shader, hostBackend, recipeUniform, emissionMode = 'host', tintMode = 'host-diffuse', transforms = [], validateResources } = {}) {
  try {
    if (String(THREE?.REVISION) !== SSM_THREE_REVISION) throw new Error('SSM_THREE_REVISION_UNSUPPORTED');
    if (!['standard', 'phong'].includes(hostBackend)) throw new Error('SSM_SHADER_HOST_UNSUPPORTED');
    if (!['host', 'recipe'].includes(emissionMode) || !['host-diffuse', 'none'].includes(tintMode)) {
      throw new Error('SSM_SHADER_SURFACE_POLICY_REQUIRED');
    }
    requireShader(shader);
    requireRecipeUniform(recipeUniform);
    if (reservedSymbols.test(maskSubstrateSmShaderComments(shader.fragmentShader))
      || reservedSymbols.test(maskSubstrateSmShaderComments(shader.vertexShader))
      || Object.keys(shader.uniforms).some(name => /^uSsm/.test(name))) throw new Error('SSM_SHADER_SYMBOL_COLLISION');
    if (shader.defines?.SB_REAL_CLOSURES !== undefined || shader.defines?.PHYSICAL !== undefined) {
      throw new Error('SSM_SHADER_BACKEND_CONFLICT');
    }
    if (!Array.isArray(transforms) || transforms.length > 8) throw new Error('SSM_SHADER_TRANSFORM_LIMIT');
    const identifiers = new Set();
    const baseUniforms = { ...shader.uniforms };
    let current = {
      vertexShader: shader.vertexShader,
      fragmentShader: prepareSource({ THREE, shader, hostBackend, emissionMode, tintMode }),
      uniforms: { ...baseUniforms, [SSM_RECIPE_UNIFORM_NAME]: recipeUniform },
    };
    for (const extension of transforms) {
      if (typeof extension?.id !== 'string' || !extension.id || identifiers.has(extension.id)
        || typeof extension.transform !== 'function') throw new Error('SSM_SHADER_TRANSFORM_CONTRACT');
      identifiers.add(extension.id);
      const inspection = createSubstrateSmReadOnlyUniforms(current.uniforms);
      const view = Object.freeze({ ...current, uniforms: inspection.view });
      const ownership = beginSubstrateSmShaderOwnership(view);
      let result;
      try {
        result = extension.transform(Object.freeze({ THREE, hostBackend, contract: SSM_SHADER_CONTRACT, shader: view }));
      } finally {
        rollbackSubstrateSmShaderOwnership(ownership);
      }
      if (result?.ok !== true || typeof result.fragmentShader !== 'string') {
        throw new Error(result?.reason || `SSM_SHADER_TRANSFORM_REFUSED:${extension.id}`);
      }
      current = {
        vertexShader: result.vertexShader ?? current.vertexShader,
        fragmentShader: result.fragmentShader,
        uniforms: inspection.resolve(result.uniforms ?? inspection.view),
      };
    }
    validateCandidate(current, baseUniforms, validateResources);
    const candidate = Object.freeze({ ok: true, applied: false, ...current, uniforms: Object.freeze(current.uniforms), contract: SSM_SHADER_CONTRACT });
    candidates.set(candidate, { shader, vertexShader: shader.vertexShader, fragmentShader: shader.fragmentShader, uniforms: shader.uniforms, entries: Object.entries(baseUniforms), committed: false });
    return candidate;
  } catch (error) {
    return refusal(error instanceof Error ? error.message : 'SSM_SHADER_UNKNOWN_FAILURE');
  }
}

export function commitSubstrateSmShaderCandidate({ shader, candidate } = {}) {
  const record = candidates.get(candidate);
  if (!record || record.shader !== shader || record.committed) return refusal('SSM_SHADER_CANDIDATE_INVALID');
  if (shader.vertexShader !== record.vertexShader || shader.fragmentShader !== record.fragmentShader
    || shader.uniforms !== record.uniforms || Object.keys(shader.uniforms).length !== record.entries.length
    || record.entries.some(([name, holder]) => shader.uniforms[name] !== holder)) return refusal('SSM_SHADER_CANDIDATE_STALE');
  try { requireShader(shader); } catch (error) { return refusal(error.message); }
  shader.vertexShader = candidate.vertexShader;
  shader.fragmentShader = candidate.fragmentShader;
  shader.uniforms = { ...candidate.uniforms };
  record.committed = true;
  return Object.freeze({ ok: true, applied: true, contract: SSM_SHADER_CONTRACT });
}
