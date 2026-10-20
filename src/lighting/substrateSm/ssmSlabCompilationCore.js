import { copySubstrateSmImmutableData } from './ssmImmutableData.js';
import { createSubstrateSmLossEntry } from './ssmLossReportCore.js';
import { createSubstrateSmCompilationRefusal } from './ssmValidationCore.js';

function activeSlabFeatures(parameters) {
  const features = [];
  if (parameters.anisotropy !== 0) features.push('anisotropy');
  if (parameters.secondRoughnessWeight !== 0) features.push('secondSpecularLobe');
  if (parameters.fuzzAmount !== 0) features.push('fuzz');
  if (parameters.subsurfaceMeanFreePath.some(value => value !== 0)) features.push('subsurface');
  if (parameters.thinFilmThicknessNanometers !== 0) features.push('thinFilm');
  if (parameters.glintDensity !== 0) features.push('glints');
  return features;
}

export function compileSubstrateSmSlab(node) {
  if (node.type !== 'bsdf' || node.bsdf !== 'slab') {
    return copySubstrateSmImmutableData({
      ok: false,
      surface: null,
      losses: [],
      refusals: [createSubstrateSmCompilationRefusal(
        'slabRequired', node.path, 'Base compilation requires one resolved slab',
      )],
    });
  }
  const parameters = node.parameters;
  const features = activeSlabFeatures(parameters);
  if (features.length > 0) {
    return copySubstrateSmImmutableData({
      ok: false,
      surface: null,
      losses: [],
      refusals: features.map(feature => createSubstrateSmCompilationRefusal(
        'featureReductionRequired', node.path,
        `The active ${feature} feature requires an explicit optical reduction stage`,
      )),
    });
  }
  const losses = [
    createSubstrateSmLossEntry({
      sourcePath: node.path,
      operation: 'resolvedSlab',
      replacement: 'baseSurfaceParameters',
      reason: 'Resolved diffuse reflectance, Fresnel endpoints, roughness, emission and opacity are copied without a second metalness interpretation',
    }),
    createSubstrateSmLossEntry({
      sourcePath: node.path,
      operation: 'inactiveSlabFeatures',
      replacement: 'neutralExtensionParameters',
      reason: 'Anisotropy, second-lobe weight, fuzz amount, mean free path, film thickness and glint density are all zero',
    }),
  ];
  return copySubstrateSmImmutableData({
    ok: true,
    surface: {
      family: 'base',
      parameters: {
        diffuseReflectance: parameters.albedo,
        perceptualRoughness: parameters.roughness,
        specularF0: parameters.f0,
        coverage: 1,
        emissiveRadiance: parameters.emissive,
        opacity: parameters.opacity,
        extinctionCoefficient: [0, 0, 0],
        layerThickness: 0,
        extensionWeight: 0,
        extensionRoughness: 0,
        anisotropy: 0,
        anisotropyRotation: 0,
        extensionTint: [0, 0, 0],
        diffuseWrap: 0,
        specularF90: parameters.f90,
        reflectionRoughness: parameters.roughness,
        thinTransmissionWeight: 0,
        reserved: 0,
        reservedVector: [0, 0, 0, 0],
      },
    },
    losses,
    refusals: [],
  });
}
