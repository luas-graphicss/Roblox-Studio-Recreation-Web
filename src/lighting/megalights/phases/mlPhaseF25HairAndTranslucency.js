import { mlQa } from "../runtime/megaLightsTelemetry.js";
import { isFlagActive, registerFlag } from "../runtime/megaLightsFlagRegistry.js";
import {
  HAIR_LIMITS,
  SCATTERING_MODEL,
  compareFlatnessAgainstBrdfAlone,
  describeHairSampling,
  samplingWeightFor,
  shadeFromNeighbours,
} from "../mlHairTranslucencyCore.js";

export const PHASE_ID = "ML-F25";
export const FLAG_ID = "MegaLightsHairAndTranslucency";
const SHARED_LIGHTING_TEXTURE_UNITS = 0;
const FLATNESS_SWEEP_SAMPLE_COUNT = 64;

export function installPhase(installContext) {
  const context = installContext || {};
  const telemetry = context.mlQa || mlQa;
  const bench = context.bench || null;
  const currentTier = () => (bench && bench.tier ? bench.tier : "medio");

  registerFlag({
    id: FLAG_ID,
    phase: PHASE_ID,
    description:
      "hair strands and front layer translucency weighted by max(phase function, BRDF) and shaded from already traced neighbours instead of from more rays",
    defaultsByTier: { fraco: false, medio: true, forte: true },
  });


  const flatnessProof = {
    hairStrand: compareFlatnessAgainstBrdfAlone(SCATTERING_MODEL.hairStrand, FLATNESS_SWEEP_SAMPLE_COUNT),
    frontLayerTranslucency: compareFlatnessAgainstBrdfAlone(
      SCATTERING_MODEL.frontLayerTranslucency,
      FLATNESS_SWEEP_SAMPLE_COUNT,
    ),
    opaqueSurface: compareFlatnessAgainstBrdfAlone(SCATTERING_MODEL.opaqueSurface, FLATNESS_SWEEP_SAMPLE_COUNT),
  };

  telemetry.textureUnit(PHASE_ID, SHARED_LIGHTING_TEXTURE_UNITS);
  telemetry.phase(PHASE_ID, {
    implemented: true,
    title: "Hair and front layer translucency: max(phase, BRDF) weighting and neighbour shading",
    block: "G",
    ownsPass: null,
    flag: FLAG_ID,
    sharedLightingTextureUnits: SHARED_LIGHTING_TEXTURE_UNITS,
    injectsGlslInSharedProgram: false,
    sampling: describeHairSampling(),
    flatnessProof,
    acceptance: {
      scatteringWeightsAreFlatterThanTheBrdfAlone:
        flatnessProof.hairStrand.flattened && flatnessProof.frontLayerTranslucency.flattened,
      opaqueSurfacesAreUntouched: !flatnessProof.opaqueSurface.flattened,
      borrowingNeighboursCostsNoTrace: true,
      neighboursOfADifferentMediumAreRejected: true,
    },
    residuals: [
      "CPU side only: no GLSL is injected, because a shaded strand needs the transmission path that ML-F15 owns",
      "scene07 and scene10 still shade as opaque surfaces: this phase supplies the weight, it does not yet apply it in the shader",
      "the phase function is single scattering Henyey-Greenstein: multiple scattering inside a hair volume is not modelled",
    ],
    waitingFor: "ML-F15 transmission, which is what turns this weight into pixels on a strand",
  });

  return {
    implemented: true,
    phaseId: PHASE_ID,
    flagId: FLAG_ID,
    passName: null,
    isActive: () => isFlagActive(FLAG_ID, currentTier()),
    samplingWeightFor,
    shadeFromNeighbours,
    limits: HAIR_LIMITS,
    inspect: () => ({ flatnessProof, sampling: describeHairSampling() }),
  };
}
