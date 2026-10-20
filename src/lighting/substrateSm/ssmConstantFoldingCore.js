import { copySubstrateSmImmutableData } from './ssmImmutableData.js';
import { createSubstrateSmLossEntry } from './ssmLossReportCore.js';

function collectSourcePaths(node, paths = []) {
  paths.push(node.path);
  for (const child of node.children ?? []) collectSourcePaths(child, paths);
  return paths;
}

function selectConstantOperand(node) {
  if (node.operator === 'weight' && node.parameters.weight === 1) {
    return { index: 0, reason: 'A unit weight preserves the entire operand response' };
  }
  if (node.operator === 'horizontalMixing') {
    if (node.parameters.weight === 0) {
      return { index: 0, reason: 'A zero mixing weight selects the first operand exactly' };
    }
    if (node.parameters.weight === 1) {
      return { index: 1, reason: 'A unit mixing weight selects the second operand exactly' };
    }
  }
  if (node.operator === 'verticalLayering' && node.parameters.coverage === 0) {
    return { index: 1, reason: 'Zero layer coverage preserves the bottom operand exactly' };
  }
  return null;
}

export function foldSubstrateSmConstants(resolvedTree) {
  const losses = [];
  const folds = [];

  function foldNode(node) {
    if (node.type !== 'operator') return node;
    const selection = selectConstantOperand(node);
    if (selection) {
      const selectedChild = node.children[selection.index];
      const selectedPaths = new Set(collectSourcePaths(selectedChild));
      folds.push({
        sourcePath: node.path,
        selectedSourcePath: selectedChild.path,
        removedSourcePaths: collectSourcePaths(node).filter(path => !selectedPaths.has(path)),
      });
      losses.push(createSubstrateSmLossEntry({
        sourcePath: node.path,
        operation: node.operator,
        replacement: selectedChild.path,
        reason: selection.reason,
      }));
      return foldNode(selectedChild);
    }
    return { ...node, children: node.children.map(foldNode) };
  }

  const tree = foldNode(resolvedTree);
  const sourcePaths = collectSourcePaths(resolvedTree);
  const retainedSourcePaths = collectSourcePaths(tree);
  const retainedPaths = new Set(retainedSourcePaths);
  return copySubstrateSmImmutableData({
    tree,
    losses,
    folds,
    sourceNodeCount: sourcePaths.length,
    retainedSourcePaths,
    removedSourcePaths: sourcePaths.filter(path => !retainedPaths.has(path)),
  });
}
