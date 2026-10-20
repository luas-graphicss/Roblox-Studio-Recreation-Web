export const SSM_FIT_VIEW_COSINES = Object.freeze([1, 0.7, 0.35, 0.1]);
export const SSM_FIT_SAMPLES_PER_DISTRIBUTION = 96;

function radicalInverse(index) {
  let value = 0;
  let place = 0.5;
  while (index > 0) {
    value += (index % 2) * place;
    index = Math.floor(index / 2);
    place *= 0.5;
  }
  return value;
}

function directionFromCosine(cosine, azimuth) {
  const sine = Math.sqrt(Math.max(0, 1 - cosine * cosine));
  return [sine * Math.cos(azimuth), sine * Math.sin(azimuth), cosine];
}

function halfVectorFor(roughness, unit, azimuth) {
  const alphaSquared = roughness ** 4;
  const cosine = Math.sqrt((1 - unit) / (1 + (alphaSquared - 1) * unit));
  return directionFromCosine(cosine, azimuth);
}

function reflectedDirection(viewDirection, halfVector) {
  const viewHalf = viewDirection.reduce((sum, value, index) => sum + value * halfVector[index], 0);
  if (viewHalf <= 0) return null;
  return halfVector.map((value, index) => 2 * viewHalf * value - viewDirection[index]);
}

function mixturePdf(viewDirection, lightDirection, roughnesses) {
  const halfLength = Math.hypot(...viewDirection.map((value, index) => value + lightDirection[index]));
  const halfVector = viewDirection.map((value, index) => (value + lightDirection[index]) / halfLength);
  const viewHalf = viewDirection.reduce((sum, value, index) => sum + value * halfVector[index], 0);
  let density = lightDirection[2] / Math.PI;
  for (const roughness of roughnesses) {
    const alphaSquared = roughness ** 4;
    const denominator = halfVector[0] ** 2 + halfVector[1] ** 2 + alphaSquared * halfVector[2] ** 2;
    const distribution = alphaSquared / (Math.PI * denominator * denominator);
    density += (distribution * halfVector[2]) / (4 * viewHalf);
  }
  return density / (roughnesses.length + 1);
}

export function createSubstrateSmFitSamples(roughnessCandidates, validation = false) {
  const roughnesses = [...new Set([0.02, 0.2, 0.6, 1, ...roughnessCandidates])].sort(
    (first, second) => first - second,
  );
  const sampleCount = SSM_FIT_SAMPLES_PER_DISTRIBUTION;
  const views = SSM_FIT_VIEW_COSINES;
  const samples = [];
  for (let viewIndex = 0; viewIndex < views.length; viewIndex += 1) {
    const viewDirection = directionFromCosine(views[viewIndex], 0);
    for (let distributionIndex = 0; distributionIndex <= roughnesses.length; distributionIndex += 1) {
      for (let index = 0; index < sampleCount; index += 1) {
        const unit = (index + (validation ? 0.75 : 0.25)) / sampleCount;
        const azimuth = 2 * Math.PI * ((radicalInverse(index) + (validation ? 0.3819660112501051 : 0)) % 1);
        const lightDirection =
          distributionIndex === 0
            ? directionFromCosine(Math.sqrt(1 - unit), azimuth)
            : reflectedDirection(
                viewDirection,
                halfVectorFor(roughnesses[distributionIndex - 1], unit, azimuth),
              );
        if (!lightDirection || lightDirection[2] <= 0) continue;
        const density = mixturePdf(viewDirection, lightDirection, roughnesses);
        const integrationWeight = lightDirection[2] / (density * sampleCount * (roughnesses.length + 1));
        samples.push({
          normal: [0, 0, 1],
          viewDirection,
          lightDirection,
          viewIndex,
          integrationWeight,
          fitWeight: integrationWeight / views.length,
          probe: false,
        });
      }
    }
    for (const roughness of roughnesses) {
      for (const spread of [0, 0.5, 1, 2]) {
        const polarAngle = Math.atan(roughness ** 2 * spread);
        const halfVector = [Math.sin(polarAngle), 0, Math.cos(polarAngle)];
        const lightDirection = reflectedDirection(viewDirection, halfVector);
        if (!lightDirection || lightDirection[2] <= 0) continue;
        samples.push({
          normal: [0, 0, 1],
          viewDirection,
          lightDirection,
          viewIndex,
          integrationWeight: 0,
          fitWeight: 1e-4 / views.length,
          probe: true,
        });
      }
    }
  }
  return samples;
}
