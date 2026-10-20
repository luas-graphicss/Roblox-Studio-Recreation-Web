import { createSlabNode, createBsdfNode, createOperatorNode, normalizeMaterialTree } from './sbMaterialTreeCore.js';
import { isSpecializedClosureKind, sanitizeSpecializedParameters } from './sbSpecializedClosureCore.js';
import { resolveAutoParameters, validateAuthoringGraph } from './sbAuthoringGraphCore.js';
import { compileMaterialTopology } from './sbTopologyCompilerCore.js';
import { simplifyTopology } from './sbSimplificationPolicyCore.js';
import { buildDispatchPlan } from './sbClosureDispatchCore.js';
import { sanitizeSlabParameters } from './sbSlabParametersCore.js';
import { writeMaterialBuffer } from './sbMaterialBufferCore.js';
import { SB_AUTHORING_PARAMETER_RANGES } from './sbAuthoringParameterRanges.js';
import { specularProfileCount } from './sbSpecularProfileCatalog.js';

function restoreNodeShape(node) {
  if (node?.operator) return createOperatorNode({ operator: node.operator, parameters: node.parameters ?? node, children: (node.children ?? [node.top, node.bottom]).filter(Boolean).map(restoreNodeShape), label: node.label });
  if (typeof node?.bsdf === 'string' && isSpecializedClosureKind(node.bsdf)) return createBsdfNode({ bsdf: node.bsdf, parameters: sanitizeSpecializedParameters(node.bsdf, node.parameters ?? node), label: node?.label });
  return createSlabNode(sanitizeSlabParameters(node?.parameters ?? node), { label: node?.label });
}
function sanitizeClosureParameters(kind, parameters) {
  return isSpecializedClosureKind(kind) ? sanitizeSpecializedParameters(kind, parameters) : sanitizeSlabParameters(parameters);
}

export function compileRuntimeMaterial(root, { tier = 'medio', materialFamily = 'standard', simplify = true } = {}) {
  const normalized = normalizeMaterialTree(root);
  if (!normalized.ok) return {ok:false, topology:null, closures:[], problems:normalized.anomalies.map(item=>`${item.path}: ${item.anomaly}`)};
  const validation = validateAuthoringGraph(normalized.root);
  if (!validation.ok) return {ok:false, topology:null, closures:[], problems:validation.refusals.map(item=>item.reason)};
  const unsupported = new Set();
  const unavailableProfiles = [];
  const pending = [normalized.root];
  while (pending.length) {
    const node = pending.pop();
    if (typeof node.bsdf === 'string' && node.bsdf !== 'slab' && !isSpecializedClosureKind(node.bsdf)) unsupported.add(node.bsdf);
    const profileIndex = node.parameters?.specularProfileIndex;
    if (profileIndex != null && (!Number.isInteger(profileIndex) || profileIndex < 0 || profileIndex >= specularProfileCount())) unavailableProfiles.push(profileIndex);
    pending.push(...(node.children ?? []));
  }
  if (unsupported.size) return { ok: false, topology: null, closures: [], buffer: null, problems: ['Unknown closure kinds: ' + [...unsupported].join(', ') + '. Native rendering is preserved; simplification must not reinterpret these as slabs.'] };
  if (unavailableProfiles.length) return { ok: false, topology: null, closures: [], buffer: null, problems: ['Unknown specular profile index: ' + unavailableProfiles.join(', ')] };
  const resolved = resolveAutoParameters(normalized.root);
  const compilationOptions = {tier, materialFamily, validationOptions:{parameterRanges:SB_AUTHORING_PARAMETER_RANGES}};
  let topology = compileMaterialTopology(resolved, compilationOptions);
  if (!topology.ok) return { ok: false, topology, closures: [], problems: topology.refusals.map(item => item.reason) };
  let simplification = null;
  if (topology.requiresSimplification && simplify) {
    simplification = simplifyTopology({ topology: resolved, tier });
    topology = compileMaterialTopology(restoreNodeShape(simplification.topology), compilationOptions);
  }
  const candidates = topology.closures.map(closure => ({ ...closure, kind: closure.bsdf }));
  const dispatch = buildDispatchPlan({ tierName: tier, closures: candidates });
  const closures = dispatch.dispatched.map(item => ({ ...candidates[item.sourceIndex], ...item }));
  const problems = [...dispatch.problems];
  if (!simplify && dispatch.droppedCount) problems.push('Topology exceeds the tier budget with simplification disabled.');
  if (problems.length) return {ok:false, topology, closures, dispatch, simplification, buffer:null, problems};
  const records = closures.map(closure => ({ kind: closure.kind, header: { closureCount: closures.length, layerIndex: closure.layerIndex }, parameters: sanitizeClosureParameters(closure.kind, closure.parameters) }));
  return { ok: problems.length === 0 && closures.length > 0, topology, closures, dispatch, simplification, buffer: writeMaterialBuffer(records), problems };
}
