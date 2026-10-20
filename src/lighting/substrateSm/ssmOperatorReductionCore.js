import { evaluateSubstrateSmBsdf } from "./ssmBsdfCore.js";
import { createSubstrateSmOperatorPlan } from "./ssmOperatorPlanCore.js";
import { evaluateSubstrateSmOperatorResponse } from "./ssmOpticalResponseCore.js";
import { fitSubstrateSmSurface } from "./ssmSurfaceFitCore.js";
import {
  copySubstrateSmReductionValue,
  createSubstrateSmReductionLoss,
  createSubstrateSmReductionRefusal,
  findSubstrateSmReductionSurfaceProblem,
  freezeSubstrateSmReductionValue,
} from "./ssmReductionValidationCore.js";

export const SSM_OPERATOR_REDUCTION_VERSION = 1;

function finish(result) {
  const losses = result.losses.map((loss) =>
    loss.classification === "fitted" && loss.estimatedLoss === null && loss.measuredLoss === null
      ? {
          ...loss,
          classification: "unsupported",
          replacement: "Retain the previously working backend",
          reason: `${loss.reason}; this candidate was not validated`,
        }
      : loss,
  );
  return freezeSubstrateSmReductionValue({ ...result, losses });
}

function describeWholeTreeMeasurement(diagnostics) {
  if (!diagnostics.validation) return null;
  return {
    metric: "whole-tree-lite-reference-relative-cpu-response-error",
    energy: Math.max(
      diagnostics.training.maximumEnergyRelativeError,
      diagnostics.validation.maximumEnergyRelativeError,
    ),
    angular: Math.max(
      diagnostics.training.maximumAngularRelativeError,
      diagnostics.validation.maximumAngularRelativeError,
    ),
    specular: Math.max(
      diagnostics.training.maximumSpecularRelativeError,
      diagnostics.validation.maximumSpecularRelativeError,
    ),
    emission: Math.max(
      diagnostics.training.maximumEmissionRelativeError,
      diagnostics.validation.maximumEmissionRelativeError,
    ),
    highlight: Math.max(
      diagnostics.training.maximumHighlightRelativeError,
      diagnostics.validation.maximumHighlightRelativeError,
    ),
    sampleCount: diagnostics.validationSampleCount + diagnostics.trainingSampleCount,
  };
}

export function reduceSubstrateSmOperators(request = {}) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return finish({
      ok: false,
      surface: null,
      losses: [],
      refusals: [
        createSubstrateSmReductionRefusal(
          "SSM_REDUCTION_REQUEST",
          "root",
          "A reduction request object is required",
        ),
      ],
      diagnostics: null,
    });
  }
  const { root, resolveSlab, profile = "Lite" } = request;
  if (profile !== "Lite" && profile !== "Moderate") {
    return finish({
      ok: false,
      surface: null,
      losses: [],
      refusals: [
        createSubstrateSmReductionRefusal(
          "SSM_REDUCTION_PROFILE",
          "root",
          "An effective Lite or Moderate profile is required",
        ),
      ],
      diagnostics: null,
    });
  }
  let prepared;
  try {
    prepared = createSubstrateSmOperatorPlan({ root, resolveSlab, profile });
    if (!prepared.ok)
      return finish({
        ok: false,
        surface: null,
        losses: prepared.losses,
        refusals: prepared.refusals,
        diagnostics: null,
      });
    if (prepared.plan.kind === "slab") {
      return finish({
        ok: true,
        surface: copySubstrateSmReductionValue(prepared.plan.surface),
        losses: prepared.losses,
        refusals: [],
        diagnostics: {
          method: "exact-operator-identity",
          sourceNodeCount: prepared.nodeCount,
          sourcePaths: prepared.sourcePaths,
          reductionVersion: SSM_OPERATOR_REDUCTION_VERSION,
          gpuVerified: false,
        },
      });
    }
    const fitted = fitSubstrateSmSurface({
      initialSurface: prepared.plan.seed,
      roughnessCandidates: prepared.roughnessCandidates,
      evaluateTarget: (directions) =>
        evaluateSubstrateSmOperatorResponse(prepared.plan, directions, evaluateSubstrateSmBsdf),
      evaluateBsdf: evaluateSubstrateSmBsdf,
      containsLayer: prepared.containsLayer,
    });
    const diagnostics = {
      ...fitted.diagnostics,
      reductionVersion: SSM_OPERATOR_REDUCTION_VERSION,
      sourceNodeCount: prepared.nodeCount,
      sourcePaths: prepared.sourcePaths,
      gpuVerified: false,
    };
    const measuredLoss = describeWholeTreeMeasurement(diagnostics);
    const losses = prepared.losses.map((loss) =>
      loss.classification === "fitted" && measuredLoss
        ? {
            ...loss,
            measuredLoss,
            evidenceStatus: "measuredCpu",
            reason: `${loss.reason}; measurement covers the complete Lite target, not an independent per-node or full multilayer-transport error`,
          }
        : loss,
    );
    losses.push({
      ...createSubstrateSmReductionLoss(
        "root",
        "surfaceFit",
        fitted.ok ? "fitted" : "unsupported",
        fitted.ok
          ? "The complete response fits one base surface within the sampled CPU limits"
          : "The original response cannot be admitted as a bounded base recipe; the host must retain its previous backend",
      ),
      measuredLoss,
      evidenceStatus: measuredLoss ? "measuredCpu" : "unmeasured",
    });
    const outputProblem = fitted.surface ? findSubstrateSmReductionSurfaceProblem(fitted.surface) : null;
    const accepted = fitted.ok && outputProblem === null;
    if (outputProblem)
      losses.push(createSubstrateSmReductionLoss("root", "outputRange", "unsupported", outputProblem));
    const refusals = accepted
      ? []
      : [
          createSubstrateSmReductionRefusal(
            outputProblem ? "SSM_REDUCTION_OUTPUT_RANGE" : fitted.code,
            "root",
            outputProblem ??
              "Optical reduction failed its energy, parameter or response-error limit without clamping authored output",
          ),
        ];
    return finish({ ok: accepted, surface: accepted ? fitted.surface : null, losses, refusals, diagnostics });
  } catch (error) {
    return finish({
      ok: false,
      surface: null,
      losses: prepared?.losses ?? [],
      refusals: [
        createSubstrateSmReductionRefusal(
          "SSM_REDUCTION_EVALUATION",
          "root",
          error instanceof Error ? error.message : "Optical reduction failed",
        ),
      ],
      diagnostics: null,
    });
  }
}
