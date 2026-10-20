import { validateSubstrateSmCapabilities } from '../../lighting/substrateSm/ssmCapabilityCore.js';
import { evaluateSubstrateSmDeformedHostBudget } from './ssmDeformedHostBudget.js';

const SAMPLER_TYPES = new Set([0x8b5e, 0x8b5f, 0x8b60, 0x8b62, 0x8dc1, 0x8dc4, 0x8dc5,
  0x8dca, 0x8dcb, 0x8dcc, 0x8dcf, 0x8dd2, 0x8dd3, 0x8dd4, 0x8dd7]);
const MATRIX_COLUMNS = new Map([[0x8b5a, 2], [0x8b5b, 3], [0x8b5c, 4],
  [0x8b65, 2], [0x8b66, 2], [0x8b67, 3], [0x8b68, 3], [0x8b69, 4], [0x8b6a, 4]]);
const VECTOR_TYPES = new Set([0x1404, 0x1405, 0x1406, 0x8b50, 0x8b51, 0x8b52, 0x8b53,
  0x8b54, 0x8b55, 0x8b56, 0x8b57, 0x8b58, 0x8b59, 0x8dc6, 0x8dc7, 0x8dc8]);

function slotsFor(info) {
  if (!Number.isSafeInteger(info?.size) || info.size < 1) throw new Error('Invalid linked resource size');
  const columns = MATRIX_COLUMNS.get(info.type);
  if (!columns && !VECTOR_TYPES.has(info.type) && !SAMPLER_TYPES.has(info.type)) {
    throw new Error(`Unsupported linked resource type: ${info.type}`);
  }
  return (columns ?? 1) * info.size;
}

function uniformDeclared(source, name) {
  const root = name.split(/[.\[]/, 1)[0];
  for (const match of source.matchAll(/\buniform\s+(?:(?:lowp|mediump|highp)\s+)?\w+\s+([^;{}]+);/g)) {
    if (new RegExp(`(?:^|,)\\s*${root}(?:\\s*\\[|\\s*$)`).test(match[1])) return true;
  }
  return false;
}

export function readSubstrateSmDeformedCapabilities(context, contextGeneration) {
  try {
    if (context.isContextLost()) throw new Error('WebGL context is lost');
    const precision = context.getShaderPrecisionFormat(context.FRAGMENT_SHADER, context.HIGH_FLOAT);
    const capabilities = { contextGeneration, fragmentHighp: (precision?.precision ?? 0) > 0,
      fragmentSamplers: context.getParameter(context.MAX_TEXTURE_IMAGE_UNITS),
      vertexSamplers: context.getParameter(context.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
      combinedSamplers: context.getParameter(context.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
      fragmentUniformVectors: context.getParameter(context.MAX_FRAGMENT_UNIFORM_VECTORS),
      vertexUniformVectors: context.getParameter(context.MAX_VERTEX_UNIFORM_VECTORS),
      varyingVectors: context.getParameter(context.MAX_VARYING_VECTORS),
      attributes: context.getParameter(context.MAX_VERTEX_ATTRIBS),
      maxTextureSize: context.getParameter(context.MAX_TEXTURE_SIZE) };
    const validation = validateSubstrateSmCapabilities(capabilities, contextGeneration);
    return validation.ok ? Object.freeze({ ok: true, capabilities: Object.freeze(capabilities) }) : validation;
  } catch (error) {
    return Object.freeze({ ok: false, code: 'SSM_DEFORMED_CONTEXT_UNAVAILABLE', reason: String(error?.message ?? error) });
  }
}

export function auditSubstrateSmDeformedProgram({ context, program, contextGeneration,
  host, hostUsage, additionalUsage } = {}) {
  try {
    const measured = readSubstrateSmDeformedCapabilities(context, contextGeneration);
    if (!measured.ok) return measured;
    const budget = evaluateSubstrateSmDeformedHostBudget({ host, hostUsage, additionalUsage,
      capabilities: measured.capabilities, contextGeneration });
    if (!budget.ok) return budget;
    if (!program || context.getParameter(context.CURRENT_PROGRAM) !== program
      || context.getProgramParameter(program, context.LINK_STATUS) !== true) {
      throw new Error('A selected and linked material program is required');
    }
    if (typeof context.ACTIVE_UNIFORM_BLOCKS === 'number'
      && context.getProgramParameter(program, context.ACTIVE_UNIFORM_BLOCKS) > 0) {
      throw new Error('Uniform block accounting requires a separate adapter');
    }
    const shaders = context.getAttachedShaders(program) ?? [];
    if (shaders.length !== 2) throw new Error('Both host stages are required');
    const sources = {};
    for (const shader of shaders) {
      if (context.getShaderParameter(shader, context.COMPILE_STATUS) !== true) throw new Error('Host stage compilation failed');
      const stage = context.getShaderParameter(shader, context.SHADER_TYPE) === context.VERTEX_SHADER ? 'vertex' : 'fragment';
      if (sources[stage]) throw new Error('Ambiguous host shader stages');
      sources[stage] = context.getShaderSource(shader) ?? '';
    }
    if (!sources.vertex || !sources.fragment) throw new Error('Both host stage sources are required');
    const reflected = { fragmentSamplers: 0, vertexSamplers: 0, fragmentUniformVectors: 0,
      vertexUniformVectors: 0, attributes: 0 };
    const samplers = [];
    const uniformCount = context.getProgramParameter(program, context.ACTIVE_UNIFORMS);
    for (let index = 0; index < uniformCount; index++) {
      const info = context.getActiveUniform(program, index);
      const vectors = slotsFor(info);
      const stages = [];
      for (const stage of ['vertex', 'fragment']) {
        if (!uniformDeclared(sources[stage], info.name)) continue;
        stages.push(stage);
        reflected[`${stage}UniformVectors`] += vectors;
        if (SAMPLER_TYPES.has(info.type)) reflected[`${stage}Samplers`] += info.size;
      }
      if (stages.length === 0) throw new Error(`Unknown linked uniform stage: ${info.name}`);
      if (SAMPLER_TYPES.has(info.type)) samplers.push(Object.freeze({ name: info.name, slots: info.size, stages: Object.freeze(stages) }));
    }
    const attributeCount = context.getProgramParameter(program, context.ACTIVE_ATTRIBUTES);
    for (let index = 0; index < attributeCount; index++) {
      reflected.attributes += slotsFor(context.getActiveAttrib(program, index));
    }
    reflected.combinedSamplers = reflected.fragmentSamplers + reflected.vertexSamplers;
    for (const [field, minimum] of Object.entries(reflected)) {
      if (minimum > budget.totals[field]) {
        return Object.freeze({ ok: false, code: 'SSM_DEFORMED_LINKED_RESOURCE_OMITTED', field, minimum, budget });
      }
    }
    const requiredSampler = host.kind === 'terrain' ? ['uRswAtlas', 'fragment']
      : host.kind === 'palette-skinned' ? ['rswPaletteTex', 'vertex'] : ['boneTexture', 'vertex'];
    if (!samplers.some(item => item.name === requiredSampler[0] && item.stages.includes(requiredSampler[1]))) {
      throw new Error(`The real host sampler is not active: ${requiredSampler[0]}`);
    }
    return Object.freeze({ ok: true, capabilities: measured.capabilities, budget,
      reflected: Object.freeze(reflected), samplers: Object.freeze(samplers),
      accounting: 'stage-sampler-counts-not-distinct-assets',
      uniformEvidence: 'conservative-active-uniform-stage-declaration-union',
      varyingEvidence: 'linked-program-limit-check-with-declared-ledger',
      linkedProgramVerified: true, hardwarePerformanceCertified: false });
  } catch (error) {
    return Object.freeze({ ok: false, code: 'SSM_DEFORMED_PROGRAM_AUDIT_REFUSED', reason: String(error?.message ?? error) });
  }
}
