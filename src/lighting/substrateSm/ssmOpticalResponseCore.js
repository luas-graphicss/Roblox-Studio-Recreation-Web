import { evaluateSubstrateSmLayerTransmission } from "./ssmLayerReductionCore.js";

const SSM_RESPONSE_CHANNELS = [0, 1, 2];

function combineResponses(first, second, firstWeight, secondWeight) {
  return {
    diffuse: SSM_RESPONSE_CHANNELS.map(
      (channel) => first.diffuse[channel] * firstWeight + second.diffuse[channel] * secondWeight,
    ),
    specular: SSM_RESPONSE_CHANNELS.map(
      (channel) => first.specular[channel] * firstWeight + second.specular[channel] * secondWeight,
    ),
    total: SSM_RESPONSE_CHANNELS.map(
      (channel) => first.total[channel] * firstWeight + second.total[channel] * secondWeight,
    ),
    emission: SSM_RESPONSE_CHANNELS.map(
      (channel) => first.emission[channel] * firstWeight + second.emission[channel] * secondWeight,
    ),
  };
}

function scaleResponse(response, weight) {
  return Object.fromEntries(
    Object.entries(response).map(([name, channels]) => [name, channels.map((channel) => channel * weight)]),
  );
}

export function evaluateSubstrateSmOperatorResponse(plan, directions, evaluateBsdf) {
  if (plan.kind === "slab") {
    const response = evaluateBsdf({ surface: plan.surface.parameters, ...directions });
    return {
      diffuse: [...response.diffuse],
      specular: [...response.specular],
      total: [...response.total],
      emission: [...plan.surface.parameters.emissiveRadiance],
    };
  }
  const first = evaluateSubstrateSmOperatorResponse(plan.children[0], directions, evaluateBsdf);
  if (plan.kind === "weight") return scaleResponse(first, plan.parameters.weight);
  const second = evaluateSubstrateSmOperatorResponse(plan.children[1], directions, evaluateBsdf);
  if (plan.kind === "add") return combineResponses(first, second, 1, 1);
  if (plan.kind === "horizontalMixing")
    return combineResponses(first, second, 1 - plan.parameters.weight, plan.parameters.weight);
  const topSurface = plan.children[0].seed.parameters;
  const dotNormal = (direction) =>
    directions.normal.reduce((sum, component, index) => sum + component * direction[index], 0);
  const transmission = evaluateSubstrateSmLayerTransmission({
    ...plan.parameters,
    specularF0: topSurface.specularF0,
    specularF90: topSurface.specularF90,
    lightCosine: dotNormal(directions.lightDirection),
    viewCosine: dotNormal(directions.viewDirection),
  });
  const response = {};
  for (const name of ["diffuse", "specular", "total"]) {
    response[name] = SSM_RESPONSE_CHANNELS.map(
      (channel) =>
        first[name][channel] * plan.parameters.coverage +
        second[name][channel] * transmission.baseTransmission[channel],
    );
  }
  response.emission = SSM_RESPONSE_CHANNELS.map(
    (channel) =>
      first.emission[channel] * plan.parameters.coverage +
      second.emission[channel] * transmission.emissionTransmission[channel],
  );
  return response;
}
