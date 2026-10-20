import { compileSubstrateSmFoliageSlab } from './ssmFoliageCompilation.js';
import { copySubstrateSmImmutableData } from './ssmImmutableData.js';
import { compileSubstrateSmSheenSlab } from './ssmSheenCompilation.js';
import { compileSubstrateSmSlab } from './ssmSlabCompilationCore.js';
import { createSubstrateSmCompilationRefusal } from './ssmValidationCore.js';

export function selectSubstrateSmSheenOrFoliageFamily(node) {
  const parameters = node?.parameters;
  if (!parameters) return null;
  const fuzzActive = typeof parameters.fuzzAmount === 'number' && parameters.fuzzAmount !== 0;
  const subsurfaceActive = Array.isArray(parameters.subsurfaceMeanFreePath) &&
    parameters.subsurfaceMeanFreePath.some(value => value !== 0);
  if (fuzzActive && subsurfaceActive) return 'ambiguous';
  if (fuzzActive) return 'sheen';
  if (subsurfaceActive) return 'foliage';
  return 'base';
}

export function compileSubstrateSmSheenOrFoliageSlab(node, options = {}) {
  const family = selectSubstrateSmSheenOrFoliageFamily(node);
  if (family === 'sheen') return compileSubstrateSmSheenSlab(node, options);
  if (family === 'foliage') return compileSubstrateSmFoliageSlab(node, options);
  if (family === 'base') return compileSubstrateSmSlab(node);
  return copySubstrateSmImmutableData({
    ok: false,
    surface: null,
    losses: [],
    refusals: [createSubstrateSmCompilationRefusal(
      family === 'ambiguous' ? 'dominantFeatureSelectionRequired' : 'slabRequired',
      node?.path ?? 'root',
      family === 'ambiguous'
        ? 'Fuzz and subsurface are both active; the upstream reduction must select one dominant family and record the loss'
        : 'Family selection requires a resolved F02 slab',
    )],
  });
}
