import { SB_MAX_CLOSURES_PER_PIXEL, SB_MAX_TREE_DEPTH } from './sbMaterialContract.js';
import { findSlabParameterProblems } from './authoring/sbSlabParameterValues.js';
import { SB_LEGACY_MATERIAL_FALLBACK_NAME, legacyMaterialFor, legacyMaterialNames } from './sbLegacyMaterialTable.js';
import { convertLegacyMaterialToTopology } from './authoring/sbLegacyMaterialConversion.js';
export { SB_LEGACY_CONVERSION_CONSTANTS, convertLegacyMaterialToTopology } from './authoring/sbLegacyMaterialConversion.js';

export function isOperatorNode(node) {
  return node !== null && typeof node === 'object' && typeof node.operator === 'string';
}

export function topologySlabs(node) {
  if (!isOperatorNode(node)) return [node];
  return [...topologySlabs(node.top), ...topologySlabs(node.bottom)];
}

export function topologyClosureCount(node) {
  return topologySlabs(node).length;
}

export function topologyDepth(node) {
  if (!isOperatorNode(node)) return 1;
  return 1 + Math.max(topologyDepth(node.top), topologyDepth(node.bottom));
}

export function baseSlabOf(node) {
  return isOperatorNode(node) ? baseSlabOf(node.bottom) : node;
}

export function convertAllLegacyMaterials(request = {}) {
  return legacyMaterialNames().map(materialName => ({ materialName, topology: convertLegacyMaterialToTopology({ ...request, materialName }) }));
}

function findTopologyProblems(materialName, topology) {
  const problems = [];
  topologySlabs(topology).forEach((slab, index) => {
    findSlabParameterProblems(slab).forEach(problem => { problems.push(`${materialName} closure ${index}: ${problem}`); });
  });
  const closureCount = topologyClosureCount(topology);
  if (closureCount > SB_MAX_CLOSURES_PER_PIXEL) problems.push(`${materialName}: ${closureCount} closures acima do teto ${SB_MAX_CLOSURES_PER_PIXEL}`);
  const depth = topologyDepth(topology);
  if (depth > SB_MAX_TREE_DEPTH) problems.push(`${materialName}: profundidade ${depth} acima do teto ${SB_MAX_TREE_DEPTH}`);
  return problems;
}

function findMetalProblems(materialName, topology) {
  if (legacyMaterialFor(materialName).metalness !== 1) return [];
  const slab = baseSlabOf(topology);
  const hasBlackAlbedo = slab.albedo.every(channel => channel === 0);
  return hasBlackAlbedo ? [] : [`${materialName}: metal convertido com albedo diferente de preto`];
}

function findRoughnessOrderProblems(conversions) {
  const ordered = conversions.map(({ materialName, topology }) => ({ materialName, legacyRoughness: legacyMaterialFor(materialName).roughness, convertedRoughness: baseSlabOf(topology).roughness })).sort((left, right) => left.legacyRoughness - right.legacyRoughness);
  const problems = [];
  ordered.forEach((current, index) => {
    if (index === 0) return;
    const previous = ordered[index - 1];
    if (previous.convertedRoughness > current.convertedRoughness) problems.push(`ordem de rugosidade quebrada entre ${previous.materialName} e ${current.materialName}`);
  });
  return problems;
}

export function findLegacyConversionProblems(request = {}) {
  const conversions = convertAllLegacyMaterials(request);
  const problems = [];
  if (conversions.length !== legacyMaterialNames().length) problems.push('a conversao nao cobriu todos os materiais do motor');
  conversions.forEach(({ materialName, topology }) => {
    problems.push(...findTopologyProblems(materialName, topology));
    problems.push(...findMetalProblems(materialName, topology));
  });
  problems.push(...findRoughnessOrderProblems(conversions));
  return problems;
}

export function describeLegacyConversion(request = {}) {
  const conversions = convertAllLegacyMaterials(request);
  return {
    materialCount: conversions.length,
    fallbackName: SB_LEGACY_MATERIAL_FALLBACK_NAME,
    layeredCount: conversions.filter(({ topology }) => isOperatorNode(topology)).length,
    maxClosureCount: conversions.reduce((total, { topology }) => Math.max(total, topologyClosureCount(topology)), 0),
    maxDepth: conversions.reduce((total, { topology }) => Math.max(total, topologyDepth(topology)), 0),
    problems: findLegacyConversionProblems(request),
  };
}
