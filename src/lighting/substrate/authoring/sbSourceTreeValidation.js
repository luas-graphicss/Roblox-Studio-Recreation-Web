import { SB_MAX_TREE_DEPTH, SB_MAX_SLABS_PER_TREE } from './sbAuthoringLimits.js';
import { SB_SOURCE_MAX_TREE_NODES, SB_SOURCE_NODE_KEYS } from './sbSourceContract.js';
import { isSourceRecord, sourceRefusal } from './sbSourceData.js';
import { SB_BSDF_KINDS } from '../sbBsdfCatalog.js';
import { SB_OPERATORS } from '../sbOperatorCatalog.js';
import { bsdfParameterNames, operatorParameterNames } from '../sbMaterialTreeCore.js';
import { authoringRangeFor, describeValueRangeRefusal } from '../sbAuthoringParameterRanges.js';
import { normalizeScalarF90 } from '../sbSlabF90Compatibility.js';

const vectorParameters = new Set(['baseColor', 'irisColor', 'absorption', 'scattering', 'extinction', 'normal', 'tangent']);

function parameterRefusal(node, name, value, path) {
  if (value === null || value === undefined) {
    return node.type === 'bsdf' && node.bsdf === 'slab'
      ? null
      : sourceRefusal('autoNotSupported', path, 'AUTO is only defined for slab parameters');
  }
  const range = authoringRangeFor(name);
  if (range) {
    const reason = describeValueRangeRefusal(name, value);
    return reason ? sourceRefusal('invalidAuthoredParameter', path, reason) : null;
  }
  if (vectorParameters.has(name)) {
    if (Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)) return null;
    return sourceRefusal('invalidParameterComponents', path, 'Parameter requires exactly three finite numbers');
  }
  return typeof value === 'number' && Number.isFinite(value)
    ? null
    : sourceRefusal('invalidParameterComponents', path, 'Parameter requires a finite scalar');
}

export function validateSourceTreeShape(root) {
  const refusals = [];
  const conversions = [];
  let nodeCount = 0;
  let slabCount = 0;

  function add(code, path, reason) {
    refusals.push(sourceRefusal(code, path, reason));
  }

  function visit(node, path, depth) {
    nodeCount += 1;
    if (nodeCount > SB_SOURCE_MAX_TREE_NODES) return add('sourceSafetyLimit', path, 'Material tree exceeds the node safety limit');
    if (depth > SB_MAX_TREE_DEPTH) return add('treeTooDeep', path, 'Material tree exceeds the shared authored depth limit');
    if (!isSourceRecord(node) || !Object.hasOwn(SB_SOURCE_NODE_KEYS, node.type)) {
      return add('unsupportedNodeType', path, 'Expected a canonical BSDF or operator node');
    }
    for (const key of Object.keys(node)) {
      if (!SB_SOURCE_NODE_KEYS[node.type].includes(key)) add('unsupportedNodeField', `${path}/${key}`, 'Unknown authored fields cannot be discarded');
    }
    if (node.label != null && typeof node.label !== 'string') add('invalidNodeLabel', `${path}/label`, 'Node labels must be strings or null');
    if (node.path !== undefined && node.path !== path) add('invalidNodePath', `${path}/path`, 'Stored path must match the authored child order');
    const isSlab = node.type === 'bsdf' && node.bsdf === 'slab';
    if (isSlab) slabCount += 1;
    const catalog = node.type === 'bsdf' ? SB_BSDF_KINDS : SB_OPERATORS;
    const kind = node.type === 'bsdf' ? node.bsdf : node.operator;
    if (typeof kind !== 'string' || !Object.hasOwn(catalog, kind)) return add('unsupportedNodeKind', path, 'Node kind is not in the shared authoring catalog');
    const parameters = node.parameters === undefined ? {} : node.parameters;
    if (!isSourceRecord(parameters)) return add('invalidParameters', `${path}/parameters`, 'Parameters must be a plain record');
    const allowedNames = node.type === 'bsdf' ? bsdfParameterNames(kind) : operatorParameterNames(kind);
    for (const [name, value] of Object.entries(parameters)) {
      const parameterPath = `${path}/parameters/${name}`;
      if (!allowedNames.includes(name)) {
        add('unknownParameter', parameterPath, 'Parameter does not belong to this authored node');
        continue;
      }
      const refusal = parameterRefusal(node, name, value, parameterPath);
      if (refusal) refusals.push(refusal);
      if (!refusal && isSlab && name === 'f90' && Array.isArray(value)) {
        conversions.push({ sourcePath: parameterPath, operation: 'legacyAchromaticF90', replacement: normalizeScalarF90(value), reason: 'Shared lossless achromatic F90 compatibility', estimatedLoss: null, measuredLoss: null, evidenceStatus: 'exact' });
      }
    }
    if (node.type !== 'operator') return;
    for (const name of allowedNames) {
      if (!Object.hasOwn(parameters, name)) add('missingOperatorParameter', `${path}/parameters/${name}`, 'Operator parameters require explicit values; AUTO is not defined');
    }
    if (!Array.isArray(node.children) || node.children.length !== catalog[kind].arity) {
      return add('invalidOperatorArity', `${path}/children`, 'Child count must match the shared operator catalog');
    }
    node.children.forEach((child, index) => visit(child, `${path}/${index}`, depth + 1));
  }

  visit(root, 'root', 1);
  if (slabCount > SB_MAX_SLABS_PER_TREE) add('tooManySlabs', 'root', 'Material tree exceeds the shared authored slab limit');
  return { ok: refusals.length === 0, refusals, conversions, nodeCount, slabCount };
}
