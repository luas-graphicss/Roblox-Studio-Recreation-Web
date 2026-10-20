import { SSM_CONTRACT_VERSION } from './ssmContract.js';
import { adaptSubstrateSmSource } from './ssmSourceAdapter.js';
import { copySubstrateSmImmutableData } from './ssmImmutableData.js';
import { validateSubstrateSmCompilationDomain, createSubstrateSmCompilationRefusal } from './ssmValidationCore.js';
import { foldSubstrateSmConstants } from './ssmConstantFoldingCore.js';
import { runSubstrateSmCompilerReductionStage } from './ssmCompilerReductionStage.js';
import { createSubstrateSmCompiledRecipe } from './ssmCompiledRecipeCore.js';
import { describeSubstrateSmCompilationCost } from './ssmCompilationCostCore.js';
import { createSubstrateSmCompilationAudit } from './ssmCompilationAuditCore.js';
import { createSubstrateSmLossEntry, createSubstrateSmLossReport } from './ssmLossReportCore.js';

function normalizeRefusals(refusals) {
  return (refusals ?? []).map(refusal => createSubstrateSmCompilationRefusal(
    typeof refusal?.code === 'string' ? refusal.code : 'compilationRefused',
    typeof (refusal?.sourcePath ?? refusal?.path) === 'string' ? refusal.sourcePath ?? refusal.path : 'root',
    typeof refusal?.reason === 'string' && refusal.reason.length > 0
      ? refusal.reason
      : 'The source or optical reduction stage refused compilation',
  ));
}

function refusalLoss(refusal) {
  return createSubstrateSmLossEntry({
    sourcePath: refusal.sourcePath,
    operation: refusal.code,
    replacement: 'preservedHostMaterial',
    reason: refusal.reason,
    classification: 'unsupported',
  });
}

function compilationResult(context, status, recipe = null) {
  const refusals = normalizeRefusals(context.refusals);
  const lossReport = createSubstrateSmLossReport([
    ...(context.folding?.losses ?? []),
    ...(context.reduction?.losses ?? []),
    ...refusals.map(refusalLoss),
  ]);
  return Object.freeze({
    ok: status === 'compiled',
    status,
    originalRequest: context.request,
    source: context.adaptation?.source ?? null,
    preservation: context.adaptation?.preservation ?? null,
    sourceConversions: copySubstrateSmImmutableData(context.adaptation?.conversions ?? []),
    recipe,
    refusals: copySubstrateSmImmutableData(refusals),
    lossReport,
    audit: createSubstrateSmCompilationAudit(context.domainValidation, context.folding, recipe !== null),
    costReport: recipe === null ? null : describeSubstrateSmCompilationCost(recipe),
    reductionDiagnostics: context.reduction?.diagnostics ?? null,
  });
}

export function compileSubstrateSmMaterial(request = {}, options = {}) {
  const context = { request, refusals: [] };
  try {
    context.adaptation = adaptSubstrateSmSource(request);
  } catch {
    context.refusals = [createSubstrateSmCompilationRefusal(
      'sourceAdapterFailure', 'root', 'Source adaptation failed; the original request remains available unchanged',
    )];
    return compilationResult(context, 'invalidSource');
  }
  if (!context.adaptation.ok) {
    context.refusals = context.adaptation.refusals;
    return compilationResult(context, 'invalidSource');
  }
  if (context.adaptation.source.contractVersion !== SSM_CONTRACT_VERSION) {
    context.refusals = [createSubstrateSmCompilationRefusal(
      'sourceContractMismatch', 'root', 'The source adapter and compiler contract versions do not match',
    )];
    return compilationResult(context, 'fallback');
  }
  context.domainValidation = validateSubstrateSmCompilationDomain(context.adaptation.source, options);
  if (!context.domainValidation.ok) {
    context.refusals = context.domainValidation.refusals;
    return compilationResult(context, 'fallback');
  }
  context.folding = foldSubstrateSmConstants(context.adaptation.source.resolvedTree);
  context.reduction = runSubstrateSmCompilerReductionStage(context.folding.tree, options, context.domainValidation.profile);
  if (!context.reduction.ok || context.reduction.refusals.length > 0) {
    context.refusals = context.reduction.refusals.length > 0
      ? context.reduction.refusals
      : [createSubstrateSmCompilationRefusal('opticalReductionRefused', 'root', 'The reduction stage did not accept the complete tree')];
    return compilationResult(context, 'fallback');
  }
  const compilation = createSubstrateSmCompiledRecipe(context.reduction.surface, context.domainValidation.profile);
  if (!compilation.ok) {
    context.refusals = compilation.refusals;
    return compilationResult(context, 'fallback');
  }
  const audit = createSubstrateSmCompilationAudit(context.domainValidation, context.folding, true);
  if (!audit.complete) {
    context.refusals = [createSubstrateSmCompilationRefusal(
      'incompleteSourceAccounting', 'root', 'Every validated source node must remain accounted for before a recipe is published',
    )];
    return compilationResult(context, 'fallback');
  }
  return compilationResult(context, 'compiled', compilation.recipe);
}
