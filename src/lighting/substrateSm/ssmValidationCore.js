import { SSM_PROFILES } from './ssmContract.js';
import { copySubstrateSmImmutableData } from './ssmImmutableData.js';

export function createSubstrateSmCompilationRefusal(code, sourcePath, reason) {
  return Object.freeze({ code, sourcePath, reason });
}

export function validateSubstrateSmCompilationDomain(source, options = {}) {
  const validOptions = options !== null && typeof options === 'object' && !Array.isArray(options);
  options = validOptions ? options : {};
  const materialDomain = options.materialDomain === undefined ? 'surface' : options.materialDomain;
  const blendMode = options.blendMode === undefined ? 'opaque' : options.blendMode;
  const profile = options.profile === undefined ? 'Lite' : options.profile;
  const refusals = [];
  const sourcePaths = [];

  if (!validOptions) {
    refusals.push(createSubstrateSmCompilationRefusal(
      'invalidCompilationOptions', 'root', 'Compilation options must be an object',
    ));
  }
  if (typeof profile !== 'string' || !Object.hasOwn(SSM_PROFILES, profile)) {
    refusals.push(createSubstrateSmCompilationRefusal(
      'profileNotResolved', 'root', 'Compilation requires an effective Lite or Moderate profile',
    ));
  }
  if (materialDomain !== 'surface') {
    refusals.push(createSubstrateSmCompilationRefusal(
      'materialDomainDelegated', 'root', `The ${String(materialDomain)} domain remains owned by the host`,
    ));
  }
  if (blendMode !== 'opaque' && blendMode !== 'alphaTest') {
    refusals.push(createSubstrateSmCompilationRefusal(
      'blendModeDelegated', 'root', `The ${String(blendMode)} blend mode remains owned by the host`,
    ));
  }

  function visit(node) {
    sourcePaths.push(node.path);
    if (node.type === 'bsdf' && node.bsdf !== 'slab') {
      refusals.push(createSubstrateSmCompilationRefusal(
        'bsdfDomainDelegated', node.path, `The ${node.bsdf} BSDF requires its existing host backend`,
      ));
    }
    if (node.type === 'bsdf' && node.bsdf === 'slab' && blendMode === 'opaque' && node.parameters.opacity !== 1) {
      refusals.push(createSubstrateSmCompilationRefusal(
        'opacityRequiresExplicitBlendMode', node.path,
        'Nonunit authored opacity cannot be silently compiled as an opaque surface',
      ));
    }
    for (const child of node.children ?? []) visit(child);
  }

  visit(source.resolvedTree);
  for (const [index] of (source.assetReferences ?? []).entries()) {
    refusals.push(createSubstrateSmCompilationRefusal(
      'mapPlanRequired', `assets/${index}`,
      'Versioned material assets require an admitted map plan before a constant recipe can be published',
    ));
  }
  return copySubstrateSmImmutableData({
    ok: refusals.length === 0,
    materialDomain,
    blendMode,
    profile,
    sourcePaths,
    refusals,
  });
}
