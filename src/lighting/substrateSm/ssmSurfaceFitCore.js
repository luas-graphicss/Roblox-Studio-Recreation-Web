import { createSubstrateSmFitSamples, SSM_FIT_VIEW_COSINES } from "./ssmFitSamplingCore.js";
import { copySubstrateSmReductionValue, isSubstrateSmFiniteColor } from "./ssmReductionValidationCore.js";

export const SSM_SURFACE_FIT_LIMITS = Object.freeze({
  maximumDirectionalAlbedo: 1.03,
  maximumEnergyRelativeError: 0.05,
  maximumAngularRelativeError: 0.15,
  maximumSpecularRelativeError: 0.15,
  maximumEmissionRelativeError: 0.05,
  minimumRelativeDenominator: 1e-7,
});

function safeRelative(numerator, denominator) {
  return numerator / Math.max(SSM_SURFACE_FIT_LIMITS.minimumRelativeDenominator, denominator);
}

function copyResponse(response) {
  const result = {};
  for (const name of ["diffuse", "specular", "total", "emission"]) {
    const channels = response?.[name];
    if (!isSubstrateSmFiniteColor(channels, Number.MAX_VALUE))
      throw new Error(`The optical evaluator returned invalid ${name} channels`);
    result[name] = [...channels];
  }
  return result;
}

function collectTargets(samples, evaluateTarget) {
  return samples.map((sample) => ({ ...sample, target: copyResponse(evaluateTarget(sample)) }));
}

function energyByView(samples, responseFor) {
  const energy = SSM_FIT_VIEW_COSINES.map(() => [0, 0, 0]);
  for (const sample of samples) {
    if (sample.integrationWeight === 0) continue;
    const response = responseFor(sample);
    for (let channel = 0; channel < 3; channel += 1)
      energy[sample.viewIndex][channel] += response.total[channel] * sample.integrationWeight;
  }
  return energy;
}

function fitDiffuseReflectance(samples, parameters, evaluateBsdf) {
  const unitParameters = { ...parameters, diffuseReflectance: [1, 1, 1] };
  const numerator = [0, 0, 0];
  const denominator = [0, 0, 0];
  for (const sample of samples) {
    const basis = evaluateBsdf({ surface: unitParameters, ...sample }).diffuse;
    if (!isSubstrateSmFiniteColor(basis, Number.MAX_VALUE))
      throw new Error("The BSDF returned an invalid diffuse basis");
    for (let channel = 0; channel < 3; channel += 1) {
      numerator[channel] += sample.fitWeight * basis[channel] * sample.target.diffuse[channel];
      denominator[channel] += sample.fitWeight * basis[channel] * basis[channel];
    }
  }
  const unconstrained = numerator.map((value, channel) =>
    denominator[channel] > 0 ? value / denominator[channel] : 0,
  );
  return { unconstrained, bounded: unconstrained.map((value) => Math.max(0, Math.min(1, value))) };
}

function evaluateCandidate(parameters, sample, evaluateBsdf) {
  const response = evaluateBsdf({ surface: parameters, ...sample });
  for (const name of ["diffuse", "specular", "total"]) {
    if (!isSubstrateSmFiniteColor(response?.[name], Number.MAX_VALUE))
      throw new Error(`The BSDF returned an invalid candidate ${name}`);
  }
  return response;
}

function candidateScore(samples, parameters, evaluateBsdf) {
  let error = 0;
  let denominator = 0;
  for (const sample of samples) {
    const response = evaluateCandidate(parameters, sample, evaluateBsdf);
    for (let channel = 0; channel < 3; channel += 1) {
      error += Math.abs(response.total[channel] - sample.target.total[channel]) * sample.fitWeight;
      error += Math.abs(response.specular[channel] - sample.target.specular[channel]) * sample.fitWeight;
      denominator += (sample.target.total[channel] + sample.target.specular[channel]) * sample.fitWeight;
    }
  }
  return safeRelative(error, denominator);
}

function fitEmission(samples, parameters) {
  const total = [0, 0, 0];
  let weight = 0;
  for (const sample of samples) {
    if (sample.probe) continue;
    weight += sample.fitWeight;
    for (let channel = 0; channel < 3; channel += 1)
      total[channel] += sample.target.emission[channel] * sample.fitWeight;
  }
  return weight > 0 ? total.map((value) => value / weight) : [...parameters.emissiveRadiance];
}

function describeCandidate(samples, parameters, evaluateBsdf) {
  const targetEnergy = energyByView(samples, (sample) => sample.target);
  const candidateEnergy = SSM_FIT_VIEW_COSINES.map(() => [0, 0, 0]);
  const totalError = SSM_FIT_VIEW_COSINES.map(() => [0, 0, 0]);
  const specularError = SSM_FIT_VIEW_COSINES.map(() => [0, 0, 0]);
  const specularEnergy = SSM_FIT_VIEW_COSINES.map(() => [0, 0, 0]);
  let maximumEmissionRelativeError = 0;
  let maximumHighlightRelativeError = 0;
  for (const sample of samples) {
    const response = evaluateCandidate(parameters, sample, evaluateBsdf);
    for (let channel = 0; channel < 3; channel += 1) {
      const viewIndex = sample.viewIndex;
      const weight = sample.integrationWeight;
      candidateEnergy[viewIndex][channel] += response.total[channel] * weight;
      totalError[viewIndex][channel] +=
        Math.abs(response.total[channel] - sample.target.total[channel]) * weight;
      specularError[viewIndex][channel] +=
        Math.abs(response.specular[channel] - sample.target.specular[channel]) * weight;
      specularEnergy[viewIndex][channel] += sample.target.specular[channel] * weight;
      maximumEmissionRelativeError = Math.max(
        maximumEmissionRelativeError,
        safeRelative(
          Math.abs(parameters.emissiveRadiance[channel] - sample.target.emission[channel]),
          sample.target.emission[channel],
        ),
      );
      if (sample.probe)
        maximumHighlightRelativeError = Math.max(
          maximumHighlightRelativeError,
          safeRelative(
            Math.abs(response.specular[channel] - sample.target.specular[channel]),
            sample.target.specular[channel],
          ),
        );
    }
  }
  let maximumEnergyRelativeError = 0;
  let maximumAngularRelativeError = 0;
  let maximumSpecularRelativeError = 0;
  for (let viewIndex = 0; viewIndex < targetEnergy.length; viewIndex += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      maximumEnergyRelativeError = Math.max(
        maximumEnergyRelativeError,
        safeRelative(
          Math.abs(candidateEnergy[viewIndex][channel] - targetEnergy[viewIndex][channel]),
          targetEnergy[viewIndex][channel],
        ),
      );
      maximumAngularRelativeError = Math.max(
        maximumAngularRelativeError,
        safeRelative(totalError[viewIndex][channel], targetEnergy[viewIndex][channel]),
      );
      maximumSpecularRelativeError = Math.max(
        maximumSpecularRelativeError,
        safeRelative(specularError[viewIndex][channel], specularEnergy[viewIndex][channel]),
      );
    }
  }
  return {
    targetEnergy,
    candidateEnergy,
    maximumEnergyRelativeError,
    maximumAngularRelativeError,
    maximumSpecularRelativeError,
    maximumEmissionRelativeError,
    maximumHighlightRelativeError,
    maximumTargetDirectionalAlbedo: Math.max(...targetEnergy.flat()),
    maximumCandidateDirectionalAlbedo: Math.max(...candidateEnergy.flat()),
  };
}

function isAdmitted(metrics) {
  return (
    metrics.maximumTargetDirectionalAlbedo <= SSM_SURFACE_FIT_LIMITS.maximumDirectionalAlbedo &&
    metrics.maximumCandidateDirectionalAlbedo <= SSM_SURFACE_FIT_LIMITS.maximumDirectionalAlbedo &&
    metrics.maximumEnergyRelativeError <= SSM_SURFACE_FIT_LIMITS.maximumEnergyRelativeError &&
    metrics.maximumAngularRelativeError <= SSM_SURFACE_FIT_LIMITS.maximumAngularRelativeError &&
    metrics.maximumSpecularRelativeError <= SSM_SURFACE_FIT_LIMITS.maximumSpecularRelativeError &&
    metrics.maximumEmissionRelativeError <= SSM_SURFACE_FIT_LIMITS.maximumEmissionRelativeError
  );
}

export function fitSubstrateSmSurface({
  initialSurface,
  roughnessCandidates,
  evaluateTarget,
  evaluateBsdf,
  containsLayer = false,
}) {
  const training = collectTargets(createSubstrateSmFitSamples(roughnessCandidates), evaluateTarget);
  const validation = collectTargets(createSubstrateSmFitSamples(roughnessCandidates, true), evaluateTarget);
  const parameters = copySubstrateSmReductionValue(initialSurface.parameters);
  const allTargets = [
    ...energyByView(training, (sample) => sample.target),
    ...energyByView(validation, (sample) => sample.target),
  ];
  const maximumTargetDirectionalAlbedo = Math.max(...allTargets.flat());
  if (maximumTargetDirectionalAlbedo > SSM_SURFACE_FIT_LIMITS.maximumDirectionalAlbedo) {
    return {
      ok: false,
      surface: null,
      code: "SSM_REDUCTION_NONCONSERVATIVE",
      diagnostics: {
        maximumTargetDirectionalAlbedo,
        targetEnergy: allTargets,
        limits: SSM_SURFACE_FIT_LIMITS,
      },
    };
  }
  if (parameters.specularF90 > 1 || parameters.specularF0.some((value) => value > 1)) {
    return {
      ok: false,
      surface: null,
      code: "SSM_REDUCTION_FRESNEL_RANGE",
      diagnostics: {
        maximumTargetDirectionalAlbedo,
        requestedSpecularF0: parameters.specularF0,
        requestedSpecularF90: parameters.specularF90,
      },
    };
  }
  const diffuseFit = fitDiffuseReflectance(training, parameters, evaluateBsdf);
  parameters.diffuseReflectance = diffuseFit.bounded;
  if (containsLayer) parameters.emissiveRadiance = fitEmission(training, parameters);
  const candidates = [
    ...new Set([
      parameters.perceptualRoughness,
      ...roughnessCandidates,
      ...Array.from({ length: 17 }, (_, index) => 0.02 * 50 ** (index / 16)),
    ]),
  ]
    .filter((value) => value >= 0.02 && value <= 1)
    .sort((first, second) => first - second);
  let bestRoughness = parameters.perceptualRoughness;
  let bestScore = Number.POSITIVE_INFINITY;
  let candidateEvaluations = 0;
  function consider(roughness) {
    const candidate = { ...parameters, perceptualRoughness: roughness };
    const score = candidateScore(training, candidate, evaluateBsdf);
    candidateEvaluations += 1;
    if (score < bestScore) {
      bestRoughness = roughness;
      bestScore = score;
    }
  }
  consider(parameters.perceptualRoughness);
  for (const roughness of candidates) consider(roughness);
  for (let step = 0; step < 6; step += 1) {
    const logarithmicStep = Math.log(50) / (32 * 2 ** step);
    const previousBest = bestRoughness;
    consider(Math.max(0.02, previousBest * Math.exp(-logarithmicStep)));
    consider(Math.min(1, previousBest * Math.exp(logarithmicStep)));
  }
  parameters.perceptualRoughness = bestRoughness;
  parameters.reflectionRoughness = bestRoughness;
  const trainingMetrics = describeCandidate(training, parameters, evaluateBsdf);
  const validationMetrics = describeCandidate(validation, parameters, evaluateBsdf);
  const accepted = isAdmitted(trainingMetrics) && isAdmitted(validationMetrics);
  return {
    ok: accepted,
    surface: accepted ? { family: "base", parameters } : null,
    code: accepted ? null : "SSM_REDUCTION_FIT_LOSS",
    diagnostics: {
      method: "fixed-fresnel-bounded-roughness-search-with-coupled-diffuse-fit-v1",
      scope: "sampled-cpu-response-not-gpu-or-full-domain-certification",
      candidateEvaluations,
      trainingSampleCount: training.length,
      validationSampleCount: validation.length,
      bestScore,
      diffuseFit,
      initialRoughness: initialSurface.parameters.perceptualRoughness,
      fittedRoughness: bestRoughness,
      training: trainingMetrics,
      validation: validationMetrics,
      limits: SSM_SURFACE_FIT_LIMITS,
    },
  };
}
