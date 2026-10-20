import { compileSubstrateSmSlab } from './ssmSlabCompilationCore.js';
import { createSubstrateSmLossReport } from './ssmLossReportCore.js';
import { createSubstrateSmCompilationRefusal } from './ssmValidationCore.js';
import { copySubstrateSmImmutableData } from './ssmImmutableData.js';

function collectOperators(root) {
  const operators = [];
  function visit(node) {
    if (node.type === 'operator') operators.push(node);
    for (const child of node.children ?? []) visit(child);
  }
  visit(root);
  return operators;
}

function refusedStage(code, reason) {
  return {
    ok: false,
    surface: null,
    losses: [],
    refusals: [createSubstrateSmCompilationRefusal(code, 'root', reason)],
  };
}

function validateReductionEvidence(root, reduction) {
  const report = createSubstrateSmLossReport(reduction.losses);
  const refusals = [...reduction.refusals];
  if (reduction.ok) {
    for (const node of collectOperators(root)) {
      if (!report.entries.some(entry => entry.sourcePath === node.path && entry.operation === node.operator)) {
        refusals.push(createSubstrateSmCompilationRefusal(
          'operatorEvidenceMissing', node.path,
          `The ${node.operator} operator cannot disappear without an explicit loss entry`,
        ));
      }
    }
    if (report.requiresFallback) {
      refusals.push(createSubstrateSmCompilationRefusal(
        'reductionLossRequiresFallback', root.path,
        'An unsupported or over-budget reduction cannot publish a partial recipe',
      ));
    }
    if (report.entries.some(entry => (entry.classification === 'fitted' || entry.classification === 'baked') && entry.measuredLoss === null)) {
      refusals.push(createSubstrateSmCompilationRefusal(
        'reductionEvidenceMissing', root.path,
        'An approximate reduction requires explicit measured reference evidence',
      ));
    }
  }
  return copySubstrateSmImmutableData({
    ok: reduction.ok === true && refusals.length === 0,
    surface: reduction.ok === true && refusals.length === 0 ? reduction.surface : null,
    losses: report.entries,
    refusals,
    diagnostics: reduction.diagnostics ?? null,
  });
}

export function runSubstrateSmCompilerReductionStage(root, options, profile) {
  if (root.type === 'bsdf') return compileSubstrateSmSlab(root);
  if (typeof options.reduceOperators !== 'function') {
    return copySubstrateSmImmutableData({
      ok: false,
      surface: null,
      losses: [],
      refusals: collectOperators(root).map(node => createSubstrateSmCompilationRefusal(
        'operatorReductionRequired', node.path,
        `The ${node.operator} operator requires an explicit optical reduction stage`,
      )),
    });
  }
  try {
    const reduction = options.reduceOperators({ root, resolveSlab: compileSubstrateSmSlab, profile });
    if (!reduction || typeof reduction.then === 'function' || typeof reduction.ok !== 'boolean' || !Array.isArray(reduction.losses) || !Array.isArray(reduction.refusals)) {
      return refusedStage('invalidReductionResult', 'The optical reduction stage must return a synchronous result with explicit status, losses and refusals');
    }
    return validateReductionEvidence(root, reduction);
  } catch {
    return refusedStage('opticalReductionFailure', 'Optical reduction or its evidence was invalid; no partial recipe was published');
  }
}
