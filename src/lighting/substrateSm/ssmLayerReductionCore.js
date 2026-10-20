export const SSM_LAYER_REFERENCE_THICKNESS = 1;
export const SSM_LAYER_TRANSMITTANCE_FLOOR = 1e-4;
export const SSM_LAYER_COSINE_FLOOR = 0.05;

export function evaluateSubstrateSmInterfaceFresnel(specularF0, specularF90, cosine) {
  const grazingFactor = (1 - Math.max(0, Math.min(1, cosine))) ** 5;
  return specularF0.map((channel) => channel + (specularF90 - channel) * grazingFactor);
}

export function evaluateSubstrateSmLayerTransmission({
  coverage,
  thickness,
  transmittanceColor,
  specularF0,
  specularF90,
  lightCosine,
  viewCosine,
}) {
  const lightPath = thickness / Math.max(SSM_LAYER_COSINE_FLOOR, lightCosine);
  const viewPath = thickness / Math.max(SSM_LAYER_COSINE_FLOOR, viewCosine);
  const incomingFresnel = evaluateSubstrateSmInterfaceFresnel(specularF0, specularF90, lightCosine);
  const outgoingFresnel = evaluateSubstrateSmInterfaceFresnel(specularF0, specularF90, viewCosine);
  const extinctionCoefficient = transmittanceColor.map(
    (channel) => -Math.log(Math.max(SSM_LAYER_TRANSMITTANCE_FLOOR, channel)) / SSM_LAYER_REFERENCE_THICKNESS,
  );
  const baseTransmission = extinctionCoefficient.map((coefficient, channel) => {
    const absorption =
      coefficient === 0 ? 1 : Math.exp(-coefficient * lightPath) * Math.exp(-coefficient * viewPath);
    return (
      1 - coverage + coverage * absorption * (1 - incomingFresnel[channel]) * (1 - outgoingFresnel[channel])
    );
  });
  const emissionTransmission = extinctionCoefficient.map(
    (coefficient, channel) =>
      1 -
      coverage +
      coverage * (coefficient === 0 ? 1 : Math.exp(-coefficient * viewPath)) * (1 - outgoingFresnel[channel]),
  );
  return { baseTransmission, emissionTransmission, extinctionCoefficient };
}
