import { SB_CLOSURE_BYTES_CEILING, SB_GATES } from './sbMaterialContract.js';
import { SB_CLOSURE_HEADER_BYTES } from './sbClosureLayouts.js';
import { SB_SLAB_PARAMETER_NAMES } from './authoring/sbAuthoringLimits.js';
import { SB_SLAB_PARAMETERS_OUTSIDE_CLOSURE, slabParameterCount, slabParameterNames, slabParameterSchema } from './authoring/sbSlabParameterSchema.js';
export { SB_SLAB_PARAMETER_KINDS, SB_SLAB_PARAMETERS_OUTSIDE_CLOSURE, slabParameterNames, slabParameterCount, slabParameterSchema, describeSlabParameters } from './authoring/sbSlabParameterSchema.js';
export { sanitizeSlabParameter, sanitizeSlabParameters, createDefaultSlabParameters, findSlabParameterProblems, isSlabParametersSanitized } from './authoring/sbSlabParameterValues.js';

export function findContractCoverageProblems() {
  const problems = [];
  SB_SLAB_PARAMETER_NAMES.forEach(name => {
    if (slabParameterSchema(name) === null) problems.push(`o contrato reserva ${name} e a SB-F4 nao descreve`);
  });
  slabParameterNames().forEach(name => {
    if (!SB_SLAB_PARAMETER_NAMES.includes(name)) problems.push(`a SB-F4 descreve ${name} fora do contrato`);
  });
  slabParameterNames().forEach(name => {
    const schema = slabParameterSchema(name);
    if (schema.closureField === null) return;
    if (schema.encoding.closureBytes === 0) problems.push(`${name}: aponta para ${schema.closureField}, campo ausente no layout do slab`);
  });
  return problems;
}

export function mappedParameterNames() {
  return slabParameterNames().filter(name => slabParameterSchema(name).closureField !== null);
}

export function mappedClosureBytes() {
  return mappedParameterNames().reduce((total, name) => total + slabParameterSchema(name).encoding.closureBytes, 0);
}

export function slabClosureBudget() {
  const parameterBytes = mappedClosureBytes();
  const totalBytes = parameterBytes + SB_CLOSURE_HEADER_BYTES;
  return { parameterBytes, headerBytes: SB_CLOSURE_HEADER_BYTES, totalBytes, ceilingBytes: SB_CLOSURE_BYTES_CEILING, headroom: SB_CLOSURE_BYTES_CEILING - totalBytes };
}

export function findQuantizationProblems() {
  const gate = SB_GATES.maxQuantizationErrorPerChannel;
  const problems = [];
  mappedParameterNames().forEach(name => {
    const { encoding } = slabParameterSchema(name);
    if (encoding.isNormalizedRange && encoding.quantizationStep > gate) problems.push(`${name}: passo de quantizacao ${encoding.quantizationStep} acima do portao ${gate}`);
  });
  if (0 > slabClosureBudget().headroom) problems.push('slab: os bytes mapeados passam do teto de closure do contrato');
  return problems;
}

export function describeSlabParametersSummary() {
  return {
    parameterCount: slabParameterCount(), mappedParameterCount: mappedParameterNames().length,
    outsideClosure: SB_SLAB_PARAMETERS_OUTSIDE_CLOSURE.slice(), budget: slabClosureBudget(),
    coverageProblems: findContractCoverageProblems(), quantizationProblems: findQuantizationProblems(),
  };
}
