import { MAX_BOUNCE_EMITTERS, MIN_EMITTER_LUMINANCE } from "./llGiLocalContract.js";
import { accumulateDirectIrradiance } from "./llGiInjectionCore.js";
import { voxelCenterOfKey, voxelKeyAt } from "./llGiVoxelGridCore.js";
import { clamp01, dotProduct, luminanceOfRgb, normalizeVector, scaleVector, subtractVectors } from "./llGiVectorCore.js";

export const EMITTER_REFUSAL = Object.freeze({
  DARK: "dark",
  OVER_BUDGET: "over-budget",
});

export const INVERSE_PI = 1 / Math.PI;

export const INFLUENCE_RADIUS_IN_DIAGONALS = 3;

export const SECOND_BOUNCE_GAIN = 0.5;
export const MIN_SQUARED_DISTANCE = 1e-8;


export function bounceRadianceOf(albedo, irradiance) {
  const surfaceAlbedo = albedo || [0, 0, 0];
  return [
    Math.max(Number(surfaceAlbedo[0]) || 0, 0) * Math.max(irradiance[0], 0) * INVERSE_PI,
    Math.max(Number(surfaceAlbedo[1]) || 0, 0) * Math.max(irradiance[1], 0) * INVERSE_PI,
    Math.max(Number(surfaceAlbedo[2]) || 0, 0) * Math.max(irradiance[2], 0) * INVERSE_PI,
  ];
}


export function formFactorWeight(options) {
  const input = options || {};
  const emitter = input.emitter;
  if (!emitter) return 0;
  const influenceRadius = Math.max(Number(emitter.influenceRadius) || 0, 0);
  const squaredRadius = influenceRadius * influenceRadius;
  if (!(squaredRadius > 0)) return 0;
  const toEmitter = subtractVectors(emitter.position, input.position);
  const squaredDistance = dotProduct(toEmitter, toEmitter);
  if (squaredDistance >= squaredRadius) return 0;
  const distance = Math.sqrt(Math.max(squaredDistance, MIN_SQUARED_DISTANCE));
  const directionToEmitter = scaleVector(toEmitter, 1 / distance);
  const receiverCosine = Math.max(dotProduct(input.normal, directionToEmitter), 0);
  if (!(receiverCosine > 0)) return 0;
  const emitterCosine = Math.max(-dotProduct(emitter.normal, directionToEmitter), 0);
  if (!(emitterCosine > 0)) return 0;
  const closing = clamp01(1 - squaredDistance / squaredRadius);
  const area = Math.max(Number(emitter.area) || 0, 0);
  return (receiverCosine * emitterCosine * closing * closing * area) / (squaredDistance + 1);
}


export function formFactorIrradiance(options) {
  const weight = formFactorWeight(options);
  if (!(weight > 0)) return [0, 0, 0];
  const radiance = (options.emitter && options.emitter.radiance) || [0, 0, 0];
  return [radiance[0] * weight, radiance[1] * weight, radiance[2] * weight];
}

function createCluster(key) {
  return {
    key: key,
    area: 0,
    weightedPosition: [0, 0, 0],
    weightedNormal: [0, 0, 0],
    flux: [0, 0, 0],
    samples: 0,
  };
}

function addSampleToCluster(cluster, surfel, radiance) {
  const area = Math.max(Number(surfel.area) || 0, 0);
  cluster.area += area;
  cluster.samples += 1;
  for (let axis = 0; axis !== 3; axis += 1) {
    cluster.weightedPosition[axis] += (Number(surfel.position[axis]) || 0) * area;
    cluster.weightedNormal[axis] += (Number(surfel.normal[axis]) || 0) * area;
    cluster.flux[axis] += Math.max(radiance[axis], 0) * area;
  }
}

function clusterToEmitter(grid, cluster, influenceRadius) {
  const area = cluster.area;
  const inverseArea = area > 0 ? 1 / area : 0;
  const averagePosition = scaleVector(cluster.weightedPosition, inverseArea);


  const normal = normalizeVector(cluster.weightedNormal, [0, 1, 0]);
  const radiance = scaleVector(cluster.flux, inverseArea);
  return {
    key: cluster.key,
    position: area > 0 ? averagePosition : voxelCenterOfKey(grid, cluster.key),
    normal: normal,
    radiance: radiance,
    area: area,
    influenceRadius: influenceRadius,
    samples: cluster.samples,
    power: luminanceOfRgb(radiance) * area,
  };
}

function compareByPower(left, right) {
  if (right.power !== left.power) return right.power - left.power;
  return String(left.key).localeCompare(String(right.key));
}


export const EMITTER_DIRECTION_TAGS = Object.freeze(["+x", "-x", "+y", "-y", "+z", "-z"]);


export function dominantDirectionTagOf(normal) {
  const vector = normal || [0, 0, 0];
  const x = Number(vector[0]) || 0;
  const y = Number(vector[1]) || 0;
  const z = Number(vector[2]) || 0;
  const absoluteX = Math.abs(x);
  const absoluteY = Math.abs(y);
  const absoluteZ = Math.abs(z);
  if (absoluteX >= absoluteY && absoluteX >= absoluteZ) return x >= 0 ? "+x" : "-x";
  if (absoluteY >= absoluteZ) return y >= 0 ? "+y" : "-y";
  return z >= 0 ? "+z" : "-z";
}


export function selectEmittersWithDirectionalCoverage(rankedEmitters, maxEmitters) {
  const ranked = Array.isArray(rankedEmitters) ? rankedEmitters : [];
  const budget = Math.max(Math.floor(Number(maxEmitters) || 0), 0);
  if (budget === 0 || ranked.length === 0) return { chosen: [], refused: ranked.slice() };

  const queueByDirection = new Map();
  for (let index = 0; index !== ranked.length; index += 1) {
    const tag = dominantDirectionTagOf(ranked[index].normal);
    let queue = queueByDirection.get(tag);
    if (!queue) {
      queue = [];
      queueByDirection.set(tag, queue);
    }
    queue.push(ranked[index]);
  }

  const directions = EMITTER_DIRECTION_TAGS.filter((tag) => queueByDirection.has(tag)).sort((left, right) => {
    const leftPower = queueByDirection.get(left)[0].power;
    const rightPower = queueByDirection.get(right)[0].power;
    if (rightPower !== leftPower) return rightPower - leftPower;
    return left.localeCompare(right);
  });

  const chosen = [];
  const takenKeys = new Set();
  let tookOneInThisRound = true;
  while (chosen.length < budget && tookOneInThisRound) {
    tookOneInThisRound = false;
    for (let index = 0; index !== directions.length && chosen.length < budget; index += 1) {
      const queue = queueByDirection.get(directions[index]);
      const next = queue.shift();
      if (!next) continue;
      chosen.push(next);
      takenKeys.add(next.key);
      tookOneInThisRound = true;
    }
  }
  chosen.sort(compareByPower);

  return { chosen: chosen, refused: ranked.filter((emitter) => !takenKeys.has(emitter.key)) };
}












export function buildBounceEmitters(options) {
  const input = options || {};
  const grid = input.grid;
  const surfels = Array.isArray(input.surfels) ? input.surfels : [];
  const injectedLights = Array.isArray(input.injectedLights) ? input.injectedLights : [];
  const requestedEmitters = Number(input.maxEmitters);
  const maxEmitters = Number.isFinite(requestedEmitters)
    ? Math.min(Math.max(Math.floor(requestedEmitters), 0), MAX_BOUNCE_EMITTERS)
    : MAX_BOUNCE_EMITTERS;
  const bounces = Number.isFinite(Number(input.bounces)) ? Math.max(Math.floor(Number(input.bounces)), 0) : 1;
  const emptyStats = {
    surfels: surfels.length,
    litSamples: 0,
    clusters: 0,
    emitters: 0,
    bounces: bounces,
    firstBounceFlux: 0,
    secondBounceFlux: 0,
    influenceRadius: 0,
  };
  if (!grid || maxEmitters === 0 || bounces === 0 || surfels.length === 0 || injectedLights.length === 0) {
    return { emitters: [], refused: [], stats: emptyStats };
  }

  const influenceRadius = grid.cellDiagonal * INFLUENCE_RADIUS_IN_DIAGONALS;


  const clusters = new Map();
  const litSamples = [];
  let firstBounceFlux = 0;
  for (let index = 0; index !== surfels.length; index += 1) {
    const surfel = surfels[index];
    const irradiance = accumulateDirectIrradiance({
      injectedLights: injectedLights,
      position: surfel.position,
      normal: surfel.normal,
      falloffBlend: input.falloffBlend,
      coneBlend: input.coneBlend,
    });
    const radiance = bounceRadianceOf(surfel.albedo, irradiance);
    const luminance = luminanceOfRgb(radiance);
    if (!(luminance > 0)) continue;
    const key = voxelKeyAt(grid, surfel.position);
    let cluster = clusters.get(key);
    if (!cluster) {
      cluster = createCluster(key);
      clusters.set(key, cluster);
    }
    addSampleToCluster(cluster, surfel, radiance);
    litSamples.push({ surfel: surfel, key: key });
    firstBounceFlux += luminance * Math.max(Number(surfel.area) || 0, 0);
  }


  const ranked = [];
  const refused = [];
  clusters.forEach((cluster) => {
    const emitter = clusterToEmitter(grid, cluster, influenceRadius);
    if (!(luminanceOfRgb(emitter.radiance) > MIN_EMITTER_LUMINANCE)) {
      refused.push({ key: emitter.key, reason: EMITTER_REFUSAL.DARK, power: emitter.power });
      return;
    }
    ranked.push(emitter);
  });
  ranked.sort(compareByPower);

  const budgetSelection = selectEmittersWithDirectionalCoverage(ranked, maxEmitters);
  const emitters = budgetSelection.chosen;
  for (let index = 0; index !== budgetSelection.refused.length; index += 1) {
    const rejected = budgetSelection.refused[index];
    refused.push({ key: rejected.key, reason: EMITTER_REFUSAL.OVER_BUDGET, power: rejected.power });
  }


  let secondBounceFlux = 0;
  if (bounces >= 2 && emitters.length > 0) {
    const extraFlux = new Map();
    for (let index = 0; index !== litSamples.length; index += 1) {
      const surfel = litSamples[index].surfel;
      const ownKey = litSamples[index].key;
      const irradiance = [0, 0, 0];
      for (let emitterIndex = 0; emitterIndex !== emitters.length; emitterIndex += 1) {
        const emitter = emitters[emitterIndex];

        if (emitter.key === ownKey) continue;
        const contribution = formFactorIrradiance({ emitter: emitter, position: surfel.position, normal: surfel.normal });
        irradiance[0] += contribution[0];
        irradiance[1] += contribution[1];
        irradiance[2] += contribution[2];
      }
      const radiance = scaleVector(bounceRadianceOf(surfel.albedo, irradiance), SECOND_BOUNCE_GAIN);
      const luminance = luminanceOfRgb(radiance);
      if (!(luminance > 0)) continue;
      const area = Math.max(Number(surfel.area) || 0, 0);
      let accumulated = extraFlux.get(ownKey);
      if (!accumulated) {
        accumulated = [0, 0, 0];
        extraFlux.set(ownKey, accumulated);
      }
      accumulated[0] += radiance[0] * area;
      accumulated[1] += radiance[1] * area;
      accumulated[2] += radiance[2] * area;
      secondBounceFlux += luminance * area;
    }
    for (let index = 0; index !== emitters.length; index += 1) {
      const emitter = emitters[index];
      const accumulated = extraFlux.get(emitter.key);
      if (!accumulated || !(emitter.area > 0)) continue;
      emitter.radiance = [
        emitter.radiance[0] + accumulated[0] / emitter.area,
        emitter.radiance[1] + accumulated[1] / emitter.area,
        emitter.radiance[2] + accumulated[2] / emitter.area,
      ];
      emitter.power = luminanceOfRgb(emitter.radiance) * emitter.area;
    }
  }

  return {
    emitters: emitters,
    refused: refused,
    stats: {
      surfels: surfels.length,
      litSamples: litSamples.length,
      clusters: clusters.size,
      emitters: emitters.length,
      bounces: bounces,
      firstBounceFlux: firstBounceFlux,
      secondBounceFlux: secondBounceFlux,
      influenceRadius: influenceRadius,
    },
  };
}


export function gatherIndirectIrradiance(emitters, position, normal) {
  const list = Array.isArray(emitters) ? emitters : [];
  const total = [0, 0, 0];
  for (let index = 0; index !== list.length; index += 1) {
    const contribution = formFactorIrradiance({ emitter: list[index], position: position, normal: normal });
    total[0] += contribution[0];
    total[1] += contribution[1];
    total[2] += contribution[2];
  }
  return total;
}
