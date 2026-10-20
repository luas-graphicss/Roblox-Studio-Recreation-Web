export const SPHERICAL_HARMONIC_BAND_COUNT = 2;
export const SPHERICAL_HARMONIC_COEFFICIENTS_PER_CHANNEL = 4;
export const SPHERICAL_HARMONIC_COLOUR_CHANNEL_COUNT = 3;
export const SPHERICAL_HARMONIC_FLOATS_PER_VOXEL =
  SPHERICAL_HARMONIC_COEFFICIENTS_PER_CHANNEL * SPHERICAL_HARMONIC_COLOUR_CHANNEL_COUNT;


export const SPHERICAL_HARMONIC_BASIS_CONSTANT = Object.freeze({
  band0: 0.28209479177387814,
  band1: 0.4886025119029199,
});


const CLAMPED_COSINE_CONVOLUTION = Object.freeze({
  band0: Math.PI,
  band1: (2 * Math.PI) / 3,
});

const REC_709_LUMINANCE = Object.freeze({ red: 0.2126, green: 0.7152, blue: 0.0722 });
const MINIMUM_DIRECTION_LENGTH = 1e-8;
const MINIMUM_LUMINANCE_FOR_DIVISION = 1e-8;
const DEFAULT_DIRECTION = Object.freeze({ x: 0, y: 0, z: 1 });

function finiteNumberOr(value, fallback) {
  const candidate = Number(value);
  return Number.isFinite(candidate) ? candidate : fallback;
}

function nonNegativeNumberOr(value, fallback) {
  return Math.max(0, finiteNumberOr(value, fallback));
}


export function radianceOf(value) {
  const radiance = value || {};
  return {
    red: nonNegativeNumberOr(radiance.red === undefined ? radiance.r : radiance.red, 0),
    green: nonNegativeNumberOr(radiance.green === undefined ? radiance.g : radiance.green, 0),
    blue: nonNegativeNumberOr(radiance.blue === undefined ? radiance.b : radiance.blue, 0),
  };
}

export function normalizedDirectionOf(direction) {
  const vector = direction || DEFAULT_DIRECTION;
  const x = finiteNumberOr(vector.x, 0);
  const y = finiteNumberOr(vector.y, 0);
  const z = finiteNumberOr(vector.z, 0);
  const length = Math.sqrt(x * x + y * y + z * z);
  if (!(length > MINIMUM_DIRECTION_LENGTH)) return DEFAULT_DIRECTION;
  return { x: x / length, y: y / length, z: z / length };
}


export function sphericalHarmonicBasisOf(direction) {
  const unit = normalizedDirectionOf(direction);
  return [
    SPHERICAL_HARMONIC_BASIS_CONSTANT.band0,
    -SPHERICAL_HARMONIC_BASIS_CONSTANT.band1 * unit.y,
    SPHERICAL_HARMONIC_BASIS_CONSTANT.band1 * unit.z,
    -SPHERICAL_HARMONIC_BASIS_CONSTANT.band1 * unit.x,
  ];
}

export function createVoxelCoefficients(voxelCount) {
  const count = Math.max(1, Math.floor(Number(voxelCount) || 1));
  return new Float32Array(count * SPHERICAL_HARMONIC_FLOATS_PER_VOXEL);
}

export function coefficientOffsetOf(voxelIndex, channelIndex) {
  return (
    voxelIndex * SPHERICAL_HARMONIC_FLOATS_PER_VOXEL +
    channelIndex * SPHERICAL_HARMONIC_COEFFICIENTS_PER_CHANNEL
  );
}

export function clearVoxelCoefficients(coefficients, voxelIndex) {
  const offset = voxelIndex * SPHERICAL_HARMONIC_FLOATS_PER_VOXEL;
  for (let index = 0; index !== SPHERICAL_HARMONIC_FLOATS_PER_VOXEL; index += 1) {
    coefficients[offset + index] = 0;
  }
  return coefficients;
}

export function copyVoxelCoefficients(source, sourceVoxelIndex, destination, destinationVoxelIndex) {
  const sourceOffset = sourceVoxelIndex * SPHERICAL_HARMONIC_FLOATS_PER_VOXEL;
  const destinationOffset = destinationVoxelIndex * SPHERICAL_HARMONIC_FLOATS_PER_VOXEL;
  for (let index = 0; index !== SPHERICAL_HARMONIC_FLOATS_PER_VOXEL; index += 1) {
    destination[destinationOffset + index] = source[sourceOffset + index];
  }
  return destination;
}


export function addRadianceSample(coefficients, voxelIndex, direction, radiance, weight) {
  const basis = sphericalHarmonicBasisOf(direction);
  const energy = radianceOf(radiance);
  const sampleWeight = nonNegativeNumberOr(weight === undefined ? 1 : weight, 1);
  const energyByChannel = [energy.red, energy.green, energy.blue];

  for (let channelIndex = 0; channelIndex !== SPHERICAL_HARMONIC_COLOUR_CHANNEL_COUNT; channelIndex += 1) {
    const offset = coefficientOffsetOf(voxelIndex, channelIndex);
    const channelEnergy = energyByChannel[channelIndex] * sampleWeight;
    for (
      let coefficientIndex = 0;
      coefficientIndex !== SPHERICAL_HARMONIC_COEFFICIENTS_PER_CHANNEL;
      coefficientIndex += 1
    ) {
      coefficients[offset + coefficientIndex] += channelEnergy * basis[coefficientIndex];
    }
  }
  return coefficients;
}


export function addIsotropicRadianceSample(coefficients, voxelIndex, radiance, weight) {
  const energy = radianceOf(radiance);
  const sampleWeight = nonNegativeNumberOr(weight === undefined ? 1 : weight, 1);
  const energyByChannel = [energy.red, energy.green, energy.blue];

  for (let channelIndex = 0; channelIndex !== SPHERICAL_HARMONIC_COLOUR_CHANNEL_COUNT; channelIndex += 1) {
    const offset = coefficientOffsetOf(voxelIndex, channelIndex);
    coefficients[offset] +=
      energyByChannel[channelIndex] * sampleWeight * SPHERICAL_HARMONIC_BASIS_CONSTANT.band0;
  }
  return coefficients;
}


export function evaluateIrradiance(coefficients, voxelIndex, direction) {
  const basis = sphericalHarmonicBasisOf(direction);
  const convolved = [
    basis[0] * CLAMPED_COSINE_CONVOLUTION.band0,
    basis[1] * CLAMPED_COSINE_CONVOLUTION.band1,
    basis[2] * CLAMPED_COSINE_CONVOLUTION.band1,
    basis[3] * CLAMPED_COSINE_CONVOLUTION.band1,
  ];
  const channelNames = ["red", "green", "blue"];
  const irradiance = {};

  for (let channelIndex = 0; channelIndex !== SPHERICAL_HARMONIC_COLOUR_CHANNEL_COUNT; channelIndex += 1) {
    const offset = coefficientOffsetOf(voxelIndex, channelIndex);
    let value = 0;
    for (
      let coefficientIndex = 0;
      coefficientIndex !== SPHERICAL_HARMONIC_COEFFICIENTS_PER_CHANNEL;
      coefficientIndex += 1
    ) {
      value += coefficients[offset + coefficientIndex] * convolved[coefficientIndex];
    }
    irradiance[channelNames[channelIndex]] = Math.max(0, value);
  }
  return Object.freeze(irradiance);
}


export function blendVoxelCoefficients(target, targetVoxelIndex, sample, sampleVoxelIndex, sampleWeight) {
  const weight = Math.min(Math.max(finiteNumberOr(sampleWeight, 1), 0), 1);
  const targetOffset = targetVoxelIndex * SPHERICAL_HARMONIC_FLOATS_PER_VOXEL;
  const sampleOffset = sampleVoxelIndex * SPHERICAL_HARMONIC_FLOATS_PER_VOXEL;

  for (let index = 0; index !== SPHERICAL_HARMONIC_FLOATS_PER_VOXEL; index += 1) {
    const previous = target[targetOffset + index];
    target[targetOffset + index] = previous + (sample[sampleOffset + index] - previous) * weight;
  }
  return target;
}


export function band0LuminanceOf(coefficients, voxelIndex) {
  const redOffset = coefficientOffsetOf(voxelIndex, 0);
  const greenOffset = coefficientOffsetOf(voxelIndex, 1);
  const blueOffset = coefficientOffsetOf(voxelIndex, 2);
  return (
    coefficients[redOffset] * REC_709_LUMINANCE.red +
    coefficients[greenOffset] * REC_709_LUMINANCE.green +
    coefficients[blueOffset] * REC_709_LUMINANCE.blue
  );
}


export function directionalEnergyRatioOf(coefficients, voxelIndex) {
  const luminanceByCoefficient = [0, 0, 0, 0];
  const channelWeights = [REC_709_LUMINANCE.red, REC_709_LUMINANCE.green, REC_709_LUMINANCE.blue];

  for (let channelIndex = 0; channelIndex !== SPHERICAL_HARMONIC_COLOUR_CHANNEL_COUNT; channelIndex += 1) {
    const offset = coefficientOffsetOf(voxelIndex, channelIndex);
    for (
      let coefficientIndex = 0;
      coefficientIndex !== SPHERICAL_HARMONIC_COEFFICIENTS_PER_CHANNEL;
      coefficientIndex += 1
    ) {
      luminanceByCoefficient[coefficientIndex] +=
        coefficients[offset + coefficientIndex] * channelWeights[channelIndex];
    }
  }

  const band0 = Math.abs(luminanceByCoefficient[0]);
  if (!(band0 > MINIMUM_LUMINANCE_FOR_DIVISION)) return 0;
  const band1Length = Math.sqrt(
    luminanceByCoefficient[1] * luminanceByCoefficient[1] +
      luminanceByCoefficient[2] * luminanceByCoefficient[2] +
      luminanceByCoefficient[3] * luminanceByCoefficient[3],
  );
  return band1Length / band0;
}


export function sphericalHarmonicBandsStored() {
  return SPHERICAL_HARMONIC_BAND_COUNT;
}
