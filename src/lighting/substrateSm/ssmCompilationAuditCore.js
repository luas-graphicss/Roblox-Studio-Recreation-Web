import { copySubstrateSmImmutableData } from './ssmImmutableData.js';

export function createSubstrateSmCompilationAudit(domainValidation, folding, compiled) {
  const sourcePaths = domainValidation?.sourcePaths ?? [];
  const removedPaths = new Set(folding?.removedSourcePaths ?? []);
  const retainedPaths = new Set(folding?.retainedSourcePaths ?? sourcePaths);
  return copySubstrateSmImmutableData({
    sourceNodeCount: sourcePaths.length,
    retainedNodeCount: retainedPaths.size,
    constantFoldedNodeCount: removedPaths.size,
    accountedNodeCount: new Set([...removedPaths, ...retainedPaths]).size,
    complete: sourcePaths.length > 0
      && new Set(sourcePaths).size === sourcePaths.length
      && new Set([...removedPaths, ...retainedPaths]).size === sourcePaths.length
      && sourcePaths.every(path => removedPaths.has(path) !== retainedPaths.has(path)),
    nodes: sourcePaths.map(sourcePath => ({
      sourcePath,
      disposition: removedPaths.has(sourcePath) ? 'constantFolded' : compiled ? 'compiled' : 'preservedForFallback',
    })),
    folds: folding?.folds ?? [],
  });
}
