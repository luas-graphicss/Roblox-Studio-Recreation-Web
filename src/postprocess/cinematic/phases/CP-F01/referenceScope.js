import { PHASE_MANIFEST } from "../../contracts/phaseManifest.js";
import { PIPELINE_STAGES } from "../../contracts/pipelineStages.js";
import { QUALITY_REQUIREMENTS } from "./referenceConstants.js";

const propertyGroups = [
  ["CP-F02", "enabled globalDefault unbound priority blendRadius blendWeight propertyOverride cameraWeight autoValue equalPriorityTie nonBlendableAsset"],
  ["CP-F03", "sensorWidth sensorHeight focalLength fieldOfView aperture minimumAperture bladeCount bladeCurvature focusPlane focusMethod focusDistance trackingTarget shutterSpeed shutterAngle iso squeezeFactor overscan worldUnits"],
  ["CP-F04", "workingPrimaries whitePoint sceneLinearEncoding preExposure previousPreExposure alphaCoverage hdrFormat negativeColorPolicy"],
  ["CP-F05", "depthEncoding depthNear depthFar depthOrigin normalEncoding coverage customDepth customStencil materialId objectId multisampleResolve"],
  ["CP-F06", "velocityEncoding velocityValidity previousMatrices previousSkin previousMorph previousDeformation particleVelocity skyVelocity translucencyVelocity cameraCut"],
  ["CP-F07", "viewHistory historyGeneration historyEncoding jitterSequence historyExposureConversion resetPolicy pausePolicy"],
  ["CP-F08", "meteringMode histogramBins meteringMask lowPercent highPercent minimumEv maximumEv middleGray manualExposure"],
  ["CP-F09", "actualEv targetEv exposureCompensation compensationCurve speedUp speedDown linearExponentialTransition minimumExposure maximumExposure physicalCameraExposure editorExposureOverride freezeExposure"],
  ["CP-F10", "highlightContrast shadowContrast detailStrength middleGrayBias blurredLuminanceBlend luminanceScale highlightCurve shadowCurve"],
  ["CP-F11", "filmSlope filmToe filmShoulder filmBlackClip filmWhiteClip blueCorrection expandGamut toneCurveAmount tonemapperReplacement"],
  ["CP-F12", "whiteBalanceMode temperature tint globalSaturation globalContrast globalGamma globalGain globalOffset shadowSaturation shadowContrast shadowGamma shadowGain shadowOffset midtoneSaturation midtoneContrast midtoneGamma midtoneGain midtoneOffset highlightSaturation highlightContrast highlightGamma highlightGain highlightOffset shadowsMaximum highlightsMinimum highlightsMaximum"],
  ["CP-F13", "lookupTexture lookupIntensity lookupSize lookupInterpolation lookupInputDomain lookupOutputDomain ocioConfig ocioVersion lookBlend"],
  ["CP-F14", "bloomMethod bloomThreshold bloomSoftKnee bloomIntensity bloomBandScale bloomBandTint bloomFilter"],
  ["CP-F15", "convolutionKernel convolutionNormalization convolutionCenter convolutionScale convolutionBufferScale convolutionPrefilter convolutionPadding"],
  ["CP-F16", "flareIntensity flareThreshold flareTint ghostPositions ghostTints flareHalo bokehShape bokehSize flareDispersion"],
  ["CP-F17", "dirtTexture dirtIntensity dirtTint dirtGamma dirtAspect"],
  ["CP-F18", "signedCoc cocPixelScale cocMaximumRadius cocCoverage cocSkyPolicy cocClassification"],
  ["CP-F19", "diaphragmBlades diaphragmCurvature anamorphicRatio bokehDistribution bokehHighlightHandling foregroundCoverage holeFilling smallCocQuality largeCocQuality"],
  ["CP-F20", "dofTemporalRejection dofHistoryQuality dofReconstructionScale dofCaptureAccumulation"],
  ["CP-F21", "antiAliasingMethod screenPercentage temporalHistorySize velocityDilation disocclusion reactiveMask colorClipping reconstructionFilter temporalSharpening"],
  ["CP-F22", "motionBlurAmount motionBlurMaximum motionBlurTargetFps motionBlurPerObjectSize shutterTiming velocityTiles motionBlurOcclusion"],
  ["CP-F23", "chromaticIntensity chromaticStartOffset chromaticChannelSampling calibratedLensDistortion"],
  ["CP-F24", "vignetteIntensity vignetteAspect vignetteResponse"],
  ["CP-F25", "grainIntensity grainShadows grainMidtones grainHighlights grainShadowLimit grainHighlightLimit grainTexelSize grainTexture grainSeed grainTemporalAdvance outputDither"],
  ["CP-F26", "materialDomain blendableLocation blendablePriority blendableWeight userSceneTexture materialSceneInputs replaceTonemapper materialQualityBranch"],
  ["CP-F27", "ambientOcclusion ambientCubemap globalIllumination reflections fog refraction substrate particles water sky pathTracingInput translucencyBeforeDof translucencyAfterDof translucencyAfterMotionBlur premultipliedAlpha"],
  ["CP-F28", "outputTransform outputGamut outputWhitePoint paperWhite peakLuminance blackLuminance gamutMapping hdrMetadata captureColorSpace uiComposition"],
  ["CP-F29", "captureTimestep captureSeed captureWarmup spatialSamples temporalSamples captureSubframes tileOverlap captureOverscan captureAlpha exportEncoding"],
  ["CP-F30", "debugBuffer pixelProbe differenceDomain comparisonMetric evidenceState"],
  ["CP-F31", "qualityProfile resolutionPolicy tapBudget historyBudget memoryCeiling degradationReason"],
  ["CP-F32", "shaderPermutation contextRestore resourceLifetime deviceCapability"],
  ["CP-F33", "settingsSchema autoPersistence assetPersistence migrationPolicy legacyMapping"],
  ["CP-F34", "futureFeatureGate safeMode presentationOwner rollbackPolicy"]
];

export const PROPERTY_REQUIREMENTS = Object.freeze(propertyGroups.flatMap(([owner, names]) => names.split(" ").map((name) => Object.freeze({ id: `${owner}.${name}`, owner, label: name, source: `docs/PLAN.md#${owner}` }))));
export const PASS_REQUIREMENTS = Object.freeze(PIPELINE_STAGES.map((stage) => Object.freeze({ id: stage, owners: Object.freeze(PHASE_MANIFEST.filter((phase) => phase.stages.includes(stage)).map((phase) => phase.id)), source: "docs/PLAN.md#macro-graph" })));
export const PROFILE_REQUIREMENTS = QUALITY_REQUIREMENTS;
export const SCOPE_SOURCE = Object.freeze({ id: "B00-plan", kind: "planning-document", uri: "docs/PLAN.md", version: null, provenance: "unmeasured", assetId: null });
