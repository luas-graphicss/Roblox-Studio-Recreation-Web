import { assetStore } from "../assets/assetStore.js";
import { relightMaterialArray } from "./relightMaterialArray.js";
import { logger } from "../core/logger.js";
import { bus } from "../core/eventBus.js";

import { startVisibilityAwareInterval } from "../core/visibilityAwareInterval.js";
import { store } from "../core/state.js";
import { getService, Events } from "../datamodel/index.js";
import { clampNumber } from "../utils/validate.js";
import { fitSunShadowWindow } from "../lighting/sunShadowFit.js";


import {
  fitSunShadowToCameraView,
  sunViewFitDistanceQuantum,
} from "../lighting/sunShadowCameraFit.js";


import { computeShadowTier, createTierController, effectiveRenderScale, initialTierFor, maxTierFor, minTierFor, motionBoostStep, tierCapsuleEnabled, tierCapsuleW, tierConfig, tierCsmWanted, tierFarEnabled, tierFitsTexUnits, tierRodizioCascades, tierSunTexelTarget, tierTemporalEnabled, tierTransEnabled } from "../lighting/shadowTierCore.js";


import { CF_CONE_EDGE, contactConeFactor, contactLightLum, contactLightWeight, fusedContactSteps, sanitizeContactFuse } from "../lighting/contactFuseCore.js";


import { createPhotoMode } from "./photoMode.js";
import { ENV_FACE_ORDER, ENV_FACE_SIZE, envSkySignature, fillEnvFace } from "../lighting/envSky.js";


import { envCapturePlan, envCaptureSignature } from "../lighting/envCaptureCore.js";
import { createEnvCapture } from "./envCapture.js";


import { aggregateStackDistribution, classifyDominantSource, makeStackTelemetry, resolveReflectionWeights } from "../lighting/reflectionStackCore.js";



import { ssrStackShare } from "./ssr.js";


import { getPlanarQa } from "./planarReflections.js";


import { hdriIntensityClamp, hdriKindForExt, hdriMaxSizeForTier, hdriSignature } from "../lighting/hdriCore.js";
import { sanitizeVfCascadeBiases, VF_BIAS_DEFAULT } from "../lighting/volumetricFogCore.js";          
import { disposeHdriWorker, loadHdriEquirect } from "../assets/hdriLoader.js";
import {
  wrapClockTime,
  timeOfDayToClockTime,
  clockTimeToTimeOfDay,
  sunDirection,
  skyStateAt,
  FACE_VECTORS,
} from "../lighting/dayNight.js";
import { createVoxelGI } from "./voxelGI.js";
import { GI_MAX_BOXES, GI_MAX_LIGHTS } from "../lighting/voxelGiCore.js";

import { GI_NEON_NITS, giBouncePlan, pickTopLights, sanitizeEmissives } from "../lighting/giBounceCore.js";
import {
  hardCapFromGpu,
  createBudgetController,
  localShadowCap,
  shadowResFor,
} from "../lighting/shadowBudget.js";

import { msmForwardInjectionTextureCharge, isMsmForwardInjectionReserved } from "../lighting/megalightsSm/msmMaterialTextureAccountingCore.js";
import { createMsmLocalLightFeed } from "./msmLocalLightFeed.js";
import { collectMsmAtlasCoveredKeys } from "../lighting/megalightsSm/msmAtlasCoverageCore.js";
import { bindMsmAtlasLightRows } from '../lighting/megalightsSm/msmAtlasLightBindingsCore.js';
import { createPcssShadows } from "./pcssShadows.js";

import { createCapsuleShadows } from "./capsuleShadows.js";

import { isLocallyInvisible } from "../lighting/localTransparencyCore.js";


import { rejectCapsulesAroundCamera } from "../lighting/cameraInsideCapsuleCore.js";
import { sunTanFromSoftness } from "../lighting/pcssCore.js";
import {
  RSW_CAP_MAX,
  areaShadowRadius,
  blobFollowY,
  blobForCapsules,
  blobOpacity,
  capsuleFromPart,
  isCapsuleLimbName,
  selectCapsules,
} from "../lighting/capsuleShadowCore.js";

import { depthUvScale } from "../lighting/pcssCore.js";
import {
  CSM_MAX_CASCADES,
  CSM_BLEND_FRACTION,
  CSM_SUN_RADIUS_MARKER,
  CSM_GHOST_RADIUS_MARKER,
  computeCsmSplits,
  frustumSliceSphere,
  fitCascadeWindow,
} from "../lighting/csmCore.js";


import { biasProfileFor, planeBiasCapFor } from "../lighting/shadowBiasCore.js";


import { createFarShadows } from "./farShadows.js";


import { advanceFrame as advanceTemporalFrame, sunResetNeeded } from "../lighting/shadowDenoiseCore.js";


import { resolveShadowMapPlus, SM_PLUS_TEXEL_TARGET } from "../lighting/shadowMapPlusCore.js";


import { sunEdgeTexels, LOCAL_LIGHT_EDGE_TEXELS } from "../lighting/shadowEdgeSharpness.js";


import {
  shadowEdgeFilterPlan,
  SHADOW_EDGE_RADIUS_MARKER,
  SHADOW_EDGE_TAP_COUNT,
} from "../lighting/shadowEdgeFilterCore.js";


import { resolveToneMapper, TONEMAP_NAMES } from "../lighting/tonemapCore.js";


import { photometryPlan, localLightPhotometryPlan, localLightEngineParams, resolveRenderStyle as resolvePhotometryStyle } from "../lighting/photometryCore.js";


import { applyPhongPhysics } from "../lighting/materialPhysicsTable.js";
import { transferMaterialState, setEmissiveRenderStyle, getEmissiveHdrState } from "./baseMaterials.js";


import { partAabb, sphereIntersectsAabb } from "../lighting/shadowPagesCore.js";



import { createSunClipmap } from "./shadowClipmap.js";
import { resolveClipmapGate } from "../lighting/clipmapCore.js";


import { createSunClipmapRender } from "./shadowClipmapRender.js";


import { smrtStepsForTier } from "../lighting/smrtCore.js";


import { gtaoLiteGate } from "../lighting/aoCore.js";



import { createFeatureGovernor, sceneKeyFor } from "../lighting/featureBudgetCore.js";
import { createSunShadowPages } from "./shadowPages.js";


import { hotCascadeRes, planRodizio, rodizioBudget, rodizioEligible, spinRadPerS } from "../lighting/csmRodizioCore.js";


import {
  TRANS_MAX_PROXIES,
  isGlassMaterialName,
  transparencyFromPoolAlpha,
  isTransmitterTransparency,
  transmitterTint,
} from "../lighting/transmissionShadowCore.js";
import { createTransmissionShadows } from "./transmissionShadows.js";

import { getRefractionQa } from "./refractionPass.js";



import { createTransDirtyGate, transListSignature, transRtSizeFor } from "../lighting/transmissionDirtyCore.js";
import { ML_MAX_LIGHTS } from "../lighting/megaLightsCore.js";





import { createMegaLightsPipeline } from "./megaLightsPipeline.js";
import { createMegaLightsDebugBridge } from "./megaLightsDebugBridge.js";
import { createSubstratePipeline } from "./substratePipeline.js";
import { createSubstrateSmPipeline } from "./substrateSmPipeline.js";
import { createSubstrateSmHostSettings } from "./substrateSm/ssmHostSettings.js";
import { createSubstrateSmHostQa } from "./substrateSm/ssmHostQa.js";


const SSM_HOST_GATE_PROPERTIES = new Set(["SubstrateSM", "SubstrateSMQuality", "Technology", "RenderStyle"]);
import { applyStandardPhysics as applySubstrateStandardPhysics } from "../lighting/materialPhysicsTable.js";




import {
  megaLightsWantsMaterials,
  subscribeMaterialToMegaLights,
  unsubscribeMaterialFromMegaLights,
} from "./megaLightsMaterialSubscription.js";
import { CL_DEFAULTS, sanitizeClusterSettings } from "../lighting/lightClusterCore.js";          
import { createShadowAtlas, createAtlasDepthRenderer } from "./shadowAtlas.js";                                     

import { SA_DEFAULT_BIAS, SA_DEFAULT_SAMPLES } from "../lighting/shadowAtlasCore.js";

import {
  MSM_ATLAS_SAMPLE_CONSUMER_READY,
  msmWantsShadowAtlas,
} from "../lighting/megalightsSm/msmAtlasWakeRequestCore.js";


import {
  LSR_MAX_PER_FRAME,
  createShadowRotation,
  lsrResFor,
} from "../lighting/localShadowRotationCore.js";


import { createRtSunShadows } from "./rtSunShadows.js";
import { RT_SUN_RADIUS_MARKER } from "../lighting/rtSunCore.js";


import { detectGpuBudget } from "../lighting/gpuBudget.js";


import { postfxDietPlan } from "../lighting/postfxDietCore.js";



import { upscaleSharpenPlan } from "../lighting/upscaleSharpenCore.js";


import { localExposurePlan } from "../lighting/localExposureCore.js";


import { filmFxPlan } from "../lighting/filmFxCore.js";

import { tsrPlan } from "../lighting/tsrCore.js";


import { lensFlarePlan } from "../lighting/lensFlareCore.js";
import { resolveAutoExposure, aeMeasureCadence } from "../lighting/autoExposureCore.js";         


import { computeSunScreenVisibility, isSunVisible } from "../lighting/sunScreenVisibilityCore.js";


import { hdrPipelinePlan, auditTextureColorSpaces, AUDIT_TEXTURE_SLOTS } from "../lighting/hdrPipelineCore.js";


import { sanitizeProbe, resolveProbesFlag, probeBudget } from "../lighting/probeCore.js";
import { createReflectionProbes } from "./reflectionProbes.js";


import { ILF1_SCENE_IDS, ILF1_BENCH_VERSION } from "../lighting/lightingBenchCore.js";


import { resolveSkyModel, skyPhysicalUniforms, getSkyPhysicalDataset, setSkyPhysicalDataset, SKY_PHYS_KNEE } from "../lighting/skyPhysicalCore.js";




import { buildHosekWilkieDataset } from "../lighting/hosekWilkieDataset.js";
try { setSkyPhysicalDataset(buildHosekWilkieDataset()); } catch (_eHw) {                                  }


import { buildCloudsGlsl, buildNightSkyGlsl, makeCloudNoiseData, sanitizeCloudsProps, resolveCloudsGate, sanitizeMoonPhase, CLOUD_TEX_SIZE, CLOUD_WIND, CLOUD_ANIM_MIN_MS } from "../lighting/cloudsCore.js";


import { buildGradingPlan, parseCubeLut } from "../lighting/gradingCore.js";


import { SUN_MASK_RADIUS_MARKER, shouldUseSunMask, maskFullResDecision } from "../lighting/sunMaskCore.js";

import { sunShadowContactNormalBias } from "../lighting/sunShadowContactBias.js";


const ADAPTIVE_RES_OFF = true;


import { resolveIgnitionFlag, weakAutoOn } from "../lighting/weakIgnitionCore.js";


import { createMaterialFeatures } from "./materialFeatures.js";
import { resolveMatFeatFlag } from "../lighting/materialFeaturesCore.js";
import { createSunShadowMask } from "./sunShadowMask.js";


import { VOL_FOG_MAX_LIGHTS, densityFromAtmosphereJs, pickVolLightsJs, resolveVolFogFlag } from "../lighting/volumetricFogCore.js";


import { resolveSsrFlag } from "../lighting/ssrCore.js";


import { createPassTiming } from "./passTiming.js";


import { giStepBudgetMs } from "../lighting/giSliceCore.js";


import { createShaderDiet } from "./shaderDiet.js";


import {
  createWarmupStager,
  createTdrWatchdog,
  stageToastMessage,
  warmupProgress,
  buildTdrReport,
  WARMUP_STAGE_ORDER,
} from "../lighting/warmupStageCore.js";
import { createCompileSlicer, dedupeCompileUnits } from "../lighting/warmupSliceCore.js";
import { compileMaterialUnit } from "./compileMaterialUnit.js";
import { createShaderProgramWarmup } from "./shaderProgramWarmup.js";
import { createIncrementalEnvironmentPrefilter } from "./incrementalEnvironmentPrefilter.js";


import { createHeightFogPatch } from "./heightFogPatch.js";


import { createIesCookiePatch } from "./iesCookiePatch.js";
import { loadIesProfile, decodeIesDataUri, cookieCellFromDataUri } from "../assets/iesLoader.js";
import {
  RSW_IESCK_MAX_SPOT, RSW_IESCK_MAX_POINT,
  RSW_IES_PRESETS, RSW_COOKIE_PRESETS,
  iesPresetProfile, iesProfileToCell, cookiePresetCell,
  predictLightOrder,
  sanitizeIesProfileRef, sanitizeLightFunctionRef, sanitizeCookieRotationDeg,
  flagsForIesCookie,
} from "../lighting/iesCookieCore.js";


import { createSpecularAaPatcher } from "../lighting/specularAaCore.js";


import { createSpecOccPatcher, specOccGate } from "../lighting/specOccCore.js";
import { buildHeightFogGlsl, mapAtmosphereToHeightFog, resolveRenderStyle } from "../lighting/heightFogCore.js";


import { smRealisticLitePlan, smLiteAmbientTint } from "../lighting/smRealisticLiteCore.js";


import { smPcssLitePlan, resolveSmLiteContactFlag, SM_LITE_RADIUS_MARKER, SM_LITE_TAPS } from "../lighting/smPcssLiteCore.js";


import { planAreaLights, rectLightNits, faceFrame, LTC_TEX_UNITS } from "../lighting/ltcCore.js";
import { resolveAreaPartsFlag, tubeLightNits, AP_MAX_LIGHTS } from "../lighting/areaPartsCore.js";
import { createAreaPartsPatch } from "./areaPartsPatch.js";          


import { createLocalLightPatchRegistry } from "./llShaderPatchRegistry.js";
import { createMsmNativePartitionFeed } from './msmNativePartitionFeed.js';


import {
  beginLocalLightWalkFrame,
  invalidateLocalLightWalk,
} from "../lighting/llLocalLightWalkCache.js";
import { registerLocalLightFalloffPhase } from "./llFalloffPatch.js";         
import { registerLocalLightSpotConePhase } from "./llSpotConePatch.js";         
import { registerLocalLightSourceShapePhase } from "./llSourceShapePatch.js";         
import { registerLocalLightAreaSpecularPhase } from "./llAreaSpecPatch.js";         
import { registerLocalLightRectExtrasPhase } from "./llRectExtrasPatch.js";         
import { registerLocalLightMaterialParityPhase } from "./llMaterialParityPatch.js";         
import { registerLocalLightHdrPhase } from "./llHdrLocalPatch.js";         
import { registerLocalLightShadowAtlasPhase } from "./llShadowGatePatch.js";                          
import { createDeterministicAtlasFeed } from "./llAtlasDeterministicFeed.js";                       
import { registerLocalLightPointShadowPhase } from "./llPointShadowPatch.js";                          
import { createPointCubeAtlasFeed } from "./llPointAtlasFeed.js";                       
import { createShadowResolutionFeed } from "./llShadowResolutionFeed.js";                     
import { createShadowCacheFeed } from "./llShadowCacheFeed.js";                     
import { createLocalLightShadowInvalidationFeed } from "./localLightShadowInvalidationFeed.js";                      
import { createMsmAtlasRedrawPolicyFeed } from "./msmAtlasRedrawPolicyFeed.js";                     
import { resolveMsmAtlasScheduleRequest } from './msmAtlasFrameScheduler.js';
import { registerLocalLightShadowSourcePhase } from "./llShadowSourcePatch.js";          
import { registerLocalLightContactShadowPhase } from "./llContactShadowPatch.js";                          
import { CONTACT_LENGTH_USER_DATA_KEY, createContactShadowFeed } from "./llContactShadowFeed.js";                       
import { registerLocalLightTransmissionPhase } from "./llTransmissionPatch.js";                          
import { createTransmissionFeed } from "./llTransmissionFeed.js";                       
import { createLocalVolumetricFeed } from "./llVolumetricLocalFeed.js";                       
import { registerLocalLightGiPhase } from "./llGiLocalPatch.js";                     
import { createLocalLightFadeFeed } from "./llLightFadeFeed.js";                                    
  import { createLocalShadowReuseFeed } from "./llLocalShadowReuseFeed.js";                                          
import { registerLocalLightProxyPhase } from "./llLightProxyPatch.js";                                       
import { registerLocalLightClusterShadingPhase } from "./llClusterShadingPatch.js";                          
import { createLocalLightClusterFeed } from "./llClusterShadingFeed.js";                       
import { publishLocalLightPublicApi } from "./llPublicApiBridge.js";                                  
import { publishLocalLightProofBattery } from "./llProofBatteryBridge.js";                                       
import { publishLocalLightBlindRound } from "./llBlindRoundBridge.js";                                  
import { publishLocalLightWiringAudit } from "./llPhaseWiringAudit.js";                                     
import { registerLocalLightPhotometricUnitsPhase } from "./llPhotometricUnitsPatch.js";         
import { resolveLocalLightTier } from "../lighting/llTierResolver.js";
import { createLocalLightGateContextCache } from "../lighting/llFrameGateContextCache.js";


import { DEFAULT_LIGHTING_TECHNOLOGY } from "../lighting/llTechnologyGate.js";
import { llQa } from "../lighting/llTelemetry.js";
import { areLtcTablesReady, ensureLtcTablesLoaded, getLtcTablesLoadError } from "../lighting/ltcTablesLoader.js";
import { NotificationService } from "../services/notifications.js";


const LIGHT_CLASSES = Object.freeze(["PointLight", "SpotLight", "SurfaceLight", "RectLight", "TubeLight"]);                     
const MAX_LOCAL_LIGHTS = 64;                                                


const LEGACY_LIGHT_SCALE = Math.PI;

const GI_PART_PROPS = new Set([
  "CFrame", "Position", "Orientation", "Rotation", "Size",
  "Color", "BrickColor", "Transparency", "Material", "Reflectance",
]);


const REFLECTANCE_RANGE = [0, 1];


const SKY_FACES = Object.freeze(["SkyboxRt", "SkyboxLf", "SkyboxUp", "SkyboxDn", "SkyboxFt", "SkyboxBk"]);


const SKY_SLOTS = Object.freeze([
  { face: "SkyboxLf", rot: 0 },
  { face: "SkyboxRt", rot: 0 },
  { face: "SkyboxUp", rot: Math.PI },
  { face: "SkyboxDn", rot: Math.PI },
  { face: "SkyboxBk", rot: 0 },
  { face: "SkyboxFt", rot: 0 },
]);


const LIGHTING_CLAMPS = Object.freeze({
  Brightness: [0, 10],
  ShadowSoftness: [0, 1],
  MegaLightsSMStrength: [0, 1],
  EnvironmentDiffuseScale: [0, 1],
  EnvironmentSpecularScale: [0, 1],
  ExposureCompensation: [-5, 5],
  GeographicLatitude: [-90, 90],

  LocalExposureStrength: [0, 1],

  LensFlareIntensity: [0, 1],

  SkyTurbidity: [1.7, 10],
  SkyGroundAlbedo: [0, 1],
});

const CHILD_CLAMPS = Object.freeze({


  PointLight: { Range: [0, 60], Brightness: [0, 40], Temperature: [0, 12000], SourceRadius: [0, 8], SoftSourceRadius: [0, 8], SourceLength: [0, 64], Intensity: [-20, 1e6], IESBrightnessScale: [0, 100] },
  SpotLight: { Range: [0, 60], Brightness: [0, 40], Angle: [0, 180], Temperature: [0, 12000], SourceRadius: [0, 8], SoftSourceRadius: [0, 8], SourceLength: [0, 64], LightFunctionRotation: [0, 360], Intensity: [-20, 1e6], IESBrightnessScale: [0, 100] },                          
  SurfaceLight: { Range: [0, 60], Brightness: [0, 40], Angle: [0, 180], Temperature: [0, 12000], LightFunctionRotation: [0, 360], Intensity: [-20, 1e6], IESBrightnessScale: [0, 100] },                  


  RectLight: { Range: [0, 60], Brightness: [0, 40], Width: [0.05, 64], Height: [0.05, 64], BarnDoorAngle: [0, 90], BarnDoorLength: [0, 64] },
  TubeLight: { Range: [0, 60], Brightness: [0, 40], Length: [0.05, 64], TubeRadius: [0.01, 8], BarnDoorAngle: [0, 90], BarnDoorLength: [0, 64] },                  
  Atmosphere: { Density: [0, 1], Offset: [0, 1], Glare: [0, 1], Haze: [0, 10] },


  Clouds: { Cover: [0, 1], Density: [0, 1] },


  ReflectionProbe: { Priority: [-64, 64], Resolution: [16, 256], BlendDistance: [0, 64] },
  Sky: { StarCount: [0, 10000], SunAngularSize: [1, 90], MoonAngularSize: [1, 90], HdriIntensity: [0, 8] },
  BlurEffect: { Size: [0, 56] },

  BloomEffect: { Intensity: [0, 10], Size: [0, 56], Threshold: [0, 2], Anamorphic: [1, 3], Dirt: [0, 1] },
  ColorCorrectionEffect: { Brightness: [-1, 1], Contrast: [-1, 1], Saturation: [-1, 1] },
  DepthOfFieldEffect: { NearIntensity: [0, 1], FarIntensity: [0, 1] },
  SunRaysEffect: { Intensity: [0, 1], Spread: [0, 1] },
});

const DOME_VERT = `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;


const DOME_FRAG = `
precision highp float;
varying vec3 vDir;
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunCos;
uniform vec3 uMoonDir;
uniform float uMoonCos;
uniform sampler2D uSunTex;
uniform float uSunTexOn;
uniform sampler2D uMoonTex;
uniform float uMoonTexOn;
uniform float uStars;
uniform float uStarDensity;
uniform float uCelestial;
uniform float uSkyMode;
uniform vec3 uAtmoColor;
uniform vec3 uAtmoDecay;
uniform float uAtmoDensity;
uniform float uAtmoOffset;
uniform float uAtmoGlare;
uniform float uAtmoHaze;
                                                                       
                                                                             
uniform float uSkyModel;
uniform float uSkyPhysBlend;
uniform vec3 uHwA;
uniform vec3 uHwB;
uniform vec3 uHwC;
uniform vec3 uHwD;
uniform vec3 uHwE;
uniform vec3 uHwF;
uniform vec3 uHwG;
uniform vec3 uHwH;
uniform vec3 uHwI;
uniform vec3 uHwZenith;
uniform vec3 uHwGround;
uniform float uHwKnee;

                                                                           
                                                                              
uniform float uHFogOn;
uniform float uHFogSigma;
uniform float uHFogFalloff;
uniform float uHFogCamY;
uniform vec3 uHFogColor;
uniform float uHFogSunK;
uniform float uHFogSunAmp;
                                                                        
                                                                          
                                                                           
uniform float uCloudsOn;
uniform float uCloudCover;
uniform float uCloudDensity;
uniform vec3 uCloudColor;
uniform sampler2D uCloudTex;
uniform vec2 uCloudWind;
uniform float uSkyTime;
uniform float uNightSky;
uniform float uMoonPhase;
${buildHeightFogGlsl()}
${buildCloudsGlsl()}
${buildNightSkyGlsl()}

float hash13(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.17, 0.13));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
  vec3 dir = normalize(vDir);
  float h = clamp(dir.y, -1.0, 1.0);
  float t = pow(clamp(h * 0.5 + 0.5, 0.0, 1.0), 1.25);
  vec3 sky = mix(uHorizon, uTop, t);
                                                                            
                                                                        
                                                                              
  if (uSkyModel > 0.5 && uSkyPhysBlend > 0.0005) {
    float cosT = max(h, 0.0);
    float cosG = clamp(dot(dir, uSunDir), -1.0, 1.0);
    float gamm = acos(cosG);
    vec3 chiH = (1.0 + cosG * cosG) / pow(max(vec3(1.0) + uHwH * uHwH - 2.0 * uHwH * cosG, vec3(1e-4)), vec3(1.5));
    vec3 fNine = (vec3(1.0) + uHwA * exp(uHwB / (cosT + 0.01)))
      * (uHwC + uHwD * exp(uHwE * gamm) + uHwF * (cosG * cosG) + uHwG * chiH + uHwI * sqrt(cosT));
    vec3 Yxy = max(uHwZenith * fNine, vec3(0.0));
    float Yl = Yxy.x;
    float xc = clamp(Yxy.y, 0.02, 0.6);
    float yc = clamp(Yxy.z, 0.02, 0.6);
    float Xc = xc * (Yl / yc);
    float Zc = (1.0 - xc - yc) * (Yl / yc);
    vec3 phys = vec3(
      3.2406 * Xc - 1.5372 * Yl - 0.4986 * Zc,
      -0.9689 * Xc + 1.8758 * Yl + 0.0415 * Zc,
      0.0557 * Xc - 0.204 * Yl + 1.057 * Zc);
    phys = vec3(1.0) - exp(-uHwKnee * max(phys, vec3(0.0)));
    float tg = smoothstep(0.0, 0.35, -h);
    phys = mix(phys, uHwGround, tg);
    sky = mix(sky, phys, uSkyPhysBlend);
  }
                                                                      
  float band = 1.0 - clamp(abs(h - uAtmoOffset * 0.35), 0.0, 1.0);
  float falloff = mix(10.0, 2.0, clamp(uAtmoHaze / 10.0, 0.0, 1.0));
  float atmo = uAtmoDensity * pow(band, falloff);
  vec3 atmoCol = mix(uAtmoColor, uAtmoDecay, clamp(uAtmoDensity, 0.0, 1.0));
  sky = mix(sky, atmoCol, clamp(atmo, 0.0, 0.95));
                                                                               
  float rswAer = 0.0;
  vec3 rswAerCol = vec3(0.0);
  float rswSkyT = 1.0;
  if (uHFogOn > 0.5) {
    rswAer = clamp(rswHFogSkyFactor(uHFogCamY, h, uHFogSigma, uHFogFalloff, 0.0), 0.0, 1.0);
    float rswAerW = uHFogSunAmp * rswHFogSunW(dot(dir, uSunDir), uHFogSunK);
    rswAerCol = mix(uHFogColor, uSunColor, clamp(rswAerW, 0.0, 1.0));
                                                                             
                                                                       
                                                                              
                                                                           
                                                                             
                                                                              
                                            
    float rswLumSky = dot(sky, vec3(0.2126, 0.7152, 0.0722));
    float rswLumFog = dot(rswAerCol, vec3(0.2126, 0.7152, 0.0722));
    rswAerCol *= min(1.0, (rswLumSky + 0.04) / max(rswLumFog, 1e-4));
    sky = mix(sky, rswAerCol, rswAer);
    rswSkyT = 1.0 - rswAer;
  }
  float alpha = 1.0 - uSkyMode;                                                
  vec3 col = sky * alpha;
  if (uHFogOn > 0.5 && uSkyMode > 0.5) {
    col += rswAerCol * rswAer;
    alpha = max(alpha, rswAer);
  }

  if (uCelestial > 0.5) {
                                                                              
    vec3 cell = floor(dir * 220.0);
    float star = step(1.0 - uStarDensity * 0.04, hash13(cell));
    float tw = 0.75 + 0.25 * hash13(cell + 19.0);
    float starM = star * tw * uStars * smoothstep(0.0, 0.12, h);
    if (uNightSky > 0.5) {
                                                                             
                                                                         
                                                                     
                                                              
      float mw = rswMilkyWay(dir);
      float star2 = step(1.0 - clamp(uStarDensity * (0.028 + 0.05 * mw), 0.0, 0.5), hash13(cell));
      float amp = rswStarMagAmp(hash13(cell + 7.0));
      float twk = 1.0 + 0.22 * sin(uSkyTime * (2.0 + 4.0 * hash13(cell + 29.0)) + hash13(cell + 41.0) * 6.2831);
      float m2 = star2 * amp * twk * uStars * smoothstep(0.0, 0.12, h);
                                                                             
                                                                           
                                                                             
                                                     
      float mwGlow = mw * 0.045 * uStars * smoothstep(0.0, 0.2, h) * clamp(uStarDensity * 10.0, 0.0, 1.0);
                                                               
      vec3 cellD = floor(dir * 520.0);
      float starD = step(1.0 - clamp(uStarDensity * (0.05 + 0.06 * mw), 0.0, 0.6), hash13(cellD));
      float mD = starD * rswStarLayer2Amp(hash13(cellD + 7.0)) * uStars * smoothstep(0.0, 0.12, h);
      col += (rswStarColor(hash13(cell + 57.0)) * m2 + rswStarColor(hash13(cellD + 57.0)) * mD + vec3(0.55, 0.62, 0.85) * mwGlow) * rswSkyT;
      alpha = max(alpha, clamp((m2 + mD + mwGlow) * rswSkyT, 0.0, 1.0));
    } else {
      col += vec3(starM * rswSkyT);
      alpha = max(alpha, starM * rswSkyT);
    }
                                                                              
    float sc = dot(dir, uSunDir);
    float sunDisc = smoothstep(uSunCos - 0.0008, uSunCos + 0.0008, sc);
    float glow = pow(clamp(sc, 0.0, 1.0), 80.0) * (0.35 + uAtmoGlare * 1.6);
    if (uSunTexOn > 0.5) {
                                                                             
                                                                             
      vec3 sunRight = normalize(cross(abs(uSunDir.y) > 0.98 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0), uSunDir));
      vec3 sunUpV = cross(uSunDir, sunRight);
      float sunSin = sqrt(max(1.0 - uSunCos * uSunCos, 1e-6));
      vec2 sunUV = vec2(dot(dir, sunRight), dot(dir, sunUpV)) / sunSin * 0.5 + vec2(0.5);
      vec4 sunSmp = texture2D(uSunTex, clamp(sunUV, 0.0, 1.0));
      float sunM = sunDisc * sunSmp.a;
                                                                              
                                                                          
                                                                             
      col += uSunColor * (sunSmp.rgb * sunM * 1.5 + glow) * rswSkyT;
      alpha = max(alpha, clamp(sunM + glow, 0.0, 1.0) * rswSkyT);
    } else {
      col += uSunColor * (sunDisc * 1.5 + glow) * rswSkyT;                        
      alpha = max(alpha, clamp(sunDisc + glow, 0.0, 1.0) * rswSkyT);
    }
                                                                      
    float mc = dot(dir, uMoonDir);
    float moonDisc = smoothstep(uMoonCos - 0.001, uMoonCos + 0.001, mc);
                                                                            
                                                                         
                                                                
    float moonLit = 1.0;
    if (uNightSky > 0.5) {
      vec3 mRt = normalize(cross(abs(uMoonDir.y) > 0.98 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0), uMoonDir));
      vec3 mUp = cross(uMoonDir, mRt);
      float mSin = sqrt(max(1.0 - uMoonCos * uMoonCos, 1e-6));
      vec2 mLoc = vec2(dot(dir, mRt), dot(dir, mUp)) / mSin;
      moonLit = rswMoonShade(mLoc, uMoonPhase);
      float halo = pow(clamp(mc, 0.0, 1.0), 320.0) * (1.0 - moonDisc);
      float haloM = halo * (0.35 + 0.65 * rswMoonLitFrac(uMoonPhase)) * uStars * rswSkyT;                         
      col += vec3(0.62, 0.68, 0.85) * haloM;
      alpha = max(alpha, clamp(haloM * 0.5, 0.0, 1.0));
    }
    if (uMoonTexOn > 0.5) {
                                                                        
      vec3 moonRight = normalize(cross(abs(uMoonDir.y) > 0.98 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0), uMoonDir));
      vec3 moonUpV = cross(uMoonDir, moonRight);
      float moonSin = sqrt(max(1.0 - uMoonCos * uMoonCos, 1e-6));
      vec2 moonUV = vec2(dot(dir, moonRight), dot(dir, moonUpV)) / moonSin * 0.5 + vec2(0.5);
      vec4 moonSmp = texture2D(uMoonTex, clamp(moonUV, 0.0, 1.0));
      float moonM = moonDisc * moonSmp.a;
      col += moonSmp.rgb * moonM * 0.9 * moonLit * rswSkyT;                        
      alpha = max(alpha, moonM * 0.9 * max(moonLit, 0.22) * rswSkyT);
    } else {
      col += vec3(0.82, 0.86, 0.95) * moonDisc * 0.9 * moonLit * rswSkyT;                        
      alpha = max(alpha, moonDisc * 0.9 * max(moonLit, 0.22) * rswSkyT);
    }
  }
                                                                             
                                                                           
                                                  
  if (uCloudsOn > 0.5) {
    vec4 rswCl = rswClouds(uCloudTex, dir, uSunDir, uSunColor, uCloudColor, uCloudCover, uCloudDensity, uSkyTime, uCloudWind, clamp(uStars, 0.0, 1.0));
    float rswClA = min(rswCl.a, 0.96);
    col = mix(col, rswCl.rgb, rswClA);
    alpha = max(alpha, rswClA);
  }
  gl_FragColor = vec4(col, alpha);
}
`;

export function createLightingRenderer({
  THREE,
  scene,
  camera,
  renderer,
  getSceneRenderTarget = () => null,
  getMeshes,
  getCameraTarget,
  requestRender,
  setPoolLightingModel,
  getTerrainBounds,
  getTerrainGiBoxes,
}) {
  let disposed = false;
  let lightingDirty = true;
  let structureDirty = true;
  let applying = false;                                                    
  let matKind = "lambert";                                                  


  let smLiteOn = false;
  let shadowsEnabled = true;
  let specScale = 1;
  let smLitePlanNow = null;                                                                        
  let modeKey = "";                                                            
  let curTech = "ShadowMap";
  let skySignature = null;
  let skyCube = null;


  let envSig = null;
  let envRT = null;
  const environmentPrefilter = createIncrementalEnvironmentPrefilter({
    THREE, renderer, requestRender,
    onReady({ key, target }) {
      const previousTarget = envRT;
      envRT = target;
      envSig = key;
      scene.environment = target.texture;
      warmupPending = true;
      shadowsDirty = true;
      try { previousTarget?.dispose(); } catch {                                         }
    },
    onError({ key, error }) {
      logger.warn("[Lighting] Environment preparation failed; retaining the last complete map.", error);
      if (key === "hdri:" + hdriCtl.sig && hdriCtl.tex) {
        hdriCtl.status = "error";
        hdriCtl.error = "pmrem: " + String(error?.message || error);
        hdriTexDispose();
        refreshReflectanceEnvMaps();
        lightingDirty = true;
      }
    },
  });
  let selIds = new Set();
  let vizDirty = true;


  let shadowsDirty = true;





  let localShadowCasterRevision = 1;
  function markLocalShadowCastersChanged() {
    localShadowCasterRevision += 1;
  }


  let fxWanted = false;
  let fxPatched = false;


  let smLitePcssOn = false;


  let shadowEdgeFilterOn = false;
  const externalMats = new Set();
  const subs = [];


  let curSoftness = 0.2;
  let curPcssBoost = 1;
  let curPcssOn = false;


  let curSmPlus = false;


  let curSkyPhys = null;


  let smLiteAmbQa = null;


  let cloudsQa = null;
  let nightSkyQa = null;
  let cloudAnimWeak = false;
  let lastCloudAnimMs = 0;
  let cloudAnimTimer = 0;


  let temporalOn = false;
  let temporalFrame = 0;
  let temporalResets = 0;
  const lastTemporalSunDir = { x: 0, y: 0, z: 0 };
  let sunWinHalf = 0;


  let appliedSunViewFit = null;


  let lastSunViewFitQuantum = -1;
  let cachedShadowBounds = null;
  let safeModeTech = null;
  let safeModeStamp = 0;
  let safeRetries = 0;
  let hardSafeMode = false;
  let hardRetries = 0;


  const threeRevisionOk = String(THREE.REVISION) === "161";
  let threeRevisionWarned = false;


  const gpuBudget = detectGpuBudget(renderer);


  const shadowTier = computeShadowTier({
    weak: gpuBudget.weak,
    maxTextures:
      renderer.capabilities && renderer.capabilities.maxTextures
        ? renderer.capabilities.maxTextures
        : 16,
  });
  let fxWarmup = 0;
  let rtWeakWarned = false;

  let gpuLiteWarned = false;


  let warmupPending = false;
  let warmupCompiling = false;
  let warmupStamp = 0;


  const WARMUP_TIMEOUT_MS = 30000;


  const warmupSlicer = createCompileSlicer({ budgetMs: 4, minPerFrame: 1, maxPerFrame: 16 });
  const shaderProgramWarmup = createShaderProgramWarmup({ readPrograms: () => renderer.info?.programs || [] });
  let warmupError = null;
  const warmupStub = new THREE.Scene();
  const warmupNowMs = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());


  function warmupSliceCompileOne(unit) {
    return compileMaterialUnit({
      renderer, scratchScene: warmupStub, camera, targetScene: scene, unit,
      renderTarget: getSceneRenderTarget(),
    });
  }


  const warmupStager = createWarmupStager({ order: WARMUP_STAGE_ORDER });
  const tdrWatchdog = createTdrWatchdog({});
  let stagedWarmupOn = false;
  let warmupToastId = null;
  let warmupTdrReported = false;
  let warmupSlowLogged = false;
  let warmupStageStamp = 0;


  let warmupTailFrames = 0;
  function warmupToastHide() {
    if (!warmupToastId) return;
    try {
      NotificationService.dismiss(warmupToastId);
    } catch (_e) {                                         }
    warmupToastId = null;
  }
  function warmupToastShow(techName) {
    warmupToastHide();
    try {
      warmupToastId = NotificationService.notify(
        "info",
        stageToastMessage({ tech: techName, compiling: true }),
        { duration: 0, progress: 0 },
      );
    } catch (_e) {
      warmupToastId = null;
    }
  }
  function warmupToastUpdate(message, progress) {
    if (!warmupToastId) return;
    try {
      NotificationService.update(warmupToastId, { message, progress });
    } catch (_e) {                 }
  }


  function warmupStageFinish(ok, totalMs) {
    warmupToastHide();
    if (!ok) return;
    try {
      NotificationService.notify(
        "success",
        "Iluminação " + curTech + " pronta" + (Number.isFinite(totalMs) && totalMs > 0 ? " em " + Math.round(totalMs / 100) / 10 + " s" : "") + ".",
        { duration: 4 },
      );
    } catch (_e) {                 }
  }


  function onWarmupContextLost() {
    substrateSmPipeline.contextLost();
    environmentPrefilter.cancel();
    tdrWatchdog.noteContextLost();
    warmupSlicer.cancel();                                                                                 
    logger.warn(buildTdrReport({
      kind: "contexto WebGL perdido (device reset)",
      tech: curTech,
      gpuReason: (gpuBudget && gpuBudget.reason) || "",
      stage: warmupStager.debug(),
      watchdog: tdrWatchdog.debug(),
      action: warmupStager.isActive()
        ? "rampa escalonada abortada; aguardando restauração automática do contexto"
        : "aguardando restauração automática do contexto",
    }));
    warmupStager.cancel();
    warmupToastHide();
  }
  if (renderer && renderer.domElement && typeof renderer.domElement.addEventListener === "function") {
    renderer.domElement.addEventListener("webglcontextlost", onWarmupContextLost);
  }
  const sunWinCenter = new THREE.Vector3(0, 0, 0);
  const shadowBox3 = new THREE.Box3();


  const giInitialTier = initialTierFor(gpuBudget.weak);
  const gi = createVoxelGI({ THREE, renderer, weakGpu: gpuBudget.weak, tier: giInitialTier });
  const giProf = gi.getProfile ? gi.getProfile() : { weak: false, baseBudgetMs: 5 };


  let giLedgerStampF15 = 0;
  let giHeadroomMsF15 = NaN;
  let giActive = false;
  let giDirty = true;
  let lastGiKick = 0;

  let giBouncePlanCur = null;
  let lastGiEmissives = 0;


  let lastGiTransBoxes = 0;


  let lastGiFocus = null;


  let giAmbSynced = false;
  const giSun = { dir: [0, 1, 0], color: [1, 1, 1], intensity: 1 };
  const giBox3 = new THREE.Box3();
  const giV1 = new THREE.Vector3();
  const giV2 = new THREE.Vector3();


  const shadowHardCap = hardCapFromGpu((renderer && renderer.capabilities) || {});


  const shadowCtl = createBudgetController({ hardCap: shadowHardCap, targetMs: 25, start: 6 });

  const tierCtl = createTierController({
    initial: initialTierFor(gpuBudget.weak),
    maxTier: maxTierFor(gpuBudget.weak),


    minTier: minTierFor(gpuBudget.weak),
    targetMs: 25,
    minHoldMs: 1000,
    upHoldMs: 3000,


    upCadenceMs: 18.5,
    bootGraceMs: 5000,
  });
  let tierCfg = tierConfig(tierCtl.getTier());
  let tierChanges = 0;


  let biasPrevKey = "";


  function biasF7On() {
    if (typeof window !== "undefined") {
      if (window.__rswBiasF7 === false) return false;
      if (window.__rswBiasF7 === true) return true;
    }
    return !!(gpuBudget && gpuBudget.weak);
  }
  let camPrev = { x: NaN, y: NaN, z: NaN, qx: 2, qy: 2, qz: 2, qw: 2 };
  let camMoveBoost = 0;
  let lastFrameStamp = 0;


  let idleShadowNeed = 0;


  const stopShadowIdleInterval = startVisibilityAwareInterval(() => {
          if (disposed) return;
          const tNow = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
          const r = shadowCtl.idleTick(tNow);

          if (r && r.changed && r.budget <= idleShadowNeed) {
            markShadowsDirty();
            requestRender();
          }
        }, 500);


  const pcss = createPcssShadows({ THREE, weakGpu: gpuBudget.weak });


  const smrtQa = { injected: pcss.smrtSupported === true, on: false, steps: 0 };
  const smrtArgs = { on: false, steps: 0 };


  const passTiming = createPassTiming({ renderer });


  const shaderDiet = createShaderDiet({ renderer, weakGpu: gpuBudget.weak });

  const caps = createCapsuleShadows({ THREE });


  const hfog = createHeightFogPatch({ THREE });

  const rprobes = createReflectionProbes({ THREE });

  const iesck = createIesCookiePatch({ THREE });
  const areaPt = createAreaPartsPatch({ THREE });                                       












  const llGateContextCache = createLocalLightGateContextCache({
    readWeakGpu: () => !!(gpuBudget && gpuBudget.weak),
    readEngineTier: () => tierCtl.getTier(),
    resolveTier: resolveLocalLightTier,
  });
  const localLightTier = () => llGateContextCache.tier();






  let curLightingTechnology = DEFAULT_LIGHTING_TECHNOLOGY;
  const msmNativePartition = createMsmNativePartitionFeed();
  const llLocalLights = createLocalLightPatchRegistry({
    THREE,
    getPatchContext: () => llGateContextCache.contextFor(curLightingTechnology),
  });





  const megaLightsPipeline = createMegaLightsPipeline({ THREE, renderer, scene });
  const megaLightsDebug = createMegaLightsDebugBridge({
    THREE, renderer, scene, pipeline: megaLightsPipeline,
    readLighting: lightingInst,
    requestRender,
    onFlagsChanged() {
      lightingDirty = true;
      scene.traverse((node) => {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials) if (material) material.needsUpdate = true;
      });
      requestRender();
    },
  });
  const substratePipeline = createSubstratePipeline({ THREE, renderer, scene,
    onReady() { if (!disposed) { lightingDirty = true; requestRender(); } },
    onError(error) { console.warn("Substrate stayed on the legacy renderer:", error); },
  });
  const substrateSmPipeline = createSubstrateSmPipeline({ THREE, renderer, scene,
    onReady() { if (!disposed) { lightingDirty = true; requestRender(); } },
    onError(error) { console.warn("Substrate SM retained the previous renderer:", error); },
  });
  const substrateSmSettings = createSubstrateSmHostSettings(substrateSmPipeline);



  const megaLightsFrameRequestBuf = {
    camera: null,
    technology: "",
    tierName: "",
    lights: null,
    frameIndex: 0,
    pixelWidth: 0,
    pixelHeight: 0,
    nowMilliseconds: 0,
    deltaMilliseconds: 0,
  };




  const llFalloff = registerLocalLightFalloffPhase({
    registry: llLocalLights,
    getLightFalloffOverrides: () => [],
  });





  const llSpotCone = registerLocalLightSpotConePhase({ registry: llLocalLights });








  const llSourceShape = registerLocalLightSourceShapePhase({ registry: llLocalLights, logger });








  const llAreaSpecular = registerLocalLightAreaSpecularPhase({ registry: llLocalLights, logger });






  const llRectExtras = registerLocalLightRectExtrasPhase({ registry: llLocalLights, logger });





  const llMaterialParity = registerLocalLightMaterialParityPhase({ registry: llLocalLights, logger });








  const llLocalHdr = registerLocalLightHdrPhase({ registry: llLocalLights, logger });












  const llShadowAtlas = registerLocalLightShadowAtlasPhase({ registry: llLocalLights, logger });
  const llAtlasFeed = createDeterministicAtlasFeed({ logger });





  const llPointShadow = registerLocalLightPointShadowPhase({ registry: llLocalLights, logger });
  const llPointFeed = createPointCubeAtlasFeed({ logger });







  const llShadowResolution = createShadowResolutionFeed({ logger });








  const llShadowCache = createShadowCacheFeed({ logger });









  const llLocalShadowInvalidation = createLocalLightShadowInvalidationFeed({ logger });









  const msmAtlasRedrawPolicy = createMsmAtlasRedrawPolicyFeed({ logger });









  const llShadowSource = registerLocalLightShadowSourcePhase({ registry: llLocalLights, logger });












  const llContactShadowPatch = registerLocalLightContactShadowPhase({ registry: llLocalLights, logger });
  const llContactShadowFeed = createContactShadowFeed({ THREE, scene, camera, renderer, logger });










  const llTransmission = registerLocalLightTransmissionPhase({ registry: llLocalLights, logger });
  const llTransmissionFeed = createTransmissionFeed({ THREE, registry: llLocalLights, logger });







  const llVolumetricFeed = createLocalVolumetricFeed({ logger });
  let llVolumetricPassExtension = null;




  const llGiLocal = registerLocalLightGiPhase({ THREE, registry: llLocalLights, logger });





  const llLightFade = createLocalLightFadeFeed({ logger });








  const llLocalShadowReuse = createLocalShadowReuseFeed({ logger });









  const llLightProxy = registerLocalLightProxyPhase({ registry: llLocalLights, logger });






  const llPhotometricUnits = registerLocalLightPhotometricUnitsPhase({
    resolveIesProfile: (iesProfileRef) => {
      const presetName = typeof iesProfileRef === "string" ? iesProfileRef.toLowerCase() : "";
      if (presetName === "" || RSW_IES_PRESETS.indexOf(presetName) === -1) return null;
      return iesPresetProfile(presetName);
    },
  });





  const llClusterShading = registerLocalLightClusterShadingPhase({ registry: llLocalLights, logger });
  const llClusterFeed = createLocalLightClusterFeed({ THREE, logger });



  const llPublicApi = publishLocalLightPublicApi({ getTier: () => localLightTier(), logger });



  const llProofBattery = publishLocalLightProofBattery({
    getTextureUnits: () => (typeof llQa.texUnitsTotal === "function" ? llQa.texUnitsTotal() : null),
    logger,
  });


  const llBlindRound = publishLocalLightBlindRound({ getTier: () => localLightTier(), logger });






  publishLocalLightWiringAudit({
    registry: llLocalLights,
    phaseHandles: [
      { phaseId: "LL-F1" },
      llFalloff,
      llSpotCone,
      llSourceShape,
      llPhotometricUnits,
      llAreaSpecular,
      llRectExtras,
      llMaterialParity,
      llLocalHdr,
      llShadowAtlas,
      llPointShadow,
      llShadowResolution,
      llShadowCache,
      llShadowSource,
      llContactShadowPatch,
      llTransmission,
      llVolumetricFeed,
      llGiLocal,
      llLightFade,
      llLightProxy,
      llClusterShading,
      llPublicApi,
      llProofBattery,
      llBlindRound,
    ],
  });


  const envcap = createEnvCapture({ THREE });










  let envCapPumpTimer = 0;



  const specAa = createSpecularAaPatcher({
    parsChunk: (THREE.ShaderChunk && THREE.ShaderChunk.lights_physical_pars_fragment) || "",
    physicalChunk: (THREE.ShaderChunk && THREE.ShaderChunk.lights_physical_fragment) || "",
  });
  let specAaAutoPrev = null;                                                      



  const specOcc = createSpecOccPatcher({
    lightsEndChunk: (THREE.ShaderChunk && THREE.ShaderChunk.lights_fragment_end) || "",
  });
  let specOccAutoPrev = null;                                              
  let specOccPhongAutoPrev = null;                                                   
  let curRenderStyle = "Classic";



  let capsCurW = 1;
  let capsWanted = false;                            
  let capsBlobMode = false;                                          

  let iesCkWanted = false;
  let areaPtWanted = false;          

  let mglWanted = false;
  let areaTubeCount = 0;            
  let iesCkOverflow = 0;
  const iesCkCells = new Map();                                                                             
  const iesCkOrderBuf = [];
  const iesCkByLightId = new Map();
  let curPatchSig = "";                                                      
  const capChars = new Map();                                              
  let lastCapsUpdate = 0;
  let capsLastSel = null;                                                              
  const capM4 = new THREE.Matrix4();






  const farShadows = createFarShadows({ THREE, renderer, weakGpu: gpuBudget.weak });



  if (gi.setTerrainProvider) gi.setTerrainProvider(() => farShadows.getHeightfield());
  let farDirty = true;
  let lastFarBake = 0;









  const featGov = createFeatureGovernor({
    weak: gpuBudget.weak,
    maxTextures:
      renderer.capabilities && renderer.capabilities.maxTextures
        ? renderer.capabilities.maxTextures
        : 16,
    farUnits: farShadows.texUnits === 1 ? 1 : 2,
    getLedger: () => passTiming.getLedger(),





    upCadenceMs: 18.5,
  });
  let featGovWanted = false;                                                       






  let featGovSceneKey = "";




  let lastFrameCostMs = 0;



  const rtSun = createRtSunShadows({ THREE, renderer, scene, camera, pcss, requestRender });






  const photoMode = createPhotoMode({ requestRender });
  let photoWanted = false;
  let photoState = null;

  const sunMask = createSunShadowMask({ THREE, scene, camera });
  let maskWanted = false;
  let maskFrame = 0;



  let maskFullWas = false;
  let maskFullFlipMs = 0;
  let maskCostEma = 0;
  let maskFullLogged = false;


  const maskDrawSize = new THREE.Vector2();
  const maskScaleArr = [0, 0, 0, 0];



  const trans = createTransmissionShadows({ THREE, renderer, rtSize: transRtSizeFor(gpuBudget.weak === true) });
  let transWanted = false;

  const matFeat = createMaterialFeatures({ THREE });
  let matFeatWanted = false;


  let transActive = false;
  let transSig = "";





  const transDirtyOnly = gpuBudget.weak === true;
  const transGate = createTransDirtyGate({ weak: gpuBudget.weak === true });
  let transListSig = "";




  let transRenderedEmpty = false;
  const transList = [];
  const transDirToSun = new THREE.Vector3(0, 1, 0);
  const transWin = { center: { x: 0, y: 0, z: 0 }, half: 60, dirToSun: { x: 0, y: 1, z: 0 } };

  let mlWanted = false;
  const mlLights = [];
  const msmLocalLightFeed = createMsmLocalLightFeed();
  const msmAtlasCoveredKeys = new Set();



  let shadowAtlas = null;
  let atlasWanted = false;



  let atlasDepthHook = null;
  const mlAtlasStateBuf = { on: false, tex: null, metaTex: null, size: 0, bias: SA_DEFAULT_BIAS, samplesK: SA_DEFAULT_SAMPLES, topCount: 0 };


  const mlPool = [];



  const mlSpotBuf = [];
  let mlBaseLum = 1;

  let clWanted = false;
  const clSettingsBuf = sanitizeClusterSettings();


  const clOverride = { on: null, specStrength: null };






  const lsrCtl = createShadowRotation();
  let lsrWanted = false;                                                
  let lsrActive = false;                                                  
  let lsrPulse = false;                                                     
  let lsrPending = 0;                                            


  let localShadowRedrawPulse = false;
  let lsrBudget = 0;                                                     
  let lsrSunManaged = false;                                                          
  const lsrCandBuf = [];                                                  



  const lsrCandPool = [];


  const llReuseCandBuf = [];
  const llReuseCandPool = [];

  const sunDir = new THREE.Vector3(0, 1, 0);
  const lightDir = new THREE.Vector3(0, 1, 0);
  const tmpV = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();
  const tmpC = new THREE.Color();
  const Y_DOWN = new THREE.Vector3(0, -1, 0);
  const Z_PLUS = new THREE.Vector3(0, 0, 1);




  const grade = {
    exposure: 1,
    bright: 1,
    tint: { r: 1, g: 1, b: 1 },
    punch: 1,
    lift: 0,



    tonemap: 0,



    grading: null,
    sunIntensity: 1,
  };





  let gradingCacheSig = null;
  let gradingCachePlan = null;
  const gradingHandle = { wheels: null, lutParsed: null, lutLabel: "", rev: 0 };



  let photometryQa = { style: "Classic", on: false };






  let localLightPhoto = null;
  let localLightPhotoRev = 0;
  let lightPhotometryQa = { on: false, mode: "auto-off" };


  const aoState = {
    ao: false,
    contact: false,
    csScale: 1,
    csSteps: 12,
    sunDirView: { x: 0, y: 0, z: 1 },


    csLocal: { on: false, pos: { x: 0, y: 0, z: 0 }, range: 0, steps: 6, spread: 0 },


    bent: false,
    hemiFrac: 0,
    upView: { x: 0, y: 1, z: 0 },
    temporal: false,
    resetCount: 0,
    frame: 0,


    lite: false,
  };

  let skyOcclusionOn = false;


  let csLocalWanted = false;
  const cfFuse = sanitizeContactFuse({});
  const aoDirTmp = new THREE.Vector3();
  const aoMatTmp = new THREE.Matrix4();


  const group = new THREE.Group();
  group.name = "rsw-lighting";
  caps.attachBlobs(group);                                            

  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  const sunTarget = new THREE.Object3D();
  sun.target = sunTarget;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -180;
  sun.shadow.camera.right = 180;
  sun.shadow.camera.top = 180;
  sun.shadow.camera.bottom = -180;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 1500;


  sun.shadow.bias = -0.00002;
  sun.shadow.normalBias = 0.1;


  const csmGhosts = [];
  for (let ci = 0; ci < CSM_MAX_CASCADES - 1; ci++) {
    const g = new THREE.DirectionalLight(0xffffff, 0);
    g.castShadow = false;
    g.shadow.mapSize.set(2048, 2048);
    g.shadow.camera.left = -180;
    g.shadow.camera.right = 180;
    g.shadow.camera.top = 180;
    g.shadow.camera.bottom = -180;
    g.shadow.camera.near = 1;
    g.shadow.camera.far = 1500;
    g.shadow.bias = -0.00002;
    g.shadow.normalBias = 0.1;
    g.shadow.radius = CSM_GHOST_RADIUS_MARKER;
    g.shadow.autoUpdate = false;
    csmGhosts.push(g);
  }
  let csmActive = false;
  let csmCount = 1;
  const csmSigs = ["", "", "", ""];
  const csmFwd = new THREE.Vector3();


  let weakIgnitionQa = null;


  let rodizioWanted = false;
  let rodizioPointer = 0;
  let rodizioPending = false;
  let rodizioLogged = false;
  const rodizioPrevFwd = { x: 0, y: 0, z: 0, t: 0 };

  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x3a3a3a, 0.9);
  const amb = new THREE.AmbientLight(0xffffff, 0.8);


  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  const lastSunFocus = new THREE.Vector3(Infinity, Infinity, Infinity);


  const vsm = createSunShadowPages({
    THREE,
    renderer,
    scene,
    sun,
    getFocus: () => lastSunFocus,
    requestRender,
    getCascadeLights: () => csmGhosts,
  });
  let vsmWanted = false;


  const clipmap = createSunClipmap({});


  const clipmapRender = createSunClipmapRender({ THREE, renderer });


  let boundsComputedAt = 0;
  let lastDynGiKick = 0;
  let pendingDynGi = false;
  let dynGiTimer = 0;

  function markShadowsDirty(rec) {


    if (rec && clipmap.isActive()) {
      if (rec.terrainAabb) {
        clipmap.noteRegion(rec.terrainAabb);
      } else if (rec.instance && rec.instance.getProperty) {
        const cAabb = partAabb(rec.instance.getProperty("Position"), rec.instance.getProperty("Size"));
        if (cAabb) clipmap.noteAabb(cAabb);
      }
    }
    if (rec && rec.instance && vsmNotePartEdit(rec.instance)) return;


    if (rec && rec.terrainAabb && vsmWanted && vsm.isActive()) {
      if (vsm.noteRegion(rec.terrainAabb)) return;
    }
    shadowsDirty = true;
  }


  function vsmNotePartEdit(inst) {
    if (!vsmWanted || !vsm.isActive() || !inst || !inst.getProperty) return false;


    const aabb = partAabb(inst.getProperty("Position"), inst.getProperty("Size"));
    if (!aabb) return false;


    for (const entry of localLights.values()) {
      if (!entry || !entry.light || !entry.light.castShadow || !entry.light.visible) continue;
      const p = entry.light.position;
      const reach = (Number(entry.light.distance) || 8) + 0.5;
      if (sphereIntersectsAabb(p.x, p.y, p.z, reach, aabb)) {


        vsm.noteAabb(inst.id, aabb);
        return false;
      }
    }
    return vsm.noteAabb(inst.id, aabb);
  }


  function markGiDirty() {
    if (disposed) return;
    giDirty = true;
    farDirty = true;                                                   
    requestRender();
  }


  function sameMatrix16(a, b) {
    for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function computeSceneShadowBounds() {
    let mnx = Infinity, mny = Infinity, mnz = Infinity;
    let mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    function fold(ax, ay, az, bx, by, bz) {
      if (ax < mnx) mnx = ax;
      if (ay < mny) mny = ay;
      if (az < mnz) mnz = az;
      if (bx > mxx) mxx = bx;
      if (by > mxy) mxy = by;
      if (bz > mxz) mxz = bz;
    }
    const tb = typeof getTerrainBounds === "function" ? getTerrainBounds() : null;
    if (
      tb && tb.min && tb.max &&
      Number.isFinite(tb.min[0]) && Number.isFinite(tb.max[0]) &&
      Number.isFinite(tb.min[1]) && Number.isFinite(tb.max[1]) &&
      Number.isFinite(tb.min[2]) && Number.isFinite(tb.max[2])
    ) {
      fold(tb.min[0], tb.min[1], tb.min[2], tb.max[0], tb.max[1], tb.max[2]);
    }
    const meshesMap = getMeshes ? getMeshes() : null;
    const vals = meshesMap && meshesMap.values ? meshesMap.values() : [];
    let seen = 0;
    for (const obj of vals) {
      if (!obj || obj.visible === false) continue;
      if (++seen > 8000) break;
      if (obj.isInstancedMesh && obj.userData.__rswPool) {


        const attr = obj.instanceMatrix;
        let bc = obj.userData.__rswShadowAabb;
        if (bc && bc.attr === attr && bc.ver === attr.version && bc.count === obj.count) {
          if (bc.has) fold(bc.nx, bc.ny, bc.nz, bc.px, bc.py, bc.pz);
          continue;
        }
        const me = attr.array;
        let pnx = Infinity, pny = Infinity, pnz = Infinity;
        let ppx = -Infinity, ppy = -Infinity, ppz = -Infinity;
        for (let i = 0; i < obj.count; i++) {
          const o = i * 16;


          const lx2 = me[o] * me[o] + me[o + 1] * me[o + 1] + me[o + 2] * me[o + 2];
          const ly2 = me[o + 4] * me[o + 4] + me[o + 5] * me[o + 5] + me[o + 6] * me[o + 6];
          const lz2 = me[o + 8] * me[o + 8] + me[o + 9] * me[o + 9] + me[o + 10] * me[o + 10];
          if (Math.max(lx2, ly2, lz2) < 0.0025) continue;
          const r = Math.sqrt(lx2 + ly2 + lz2) / 2;
          if (!Number.isFinite(r) || r > 4096) continue;
          const cx = me[o + 12], cy = me[o + 13], cz = me[o + 14];
          if (!Number.isFinite(cx + cy + cz)) continue;
          if (Math.abs(cx) + Math.abs(cy) + Math.abs(cz) > 60000) continue;
          if (cx - r < pnx) pnx = cx - r;
          if (cy - r < pny) pny = cy - r;
          if (cz - r < pnz) pnz = cz - r;
          if (cx + r > ppx) ppx = cx + r;
          if (cy + r > ppy) ppy = cy + r;
          if (cz + r > ppz) ppz = cz + r;
        }
        if (!bc) {
          bc = { attr: null, ver: -1, count: -1, has: false, nx: 0, ny: 0, nz: 0, px: 0, py: 0, pz: 0 };
          obj.userData.__rswShadowAabb = bc;
        }
        bc.attr = attr;
        bc.ver = attr.version;
        bc.count = obj.count;
        bc.has = Number.isFinite(pnx);
        if (bc.has) {
          bc.nx = pnx; bc.ny = pny; bc.nz = pnz;
          bc.px = ppx; bc.py = ppy; bc.pz = ppz;
          fold(pnx, pny, pnz, ppx, ppy, ppz);
        }
        continue;
      }


      const geoM = obj.geometry;
      const leafM = !obj.children || obj.children.length === 0;
      if (leafM && geoM) {
        obj.updateWorldMatrix(false, false);
        const posM = geoM.attributes ? geoM.attributes.position : null;
        const pverM = posM ? posM.version : -1;
        const emM = obj.matrixWorld.elements;
        let mc = obj.userData.__rswShadowAabbM;
        if (mc && mc.geo === geoM && mc.pver === pverM && sameMatrix16(mc.m, emM)) {
          if (mc.has) fold(mc.nx, mc.ny, mc.nz, mc.px, mc.py, mc.pz);
          continue;
        }
        shadowBox3.setFromObject(obj);
        let hasM = false;
        if (!shadowBox3.isEmpty()) {
          const mdM = Math.max(
            shadowBox3.max.x - shadowBox3.min.x,
            shadowBox3.max.y - shadowBox3.min.y,
            shadowBox3.max.z - shadowBox3.min.z,
          );
          hasM = Number.isFinite(mdM) && mdM >= 0.05 && mdM <= 4096;
        }
        if (!mc) {
          mc = { geo: null, pver: -1, m: new Float64Array(16), has: false, nx: 0, ny: 0, nz: 0, px: 0, py: 0, pz: 0 };
          obj.userData.__rswShadowAabbM = mc;
        }
        mc.geo = geoM;
        mc.pver = pverM;
        for (let k = 0; k < 16; k++) mc.m[k] = emM[k];
        mc.has = hasM;
        if (hasM) {
          mc.nx = shadowBox3.min.x; mc.ny = shadowBox3.min.y; mc.nz = shadowBox3.min.z;
          mc.px = shadowBox3.max.x; mc.py = shadowBox3.max.y; mc.pz = shadowBox3.max.z;
          fold(mc.nx, mc.ny, mc.nz, mc.px, mc.py, mc.pz);
        }
        continue;
      }
      shadowBox3.setFromObject(obj);
      if (shadowBox3.isEmpty()) continue;
      const sx = shadowBox3.max.x - shadowBox3.min.x;
      const sy = shadowBox3.max.y - shadowBox3.min.y;
      const sz = shadowBox3.max.z - shadowBox3.min.z;
      const md = Math.max(sx, sy, sz);
      if (!Number.isFinite(md) || md < 0.05 || md > 4096) continue;
      fold(
        shadowBox3.min.x, shadowBox3.min.y, shadowBox3.min.z,
        shadowBox3.max.x, shadowBox3.max.y, shadowBox3.max.z,
      );
    }
    if (!Number.isFinite(mnx)) return null;
    return { min: [mnx, mny, mnz], max: [mxx, mxy, mxz] };
  }


  const csmFitPrev = { valid: false, bounds: null, persp: false, v: new Float64Array(21) };


  function setCsmActive(on) {
    if (csmActive === on) return;
    csmActive = on;
    csmFitPrev.valid = false;                                                 
    sun.shadow.autoUpdate = !on;
    csmSigs[0] = csmSigs[1] = csmSigs[2] = csmSigs[3] = "";
    if (on) {
      for (const g of csmGhosts) group.add(g, g.target);
      sun.shadow.needsUpdate = true;
    } else {
      csmCount = 1;
      for (const g of csmGhosts) {
        g.castShadow = false;
        group.remove(g, g.target);
        if (g.shadow.map) {
          g.shadow.map.dispose();
          g.shadow.map = null;
        }
      }
      sun.shadow.needsUpdate = true;
      pcss.setCsm({ on: false });

      sunWinHalf = 0;
    }

    if (vsmWanted) vsm.syncCsm({ on, count: on ? csmCount : 1 });
    shadowsDirty = true;
  }


  function updateCsmWindows() {
    const res = sun.shadow.mapSize.x;


    const resGhost = Math.max(512, Number(tierCfg.csmRes) || 2048);
    const res0Base = Math.min(resGhost, Math.max(512, Number(tierCfg.csmRes0) || resGhost));


    const res0Qa = typeof window !== "undefined" ? Number(window.__rswCsmRes0Qa) : NaN;
    const res0Cfg = Number.isFinite(res0Qa) && res0Qa >= 256 && res0Qa <= 4096
      ? Math.min(resGhost, Math.round(res0Qa))
      : res0Base;


    const biasOn = biasF7On();
    const biasProf = biasProfileFor(biasOn ? tierCtl.getTier() : null);
    const biasKey = (biasOn ? biasProf.tier : "off") + "|" + res0Cfg;
    if (biasKey !== biasPrevKey) {
      biasPrevKey = biasKey;
      csmFitPrev.valid = false;
    }


    const rodizioOn = rodizioWanted && csmActive;
    const res0Want = rodizioOn ? hotCascadeRes(res0Cfg) : res0Cfg;


    camera.getWorldDirection(csmFwd);
    const maxTexNow =
      renderer.capabilities && renderer.capabilities.maxTextures ? renderer.capabilities.maxTextures : 16;
    const pv = csmFitPrev.v;
    if (
      csmFitPrev.valid && !shadowsDirty &&

      !(rodizioOn && rodizioPending) &&
      csmFitPrev.bounds === cachedShadowBounds &&
      csmFitPrev.persp === (camera.isPerspectiveCamera === true) &&
      pv[0] === camera.position.x && pv[1] === camera.position.y && pv[2] === camera.position.z &&
      pv[3] === csmFwd.x && pv[4] === csmFwd.y && pv[5] === csmFwd.z &&
      pv[6] === camera.fov && pv[7] === camera.aspect && pv[8] === camera.near &&
      pv[9] === lightDir.x && pv[10] === lightDir.y && pv[11] === lightDir.z &&
      pv[12] === res && pv[13] === maxTexNow &&
      pv[14] === lastSunFocus.x && pv[15] === lastSunFocus.y && pv[16] === lastSunFocus.z &&
      pv[17] === sun.shadow.camera.near && pv[18] === sun.shadow.camera.far &&
      pv[19] === (curPcssOn ? curSoftness : -1) && pv[20] === curPcssBoost
    ) {
      return;
    }
    const outer = fitSunShadowWindow({
      bounds: cachedShadowBounds,
      focus: [lastSunFocus.x, lastSunFocus.y, lastSunFocus.z],
      mapSize: resGhost,


      biasScale: biasProf.normalTexels,
      biasCap: biasProf.normalCap,
    });


    farShadows.setWindow(outer.center, outer.half);

    const dirSig =
      Math.round(lightDir.x * 64) + "," + Math.round(lightDir.y * 64) + "," + Math.round(lightDir.z * 64);
    const persp = camera.isPerspectiveCamera === true;
    const maxTex = maxTexNow;                                         


    let rodizioBudgetNow = 0;
    if (rodizioOn) {
      const nowSpin = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
      const dtSpin = rodizioPrevFwd.t > 0 ? nowSpin - rodizioPrevFwd.t : 0;
      rodizioBudgetNow = rodizioBudget(spinRadPerS({
        prevX: rodizioPrevFwd.x, prevY: rodizioPrevFwd.y, prevZ: rodizioPrevFwd.z,
        fwdX: csmFwd.x, fwdY: csmFwd.y, fwdZ: csmFwd.z,
        dtMs: dtSpin,
      }));
      rodizioPrevFwd.x = csmFwd.x;
      rodizioPrevFwd.y = csmFwd.y;
      rodizioPrevFwd.z = csmFwd.z;
      rodizioPrevFwd.t = nowSpin;
    }


    const wantCasc = !persp ? 1 : Math.min(maxTex >= 16 ? CSM_MAX_CASCADES : 2, rodizioOn ? tierRodizioCascades(tierCfg) : Math.max(2, tierCfg.csmCascades));
    const maxDist = Math.max(96, Math.min(outer.half * 2.2, 2560));
    const splits = computeCsmSplits({
      cascades: wantCasc,
      near: persp ? Math.min(4, Math.max(0.25, camera.near)) : 1,
      maxDistance: maxDist,
    });
    const fits = [];
    for (let i = 0; i < splits.length - 1 && fits.length < CSM_MAX_CASCADES - 1; i++) {
      const sph = frustumSliceSphere({
        position: [camera.position.x, camera.position.y, camera.position.z],
        forward: [csmFwd.x, csmFwd.y, csmFwd.z],
        fovYDeg: camera.fov,
        aspect: camera.aspect,
        start: splits[i].start,
        end: splits[i].end,
      });
      const fit = fitCascadeWindow({
        sphereCenter: sph.center,
        sphereRadius: sph.radius,
        lightDir: [lightDir.x, lightDir.y, lightDir.z],


        mapSize: fits.length === 0 ? res0Want : resGhost,
        maxHalf: outer.half,


        biasScale: biasProf.normalTexels,
        biasCap: biasProf.normalCap,
      });

      if (fit.half >= outer.half * 0.9) break;
      fits.push(fit);
    }


    fits.push({
      center: outer.center,
      half: outer.half,
      normalBias: outer.normalBias,
      signature:
        "outer|" +
        Math.round(outer.center[0]) + "," + Math.round(outer.center[1]) + "," + Math.round(outer.center[2]) +
        "|" + outer.half,
    });
    const count = Math.min(fits.length, CSM_MAX_CASCADES);
    csmCount = count;


    const desired0 = count >= 2 ? res0Want : resGhost;
    if (sun.shadow.mapSize.x !== desired0) {
      sun.shadow.mapSize.set(desired0, desired0);
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        sun.shadow.map = null;
      }
      csmSigs[0] = "";
    }


    if (vsmWanted) vsm.syncCsm({ on: true, count });


    let rodizioGrants = null;
    if (rodizioOn && count >= 2) {
      const changed = [];
      for (let c = 1; c < count; c++) {
        const gLight = csmGhosts[c - 1];


        const sigC = fits[c].signature + "|" + dirSig + "|" + resGhost + "|" + biasKey;


        changed.push(!!gLight.shadow.map && (gLight.shadow.mapSize.x !== resGhost || csmSigs[c] !== sigC));
      }
      const plan = planRodizio({ pointer: rodizioPointer, changed, budget: rodizioBudgetNow });
      rodizioPointer = plan.pointer;
      rodizioPending = plan.pending;
      rodizioGrants = plan.grants;
    } else {
      rodizioPending = false;
    }
    let farBudget = 1;
    let flagged = false;
    for (let c = 0; c < CSM_MAX_CASCADES; c++) {
      const light = c === 0 ? sun : csmGhosts[c - 1];
      const active = c < count;
      if (c > 0 && light.castShadow !== active) {
        light.castShadow = active;
        flagged = true;
        if (!active && light.shadow.map) {
          light.shadow.map.dispose();
          light.shadow.map = null;
        }
      }
      if (!active) {
        csmSigs[c] = "";
        continue;
      }
      const fit = fits[c];


      const mapaNulo = c > 0 && !light.shadow.map;
      if (c > 0 && light.shadow.mapSize.x !== resGhost) {


        const resizeAdiado = rodizioOn && !mapaNulo &&
          (!rodizioGrants || rodizioGrants.indexOf(c - 1) < 0);
        if (!resizeAdiado) {
          light.shadow.mapSize.set(resGhost, resGhost);
          if (light.shadow.map) {
            light.shadow.map.dispose();
            light.shadow.map = null;
          }
          csmSigs[c] = "";
        }
      }
      const sig = fit.signature + "|" + dirSig + "|" + (c === 0 ? desired0 : resGhost) + "|" + biasKey;
      if (c === 0) {
        sunWinCenter.set(fit.center[0], fit.center[1], fit.center[2]);
        sunWinHalf = fit.half;
      } else {


        const rodizioAdiado = rodizioOn && !mapaNulo && csmSigs[c] !== sig &&
          (!rodizioGrants || rodizioGrants.indexOf(c - 1) < 0);
        if (!rodizioAdiado) {
          light.position.set(fit.center[0], fit.center[1], fit.center[2]).addScaledVector(lightDir, 500);
          light.target.position.set(fit.center[0], fit.center[1], fit.center[2]);
        }
      }
      if (csmSigs[c] === sig) continue;


      if (rodizioOn) {

        if (c >= 1 && !mapaNulo && (!rodizioGrants || rodizioGrants.indexOf(c - 1) < 0)) continue;
      } else if (c >= 2) {
        if (farBudget <= 0) continue;
        farBudget--;
      }
      csmSigs[c] = sig;
      const cam2 = light.shadow.camera;
      cam2.left = -fit.half;
      cam2.right = fit.half;
      cam2.top = fit.half;
      cam2.bottom = -fit.half;
      cam2.updateProjectionMatrix();


      light.shadow.normalBias = sunShadowContactNormalBias({
        receiverPlaneBiasPerTapKernel: curPcssOn || smLitePcssOn,
        singleBiasedDepthEdgeKernel: shadowEdgeFilterOn,
        fittedNormalBias: fit.normalBias,
      });
      light.shadow.needsUpdate = true;
      flagged = true;


      if (vsmWanted) {
        vsm.syncCascadeWindow(c, {
          cx: fit.center[0], cy: fit.center[1], cz: fit.center[2],
          half: fit.half, mapSize: light.shadow.mapSize.x,
          dirX: lightDir.x, dirY: lightDir.y, dirZ: lightDir.z,
        });
        vsm.noteCascadeFullPass(c);
      }
    }







    if (curPcssOn) {


      pcss.setSun({
        softness: curSoftness,
        boost: curPcssBoost,
        near: sun.shadow.camera.near,
        far: sun.shadow.camera.far,
        frustumSize: outer.half * 2,
      });
      const scales = [];
      for (let c = 0; c < count; c++) {
        scales.push(depthUvScale(sun.shadow.camera.near, sun.shadow.camera.far, fits[c].half * 2));
      }
      pcss.setCsm({ on: true, count, scales, blend: CSM_BLEND_FRACTION });


      pcss.setPlaneBiasCap(planeBiasCapFor({ mapSize: desired0, tier: biasOn ? biasProf.tier : null }));
    }


    if (flagged && renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = true;

    if (rodizioOn && rodizioPending && typeof requestRender === "function") requestRender();

    csmFitPrev.valid = true;
    csmFitPrev.bounds = cachedShadowBounds;
    csmFitPrev.persp = persp;
    pv[0] = camera.position.x; pv[1] = camera.position.y; pv[2] = camera.position.z;
    pv[3] = csmFwd.x; pv[4] = csmFwd.y; pv[5] = csmFwd.z;
    pv[6] = camera.fov; pv[7] = camera.aspect; pv[8] = camera.near;
    pv[9] = lightDir.x; pv[10] = lightDir.y; pv[11] = lightDir.z;
    pv[12] = res; pv[13] = maxTexNow;
    pv[14] = lastSunFocus.x; pv[15] = lastSunFocus.y; pv[16] = lastSunFocus.z;
    pv[17] = sun.shadow.camera.near; pv[18] = sun.shadow.camera.far;
    pv[19] = curPcssOn ? curSoftness : -1; pv[20] = curPcssBoost;
  }


  function sunViewFitOn() {
    const forced = typeof window !== "undefined" ? window.__rswSharpSunShadow : undefined;
    if (forced === false) return false;
    return forced === true || curTech === "ShadowMap";
  }

  function updateSunWindow() {
    if (csmActive) {
      updateCsmWindows();
      return;
    }


    const biasOn7 = biasF7On() && curPcssOn;
    const biasProf7 = biasProfileFor(biasOn7 ? tierCtl.getTier() : null);
    if (curPcssOn) pcss.setPlaneBiasCap(planeBiasCapFor({ mapSize: sun.shadow.mapSize.x, tier: biasOn7 ? biasProf7.tier : null }));
    const fit = fitSunShadowWindow({
      bounds: cachedShadowBounds,
      focus: [lastSunFocus.x, lastSunFocus.y, lastSunFocus.z],
      mapSize: sun.shadow.mapSize.x,


      biasScale: curPcssOn ? biasProf7.normalTexels : 0.5,
      biasCap: biasOn7 ? biasProf7.normalCap : undefined,


      texelTarget: curPcssOn && curTech === "Future" ? tierSunTexelTarget(tierCfg, !!(gpuBudget && gpuBudget.weak)) : (curSmPlus && curTech === "ShadowMap" ? SM_PLUS_TEXEL_TARGET : 0),
    });


    const viewFit = sunViewFitOn()
      ? fitSunShadowToCameraView({
          cameraPosition: [camera.position.x, camera.position.y, camera.position.z],
          focusPoint: [lastSunFocus.x, lastSunFocus.y, lastSunFocus.z],
          fieldOfViewYDeg: camera.fov,
          aspect: camera.aspect,
          lightDirection: [lightDir.x, lightDir.y, lightDir.z],
          mapSize: sun.shadow.mapSize.x,
          maxHalf: fit.half,
        })
      : null;
    const useViewFit = viewFit !== null && viewFit.usable && viewFit.half < fit.half;
    const win = useViewFit ? viewFit : fit;
    appliedSunViewFit = useViewFit ? viewFit : null;
    const c = win.center;
    const changed =
      Math.abs(sunWinHalf - win.half) > 0.5 ||
      Math.abs(sunWinCenter.x - c[0]) > 0.5 ||
      Math.abs(sunWinCenter.y - c[1]) > 0.5 ||
      Math.abs(sunWinCenter.z - c[2]) > 0.5;
    if (!changed) {


      const steadyContactNormalBias = sunShadowContactNormalBias({
        receiverPlaneBiasPerTapKernel: curPcssOn || smLitePcssOn,
        singleBiasedDepthEdgeKernel: shadowEdgeFilterOn,
        fittedNormalBias: win.normalBias,
      });
      if (sun.shadow.normalBias !== steadyContactNormalBias) sun.shadow.normalBias = steadyContactNormalBias;
      return;
    }
    sunWinCenter.set(c[0], c[1], c[2]);
    sunWinHalf = win.half;
    sun.shadow.camera.left = -win.half;
    sun.shadow.camera.right = win.half;
    sun.shadow.camera.top = win.half;
    sun.shadow.camera.bottom = -win.half;
    sun.shadow.camera.updateProjectionMatrix();


    sun.shadow.normalBias = sunShadowContactNormalBias({
      receiverPlaneBiasPerTapKernel: curPcssOn || smLitePcssOn,
      singleBiasedDepthEdgeKernel: shadowEdgeFilterOn,
      fittedNormalBias: win.normalBias,
    });
    farShadows.setWindow(c, win.half);                                          
    if (curPcssOn) {


      pcss.setSun({
        softness: curSoftness,
        boost: curPcssBoost,
        near: sun.shadow.camera.near,
        far: sun.shadow.camera.far,
        frustumSize: win.half * 2,
      });
    }
    shadowsDirty = true;
  }


  const whiteTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  whiteTex.needsUpdate = true;


  const cloudNoiseTex = new THREE.DataTexture(makeCloudNoiseData(CLOUD_TEX_SIZE, 7), CLOUD_TEX_SIZE, CLOUD_TEX_SIZE);
  cloudNoiseTex.wrapS = THREE.RepeatWrapping;
  cloudNoiseTex.wrapT = THREE.RepeatWrapping;
  cloudNoiseTex.magFilter = THREE.LinearFilter;
  cloudNoiseTex.minFilter = THREE.LinearFilter;
  cloudNoiseTex.needsUpdate = true;

  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    transparent: true,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(0.27, 0.56, 0.89) },
      uHorizon: { value: new THREE.Color(0.74, 0.86, 0.97) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 0.98, 0.92) },
      uSunCos: { value: Math.cos((10.5 * Math.PI) / 180) },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uMoonCos: { value: Math.cos((5.5 * Math.PI) / 180) },
      uSunTex: { value: whiteTex },
      uSunTexOn: { value: 0 },
      uMoonTex: { value: whiteTex },
      uMoonTexOn: { value: 0 },
      uStars: { value: 0 },
      uStarDensity: { value: 0.3 },
      uCelestial: { value: 1 },
      uSkyMode: { value: 0 },
      uAtmoColor: { value: new THREE.Color(0.78, 0.81, 0.91) },
      uAtmoDecay: { value: new THREE.Color(0.42, 0.44, 0.55) },
      uAtmoDensity: { value: 0 },
      uAtmoOffset: { value: 0 },
      uAtmoGlare: { value: 0 },
      uAtmoHaze: { value: 0 },


      uSkyModel: { value: 0 },
      uSkyPhysBlend: { value: 0 },
      uHwA: { value: new THREE.Vector3() },
      uHwB: { value: new THREE.Vector3() },
      uHwC: { value: new THREE.Vector3(1, 1, 1) },
      uHwD: { value: new THREE.Vector3() },
      uHwE: { value: new THREE.Vector3() },
      uHwF: { value: new THREE.Vector3() },
      uHwG: { value: new THREE.Vector3() },
      uHwH: { value: new THREE.Vector3() },
      uHwI: { value: new THREE.Vector3() },
      uHwZenith: { value: new THREE.Vector3(1, 0.31, 0.33) },
      uHwGround: { value: new THREE.Color(0.12, 0.12, 0.12) },
      uHwKnee: { value: SKY_PHYS_KNEE },

      uHFogOn: { value: 0 },
      uHFogSigma: { value: 0 },
      uHFogFalloff: { value: 0.014 },
      uHFogCamY: { value: 0 },
      uHFogColor: { value: new THREE.Color(0.75, 0.75, 0.75) },
      uHFogSunK: { value: 10 },
      uHFogSunAmp: { value: 0.45 },


      uCloudsOn: { value: 0 },
      uCloudCover: { value: 0.5 },
      uCloudDensity: { value: 0.7 },
      uCloudColor: { value: new THREE.Color(1, 1, 1) },
      uCloudTex: { value: cloudNoiseTex },
      uCloudWind: { value: new THREE.Vector2(CLOUD_WIND[0], CLOUD_WIND[1]) },
      uSkyTime: { value: 0 },
      uNightSky: { value: 0 },
      uMoonPhase: { value: 0.5 },
    },
    vertexShader: DOME_VERT,
    fragmentShader: DOME_FRAG,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(30000, 32, 16), domeMat);
  dome.renderOrder = -1000;
  dome.frustumCulled = false;

  const fog = new THREE.Fog(0xbfbfbf, 0, 100000);
  scene.fog = fog;

  const vizGroup = new THREE.Group();
  group.add(sun, sunTarget, hemi, amb, dome, vizGroup);
  scene.add(group);


  const vizSphereGeo = new THREE.SphereGeometry(1, 24, 16);
  const vizConeGeo = new THREE.ConeGeometry(1, 1, 24, 1, true);
  vizConeGeo.translate(0, -0.5, 0);                                    
  const vizPlaneGeo = new THREE.PlaneGeometry(1, 1);


  function dataModel() {
    try { return store.getDataModel && store.getDataModel(); } catch (_e) { return null; }
  }
  function lightingInst() {
    const dm = dataModel();
    if (!dm) return null;
    try { return getService(dm, "Lighting"); } catch (_e) { return null; }
  }
  function workspaceInst() {
    const dm = dataModel();
    if (!dm) return null;
    try { return getService(dm, "Workspace"); } catch (_e) { return null; }
  }
  function firstChildOfClass(inst, className) {
    if (!inst || !inst.getChildren) return null;
    for (const c of inst.getChildren()) {
      if (c.className === className) return c;                           
    }
    return null;
  }


  function clampProp(inst, name, range) {
    const v = Number(inst.getProperty(name));
    const c = clampNumber(v, range[0], range[1], range[0]);
    if (c !== v) inst._setInternal(name, c);
  }

  function sanitizeLighting(inst, name) {
    if (applying || !inst) return;
    applying = true;
    try {
      if (name === null || name === "ClockTime") {
        const c = inst.getProperty("ClockTime");
        const w = wrapClockTime(c);                                        
        if (w !== c) inst._setInternal("ClockTime", w);
        const tod = clockTimeToTimeOfDay(inst.getProperty("ClockTime"));
        if (inst.getProperty("TimeOfDay") !== tod) inst._setInternal("TimeOfDay", tod);
      }
      if (name === "TimeOfDay") {
        const parsed = timeOfDayToClockTime(inst.getProperty("TimeOfDay"));
        if (parsed === null) {

          inst._setInternal("TimeOfDay", clockTimeToTimeOfDay(inst.getProperty("ClockTime")));
        } else {
          if (inst.getProperty("ClockTime") !== parsed) inst._setInternal("ClockTime", parsed);
          const norm = clockTimeToTimeOfDay(parsed);
          if (inst.getProperty("TimeOfDay") !== norm) inst._setInternal("TimeOfDay", norm);
        }
      }
      if (name === null || name === "FogStart" || name === "FogEnd") {
        const fs = Number(inst.getProperty("FogStart"));
        const start = Number.isFinite(fs) ? Math.max(0, fs) : 0;
        if (start !== fs) inst._setInternal("FogStart", start);
        const fe = Number(inst.getProperty("FogEnd"));

        if (!Number.isFinite(fe) || fe <= start) inst._setInternal("FogEnd", start + 1);
      }
      if (name === null) {
        for (const key of Object.keys(LIGHTING_CLAMPS)) clampProp(inst, key, LIGHTING_CLAMPS[key]);
      } else if (LIGHTING_CLAMPS[name]) {
        clampProp(inst, name, LIGHTING_CLAMPS[name]);
      }
    } finally {
      applying = false;
    }
  }

  function sanitizeChild(inst, name) {
    if (applying || !inst) return;
    const table = CHILD_CLAMPS[inst.className];
    if (!table) return;
    applying = true;
    try {
      if (name === null) {
        for (const key of Object.keys(table)) clampProp(inst, key, table[key]);
      } else if (table[name]) {
        clampProp(inst, name, table[name]);
      }


      if (inst.className === "Sky" && name && name.indexOf("Skybox") === 0) {
        const v = inst.getProperty(name);
        if (typeof v !== "string") inst._setInternal(name, "");
      }
    } finally {
      applying = false;
    }
  }


  const reflByPart = new Map();                                              
  let lastReflEnvSrc = null;                                                      


  function reflEnvSource() {
    if (smLiteOn) {
      const t = envcap.cubeTexture();
      if (t) return t;
    }


    if (hdriCtl.tex) return hdriCtl.tex;
    return skyCube;
  }


  function syncReflectanceEnvSource() {
    if (reflEnvSource() === lastReflEnvSrc) return;
    refreshReflectanceEnvMaps();
  }

  function reflectanceOf(inst) {
    const v = Number(inst.getProperty("Reflectance"));
    if (!Number.isFinite(v)) return 0;
    return Math.min(REFLECTANCE_RANGE[1], Math.max(REFLECTANCE_RANGE[0], v));
  }

  function applyReflectanceToObj(obj, r) {
    if (!obj || typeof obj.traverse !== "function") return;
    obj.traverse((node) => {
      if (!node.isMesh) return;
      if (node.userData && (node.userData.__rswPool || node.userData.__rswShared)) return;
      const mat = node.material;
      if (!mat || Array.isArray(mat) || mat.wireframe) return;
      const ud = mat.userData || (mat.userData = {});
      if (ud.__rswPool || ud.__rswShared) return;                                 
      if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {


        if (r > 0) {
          if (ud.__rswReflBase === undefined) {
            ud.__rswReflBase = { metalness: mat.metalness, roughness: mat.roughness };
          }
          mat.metalness = Math.max(0, Math.min(0.8, r * 0.7));
          mat.roughness = Math.max(0.05, 0.6 - r * 0.5);
        } else if (ud.__rswReflBase !== undefined) {
          mat.metalness = ud.__rswReflBase.metalness;
          mat.roughness = ud.__rswReflBase.roughness;
          delete ud.__rswReflBase;
        }
        return;
      }
      if (mat.isMeshPhongMaterial) {

        mat.shininess = 28 + 272 * r;
        mat.specular.setScalar(Math.min(1, 0.18 * specScale + 0.72 * r));
      }
      if (mat.isMeshBasicMaterial || mat.isMeshLambertMaterial || mat.isMeshPhongMaterial) {


        const envSrc = reflEnvSource();
        const wantEnv = r > 0 && !!envSrc;
        const hasEnv = !!mat.envMap;
        if (wantEnv) {
          if (hasEnv && mat.envMap !== envSrc) mat.needsUpdate = true;
          mat.envMap = envSrc;
          mat.combine = THREE.MixOperation;
          mat.reflectivity = r;
        } else if (hasEnv) {
          mat.envMap = null;
          mat.reflectivity = 1;
        }
        if (wantEnv !== hasEnv) mat.needsUpdate = true;
      }
    });
  }

  function applyReflectance(inst) {
    if (!inst || !inst.hasProperty || !inst.hasProperty("Reflectance")) return;
    const r = reflectanceOf(inst);
    const had = reflByPart.has(inst.id);
    if (r > 0) reflByPart.set(inst.id, r);
    else reflByPart.delete(inst.id);
    if (r === 0 && !had) return;                                        
    const meshesMap = getMeshes ? getMeshes() : null;
    const obj = meshesMap && typeof meshesMap.get === "function" ? meshesMap.get(inst.id) : null;
    if (obj) applyReflectanceToObj(obj, r);
  }


  function refreshReflectanceEnvMaps() {
    lastReflEnvSrc = reflEnvSource();                                        
    if (reflByPart.size === 0) return;
    const meshesMap = getMeshes ? getMeshes() : null;
    if (!meshesMap || typeof meshesMap.get !== "function") return;
    for (const [id, r] of reflByPart) {
      const obj = meshesMap.get(id);
      if (obj) applyReflectanceToObj(obj, r);
    }
  }


  function onPropertyChanged(e) {
    if (disposed || !e) return;
    const inst = e.instance;
    if (!inst) return;
    const name = e.name || e.property || null;
    substrateSmPipeline.invalidateSource(inst, name);
    if (inst.className === "Lighting") {


      if (name === null || SSM_HOST_GATE_PROPERTIES.has(name)) substrateSmPipeline.suspend("SSM_HOST_LIGHTING_CHANGED");
      sanitizeLighting(inst, name);
      lightingDirty = true;
      requestRender();
      return;
    }
    if (CHILD_CLAMPS[inst.className]) {
      sanitizeChild(inst, name);


      const llEntry = localLights.get(inst.id);
      if (llEntry) llEntry.paramsDirty = true;
      lightingDirty = true;
      vizDirty = true;
      shadowsDirty = true;


      if (LIGHT_CLASSES.includes(inst.className)) giDirty = true;
      requestRender();
      return;
    }


    if (inst.className === "Bone") {
      if (name === "Transform" || name === "TransformRotation" ||
          name === "Position" || name === "Orientation") {


        markLocalShadowCastersChanged();
        shadowsDirty = true;
        requestRender();
      }
      return;
    }


    if (name === "Reflectance" && inst.hasProperty && inst.hasProperty("Anchored")) {
      if (!applying) {
        applying = true;
        try {
          clampProp(inst, "Reflectance", REFLECTANCE_RANGE);
        } finally {
          applying = false;
        }
      }
      applyReflectance(inst);
    }

    if (name && GI_PART_PROPS.has(name) && inst.hasProperty && inst.hasProperty("Anchored")) {


      if (inst.getProperty && inst.getProperty("Anchored") !== true) {
        const tGi = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
        if (tGi - lastDynGiKick >= 500) {
          lastDynGiKick = tGi;
          pendingDynGi = false;
          giDirty = true;
        } else {
          pendingDynGi = true;
          if (!dynGiTimer && typeof setTimeout === "function") {
            dynGiTimer = setTimeout(() => {
              dynGiTimer = 0;
              if (!disposed) requestRender();
            }, 520);
          }
        }
      } else {
        giDirty = true;
      }


      markLocalShadowCastersChanged();
      if (!vsmNotePartEdit(inst)) shadowsDirty = true;
      requestRender();
    }
  }
  function onTreeChanged(event) {
    if (disposed) return;
    substrateSmPipeline.invalidateStructure(event);

    markLocalShadowCastersChanged();
    structureDirty = true;
    boundsComputedAt = 0;                                               
    lightingDirty = true;
    giDirty = true;
    shadowsDirty = true;
    requestRender();
  }
  subs.push(bus.on(Events.PropertyChanged, onPropertyChanged));
  subs.push(bus.on(Events.ChildAdded, onTreeChanged));
  subs.push(bus.on(Events.ChildRemoved, onTreeChanged));
  subs.push(bus.on(Events.Destroying, onTreeChanged));
  subs.push(bus.on("selection:changed", (payload) => {
    if (disposed) return;
    selIds = new Set((payload && payload.ids) || []);
    vizDirty = true;
    requestRender();
  }));


  const localLights = new Map();                                                              


  let ltcReady = areLtcTablesReady();
  let ltcLoading = false;
  let ltcError = "";
  let areaPlanKey = "";
  let areaRectCount = 0;                                                    
  let areaActiveCount = 0;                                                 
  const _areaRight = new THREE.Vector3();
  const _areaUp = new THREE.Vector3();
  const _areaFwd = new THREE.Vector3();
  const _areaMat4 = new THREE.Matrix4();
  const _areaQuat = new THREE.Quaternion();

  const _areaQuat2 = new THREE.Quaternion();


  function ensureLtcLib() {
    if (ltcReady || ltcLoading) return;
    ltcLoading = true;
    ensureLtcTablesLoaded().then((ready) => {
      ltcLoading = false;
      ltcReady = ready;
      ltcError = ready ? "" : getLtcTablesLoadError() || "tabelas LTC indisponíveis";
      if (!disposed && ltcReady) { rescanLights(); lightingDirty = true; requestRender(); }
    });
  }

  function removeLightEntry(id, entry) {
    if (entry.light.parent) entry.light.parent.remove(entry.light);
    if (entry.target && entry.target.parent) entry.target.parent.remove(entry.target);
    if (entry.light.dispose) entry.light.dispose();

    if (entry.light2) {
      if (entry.light2.parent) entry.light2.parent.remove(entry.light2);
      if (entry.light2.dispose) entry.light2.dispose();
    }
    localLights.delete(id);
  }

  function rescanLights() {
    const ws = workspaceInst();
    const found = new Set();
    const liveReflParts = new Set();                                          


    const areaPlan = planAreaLights({
      weakGpu: !!(gpuBudget && gpuBudget.weak),
      maxTexUnits: renderer.capabilities && renderer.capabilities.maxTextures ? renderer.capabilities.maxTextures : 16,
      ltcReady,
    });
    let areaGrants = 0;
    if (ws && ws.getDescendants) {
      for (const part of ws.getDescendants()) {

        if (!part.hasProperty || !part.hasProperty("Anchored")) continue;


        liveReflParts.add(part.id);
        applyReflectance(part);
        if (!part.getChildren) continue;
        for (const child of part.getChildren()) {
          if (LIGHT_CLASSES.indexOf(child.className) === -1) continue;
          if (!localLights.has(child.id) && localLights.size >= MAX_LOCAL_LIGHTS) continue;
          found.add(child.id);


          let desiredAreaMode = null;
          if (child.className === "RectLight" || child.className === "TubeLight") {          
            if (!ltcReady && areaPlan.budget > 0) ensureLtcLib();
            desiredAreaMode = ltcReady && areaGrants < areaPlan.budget ? "ltc" : "point";
            if (desiredAreaMode === "ltc") areaGrants += 1;
          }
          if (localLights.has(child.id)) {
            const prev = localLights.get(child.id);
            prev.partId = part.id;
            prev.part = part;
            if ((child.className !== "RectLight" && child.className !== "TubeLight") || prev.areaMode === desiredAreaMode) continue;          


            removeLightEntry(child.id, prev);
            lightingDirty = true;
            giDirty = true;
          }
          const kind = child.className;
          let light;
          let target = null;
          let areaMode = null;                                                  
          if (kind === "PointLight") {
            light = new THREE.PointLight(0xffffff, 1, 8, 2);
          } else if (kind === "RectLight") {


            areaMode = desiredAreaMode;
            light = areaMode === "ltc"
              ? new THREE.RectAreaLight(0xffffff, 1, 2, 1)
              : new THREE.PointLight(0xffffff, 1, 16, 2);
          } else if (kind === "TubeLight") {                                                  
            areaMode = desiredAreaMode;
            light = areaMode === "ltc"
              ? new THREE.RectAreaLight(0xffffff, 1, 4, 0.6)
              : new THREE.PointLight(0xffffff, 1, 16, 2);
          } else {
            light = new THREE.SpotLight(0xffffff, 1, 16, Math.PI / 4, 0.4, 2);
            target = new THREE.Object3D();
            group.add(target);
            light.target = target;
          }
          light.castShadow = false;
          if (light.shadow) {
            light.shadow.mapSize.set(512, 512);
            light.shadow.bias = -0.00005;
            light.shadow.normalBias = 0.15;
          }
          group.add(light);


          let light2 = null;
          if (kind === "TubeLight" && areaMode === "ltc") {
            light2 = new THREE.RectAreaLight(0xffffff, 1, 4, 0.6);
            group.add(light2);
          }
          localLights.set(child.id, { inst: child, part, partId: part.id, light, light2, target, kind, areaMode });
        }
      }
    }
    for (const [id, entry] of Array.from(localLights)) {
      if (!found.has(id)) removeLightEntry(id, entry);
    }

    areaRectCount = 0;
    areaTubeCount = 0;          
    for (const e of localLights.values()) {
      if (e.kind === "RectLight") areaRectCount++;
      else if (e.kind === "TubeLight") areaTubeCount++;          
    }

    for (const id of Array.from(reflByPart.keys())) {
      if (!liveReflParts.has(id)) reflByPart.delete(id);
    }
    vizDirty = true;
  }

  function faceHalfExtent(mesh, face) {
    return (
      Math.abs(face.x) * mesh.scale.x * 0.5 +
      Math.abs(face.y) * mesh.scale.y * 0.5 +
      Math.abs(face.z) * mesh.scale.z * 0.5
    );
  }


  function faceHalfExtentFromSize(part, face) {
    const s = (part && part.getProperty && part.getProperty("Size")) || { x: 1, y: 1, z: 1 };
    return (
      Math.abs(face.x) * (Number(s.x) || 0) * 0.5 +
      Math.abs(face.y) * (Number(s.y) || 0) * 0.5 +
      Math.abs(face.z) * (Number(s.z) || 0) * 0.5
    );
  }

  const llPos = new THREE.Vector3();
  const llQuat = new THREE.Quaternion();
  const llEuler = new THREE.Euler();


  const shadowCandidatesBuf = [];


  const llAtlasSpotBuf = [];


  const llAtlasPointBuf = [];


  function anyIesCookieConfigured() {
    for (const [, entry] of localLights) {
      const inst = entry.inst;
      if (!inst) continue;
      const ies = inst.getProperty("IesProfile");
      const lf  = inst.getProperty("LightFunction");
      if ((typeof ies === "string" && ies !== "") ||
          (typeof lf  === "string" && lf  !== "")) return true;
    }
    return false;
  }


  function iesCkResetCells() {
    iesCkCells.clear();
    iesCkByLightId.clear();
    iesCkOverflow = 0;
    iesck.resetAtlas();
  }


  function updateIesCookieFrame() {
    if (!iesCkWanted) {
      if (iesCkCells.size > 0) iesCkResetCells();
      return;
    }


    const activeIds = new Set();
    for (const [id, entry] of localLights) {
      if (entry.light && entry.light.visible) activeIds.add(id);
    }

    for (const [id] of iesCkByLightId) {
      if (!activeIds.has(id)) {
        const cell = iesCkByLightId.get(id);
        iesCkCells.delete(cell);
        iesCkByLightId.delete(id);
      }
    }

    iesCkOverflow = 0;
    for (const id of activeIds) {
      const entry = localLights.get(id);
      if (!entry) continue;
      const inst = entry.inst;
      if (!inst) continue;


      const pcIes = entry.paramsCache;
      const iesProfile = pcIes ? pcIes.iesRef : sanitizeIesProfileRef(inst.getProperty("IesProfile"));
      const lightFunc = pcIes ? pcIes.ckRef : sanitizeLightFunctionRef(inst.getProperty("LightFunction"));
      const lfRot = pcIes ? pcIes.ckRot : sanitizeCookieRotationDeg(inst.getProperty("LightFunctionRotation"));
      if (iesProfile === "" && lightFunc === "") {
        if (iesCkByLightId.has(id)) {
          const cell = iesCkByLightId.get(id);
          iesCkCells.delete(cell);
          iesCkByLightId.delete(id);
        }
        continue;
      }

      const ckRef = iesProfile + "|" + lightFunc + "|" + Math.round(lfRot);
      const existing = iesCkByLightId.get(id);
      if (existing && existing.ckRef === ckRef) continue;               

      const cell = iesck.allocCell({ iesProfile, lightFunc, lfRot, ckRef });
      if (!cell) {


        iesCkOverflow++;
        if (existing) {
          iesCkCells.delete(existing);
          iesCkByLightId.delete(id);
        }
        continue;
      }
      if (existing) iesCkCells.delete(existing);
      iesCkCells.set(cell, { id, ckRef });
      iesCkByLightId.set(id, cell);
    }


    iesck.uploadFrame({
      cells: iesCkCells,
      lights: localLights,
      orderBuf: iesCkOrderBuf,
      viewMatrix: camera ? camera.matrixWorldInverse : null,
    });

    if (typeof window !== "undefined") {
      const dbg = (window.__rswIesCookie = window.__rswIesCookie || {});
      const dbgSt = dbg.state || (dbg.state = {});
      dbgSt.wanted = iesCkWanted;
      dbgSt.cells = iesCkCells.size;
      dbgSt.overflow = iesCkOverflow;
    }
  }

  function updateLocalLightsFrame() {
    msmLocalLightFeed.reset();
    mlLights.length = 0;
    mlSpotBuf.length = 0;
    shadowCandidatesBuf.length = 0;
    llAtlasSpotBuf.length = 0;                                                   
    llAtlasPointBuf.length = 0;                                    
    areaActiveCount = 0;                                                   


    llSourceShape.beginFrame();


    llAreaSpecular.beginFrame();


    llRectExtras.beginFrame();


    llShadowSource.beginFrame();


    const _areaKey = ((gpuBudget && gpuBudget.weak) ? "w" : "s") + (ltcReady ? "1" : "0");
    if (_areaKey !== areaPlanKey) {
      areaPlanKey = _areaKey;
      if (areaRectCount > 0) rescanLights();
    }
    if (localLights.size === 0) {


      lsrActive = false;
      lsrPulse = false;
      lsrPending = 0;


      lsrCtl.reset();


      llSourceShape.syncViewSpaceTable(camera, llGateContextCache.contextFor(curTech));


      beginLocalLightWalkFrame(scene);


      llAreaSpecular.syncAreaLightTable(scene, camera, llGateContextCache.contextFor(curTech));


      llRectExtras.syncRectExtrasTable(scene, llGateContextCache.contextFor(curTech));


      llAtlasFeed.reset();

      llPointFeed.reset();


      llShadowResolution.reset();


      llShadowCache.reset();


      llLocalShadowInvalidation.reset();


      llShadowSource.reset();


      llContactShadowFeed.reset(llContactShadowPatch);


      llTransmissionFeed.reset(llTransmission);


      llVolumetricFeed.reset(llVolumetricPassExtension);


      llGiLocal.reset();


      llLightFade.reset("sem-luz-local");


      invalidateLocalLightWalk("light-fade-heal");


      llLightProxy.reset();


      llClusterFeed.reset(llClusterShading, "sem-luz-local");


      llLocalHdr.syncLocalHdrFrame(scene, camera, {
        tier: localLightTier(),
        technology: curTech,
        exposure: renderer ? renderer.toneMappingExposure : 1,
      });
      return;
    }
    const meshesMap = getMeshes();
    const shadowCandidates = shadowCandidatesBuf;
    for (const entry of localLights.values()) {
      const inst = entry.inst;
      const mesh = meshesMap ? meshesMap.get(entry.partId) : null;


      const part = entry.part;
      const partLive = !!part && typeof part.getProperty === "function" &&
        (typeof part.isDestroyed !== "function" || !part.isDestroyed());
      let hasFrame = false;
      if (mesh) {
        llPos.copy(mesh.position);
        llQuat.copy(mesh.quaternion);
        hasFrame = true;
      } else if (partLive) {
        const pp = part.getProperty("Position");
        if (pp && typeof pp === "object") {
          llPos.set(Number(pp.x) || 0, Number(pp.y) || 0, Number(pp.z) || 0);
          const pr = part.getProperty("Rotation") || { x: 0, y: 0, z: 0 };
          llEuler.set(
            ((Number(pr.x) || 0) * Math.PI) / 180,
            ((Number(pr.y) || 0) * Math.PI) / 180,
            ((Number(pr.z) || 0) * Math.PI) / 180,


            "XYZ",
          );
          llQuat.setFromEuler(llEuler);
          hasFrame = true;
        }
      }


      const llPhoto = localLightPhoto && localLightPhoto.on ? localLightPhoto : null;
      let pc = entry.paramsCache;
      if (!pc || entry.paramsDirty !== false || entry.__photoRev !== localLightPhotoRev) {
        const c = inst.getProperty("Color") || { r: 1, g: 1, b: 1 };
        const range = clampNumber(Number(inst.getProperty("Range")), 0, 60, 8);
        const bright = clampNumber(Number(inst.getProperty("Brightness")), 0, 40, 1);
        const angle = clampNumber(Number(inst.getProperty("Angle")), 0, 180, 90);


        const phys = llPhoto && entry.kind !== "RectLight" && entry.kind !== "TubeLight"          
          ? localLightEngineParams({
              kind: entry.kind,
              brightness: bright,
              angleDeg: angle,
              preset: inst.getProperty("LightPreset"),
              temperatureK: Number(inst.getProperty("Temperature")),
            })
          : null;









        const llIntensity = phys
          ? llPhotometricUnits.resolveCandela(
              {
                legacyCandela: phys.candela,
                kind: entry.kind,
                angleDeg: angle,
                brightness: bright,
                intensity: Number(inst.getProperty("Intensity")),
                intensityUnits: inst.getProperty("IntensityUnits"),
                useIesBrightness: inst.getProperty("UseIESBrightness") === true,
                iesBrightnessScale: Number(inst.getProperty("IESBrightnessScale")),
                iesProfileRef: sanitizeIesProfileRef(inst.getProperty("IesProfile")),
              },
              llGateContextCache.contextFor(curTech),
            )
          : null;
        pc = entry.paramsCache = {
          enabled: inst.getProperty("Enabled") !== false,
          range,


          intensity: bright * 0.9 * Math.max(1, range * range * 0.12),


          candela: llIntensity ? llIntensity.candela : 0,

          intensityUnits: llIntensity ? llIntensity.units : "unitless",
          intensitySource: llIntensity ? llIntensity.source : "legacyBrightness",


          photo: !!phys,
          face: FACE_VECTORS[inst.getProperty("Face")] || FACE_VECTORS.Front,
          angleRad: Math.min((Math.max(angle, 1) * Math.PI) / 360, Math.PI / 2 - 0.01),
          shadows: inst.getProperty("Shadows") === true,


          contactShadowLength: clampNumber(Number(inst.getProperty("ContactShadowLength")), 0, 8, 0),

          iesRef: sanitizeIesProfileRef(inst.getProperty("IesProfile")),
          ckRef: sanitizeLightFunctionRef(inst.getProperty("LightFunction")),
          ckRot: sanitizeCookieRotationDeg(inst.getProperty("LightFunctionRotation")),


          sourceRadius: clampNumber(Number(inst.getProperty("SourceRadius")), 0, 8, 0),


          softSourceRadius: clampNumber(Number(inst.getProperty("SoftSourceRadius")), 0, 8, 0),
          sourceLength: clampNumber(Number(inst.getProperty("SourceLength")), 0, 64, 0),
          width: clampNumber(Number(inst.getProperty("Width")), 0.05, 64, 2),
          height: clampNumber(Number(inst.getProperty("Height")), 0.05, 64, 1),


          barnDoorAngle: clampNumber(Number(inst.getProperty("BarnDoorAngle")), 0, 90, 90),
          barnDoorLength: clampNumber(Number(inst.getProperty("BarnDoorLength")), 0, 64, 0),
          sourceTexture: typeof inst.getProperty("SourceTexture") === "string" ? inst.getProperty("SourceTexture") : "",
          twoSided: inst.getProperty("TwoSided") === true,
          length: clampNumber(Number(inst.getProperty("Length")), 0.05, 64, 2),                          
          tubeRadius: clampNumber(Number(inst.getProperty("TubeRadius")), 0.01, 8, 0.1),                    
          faceName: inst.getProperty("Face") || "Front",
        };

        pc.rectNits = entry.kind === "RectLight"
          ? rectLightNits(bright, pc.width, pc.height)
          : entry.kind === "TubeLight"
            ? tubeLightNits(bright, pc.length, pc.tubeRadius)          
            : 0;


        if (phys && phys.tint) entry.light.color.setRGB(c.r * phys.tint.r, c.g * phys.tint.g, c.b * phys.tint.b);
        else entry.light.color.setRGB(c.r, c.g, c.b);
        entry.__photoRev = localLightPhotoRev;
        entry.paramsDirty = false;


        entry.__lsrMoved = true;
      }
      const enabled = hasFrame && pc.enabled;
      entry.light.visible = enabled;
      entry.light.castShadow = false;
      if (!enabled) continue;


      const llShapeIsAreaLtc = (entry.kind === "RectLight" || entry.kind === "TubeLight") && entry.areaMode === "ltc";
      if (!llShapeIsAreaLtc) {


        if (!pc.shapeAuthored) {
          pc.shapeAuthored = {
            SourceRadius: pc.sourceRadius || 0,
            SoftSourceRadius: pc.softSourceRadius || 0,
            SourceLength: entry.kind === "TubeLight" ? (pc.length || 0) : (pc.sourceLength || 0),
          };
        }
        llSourceShape.collectShapedLight(
          entry.light,
          pc.shapeAuthored,
          llGateContextCache.contextFor(curTech),
          entry.partId || "",
        );


        if (!pc.areaAuthored) {
          pc.areaAuthored = {
            SourceRadius: pc.sourceRadius || 0,
            SourceLength: entry.kind === "TubeLight" ? (pc.length || 0) : (pc.sourceLength || 0),
          };
        }
        llAreaSpecular.collectAreaLight(
          entry.light,
          pc.areaAuthored,
          llGateContextCache.contextFor(curTech),
        );
      }


      if ((entry.kind === "RectLight" || entry.kind === "TubeLight") && entry.areaMode === "ltc") {          


        entry.light.intensity = entry.light2 ? pc.rectNits * 0.5 : pc.rectNits;
        if (entry.light2) entry.light2.intensity = entry.light.intensity;


        if (!pc.rectAuthored) {
          pc.rectAuthored = {
            Width: pc.width,
            Height: pc.height,
            BarnDoorAngle: pc.barnDoorAngle,
            BarnDoorLength: pc.barnDoorLength,
            SourceTexture: pc.sourceTexture,
            TwoSided: pc.twoSided,
          };
        }
        const llRectAuthored = pc.rectAuthored;


        const llRectGateContext = llGateContextCache.contextFor(curTech);
        llRectExtras.collectRectLight(entry.light, llRectAuthored, llRectGateContext);
        if (entry.light2) {
          llRectExtras.collectRectLight(entry.light2, llRectAuthored, llRectGateContext);
        }


        entry.__rectRange = Math.max(0.05, pc.range);
      } else {
        entry.light.intensity = llPhoto && pc.photo ? pc.candela * llPhoto.scale : pc.intensity;
        entry.light.distance = Math.max(0.05, pc.range);
      }
      entry.__pointEquivI = llPhoto && pc.photo ? pc.candela * llPhoto.scale : pc.intensity;
      if (entry.kind === "PointLight" || ((entry.kind === "RectLight" || entry.kind === "TubeLight") && entry.areaMode !== "ltc")) {          


        const lp = entry.light.position;
        if (lp.x !== llPos.x || lp.y !== llPos.y || lp.z !== llPos.z) {
          lp.copy(llPos);
          entry.__lsrMoved = true;                                         
        }

        entry.__faceHalf = pc.sourceRadius || 0;
      } else if ((entry.kind === "RectLight" || entry.kind === "TubeLight") && entry.areaMode === "ltc") {          


        const face = pc.face;
        tmpV.set(face.x, face.y, face.z).applyQuaternion(llQuat);
        const rOff = (mesh ? faceHalfExtent(mesh, face) : faceHalfExtentFromSize(part, face)) + 0.02;
        const rnx = llPos.x + tmpV.x * rOff;
        const rny = llPos.y + tmpV.y * rOff;
        const rnz = llPos.z + tmpV.z * rOff;
        const rlp = entry.light.position;
        if (rlp.x !== rnx || rlp.y !== rny || rlp.z !== rnz) rlp.set(rnx, rny, rnz);
        const ff = faceFrame(pc.faceName);
        _areaRight.set(ff.right[0], ff.right[1], ff.right[2]).applyQuaternion(llQuat);
        _areaUp.set(ff.up[0], ff.up[1], ff.up[2]).applyQuaternion(llQuat).negate();
        _areaFwd.copy(tmpV).negate();
        _areaMat4.makeBasis(_areaRight, _areaUp, _areaFwd);
        _areaQuat.setFromRotationMatrix(_areaMat4);
        if (!entry.light.quaternion.equals(_areaQuat)) entry.light.quaternion.copy(_areaQuat);


        if (entry.light2) {
          const l2p = entry.light2.position;
          if (l2p.x !== rnx || l2p.y !== rny || l2p.z !== rnz) l2p.set(rnx, rny, rnz);
          _areaQuat2.setFromAxisAngle(_areaRight, Math.PI / 2).multiply(_areaQuat);
          if (!entry.light2.quaternion.equals(_areaQuat2)) entry.light2.quaternion.copy(_areaQuat2);
          entry.light2.color.copy(entry.light.color);
          entry.light2.visible = entry.light.visible;
        }

        const apW = entry.kind === "TubeLight" ? pc.length : pc.width;
        const apH = entry.kind === "TubeLight" ? pc.tubeRadius * 2 : pc.height;
        if (entry.light.width !== apW) entry.light.width = apW;
        if (entry.light.height !== apH) entry.light.height = apH;
        if (entry.light2) {              
          if (entry.light2.width !== apW) entry.light2.width = apW;
          if (entry.light2.height !== apH) entry.light2.height = apH;
        }
        entry.__areaNx = tmpV.x;
        entry.__areaNy = tmpV.y;
        entry.__areaNz = tmpV.z;
        entry.__faceHalf = 0;
        areaActiveCount += 1;

        if (areaPtWanted && areaActiveCount <= AP_MAX_LIGHTS) {
          const apIdx = areaActiveCount - 1;
          const apKind = entry.kind === "TubeLight" ? 1 : 0;
          const apHalfH = entry.kind === "TubeLight" ? pc.tubeRadius : apH / 2;
          areaPt.setLight(
            apIdx,
            rnx, rny, rnz, apKind,
            _areaRight.x, _areaRight.y, _areaRight.z, apW / 2,
            _areaUp.x, _areaUp.y, _areaUp.z, apHalfH,
            entry.light.color.r, entry.light.color.g, entry.light.color.b,
            entry.__pointEquivI,
            tmpV.x, tmpV.y, tmpV.z,
            entry.__rectRange || pc.range,
          );
        }
      } else {
        const face = pc.face;
        tmpV.set(face.x, face.y, face.z).applyQuaternion(llQuat);
        const offset = entry.kind === "SurfaceLight"
          ? (mesh ? faceHalfExtent(mesh, face) : faceHalfExtentFromSize(part, face))
          : (pc.sourceRadius || 0);                                 
        entry.__faceHalf = offset;                                               

        const nx = llPos.x + tmpV.x * (entry.kind === "SurfaceLight" ? offset : 0);
        const ny = llPos.y + tmpV.y * (entry.kind === "SurfaceLight" ? offset : 0);
        const nz = llPos.z + tmpV.z * (entry.kind === "SurfaceLight" ? offset : 0);
        const lp2 = entry.light.position;
        if (lp2.x !== nx || lp2.y !== ny || lp2.z !== nz) {
          lp2.set(nx, ny, nz);
          entry.__lsrMoved = true;                                         
        }
        const tx = nx + tmpV.x * Math.max(pc.range, 0.5);
        const ty = ny + tmpV.y * Math.max(pc.range, 0.5);
        const tz = nz + tmpV.z * Math.max(pc.range, 0.5);
        const tp = entry.target.position;
        if (tp.x !== tx || tp.y !== ty || tp.z !== tz) {
          tp.set(tx, ty, tz);
          entry.__lsrMoved = true;                                         
        }
        entry.light.angle = pc.angleRad;
        const legacySpotPenumbra = curTech === "Voxel" ? 0.9 : curTech === "Future" ? 0.55 : 0.35;
        entry.light.penumbra = legacySpotPenumbra;


        llSpotCone.applyResolvedConeToLight(
          entry.light,
          {
            coneAngleDeg: (pc.angleRad * 360) / Math.PI,
            legacyPenumbra: legacySpotPenumbra,
            iesOwnsAngularFalloff: !!pc.iesRef,
          },
          llGateContextCache.contextFor(curTech),
        );
      }


      if (entry.light.userData) entry.light.userData.__rswShadowsRequested = !!pc.shadows;


      if (entry.light.userData) entry.light.userData[CONTACT_LENGTH_USER_DATA_KEY] = pc.contactShadowLength;


      if (entry.light.isSpotLight && entry.light.visible !== false) llAtlasSpotBuf.push(entry.light);


      if (entry.light.isSpotLight) {
        llShadowSource.applySpotPenumbra(entry.light, { type: entry.kind, props: pc });
      }

      if (entry.light.isPointLight && entry.light.visible !== false) llAtlasPointBuf.push(entry.light);
      if (pc.shadows && entry.kind !== "RectLight" && entry.kind !== "TubeLight") shadowCandidates.push(entry);          
    }

    areaPt.setCount(areaPtWanted ? Math.min(areaActiveCount, AP_MAX_LIGHTS) : 0);


    llSourceShape.syncViewSpaceTable(camera, llGateContextCache.contextFor(curTech));


    beginLocalLightWalkFrame(scene);


    llAreaSpecular.syncAreaLightTable(scene, camera, llGateContextCache.contextFor(curTech));


    llRectExtras.syncRectExtrasTable(scene, llGateContextCache.contextFor(curTech));


    llShadowResolution.planFrame({
      lights: llAtlasSpotBuf,
      camera,
      tier: localLightTier(),
      technology: curTech,
      viewWidthPixels: renderer && renderer.domElement ? renderer.domElement.clientWidth : 0,
      viewHeightPixels: renderer && renderer.domElement ? renderer.domElement.clientHeight : 0,
    });
    llAtlasFeed.planFrame({
      spotLights: llAtlasSpotBuf,
      cameraPosition: [camera.position.x, camera.position.y, camera.position.z],
      tier: localLightTier(),
      renderSceneDepth: atlasDepthHook,
      influenceRadiusById: llShadowResolution.influenceRadii(),
    });


    llPointFeed.planFrame({
      pointLights: llAtlasPointBuf,
      cameraPosition: [camera.position.x, camera.position.y, camera.position.z],
      tier: localLightTier(),
    });
    llAtlasFeed.attachCubeFacePages(llPointFeed.pages());


    llAtlasFeed.attachPageResolutions(llShadowResolution.resolutions());


    llShadowCache.planFrame({
      spotLights: llAtlasSpotBuf,
      pointLights: llAtlasPointBuf,


      cubePages: llPointFeed.pages(),
      meshes: typeof getMeshes === "function" ? getMeshes() : null,
      tier: localLightTier(),
      technology: curTech,
    });
    llAtlasFeed.attachRedrawPolicy(llShadowCache.policy());


    llShadowSource.syncShadowSourceFrame(llGateContextCache.contextFor(curTech));


    llContactShadowFeed.planFrame({
      spotLights: llAtlasSpotBuf,
      pointLights: llAtlasPointBuf,
      patch: llContactShadowPatch,
      tier: localLightTier(),
      technology: curTech,
      influenceRadiusById: llShadowResolution.influenceRadii(),
    });


    llTransmissionFeed.planFrame({
      meshes: typeof getMeshes === "function" ? getMeshes() : null,
      patch: llTransmission,
      tier: localLightTier(),
      technology: curTech,
      cameraPosition: [camera.position.x, camera.position.y, camera.position.z],
    });


      const lightWriteRevisionBeforeFade = llLightFade.lightWriteRevision();
      llLightFade.planFrame({
        lights: localLights.values(),
        camera,
        tier: localLightTier(),
        technology: curTech,
        viewportWidth: renderer && renderer.domElement ? renderer.domElement.clientWidth : 0,
        viewportHeight: renderer && renderer.domElement ? renderer.domElement.clientHeight : 0,
      });


      if (lightWriteRevisionBeforeFade !== llLightFade.lightWriteRevision()) {
        invalidateLocalLightWalk("light-fade-plan");
      }
      llGiLocal.syncGiLocalFrame({
        scene,
        camera,
        lights: localLights.values(),
        tier: localLightTier(),
        technology: curTech,
        now: typeof performance !== "undefined" && performance.now ? performance.now() : Date.now(),
      });


      llLightProxy.planFrame({
        lights: localLights.values(),
        scene,
        renderer,
        tier: localLightTier(),
        technology: curTech,
        now: typeof performance !== "undefined" && performance.now ? performance.now() : Date.now(),
      });


      llClusterFeed.planFrame({
        lights: localLights.values(),
        camera,
        patch: llClusterShading,
        tier: localLightTier(),
        technology: curTech,
      });
      llVolumetricFeed.planFrame({
      lights: localLights.values(),
      camera,
      rankedSpotLights: llAtlasSpotBuf,
      viewDistance: camera && Number.isFinite(camera.far) ? camera.far : 0,
      tier: localLightTier(),
      technology: curTech,
      extension: llVolumetricPassExtension,
    });


    llLocalHdr.syncLocalHdrFrame(scene, camera, {
      tier: localLightTier(),
      technology: curTech,
      exposure: renderer ? renderer.toneMappingExposure : 1,
    });


    const allowLocal = shadowsEnabled && (curTech === "ShadowMap" || curTech === "Future");


    const extraGlobalTex =
      (csmActive ? Math.max(1, csmCount) - 1 : 0) +
      (farShadows.isEnabled() ? (farShadows.texUnits === 1 ? 1 : 2) : 0) +
      (rtSun.isEnabled() ? 1 : 0) +


      (maskWanted ? 1 : 0) +

      (areaActiveCount > 0 ? LTC_TEX_UNITS : 0) +

      (iesCkWanted ? 1 : 0) +


      (pcss.clipmapSupported === true ? 2 : 0) +


        msmForwardInjectionTextureCharge();
    const texCap = localShadowCap(shadowHardCap, extraGlobalTex);
    const techCap = curTech === "Future" ? texCap : Math.min(texCap, 8);


    const playCap = Math.round(techCap * playShadowScale);
    const budget = allowLocal ? Math.min(shadowCtl.getBudget(), playCap) : 0;
    if (budget <= 0) msmNativePartition.update([], 0, false, performance.now());
    idleShadowNeed = allowLocal ? Math.min(shadowCandidates.length, playCap) : 0;


    lsrActive = lsrWanted && allowLocal && budget > 0;
    lsrBudget = budget;
    lsrCandBuf.length = 0;
    llReuseCandBuf.length = 0;                                     


    if (budget > 0 && shadowCandidates.length > 0) {


      for (let i = 0; i < shadowCandidates.length; i++) {
        shadowCandidates[i].__dist2 =
          shadowCandidates[i].light.position.distanceToSquared(camera.position);
      }
      const msmResidents = msmNativePartition.update(shadowCandidates, budget,
        curTech === 'ShadowMap' && !mlWanted && !mglWanted && isMsmForwardInjectionReserved(), performance.now());
      if (!msmResidents) shadowCandidates.sort((a, b) => a.__dist2 - b.__dist2);
      for (let i = 0; i < shadowCandidates.length && i < budget; i++) {
        const entry = shadowCandidates[i];
        if (msmResidents && !msmResidents.has(entry.light.uuid)) continue;
        entry.light.castShadow = true;


        let res = shadowResFor(i, budget);


        if (entry.kind === "PointLight" && res > 512) res = 512;


        if (lsrActive) res = lsrResFor(i);


        entry.light.shadow.radius = curPcssOn && (entry.kind === "SurfaceLight" || (entry.__faceHalf || 0) > 0)
          ? areaShadowRadius(entry.__faceHalf || 0)
          : LOCAL_LIGHT_EDGE_TEXELS;
        if (entry.light.shadow.mapSize.x !== res) {


          if (!lsrActive || !entry.light.shadow.map) {
            entry.light.shadow.mapSize.set(res, res);
            if (entry.light.shadow.map) {
              entry.light.shadow.map.dispose();
              entry.light.shadow.map = null;
            }
          } else {
            entry.__lsrRes = res;
          }
        } else if (entry.__lsrRes) {
          entry.__lsrRes = 0;
        }


        const shadowCam = entry.light.shadow.camera;
        const shadowFar = Math.max(1, entry.light.distance || 8);


        let shadowNear = 0.1;
        const hostPart = entry.part;
        if (entry.kind === "SpotLight" && hostPart && typeof hostPart.getProperty === "function") {
          const hsz = hostPart.getProperty("Size");
          if (hsz && typeof hsz === "object") {
            const hface = FACE_VECTORS[entry.inst.getProperty("Face")] || FACE_VECTORS.Front;
            const hostHalf = faceHalfExtentFromSize(hostPart, hface);
            shadowNear = Math.min(Math.max(0.1, hostHalf + 0.05), shadowFar * 0.5);
          }
        }
        if (shadowCam.far !== shadowFar || shadowCam.near !== shadowNear) {
          shadowCam.near = shadowNear;
          shadowCam.far = shadowFar;
          shadowCam.updateProjectionMatrix();
          shadowsDirty = true;
          entry.__lsrMoved = true;                                           
        }


        if (lsrActive) {
          entry.light.shadow.autoUpdate = false;
          entry.__lsrManaged = true;

          let cand = lsrCandPool[lsrCandBuf.length];
          if (!cand) {
            cand = { id: null, rank: 0, hasMap: false, moved: false, entry: null };
            lsrCandPool[lsrCandBuf.length] = cand;
          }
          cand.id = entry.inst.id;
          cand.rank = i;
          cand.hasMap = !!entry.light.shadow.map;
          cand.moved = !!entry.__lsrMoved;
          cand.entry = entry;
          lsrCandBuf.push(cand);
        }


        let reuseCand = llReuseCandPool[llReuseCandBuf.length];
        if (!reuseCand) {
          reuseCand = { key: null, light: null };
          llReuseCandPool[llReuseCandBuf.length] = reuseCand;
        }
        reuseCand.key = entry.inst.id;
        reuseCand.light = entry.light;
        llReuseCandBuf.push(reuseCand);
      }
    }


    lsrPulse = false;
    if (lsrActive) {
      const lsrPlan = lsrCtl.plan(lsrCandBuf, LSR_MAX_PER_FRAME);
      for (let k = 0; k < lsrPlan.render.length; k++) {
        for (let c = 0; c < lsrCandBuf.length; c++) {
          const cand = lsrCandBuf[c];
          if (cand.id !== lsrPlan.render[k]) continue;
          const sh = cand.entry.light.shadow;


          if (cand.entry.__lsrRes && sh.mapSize.x !== cand.entry.__lsrRes) {
            sh.mapSize.set(cand.entry.__lsrRes, cand.entry.__lsrRes);
            if (sh.map) {
              sh.map.dispose();
              sh.map = null;
            }
          }
          cand.entry.__lsrRes = 0;
          cand.entry.__lsrMoved = false;
          sh.needsUpdate = true;
          lsrPulse = true;
          break;
        }
      }
      lsrPending = lsrPlan.pending;
      if (lsrPending > 0) requestRender();


      for (let c = 0; c < lsrCandBuf.length; c++) lsrCandBuf[c].entry = null;
    } else {
      lsrPending = 0;
    }


    if (lsrActive) {
      llLocalShadowInvalidation.handOverTo("LL-F9 rodizio de sombras locais");
      localShadowRedrawPulse = false;
    } else {
      const localShadowPulse = llLocalShadowInvalidation.planFrame({
        entries: shadowCandidates,
        managedCount: shadowCandidates.length,
        meshes: meshesMap,
        tier: localLightTier(),
        technology: curTech,
      });
      localShadowRedrawPulse = localShadowPulse.pulseRequested === true;
    }


    if (!lsrActive && allowLocal && llReuseCandBuf.length > 0) {
      llLocalShadowReuse.planFrame({
        lights: llReuseCandBuf,
        casterRevision: localShadowCasterRevision,
        tier: localLightTier(),
        technology: curTech,
      });
    } else if (llLocalShadowReuse.heldShadowCount() > 0) {


      llLocalShadowReuse.heal(lsrActive ? "rotation-owns-maps" : "no-local-shadow-budget");
    }

    for (let c = 0; c < llReuseCandBuf.length; c++) llReuseCandBuf[c].light = null;


    msmLocalLightFeed.update(shadowCandidates, allowLocal && !patchesDisabled);
    mlLights.length = 0;
    mlSpotBuf.length = 0;
    if (mlWanted && allowLocal && shadowCandidates.length > budget) {
      mlBaseLum = (hemi.intensity * 0.5 + amb.intensity + sun.intensity * 0.5) / LEGACY_LIGHT_SCALE;
      for (let i = Math.max(budget, 0); i < shadowCandidates.length && mlLights.length < ML_MAX_LIGHTS; i++) {
        const entry = shadowCandidates[i];
        const L = entry.light;
        if (!L.visible) continue;

        let ml = mlPool[mlLights.length];
        if (!ml) {
          ml = { x: 0, y: 0, z: 0, range: 0.5, r: 1, g: 1, b: 1, intensity: 1, id: null };
          mlPool[mlLights.length] = ml;
        }
        ml.x = L.position.x; ml.y = L.position.y; ml.z = L.position.z;
        ml.range = Math.max(L.distance || 0, 0.5);
        ml.r = L.color.r; ml.g = L.color.g; ml.b = L.color.b;
        ml.intensity = L.intensity;


        ml.id = L.uuid;
        if (L.isSpotLight) {
          L.userData.__rswAtlasId = ml.id;
          mlSpotBuf.push(L);
        }
        mlLights.push(ml);
      }
    }


    for (const entry of localLights.values()) {


      if (!lsrActive && entry.__lsrManaged) {
        entry.__lsrManaged = false;
        entry.__lsrRes = 0;
        entry.__lsrMoved = false;
        if (entry.light.shadow) {
          entry.light.shadow.autoUpdate = true;
          entry.light.shadow.needsUpdate = true;
        }
        shadowsDirty = true;
      }
      if (!entry.light.castShadow && entry.light.shadow && entry.light.shadow.map) {
        entry.light.shadow.map.dispose();
        entry.light.shadow.map = null;
      }


      if (entry.__shadowOn !== entry.light.castShadow) {
        entry.__shadowOn = entry.light.castShadow;
        shadowsDirty = true;
      }


      syncHostShadowSkip(entry, meshesMap);
    }
  }


  let hostSkipMat = null;


  let hostSkipRev = 1;
  function syncHostShadowSkip(entry, meshesMap) {
    const want = !!(entry.kind === "PointLight" && entry.light && entry.light.castShadow);
    const host = want && meshesMap ? meshesMap.get(entry.partId) : null;
    const prev = entry.__hostSkipObj || null;
    if (prev && prev !== host) {
      prev.traverse((n) => {
        if (n.isMesh && n.customDistanceMaterial === hostSkipMat) n.customDistanceMaterial = undefined;
      });
      entry.__hostSkipObj = null;
      shadowsDirty = true;
    }
    if (!host) return;
    if (
      prev === host &&
      entry.__hostSkipRev === hostSkipRev &&
      entry.__hostSkipKids === host.children.length
    ) {
      return;                                                           
    }
    if (!hostSkipMat) {
      hostSkipMat = new THREE.ShaderMaterial({
        vertexShader: "void main() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }",
        fragmentShader: "void main() { gl_FragColor = vec4(1.0); }",
      });
    }
    let changed = false;
    host.traverse((n) => {
      if (n.isMesh && n.customDistanceMaterial !== hostSkipMat) {
        n.customDistanceMaterial = hostSkipMat;
        changed = true;
      }
    });
    if (changed) shadowsDirty = true;
    entry.__hostSkipObj = host;
    entry.__hostSkipRev = hostSkipRev;
    entry.__hostSkipKids = host.children.length;
  }


  function rescanCharacters() {


    const prevChars = new Map(capChars);
    capChars.clear();
    const ws = workspaceInst();
    if (!ws || !ws.getDescendants) return;
    let count = 0;
    for (const inst of ws.getDescendants()) {
      if (count >= 12) break;                       
      if (inst.className !== "Model") continue;
      const humanoid = inst.getChildren && (() => {
        for (const c of inst.getChildren()) if (c.className === "Humanoid") return c;
        return null;
      })();
      if (!humanoid) continue;
      const parts = [];
      if (inst.getDescendants) {
        for (const child of inst.getDescendants()) {
          if (!child.hasProperty || !child.hasProperty("Anchored")) continue;
          const name = child.getProperty("Name") || child.name || "";
          if (isCapsuleLimbName(name)) parts.push(child);
        }
      }


      if (parts.length === 0) continue;
      const capKey = inst.id || inst;
      const prevEntry = prevChars.get(capKey);
      capChars.set(capKey, { parts, blobY: prevEntry ? prevEntry.blobY : null });
      count++;
    }
  }


  const capsViewCamPrev = new Float64Array(16);
  let capsViewSunX = NaN;
  let capsViewSunY = NaN;
  let capsViewSunZ = NaN;
  let capsViewDirty = true;


  function updateCapsulesFrame(nowStamp) {
    if ((!capsWanted && !capsBlobMode) || capChars.size === 0) {
      caps.setEnabled(false);
      caps.hideBlobs();
      capsLastSel = null;
      return;
    }


    if (nowStamp - lastCapsUpdate >= 50) {


      const capsDtMs = nowStamp - lastCapsUpdate;
      lastCapsUpdate = nowStamp;
      const todasCaps = [];
      let blobIdx = 0;
      for (const [id, entry] of capChars) {
        const charCaps = [];
        for (const part of entry.parts) {


          if (part.getProperty) {
            if (part.getProperty("CastShadow") === false) continue;


            if (
              isLocallyInvisible(
                part.getProperty("Transparency"),
                part.getProperty("LocalTransparencyModifier"),
              )
            ) {
              continue;
            }
          }
          const pos = part.getProperty && part.getProperty("Position");
          const rotDeg = part.getProperty && part.getProperty("Rotation");
          const size = part.getProperty && part.getProperty("Size");
          if (!pos || !size) continue;
          const cap = capsuleFromPart({ pos, rotDeg: rotDeg || { x: 0, y: 0, z: 0 }, size });
          if (cap) {
            cap.w = capsCurW;                                                      
            charCaps.push(cap);
          }
        }
        if (charCaps.length === 0) continue;                                                                                                                                    


        const blob = blobForCapsules(charCaps);
        if (blob) {
          entry.blobY = blobFollowY(entry.blobY, blob.feetY, capsDtMs);
          if (capsBlobMode) {
            const opacity = blobOpacity(blob.feetY, entry.blobY);
            caps.updateBlob(blobIdx++, blob.cx, entry.blobY + 0.03, blob.cz, blob.radius, opacity);
          }
        }
        for (const c of charCaps) todasCaps.push(c);
      }
      caps.hideBlobsFrom(blobIdx);


      const visibleCaps = rejectCapsulesAroundCamera(todasCaps, camera.position);
      capsLastSel = capsWanted && visibleCaps.length > 0
        ? selectCapsules(visibleCaps, camera.position, RSW_CAP_MAX)
        : null;
      capsViewDirty = true;                                                     
      caps.setEnabled(!!(capsLastSel && capsLastSel.length > 0));
    }


    if (capsLastSel && capsLastSel.length > 0) {
      camera.updateMatrixWorld();
      const cm = camera.matrixWorld.elements;
      let semMudanca = !capsViewDirty &&
        capsViewSunX === lightDir.x && capsViewSunY === lightDir.y && capsViewSunZ === lightDir.z;
      if (semMudanca) {
        for (let i = 0; i < 16; i++) {
          if (capsViewCamPrev[i] !== cm[i]) { semMudanca = false; break; }
        }
      }
      if (semMudanca) return;
      for (let i = 0; i < 16; i++) capsViewCamPrev[i] = cm[i];
      capsViewSunX = lightDir.x; capsViewSunY = lightDir.y; capsViewSunZ = lightDir.z;
      capsViewDirty = false;
      capM4.copy(camera.matrixWorld).invert();
      caps.setCapsulesView(capsLastSel, capM4);
      tmpV.copy(lightDir).transformDirection(capM4);
      caps.setSunDir(tmpV);
    }
  }


  const vizEntries = new Map();                             

  function clearViz() {
    for (const v of vizEntries.values()) {
      vizGroup.remove(v.fill);
      v.fill.material.dispose();
      if (v.wire) {
        vizGroup.remove(v.wire);
        v.wire.material.dispose();
      }
    }
    vizEntries.clear();
  }

  function rebuildViz() {
    clearViz();
    for (const [id, entry] of localLights) {
      if (!selIds.has(id)) continue;
      const geo =
        entry.kind === "PointLight" ? vizSphereGeo : entry.kind === "SpotLight" ? vizConeGeo : vizPlaneGeo;
      const fill = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: entry.kind === "SurfaceLight" ? 0.28 : 0.12,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      fill.renderOrder = 500;
      let wire = null;
      if (entry.kind === "PointLight") {
        wire = new THREE.Mesh(
          vizSphereGeo,
          new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.2, depthWrite: false }),
        );
        wire.renderOrder = 501;
        vizGroup.add(wire);
      }
      vizGroup.add(fill);
      vizEntries.set(id, { fill, wire });
    }
  }

  function updateVizFrame() {
    if (vizEntries.size === 0) return;
    const meshesMap = getMeshes();
    for (const [id, v] of vizEntries) {
      const entry = localLights.get(id);
      const mesh = meshesMap ? meshesMap.get(entry && entry.partId) : null;
      const visible = !!entry && !!mesh && entry.light.visible;
      v.fill.visible = visible;
      if (v.wire) v.wire.visible = visible;
      if (!visible) continue;
      const inst = entry.inst;
      v.fill.material.color.copy(entry.light.color);
      if (v.wire) v.wire.material.color.copy(entry.light.color);
      const range = Math.max(entry.light.distance, 0.5);
      if (entry.kind === "PointLight") {

        v.fill.position.copy(entry.light.position);
        v.fill.scale.setScalar(range);
        v.fill.quaternion.identity();
        v.wire.position.copy(entry.light.position);
        v.wire.scale.setScalar(range);
      } else if (entry.kind === "SpotLight") {

        const face = FACE_VECTORS[inst.getProperty("Face")] || FACE_VECTORS.Front;
        tmpV.set(face.x, face.y, face.z).applyQuaternion(mesh.quaternion);
        const angle = clampNumber(Number(inst.getProperty("Angle")), 0, 180, 90);
        const r = Math.tan((Math.min(Math.max(angle, 2), 160) * Math.PI) / 360) * range;
        v.fill.position.copy(entry.light.position);
        v.fill.quaternion.setFromUnitVectors(Y_DOWN, tmpV);
        v.fill.scale.set(r, range, r);
      } else {

        const face = FACE_VECTORS[inst.getProperty("Face")] || FACE_VECTORS.Front;
        tmpV.set(face.x, face.y, face.z).applyQuaternion(mesh.quaternion);
        v.fill.position.copy(entry.light.position).addScaledVector(tmpV, 0.05);
        v.fill.quaternion.setFromUnitVectors(Z_PLUS, tmpV);
        let w = mesh.scale.x;
        let hgt = mesh.scale.y;
        if (Math.abs(face.x) > 0.5) { w = mesh.scale.z; hgt = mesh.scale.y; }
        else if (Math.abs(face.y) > 0.5) { w = mesh.scale.x; hgt = mesh.scale.z; }
        v.fill.scale.set(Math.max(w, 0.2), Math.max(hgt, 0.2), 1);
      }
    }
  }


  let patchesDisabled = false;

  function relightNode(node) {
    if (!node.isMesh) return;
    if (relightMaterialArray(node, relightNode)) return;
    const mat = node.material;
    if (!mat) return;
    if (mat.wireframe) return;                                   


    if (node.userData && (node.userData.__rswPool || node.userData.__rswShared)) {


      const lit =
        !!mat.isMeshLambertMaterial ||
        !!mat.isMeshPhongMaterial ||
        !!mat.isMeshStandardMaterial;
      node.castShadow = shadowsEnabled && matKind !== "basic" && !mat.transparent;
      node.receiveShadow = shadowsEnabled && matKind !== "basic" && lit;

      if (mat.transparent && node.userData.__rswPoolKey) {
        trans.ensureDitherCaster(node, transWanted && shadowsEnabled && matKind !== "basic");
      }
      if (lit && matKind !== "basic" && !patchesDisabled) {
        mat.userData.__rswSbPool = true;
        substratePipeline.attachMaterial(mat);
        if (fxWanted) {
          gi.patchMaterial(mat);
          pcss.patchMaterial(mat);
          farShadows.patchMaterial(mat);
        }
        if (capsWanted) caps.patchMaterial(mat);          
        if (matFeatWanted) matFeat.patchMaterial(mat);          
        if (transWanted) trans.patchMaterial(mat);          
        hfog.patchMaterial(mat);                                             
        rprobes.patchMaterial(mat);                                      
        specAa.patchMaterial(mat);                                                
        specOcc.patchMaterial(mat);                                               
        if (iesCkWanted) iesck.patchMaterial(mat);          
        if (areaPtWanted) areaPt.patchMaterial(mat);          
        llLocalLights.patchMaterial(mat);                                            
        if (mglWanted) subscribeMaterialToMegaLights(mat);                                           
        substrateSmPipeline.attachMaterial(mat, node, "pool");
      }
      return;
    }
    const cur = mat.isMeshStandardMaterial && mat.userData?.__rswSbGenerated ? "standard" : mat.isMeshBasicMaterial
      ? "basic"
      : mat.isMeshLambertMaterial
        ? "lambert"
        : mat.isMeshPhongMaterial
          ? "phong"
          : null;
    if (cur === null) {

      if (!patchesDisabled) {
        substratePipeline.attachMaterial(mat);
        if (fxWanted) {
          gi.patchMaterial(mat);                                             
          pcss.patchMaterial(mat);                           
          farShadows.patchMaterial(mat);                                 
        }
        if (capsWanted) caps.patchMaterial(mat);          
        if (matFeatWanted) matFeat.patchMaterial(mat);          
        if (transWanted) trans.patchMaterial(mat);          
        hfog.patchMaterial(mat);                                             
        rprobes.patchMaterial(mat);                                      
        specAa.patchMaterial(mat);                                                
        specOcc.patchMaterial(mat);                                               
        if (iesCkWanted) iesck.patchMaterial(mat);          
        if (areaPtWanted) areaPt.patchMaterial(mat);          
        llLocalLights.patchMaterial(mat);                                            
        if (mglWanted) subscribeMaterialToMegaLights(mat);                                           
        substrateSmPipeline.attachMaterial(mat, node, "imported");
      }
      node.castShadow = shadowsEnabled;
      node.receiveShadow = shadowsEnabled;
      return;
    }
    if (cur !== matKind) {
      let next;
      if (matKind === "basic") next = new THREE.MeshBasicMaterial();
      else if (matKind === "lambert") next = new THREE.MeshLambertMaterial();
      else if (matKind === "standard") next = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.05 });
      else next = new THREE.MeshPhongMaterial();


      transferMaterialState(mat, next);
      if (matKind === "standard") {
        next.userData.__rswSbGenerated = true;
        applySubstrateStandardPhysics(next, next.userData.__rswMatName || "Plastic");
      }
      if (matKind === "phong") {
        next.shininess = 28;
        next.specular.setScalar(0.18 * specScale);


        if (next.userData && next.userData.__rswMatName) {
          applyPhongPhysics(next, next.userData.__rswMatName, { specScale, rebase: true });
        }
      }
      node.material = next;
      mat.dispose();
    } else if (matKind === "phong") {
      mat.specular.setScalar(0.18 * specScale);


      if (mat.userData && mat.userData.__rswMatName) {
        mat.shininess = 28;                                           
        applyPhongPhysics(mat, mat.userData.__rswMatName, { specScale, rebase: true });
      }
    }
    if (matKind !== "basic" && !patchesDisabled) {
      if (node.material.userData?.__rswSbGenerated) applySubstrateStandardPhysics(node.material, node.material.userData.__rswMatName || "Plastic");
      substratePipeline.attachMaterial(node.material);
      if (fxWanted) {
        gi.patchMaterial(node.material);            
        pcss.patchMaterial(node.material);            
        farShadows.patchMaterial(node.material);          
      }
      if (capsWanted) caps.patchMaterial(node.material);          
      if (matFeatWanted) matFeat.patchMaterial(node.material);          
      if (transWanted) trans.patchMaterial(node.material);          


      hfog.patchMaterial(node.material);          
      rprobes.patchMaterial(node.material);          
      specAa.patchMaterial(node.material);         
      specOcc.patchMaterial(node.material);          
      if (iesCkWanted) iesck.patchMaterial(node.material);          
      if (areaPtWanted) areaPt.patchMaterial(node.material);          
      llLocalLights.patchMaterial(node.material);                                            
      if (mglWanted) subscribeMaterialToMegaLights(node.material);                                           
      substrateSmPipeline.attachMaterial(node.material, node, "individual");
    }
    node.castShadow = shadowsEnabled && matKind !== "basic";
    node.receiveShadow = shadowsEnabled && matKind !== "basic";
  }


  let __ensureModeKey = null;
  let __ensureMapSize = -1;
  let __ensureStructRev = -1;


  function ensureMaterials() {
    const meshesMap = getMeshes();
    if (!meshesMap) return;


    if (
      modeKey === __ensureModeKey &&
      meshesMap.size === __ensureMapSize &&
      hostSkipRev === __ensureStructRev
    ) return;
    __ensureModeKey = modeKey;
    __ensureMapSize = meshesMap.size;
    __ensureStructRev = hostSkipRev;
    for (const obj of meshesMap.values()) {
      if (obj.userData.__litMode !== modeKey) {
        obj.userData.__litMode = modeKey;
        obj.traverse(relightNode);


        const rid = obj.userData.rswId;
        if (rid !== undefined && reflByPart.has(rid)) {
          applyReflectanceToObj(obj, reflByPart.get(rid));
        }
      }
    }
  }


  function relightObject(obj) {
    if (!obj || typeof obj.traverse !== "function") return;


    if (__ensureModeKey === null) return;
    obj.userData.__litMode = modeKey;
    obj.traverse(relightNode);


    const rid = obj.userData.rswId;
    if (rid !== undefined && reflByPart.has(rid)) {
      applyReflectanceToObj(obj, reflByPart.get(rid));
    }
  }


  function refreshAllMaterials() {
    scene.traverse((node) => {
      if (!node.isMesh || !node.material) return;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const m of mats) m.needsUpdate = true;

      if (node !== dome && node.material.isMeshStandardMaterial) {


        node.castShadow = shadowsEnabled && !node.material.transparent;
        node.receiveShadow = shadowsEnabled;
      }
    });
  }


  function stripFxMaterial(m) {
    if (!m) return;
    substrateSmPipeline.detachMaterial(m, "SSM_HOST_FX_STRIPPED");
    const ud = m.userData || {};
    if (!ud.__rswGi && !ud.__rswPcss && !ud.__rswFar && !ud.__rswCaps && !ud.__rswTrans && !ud.__rswHFog && !ud.__rswPrb && !ud.__rswSpecAA && !ud.__rswSpecOcc && !ud.__rswMatFeat && !ud.__rswIesCk && !ud.__rswLl && !ud.__rswMgl && !ud.__rswSb) return;
    delete ud.__rswGi;
    delete ud.__rswPcss;
    delete ud.__rswFar;
    delete ud.__rswCaps;
    delete ud.__rswTrans;          
    delete ud.__rswHFog;                                                           
    delete ud.__rswPrb;          
    delete ud.__rswSpecAA;                                                   
    delete ud.__rswSpecOcc;                                                 
    delete ud.__rswMatFeat;          
    delete ud.__rswIesCk;                                                          
    delete ud.__rswAreaPt;          
    delete ud.__rswLl;                                                        
    delete ud.__rswMFUni;                                  
    substratePipeline.detachMaterial(m);
    unsubscribeMaterialFromMegaLights(m);                                               
    m.onBeforeCompile =
      typeof ud.__rswBasePatch === "function" ? ud.__rswBasePatch : function () {};
    m.customProgramCacheKey =
      typeof ud.__rswBaseKey === "function" ? ud.__rswBaseKey : function () { return "rswNoFx"; };
    m.needsUpdate = true;
  }

  function stripFxPatches() {
    scene.traverse((node) => {
      if (!node.isMesh || !node.material) return;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const m of mats) stripFxMaterial(m);
    });
    for (const m of externalMats) stripFxMaterial(m);
  }






  function hardStripMaterial(m) {
    if (!m) return;
    substrateSmPipeline.detachMaterial(m, "SSM_HOST_HARD_STRIPPED");
    const ud = m.userData || {};
    delete ud.__rswGi;
    delete ud.__rswPcss;
    delete ud.__rswFar;
    delete ud.__rswCaps;          
    delete ud.__rswTrans;          
    delete ud.__rswHFog;          
    delete ud.__rswPrb;          
    delete ud.__rswSpecAA;         
    delete ud.__rswSpecOcc;          
    delete ud.__rswMatFeat;          
    delete ud.__rswMFUni;          
    delete ud.__rswLl;                                                        
    substratePipeline.detachMaterial(m);
    unsubscribeMaterialFromMegaLights(m);                                               
    m.onBeforeCompile = function () {};
    m.customProgramCacheKey = function () { return "rswSafeMode2"; };
    m.needsUpdate = true;
  }


  function restoreBaseMaterial(m) {
    substrateSmPipeline.detachMaterial(m, "SSM_HOST_BASE_RESTORED");
    if (!m || !m.userData) return;
    const ud = m.userData;
    if (typeof ud.__rswBasePatch !== "function") { stripFxMaterial(m); return; }
    delete ud.__rswGi;
    delete ud.__rswPcss;
    delete ud.__rswFar;
    delete ud.__rswCaps;          
    delete ud.__rswTrans;          
    delete ud.__rswHFog;          
    delete ud.__rswPrb;          
    delete ud.__rswSpecAA;         
    delete ud.__rswSpecOcc;          
    delete ud.__rswMatFeat;          
    delete ud.__rswMFUni;          
    delete ud.__rswLl;                                                        
    substratePipeline.detachMaterial(m);
    unsubscribeMaterialFromMegaLights(m);                                               
    m.onBeforeCompile = ud.__rswBasePatch;
    m.customProgramCacheKey =
      typeof ud.__rswBaseKey === "function" ? ud.__rswBaseKey : function () { return "rswBase"; };
    m.needsUpdate = true;
  }

  function restoreBasePatches() {
    scene.traverse((node) => {
      if (!node.isMesh || !node.material) return;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const m of mats) restoreBaseMaterial(m);
    });
    for (const m of externalMats) restoreBaseMaterial(m);
  }


  function reopenShaderPatches(reason) {
    if (disposed) return;
    substratePipeline.contextRestored();
    substrateSmPipeline.contextRestored();

    environmentPrefilter.cancel();
    envSig = null;
    warmupError = null;
    warmupPending = true;
    lightingDirty = true;
    requestRender();
    if (!patchesDisabled && !hardSafeMode) return;                  
    hardSafeMode = false;
    patchesDisabled = false;
    safeModeTech = null;
    safeModeStamp = 0;
    safeRetries = 0;
    hardRetries = 0;
    fxPatched = false;
    curPatchSig = "";


    gi.bumpGeneration();
    pcss.bumpGeneration();
    farShadows.bumpGeneration();
    caps.bumpGeneration();
    trans.bumpGeneration();
    hfog.bumpGeneration();          
    rprobes.bumpGeneration();          
    specAa.bumpGeneration();         
    specOcc.bumpGeneration();          
    matFeat.bumpGeneration();          
    iesck.bumpGeneration();          
    areaPt.bumpGeneration();          
    llLocalLights.bumpGeneration();                                        
    llLocalLights.setEnabled(true);                                          
    restoreBasePatches();
    logger.warn("[Iluminação] Modo seguro de shaders REABERTO" + (reason ? " (" + reason + ")" : "") + ": patches serão reaplicados do zero.");
    lightingDirty = true;
    requestRender();
  }

  function disableShaderPatches(reason) {
    substrateSmPipeline.suspend("SSM_SAFE_MODE");
    if (disposed || hardSafeMode) return;


    if (warmupStager.isActive()) warmupStager.cancel();
    warmupToastHide();
    if (patchesDisabled) {


      hardSafeMode = true;
      fxPatched = false;
      curPatchSig = "";          
      gi.bumpGeneration();
      pcss.bumpGeneration();
      farShadows.bumpGeneration();
      caps.bumpGeneration();          
      trans.bumpGeneration();          
      hfog.bumpGeneration();          
      rprobes.bumpGeneration();          
      specAa.bumpGeneration();         
      specOcc.bumpGeneration();          
      matFeat.bumpGeneration();          
      iesck.bumpGeneration();          
      areaPt.bumpGeneration();          
      llLocalLights.bumpGeneration();                                        
      logger.warn("[Iluminação] Modo seguro NÍVEL 2" + (reason ? " (" + reason + ")" : "") + ": todos os patches de shader foram removidos.");
      pcss.setEnabled(false);
      farShadows.setEnabled(false);
      caps.setEnabled(false);          
      rtSun.setEnabled(false);          
      trans.setEnabled(false); mlWanted = false; clWanted = false;                                                      
      matFeat.setEnabled(false); matFeatWanted = false;          
      iesck.setEnabled(false); iesCkWanted = false;          
      areaPt.setEnabled(false); areaPtWanted = false;          
      llLocalLights.setEnabled(false);                                       
      mglWanted = false;                                                 
      maskWanted = false;                                                                
      temporalOn = false;
      temporalResets += 1;
      gi.setAmount(0);
      scene.traverse((node) => {
        if (!node.isMesh || !node.material) return;
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        for (const m of mats) hardStripMaterial(m);
      });
      for (const m of externalMats) hardStripMaterial(m);
      lightingDirty = true;
      requestRender();
      return;
    }
    patchesDisabled = true;
    safeModeTech = curTech;
    safeModeStamp = Date.now();


    fxPatched = false;
    curPatchSig = "";          


    gi.bumpGeneration();
    pcss.bumpGeneration();
    farShadows.bumpGeneration();
    caps.bumpGeneration();          
    trans.bumpGeneration();          
    specAa.bumpGeneration();                                                     
    specOcc.bumpGeneration();                             
    matFeat.bumpGeneration();          
    iesck.bumpGeneration();          
    areaPt.bumpGeneration();          
    llLocalLights.bumpGeneration();                                   


    hfog.bumpGeneration();                                                      
    rprobes.bumpGeneration();                 
    logger.warn("[Iluminação] Modo seguro de shaders ativado" + (reason ? " (" + reason + ")" : "") + "; GI/PCSS desligados.");
    pcss.setEnabled(false);
    farShadows.setEnabled(false);
    caps.setEnabled(false);          
    rtSun.setEnabled(false);          
    trans.setEnabled(false); mlWanted = false;          
    matFeat.setEnabled(false); matFeatWanted = false;          
    iesck.setEnabled(false); iesCkWanted = false;          
    areaPt.setEnabled(false); areaPtWanted = false;          
    mglWanted = false;                                                 
    maskWanted = false;                                                                
    temporalOn = false;
    temporalResets += 1;
    gi.setAmount(0);
    scene.traverse((node) => {
      if (!node.isMesh || !node.material || Array.isArray(node.material)) return;
      if (node.userData && (node.userData.__rswPool || node.userData.__rswShared)) {


        const pm = node.material;
        const pud = pm.userData || {};
        if (pud.__rswGi || pud.__rswPcss || pud.__rswFar || pud.__rswCaps || pud.__rswTrans || pud.__rswHFog || pud.__rswPrb || pud.__rswSpecAA || pud.__rswSpecOcc || pud.__rswMatFeat || pud.__rswIesCk || pud.__rswLl || pud.__rswMgl) {
          delete pud.__rswGi;
          delete pud.__rswPcss;
          delete pud.__rswFar;


          delete pud.__rswCaps;          
          delete pud.__rswTrans;          
          delete pud.__rswHFog;                                                                  
          delete pud.__rswPrb;          
          delete pud.__rswSpecAA;         
          delete pud.__rswSpecOcc;          
          delete pud.__rswMatFeat;                                                  
          delete pud.__rswIesCk;                     
          delete pud.__rswAreaPt;          
          delete pud.__rswLl;                           
          delete pud.__rswMFUni;          
          unsubscribeMaterialFromMegaLights(pm);                                               
          pm.onBeforeCompile =
            typeof pud.__rswBasePatch === "function" ? pud.__rswBasePatch : function () {};
          pm.customProgramCacheKey =
            typeof pud.__rswBaseKey === "function" ? pud.__rswBaseKey : function () { return "rswSafeMode"; };
          pm.needsUpdate = true;
        }
        return;
      }
      const m = node.material;
      const ud = m.userData || {};
      if (!ud.__rswGi && !ud.__rswPcss && !ud.__rswFar && !ud.__rswCaps && !ud.__rswTrans && !ud.__rswHFog && !ud.__rswPrb && !ud.__rswSpecAA && !ud.__rswSpecOcc && !ud.__rswMatFeat && !ud.__rswIesCk && !ud.__rswLl && !ud.__rswMgl && !ud.__rswSb) return;
      if (m.isMeshBasicMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial) {
        let next;
        if (m.isMeshBasicMaterial) next = new THREE.MeshBasicMaterial();
        else if (m.isMeshLambertMaterial) next = new THREE.MeshLambertMaterial();
        else next = new THREE.MeshPhongMaterial();
        transferMaterialState(m, next);                                      
        if (next.isMeshPhongMaterial) {
          next.shininess = typeof m.shininess === "number" ? m.shininess : 28;
          if (m.specular) next.specular.copy(m.specular);
        }


        if (next.isMeshPhongMaterial && ud.__rswPhys && ud.__rswPhys.kind === "phong") {
          if (ud.__rswPhysBase) next.userData.__rswPhysBase = ud.__rswPhysBase;
          applyPhongPhysics(next, ud.__rswPhys.name, { specScale: ud.__rswPhys.specScale });
        }
        node.material = next;
        m.dispose();
      } else {
        delete ud.__rswGi;
        delete ud.__rswPcss;
        delete ud.__rswFar;
        delete ud.__rswCaps;                                               
        delete ud.__rswTrans;                                                
        delete ud.__rswHFog;                                      
        delete ud.__rswPrb;          
        delete ud.__rswSpecAA;         
        delete ud.__rswSpecOcc;          
        delete ud.__rswMatFeat;          
        delete ud.__rswIesCk;                     
        delete ud.__rswAreaPt;          
        delete ud.__rswLl;                           
        delete ud.__rswMFUni;          
        substrateSmPipeline.detachMaterial(m, "SSM_HOST_HEALED");
        substratePipeline.detachMaterial(m);
    unsubscribeMaterialFromMegaLights(m);                                               


        m.onBeforeCompile =
          typeof ud.__rswBasePatch === "function" ? ud.__rswBasePatch : function () {};
        m.customProgramCacheKey =
          typeof ud.__rswBaseKey === "function" ? ud.__rswBaseKey : function () { return "rswSafeMode"; };
        m.needsUpdate = true;
      }
    });
    lightingDirty = true;
    requestRender();
  }


  function syncEnvironment(st) {
    if (typeof document === "undefined" || !THREE.PMREMGenerator || !THREE.CubeTexture) return;


    if (hdriCtl.tex) {
      const key = "hdri:" + hdriCtl.sig;
      if (key !== envSig && !environmentPrefilter.hasRequest(key)) {
        environmentPrefilter.request({ key, texture: hdriCtl.tex });
      }
      return;
    }
    if (envcap.isReady()) {
      environmentPrefilter.cancel();
      const key = "envcap:" + envcap.capturedSig();
      if (key === envSig) return;
      envSig = key;
      if (envRT) { envRT.dispose(); envRT = null; }
      scene.environment = envcap.texture();
      warmupPending = true;
      return;
    }
    const key = envSkySignature(st);
    if (key === envSig || environmentPrefilter.hasRequest(key)) return;
    const faces = [];
    for (const face of ENV_FACE_ORDER) {
      const canvas = document.createElement("canvas");
      canvas.width = ENV_FACE_SIZE;
      canvas.height = ENV_FACE_SIZE;
      const context = canvas.getContext("2d");
      if (!context) return;
      const image = context.createImageData(ENV_FACE_SIZE, ENV_FACE_SIZE);
      fillEnvFace(image.data, face, ENV_FACE_SIZE, st);
      context.putImageData(image, 0, 0);
      faces.push(canvas);
    }
    const texture = new THREE.CubeTexture(faces);
    if (THREE.SRGBColorSpace && "colorSpace" in texture) texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    environmentPrefilter.request({ key, texture, releaseSource: true });
  }


  const skyImages = new Map();                                      


  function markSkyDirty() {
    if (disposed) return;
    skySignature = null;
    lightingDirty = true;
    requestRender();
  }

  function skyImageFor(assetId) {
    if (!assetId) return null;
    let entry = skyImages.get(assetId);
    if (entry) return entry;
    let rec = null;
    try {
      rec = assetStore.getById(assetId);
    } catch (_e) {
      rec = null;
    }
    if (!rec || !rec.local || !rec.dataUri || rec.section !== "images") return null;
    if (typeof Image === "undefined") return null;
    const img = new Image();
    entry = { img, loaded: false, failed: false };
    img.onload = () => {
      entry.loaded = true;
      markSkyDirty();                                                
    };
    img.onerror = () => {
      entry.failed = true;
      markSkyDirty();
    };
    img.src = rec.dataUri;
    skyImages.set(assetId, entry);
    return entry;
  }


  const celestialTex = new Map();                                             
  function clearCelestialTextures() {
    for (const t of celestialTex.values()) t.dispose();
    celestialTex.clear();
  }
  function celestialTextureFor(raw) {
    const assetId = typeof raw === "string" ? raw : "";
    if (!assetId) return null;
    const entry = skyImageFor(assetId);
    if (!entry || !entry.loaded || entry.failed) return null;
    let tex = celestialTex.get(assetId);
    if (!tex) {
      tex = new THREE.Texture(entry.img);

      tex.minFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      if (THREE.SRGBColorSpace && "colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      celestialTex.set(assetId, tex);
    }
    return tex;
  }


  let hdriCtl = { sig: null, tex: null, status: "off", width: 0, height: 0, ms: 0, error: "", stats: null, gen: 0 };
  function hdriTexDispose() {
    if (hdriCtl.tex) {

      environmentPrefilter.cancel();
      hdriCtl.tex.dispose();
      hdriCtl.tex = null;
    }
  }

  function hdriReset() {
    hdriCtl.gen++;
    hdriTexDispose();
    hdriCtl.sig = null;
    hdriCtl.status = "off";
    hdriCtl.width = 0;
    hdriCtl.height = 0;
    hdriCtl.ms = 0;
    hdriCtl.error = "";
    hdriCtl.stats = null;
    envSig = null;
    markSkyDirty();
    refreshReflectanceEnvMaps();                                               
  }


  function hdriRecFor(raw) {
    const assetId = typeof raw === "string" ? raw.trim() : "";
    if (!assetId) return null;
    let rec = null;
    try {
      rec = assetStore.getById(assetId);
    } catch (_e) {
      rec = null;
    }
    if (!rec || !rec.local || !rec.dataUri || rec.section !== "images") return null;
    if (!hdriKindForExt(rec.ext)) return null;
    return rec;
  }


  function syncHdri(sky) {
    const rawHdri = sky ? sky.getProperty("SkyboxHdri") : "";
    const rawId = typeof rawHdri === "string" ? rawHdri.trim() : "";
    const rec = hdriRecFor(rawId);
    if (!rec) {
      if (rawId) {


        const sig = "unresolved:" + rawId;
        if (hdriCtl.sig !== sig) {
          hdriReset();
          hdriCtl.sig = sig;
          hdriCtl.status = "error";
          hdriCtl.error = "SkyboxHdri nao resolve para um .hdr/.exr local importado";
          logger.warn('[Iluminação] IL-F16: SkyboxHdri "' + rawId + '" não resolve para um .hdr/.exr importado no Asset Manager (Imagens).');
        }
        return;
      }
      if (hdriCtl.sig !== null || hdriCtl.status !== "off") hdriReset();
      return;
    }
    const intensity = hdriIntensityClamp(sky.getProperty("HdriIntensity"));
    const maxSize = hdriMaxSizeForTier(!!(gpuBudget && gpuBudget.weak));
    const sig = hdriSignature(rec.id, intensity, maxSize);
    if (sig === hdriCtl.sig) return;
    const gen = ++hdriCtl.gen;
    hdriCtl.sig = sig;
    hdriCtl.status = "loading";
    hdriCtl.error = "";
    loadHdriEquirect({ dataUri: rec.dataUri, ext: rec.ext, maxSize, intensity })
      .then((r) => {
        if (disposed || gen !== hdriCtl.gen || sig !== hdriCtl.sig) return;
        hdriTexDispose();
        const tex = new THREE.DataTexture(r.half, r.width, r.height, THREE.RGBAFormat, THREE.HalfFloatType);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;


        tex.flipY = true;
        if (THREE.LinearSRGBColorSpace && "colorSpace" in tex) tex.colorSpace = THREE.LinearSRGBColorSpace;
        tex.needsUpdate = true;
        hdriCtl.tex = tex;
        hdriCtl.status = "on";
        hdriCtl.width = r.width;
        hdriCtl.height = r.height;
        hdriCtl.ms = r.ms;
        hdriCtl.stats = r.stats;
        envSig = null;                                              
        markSkyDirty();
        refreshReflectanceEnvMaps();                                           
      })
      .catch((err) => {
        if (disposed || gen !== hdriCtl.gen || sig !== hdriCtl.sig) return;
        hdriCtl.status = "error";
        hdriCtl.error = String((err && err.message) || err);
        logger.warn("[Iluminação] IL-F16: HDRI \"" + rec.id + "\" falhou: " + hdriCtl.error);
      });
  }


  subs.push(
    bus.on("assets:changed", () => {
      if (disposed) return;
      if (skyImages.size === 0 && skySignature === null && celestialTex.size === 0 && hdriCtl.sig === null && iesCkCells.size === 0) return;
      skyImages.clear();
      clearCelestialTextures();
      hdriReset();                                                            
      iesCkResetCells();                                                       
      lightingDirty = true;
      markSkyDirty();
    }),
  );

  function makeFaceCanvas(assetId, faceName, size) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    let hsh = 0;
    for (let i = 0; i < assetId.length; i++) hsh = (hsh * 31 + assetId.charCodeAt(i)) >>> 0;
    const baseHue = assetId
      ? hsh % 360
      : faceName === "SkyboxUp"
        ? 210
        : faceName === "SkyboxDn"
          ? 30
          : 205;
    const sat = assetId ? 45 : 55;
    const grad = ctx.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, `hsl(${baseHue}, ${sat}%, ${assetId ? 62 : 70}%)`);
    grad.addColorStop(1, `hsl(${(baseHue + 24) % 360}, ${sat}%, ${assetId ? 38 : 50}%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return canvas;
  }


  function makeFaceFromImage(img, size, rot) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.translate(size / 2, size / 2);
    if (rot) ctx.rotate(rot);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    return canvas;
  }

  function rebuildSkyCube(sky) {
    if (skyCube) skyCube.dispose();
    const byFace = {};
    for (const face of SKY_FACES) {
      const raw = sky.getProperty(face);
      const assetId = typeof raw === "string" ? raw : "";
      byFace[face] = { assetId, entry: skyImageFor(assetId) };
    }


    let size = 0;
    for (const face of SKY_FACES) {
      const e = byFace[face].entry;
      if (e && e.loaded && !e.failed) size = Math.max(size, e.img.width, e.img.height);
    }
    size = size > 0 ? Math.min(1024, Math.max(64, size)) : 64;
    const images = SKY_SLOTS.map(({ face, rot }) => {
      const { assetId, entry } = byFace[face];
      if (entry && entry.loaded && !entry.failed) {
        return makeFaceFromImage(entry.img, size, rot);
      }

      return makeFaceCanvas(assetId, face, size);
    });
    skyCube = new THREE.CubeTexture(images);
    if (THREE.SRGBColorSpace && "colorSpace" in skyCube) {
      skyCube.colorSpace = THREE.SRGBColorSpace;
    }
    skyCube.needsUpdate = true;


    refreshReflectanceEnvMaps();
  }


  function applyLighting() {
    const li = lightingInst();
    megaLightsDebug.synchronize();
    if (!li) return;

    let heavyShaderChange = false;
    const clock = wrapClockTime(li.getProperty("ClockTime"));
    const lat = clampNumber(Number(li.getProperty("GeographicLatitude")), -90, 90, 41.73);
    const st = skyStateAt(clock);
    const sd = sunDirection(clock, lat);
    sunDir.set(sd.x, sd.y, sd.z);
    const sunUp = sunDir.y > -0.08;
    lightDir.copy(sunDir);
    if (!sunUp) lightDir.multiplyScalar(-1);                                  

    const tech = String(li.getProperty("Technology") || "ShadowMap");


    if (tech !== curLightingTechnology) {
      curLightingTechnology = tech;
      llLocalLights.bumpGeneration();
    }


    if (hardSafeMode && safeModeTech && tech !== safeModeTech && hardRetries < 1) {
      hardRetries++;
      hardSafeMode = false;
      patchesDisabled = true;
      safeModeTech = tech;
      safeModeStamp = Date.now();
      restoreBasePatches();
      logger.warn("[Iluminação] Technology mudou (" + tech + "): religando os patches base após o modo seguro nível 2 (tentativa 1/1).");
    }
    if (patchesDisabled && !hardSafeMode && safeModeTech && tech !== safeModeTech && safeRetries < 2) {
      safeRetries++;
      patchesDisabled = false;
      safeModeTech = null;
      logger.warn("[Iluminação] Technology mudou (" + tech + "): saindo do modo seguro de shaders (tentativa " + safeRetries + "/2).");
    }
    const brightness = clampNumber(Number(li.getProperty("Brightness")), 0, 10, 2);
    const diffScale = clampNumber(Number(li.getProperty("EnvironmentDiffuseScale")), 0, 1, 1);
    const specNow = clampNumber(Number(li.getProperty("EnvironmentSpecularScale")), 0, 1, 1);
    const exposure = Math.pow(2, clampNumber(Number(li.getProperty("ExposureCompensation")), -5, 5, 0));


    renderStyleProp = li.getProperty("RenderStyle");


    setEmissiveRenderStyle(renderStyleProp);


    grade.tonemap = resolveToneMapper(li.getProperty("ToneMapper"));


    {
      const gradingSig = [
        String(li.getProperty("ColorGradingPreset") || "None"),
        Number(li.getProperty("WhiteBalanceTemperature")),
        Number(li.getProperty("WhiteBalanceTint")),
        Number(li.getProperty("ColorGradingLutAmount")),
        gradingHandle.rev,
      ].join("|");
      if (gradingSig !== gradingCacheSig) {
        gradingCacheSig = gradingSig;
        gradingCachePlan = buildGradingPlan({
          preset: li.getProperty("ColorGradingPreset"),
          temp: Number(li.getProperty("WhiteBalanceTemperature")),
          tint: Number(li.getProperty("WhiteBalanceTint")),
          lutAmount: Number(li.getProperty("ColorGradingLutAmount")),
          wheels: gradingHandle.wheels,
          lutParsed: gradingHandle.lutParsed,
          lutLabel: gradingHandle.lutLabel,
        });
      }
      grade.grading = gradingCachePlan;
    }
    const globalShadows = li.getProperty("GlobalShadows") !== false;
    const softness = clampNumber(Number(li.getProperty("ShadowSoftness")), 0, 1, 0.2);


    const smPlusOn = resolveShadowMapPlus(li.getProperty("ShadowMapPlus"), tech);


    aeFlagRaw = li.getProperty("AutoExposure");


    caFlagRaw = li.getProperty("ChromaticAberration");
    grainFlagRaw = li.getProperty("FilmGrain");
    mbFlagRaw = li.getProperty("MotionBlur");
    taaFlagRaw = li.getProperty("TemporalAA");

    mvFlagRaw = li.getProperty("ObjectMotionVectors");
    upscaleFlagRaw = li.getProperty("TemporalUpscale");


    const skyModelOn = resolveSkyModel(li.getProperty("RenderStyle")) === 1;
    const skyTurb = clampNumber(Number(li.getProperty("SkyTurbidity")), 1.7, 10, 3);
    const skyAlb = clampNumber(Number(li.getProperty("SkyGroundAlbedo")), 0, 1, 0.25);
    const ambient = li.getProperty("Ambient") || { r: 0, g: 0, b: 0 };
    const outdoor = li.getProperty("OutdoorAmbient") || { r: 0.27, g: 0.27, b: 0.27 };
    const shiftTop = li.getProperty("ColorShift_Top") || { r: 0, g: 0, b: 0 };
    const shiftBottom = li.getProperty("ColorShift_Bottom") || { r: 0, g: 0, b: 0 };


    const bf = 0.25 + brightness * 0.375;                                


    const photo = resolvePhotometryStyle(li.getProperty("RenderStyle")) === "Realistic"
      ? photometryPlan({
          style: "Realistic",


          sunVisible: sunUp,
          sunElevDeg: (Math.asin(Math.max(-1, Math.min(1, sd.y))) * 180) / Math.PI,
          brightness,
          exposureCompensation: Number(li.getProperty("ExposureCompensation")),
        })
      : null;
    photometryQa = photo
      ? { style: "Realistic", on: true, sunVisible: photo.sunVisible, ev100: photo.ev100, evAdjusted: photo.evAdjusted, sunElevDeg: photo.sunElevDeg, sunLux: photo.sunLux, skyLux: photo.skyLux, moonLux: photo.moonLux, brightnessStops: photo.brightnessStops, exposure: photo.exposure }
      : { style: "Classic", on: false };


    const llFlagRaw = li.getProperty("LightPhotometry");
    const prevLLOn = !!(localLightPhoto && localLightPhoto.on);
    localLightPhoto = localLightPhotometryPlan({
      flag: typeof llFlagRaw === "boolean" ? llFlagRaw : null,
      style: li.getProperty("RenderStyle"),
      sunElevDeg: (Math.asin(Math.max(-1, Math.min(1, sd.y))) * 180) / Math.PI,
      brightness,
      exposureCompensation: Number(li.getProperty("ExposureCompensation")),
    });
    if (prevLLOn !== localLightPhoto.on) localLightPhotoRev++;
    lightPhotometryQa = { on: localLightPhoto.on, mode: localLightPhoto.mode, scale: localLightPhoto.scale };
    sun.color.setRGB(st.sunColor.r, st.sunColor.g, st.sunColor.b);


    sun.intensity = photo
      ? photo.sunIntensity * LEGACY_LIGHT_SCALE
      : st.sunIntensity * 1.1 * bf * (sunUp ? 1 : 0.4) * LEGACY_LIGHT_SCALE;


    hemi.color.setRGB(
      Math.min(outdoor.r + shiftTop.r, 1),
      Math.min(outdoor.g + shiftTop.g, 1),
      Math.min(outdoor.b + shiftTop.b, 1),
    );
    hemi.groundColor.setRGB(
      Math.min(0.12 + ambient.r + shiftBottom.r, 1),
      Math.min(0.12 + ambient.g + shiftBottom.g, 1),
      Math.min(0.12 + ambient.b + shiftBottom.b, 1),
    );


    if (!threeRevisionOk && !threeRevisionWarned && (tech === "Voxel" || tech === "Future")) {
      threeRevisionWarned = true;
      logger.warn(
        "[Iluminação] three.js r" + THREE.REVISION + " detectado (o app foi validado com r161; a página hospedeira substituiu o import map do three). GI/PCSS ficam desligados para evitar shaders inválidos; o restante da iluminação segue normal.",
      );
    }


    if ((tech === "Voxel" || tech === "Future") && curTech !== tech && !fxPatched && fxWarmup === 0) {
      fxWarmup = 2;





      const stagedFlagF21 = li.getProperty("StagedWarmup");
      stagedWarmupOn = stagedFlagF21 === true || (!!(gpuBudget && gpuBudget.weak) && stagedFlagF21 !== false);
      if (stagedWarmupOn) {
        warmupStageStamp = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
        warmupStager.arm({ tech, nowMs: warmupStageStamp });
        tdrWatchdog.reset();
        warmupTailFrames = 0;                                                    
        warmupTdrReported = false;
        warmupSlowLogged = false;
        warmupToastShow(tech);
      } else if (warmupStager.isActive()) {
        warmupStager.cancel();
        warmupToastHide();
      }
    } else if (warmupStager.isActive() && tech !== "Voxel" && tech !== "Future") {


      warmupStager.cancel();
      warmupToastHide();
    }
    const fxHold = fxWarmup > 0;


    const holdFx = (f) => fxHold || warmupStager.holds(f);
    giActive = threeRevisionOk && !holdFx("gi") && !patchesDisabled && gi.supported && (tech === "Voxel" || tech === "Future");


    const giAmb = giActive && gi.hasBaked() ? 0.55 : 1;


    hemi.intensity = photo
      ? (tech === "Voxel" ? 1.15 / 0.85 : 1) * photo.skyIntensity * diffScale * giAmb * LEGACY_LIGHT_SCALE
      : (tech === "Voxel" ? 1.15 : 0.85) * diffScale * (0.35 + 0.65 * st.ambientFactor) * giAmb * LEGACY_LIGHT_SCALE;
    amb.color.setRGB(0.5 + ambient.r * 0.5, 0.5 + ambient.g * 0.5, 0.5 + ambient.b * 0.5);
    amb.intensity = photo
      ? photo.ambIntensity * diffScale * giAmb * LEGACY_LIGHT_SCALE
      : 0.8 * diffScale * (0.4 + 0.6 * st.ambientFactor) * giAmb * LEGACY_LIGHT_SCALE;


    const shadowsOn = globalShadows && tech !== "Compatibility";
    const desiredType = tech === "ShadowMap" ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    shadowsEnabled = shadowsOn;
    if (renderer.shadowMap.enabled !== shadowsOn || renderer.shadowMap.type !== desiredType) {
      renderer.shadowMap.enabled = shadowsOn;
      renderer.shadowMap.type = desiredType;
      refreshAllMaterials();
      heavyShaderChange = true;                                   
    }


    const weakIgnitionCtx = {
      weak: !!(gpuBudget && gpuBudget.weak),
      tech: tech,
      globalShadows: globalShadows === true,
    };
    weakIgnitionQa = {
      auto: weakAutoOn(weakIgnitionCtx),
      featureBudget: li.getProperty("FeatureBudget"),
      csmRodizio: li.getProperty("CsmRodizio"),
      halfResSunShadows: li.getProperty("HalfResSunShadows"),
      ambientOcclusionLite: li.getProperty("AmbientOcclusionLite"),
    };


    const rodizioPrev = rodizioWanted;
    rodizioWanted =
      rodizioEligible({
        flagOn: resolveIgnitionFlag(li.getProperty("CsmRodizio"), weakIgnitionCtx),
        weak: gpuBudget.weak,
        maxTextures:
          renderer.capabilities && renderer.capabilities.maxTextures
            ? renderer.capabilities.maxTextures
            : 16,
      }) &&
      threeRevisionOk && !hardSafeMode && shadowsOn;
    if (rodizioWanted !== rodizioPrev) {


      csmFitPrev.valid = false;
      rodizioPending = false;
      shadowsDirty = true;
    }
    const csmFinal =
      threeRevisionOk &&
      !patchesDisabled &&
      pcss.supported &&
      pcss.csmSupported === true &&
      shadowsOn &&
      tech === "Future" &&


      tierCsmWanted(tierCfg, { rodizio: rodizioWanted });


    const csmOn = csmFinal && !holdFx("csm");                                


    const csmResFull = Math.max(512, Number(tierCfg.csmRes) || 2048);
    const csmRes0 = Math.min(csmResFull, Math.max(512, Number(tierCfg.csmRes0) || csmResFull));


    const sunResCap = tierCfg.sunRes > 0 ? Math.min(tierCfg.sunRes, gpuBudget.maxSunShadowRes) : Math.min(4096, gpuBudget.maxSunShadowRes);


    const rodizioRes0 = hotCascadeRes(csmRes0);
    if (rodizioWanted && csmFinal && !rodizioLogged) {
      rodizioLogged = true;
      logger.warn(
        "[Sombras] F6: CSM em RODÍZIO ativo nesta GPU fraca — " + tierRodizioCascades(tierCfg) + " cascatas (cascata 0 quente de " +
          rodizioRes0 +
          " px; fantasmas em round-robin, 2/frame em giro rápido) + cache de páginas (F25: no tier micro são 2 — só a externa congelada/em rodízio). Lighting.CsmRodizio=false volta ao perfil padrão.",
      );
    }
    const res = tech === "Voxel" ? 512 : tech === "Future" ? (csmFinal ? (sun.shadow.mapSize.x === csmRes0 || sun.shadow.mapSize.x === rodizioRes0 ? sun.shadow.mapSize.x : csmResFull) : sunResCap) : 2048;
    if (sun.shadow.mapSize.x !== res) {
      sun.shadow.mapSize.set(res, res);
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        sun.shadow.map = null;
      }
    }
    sun.castShadow = shadowsOn;


    const vsmPrev = vsmWanted;


    vsmWanted = (li.getProperty("VirtualShadows") === true || (rodizioWanted && csmFinal)) && threeRevisionOk && !hardSafeMode && shadowsOn;


    if (vsmPrev && !vsmWanted) {
      sun.shadow.autoUpdate = !csmActive;
      sun.shadow.needsUpdate = true;
      shadowsDirty = true;
    }
    vsm.setEnabled(vsmWanted);


    { const _cg = resolveClipmapGate({
        virtualShadows: li.getProperty("VirtualShadows") === true,
        sunClipmap: li.getProperty("SunClipmap"),
        weakGpu: !!(gpuBudget && gpuBudget.weak),
        tier: typeof tierCtl !== "undefined" && tierCtl ? tierCtl.getTier() : "",
        tech, threeOk: threeRevisionOk, safeMode: hardSafeMode, shadowsOn,
      }); clipmap.setEnabled(_cg.on);


      clipmapRender.setEnabled(_cg.on); }


    const pcssOn = threeRevisionOk && !holdFx("pcss") && !patchesDisabled && pcss.supported && shadowsOn && (tech === "Voxel" || tech === "Future");
    pcss.setEnabled(pcssOn);


    const farOn = threeRevisionOk && !holdFx("far") && !patchesDisabled && farShadows.supported && shadowsOn && (tech === "Voxel" || tech === "Future") && tierFarEnabled(tierCfg, gpuBudget.weak);


    if (farOn && !farShadows.isEnabled()) farDirty = true;
    farShadows.setEnabled(farOn);
    curSoftness = softness;
    curPcssBoost = tech === "Voxel" ? 1.6 : 1;
    curPcssOn = pcssOn;

    curSmPlus = smPlusOn;


    const sunDot = lastTemporalSunDir.x * sunDir.x + lastTemporalSunDir.y * sunDir.y + lastTemporalSunDir.z * sunDir.z;
    if (sunResetNeeded(sunDot)) {
      temporalResets += 1;
      lastTemporalSunDir.x = sunDir.x;
      lastTemporalSunDir.y = sunDir.y;
      lastTemporalSunDir.z = sunDir.z;
    }





















    if (gpuBudget.weak && !gpuLiteWarned && (tech === "Voxel" || tech === "Future")) {
      gpuLiteWarned = true;
      logger.warn("[Iluminação] Escada de tiers de sombra em GPU fraca (" + (gpuBudget.reason || "orçamento de GPU") + "): inicia no tier LOW — CSM segue ATIVO (cascata 0 de 1024 colada na câmera + externa de 2048: nítido no contato, cobertura clássica ao longe) + PCSS TEMPORAL com IGN animado e acumulação reprojetada (F14: 9/8 taps por frame, qualidade converge em ~0,5 s parado; sol girado reseta a história) + contato do sol (SSCS 8 passos) + far shadows LITE (F8: só heightfield, 8 passos + dither IGN, +1 texture unit — montanha segue sombreando o vale); GTAO e RT ficam desligados para manter o viewport fluido e sem queda do driver. Sob pressão o controlador desce para LITE (temporal segue ligado, sem SSCS, sem tinte de vidro) e, em ÚLTIMO caso, para MICRO — que desde a F25 não é mais o 'modo feio': com o rodízio F6 elegível o CSM segue vivo com 2 cascatas (quente 512–768 + externa em rodízio) e, com a máscara F5, o temporal converge; sem as flags, mapa único de 1024 com fit por texel-alvo (~0,35 stud) e PCSS ESTÁTICO 8/6 — e resolução de render a 50% — sempre registrando o motivo; com folga sustentada ele sobe de volta sozinho (Parte 186).");
    }


    const smLitePlan = smRealisticLitePlan({
      weakGpu: !!(gpuBudget && gpuBudget.weak),
      tech,
      renderStyle: li.getProperty("RenderStyle"),
      forced: typeof window !== "undefined" ? window.__rswSmRealista : undefined,

      specKnob: typeof window !== "undefined" ? window.__rswSmRealistaSpec : undefined,
    });


    smLitePcssOn = smPcssLitePlan({
      packageOn: smLitePlan.on,
      supported: threeRevisionOk && !patchesDisabled && pcss.smLiteSupported === true,
      shadowsOn,
    }).on;


    shadowEdgeFilterOn = shadowEdgeFilterPlan({
      tech,
      supported: threeRevisionOk && !patchesDisabled && pcss.shadowEdgeSupported === true,
      shadowsOn,
      forced: typeof window !== "undefined" ? window.__rswShadowEdge : undefined,
    }).on;


    smLiteAmbQa = null;
    if (smLitePlan.on) {
      if (!skyModelOn) {
        smLiteAmbQa = { applied: false, reason: "céu físico IL-F14 vetado — ambiente legado (coerente com o dome)" };
      } else {
        const ambTint = smLiteAmbientTint({
          on: true,
          uni: skyPhysicalUniforms({ turbidity: skyTurb, albedo: skyAlb, sunDir: { x: sd.x, y: sd.y, z: sd.z } }),
          legacySky: [hemi.color.r, hemi.color.g, hemi.color.b],
          legacyGround: [hemi.groundColor.r, hemi.groundColor.g, hemi.groundColor.b],
          strength: typeof window !== "undefined" ? window.__rswSmRealistaAmb : undefined,
        });
        if (ambTint.applied) {
          hemi.color.setRGB(ambTint.sky[0], ambTint.sky[1], ambTint.sky[2]);
          hemi.groundColor.setRGB(ambTint.ground[0], ambTint.ground[1], ambTint.ground[2]);
        }
        smLiteAmbQa = {
          applied: ambTint.applied,
          blend: Math.round(ambTint.blend * 1000) / 1000,
          strength: ambTint.strength,
          sky: ambTint.sky,
          ground: ambTint.ground,
          reason: ambTint.reason,
        };
      }
    }


    let rtOn = false;

    let rtIdleWeakOn = false;
    if (pcssOn) {
      pcss.setSun({
        softness,
        boost: tech === "Voxel" ? 1.6 : 1,
        near: sun.shadow.camera.near,
        far: sun.shadow.camera.far,
        frustumSize: sun.shadow.camera.right - sun.shadow.camera.left,
      });


      const rtBase = threeRevisionOk && !patchesDisabled && pcssOn && tech === "Future" &&
        pcss.rtSupported === true && li.getProperty("RayTracedShadows") === true;
      rtOn = rtBase && tierCfg.rt;


      rtIdleWeakOn = rtBase && !rtOn && !!(gpuBudget && gpuBudget.weak);
      if (rtIdleWeakOn) rtOn = true;


      if (rtIdleWeakOn && !rtWeakWarned) {
        rtWeakWarned = true;
        logger.warn("[Iluminação] RayTracedShadows nesta GPU (" + (gpuBudget.reason || "orçamento de GPU") + ") roda como refinador de ócio (F16): traçado por CPU só com a câmera parada (>= 300 ms) — em movimento/bateria/aba oculta ele pausa e as sombras clássicas do Future seguem mandando.");
      }


      maskWanted = shouldUseSunMask({
        supported: pcss.maskSupported === true,
        pcssOn: pcssOn,
        tech: tech,
        rtOn: rtOn,
        flagOn: resolveIgnitionFlag(li.getProperty("HalfResSunShadows"), weakIgnitionCtx),
      });
      sun.shadow.radius = csmOn ? CSM_SUN_RADIUS_MARKER : (rtOn ? RT_SUN_RADIUS_MARKER : (maskWanted ? SUN_MASK_RADIUS_MARKER : 1));
    } else {


      maskWanted = false;


      if (smLitePcssOn) pcss.setSmLiteSoftness(softness);


      if (typeof pcss.setSmLiteContact === "function") {
        pcss.setSmLiteContact(
          smLitePcssOn &&
            resolveSmLiteContactFlag(typeof window !== "undefined" ? window.__rswSmLiteContact : null),
        );
      }


      if (typeof pcss.setShadowEdge === "function") {
        pcss.setShadowEdge({ on: shadowEdgeFilterOn, softness });
      }


      sun.shadow.radius = shadowEdgeFilterOn
        ? SHADOW_EDGE_RADIUS_MARKER
        : smLitePcssOn
          ? SM_LITE_RADIUS_MARKER
          : sunEdgeTexels(softness, tech);
    }


    const temporalWanted = pcssOn && tierTemporalEnabled(tierCfg, gpuBudget.weak, { sunMask: maskWanted });
    if (temporalOn !== temporalWanted) {
      temporalOn = temporalWanted;
      temporalResets += 1;
    }
    const csmWasActive = csmActive;
    setCsmActive(csmOn);


    if (csmActive !== csmWasActive) heavyShaderChange = true;


    rtSun.setIdlePolicy({ weak: rtIdleWeakOn });
    rtSun.setEnabled(rtOn);
    if (rtOn) rtSun.setSun([lightDir.x, lightDir.y, lightDir.z], sunTanFromSoftness(softness, 1));


    const substrateActive = substratePipeline.configure({ technology: tech, tierName: localLightTier(),
      enabledFlag: li.getProperty("SubstrateEnabled"), safeMode: patchesDisabled, webgl2: renderer.capabilities?.isWebGL2 === true });
    substrateSmSettings.configure(li, { technology: tech, renderStyle: renderStyleProp,
      safeMode: patchesDisabled, contextAvailable: renderer.getContext?.()?.isContextLost?.() === false,
      webgl2: renderer.capabilities?.isWebGL2 === true });
    matKind = tech === "Compatibility" ? "basic" : tech === "Future" ? (substrateActive ? "standard" : "phong") : smLitePlan.on ? "phong" : "lambert";


    smLiteOn = smLitePlan.on === true;


    smLitePlanNow = smLitePlan;
    grade.smLite = smLitePlan;


    specScale = smLitePlan.on ? specNow * smLitePlan.specIntensity : specNow;
    curTech = tech;


    if (typeof setPoolLightingModel === "function") setPoolLightingModel(matKind, specScale);


    fxWanted = pcssOn || giActive || farOn || smLitePcssOn || shadowEdgeFilterOn;


    capsWanted = threeRevisionOk && !patchesDisabled && caps.supported && tech !== "Compatibility" && globalShadows && tierCapsuleEnabled(tierCfg);
    capsBlobMode = globalShadows && (tech === "Compatibility" || !capsWanted);                                                                      


    featGovWanted = tech === "Future" && globalShadows &&
      !!(gpuBudget && gpuBudget.weak) &&
      resolveIgnitionFlag(li.getProperty("FeatureBudget"), weakIgnitionCtx);


    const upsRaw = li.getProperty("UpscaleSharpen");
    upsharpFlag = upsRaw === true ? true : upsRaw === false ? false : null;
    upsharpStrength = li.getProperty("UpscaleSharpenStrength");


    const leRawIlF6 = li.getProperty("LocalExposure");
    leFlag = leRawIlF6 === true ? true : leRawIlF6 === false ? false : null;
    leStrengthRaw = li.getProperty("LocalExposureStrength");


    const lfRawIlF30 = li.getProperty("LensFlare");
    lfFlag = lfRawIlF30 === true ? true : lfRawIlF30 === false ? false : null;
    lfIntensityRaw = li.getProperty("LensFlareIntensity");


    capsCurW = tierCapsuleW(tierCfg, !!(gpuBudget && gpuBudget.weak));
    caps.setSunTan(sunTanFromSoftness(softness, tech === "Voxel" ? 1.6 : 1));


    lsrWanted = gpuBudget.weak && shadowsOn &&
      li.getProperty("LocalShadowRotation") !== false;

    transWanted = threeRevisionOk && !holdFx("trans") && !patchesDisabled && trans.supported &&
      shadowsOn && (tech === "Voxel" || tech === "Future") &&
      li.getProperty("TransparencyShadows") !== false;


    const transActivePrev = transActive;


    transActive = transWanted && tierTransEnabled(tierCfg, gpuBudget.weak === true);
    if (transActive && !transActivePrev) {                                    
      transSig = "";
      transListSig = "";
      transRenderedEmpty = false;                                                        
      transGate.reset();
    }
    if (!transActive) trans.setEnabled(false);

    mlWanted = tech === "Future" && !holdFx("megalights") && !patchesDisabled && temporalWanted &&
      !gpuBudget.weak && shadowsOn && li.getProperty("MegaLights") !== false;

    {
      const saRaw = li.getProperty("ShadowAtlas");
      atlasWanted = saRaw === true ? (mlWanted) : saRaw === false ? false :
        (mlWanted && !gpuBudget.weak);                                        


      if (saRaw !== false && !atlasWanted && renderer && renderer.capabilities
        && llShadowAtlas.wantsDeterministicAtlas({
          tier: localLightTier(),
          technology: curTech,
          maxTextureSize: renderer.capabilities.maxTextureSize,
          allow8k: false,
        })) {
        atlasWanted = true;
      }


      if (saRaw !== false && !atlasWanted && renderer && renderer.capabilities
        && msmWantsShadowAtlas({
          shadowAtlasProperty: saRaw,
          technology: curTech,
          megaLightsWanted: mlWanted,
          tier: localLightTier(),
          flag: li.getProperty("MegaLightsSM"),
          weakGpu: gpuBudget.weak === true,
          maxTextureSize: renderer.capabilities.maxTextureSize,
          sampleReadsAtlas: MSM_ATLAS_SAMPLE_CONSUMER_READY,
        })) {
        atlasWanted = true;
      }

      if (atlasWanted && shadowAtlas === null && renderer && renderer.capabilities) {
        shadowAtlas = createShadowAtlas({
          THREE,
          renderer,
          maxTextureSize: renderer.capabilities.maxTextureSize,
          allow8k: false,
        });
      }


      if (atlasWanted && shadowAtlas && shadowAtlas.enabled && !atlasDepthHook) {
        atlasDepthHook = createAtlasDepthRenderer({ THREE, scene });
      }
      if (!atlasWanted && shadowAtlas && shadowAtlas.enabled) {


      }
    }

    {
      const clRaw = li.getProperty("LightCluster");
      clWanted = clRaw === true
        ? mlWanted                                               
        : clRaw === false
        ? false
        : (mlWanted && !gpuBudget.weak);                                        


      if (clOverride.on === false) clWanted = false;
      else if (clOverride.on === true) clWanted = mlWanted;
      clSettingsBuf.specStrength = clOverride.specStrength == null
        ? CL_DEFAULTS.specStrength
        : clOverride.specStrength;
    }


    matFeatWanted = threeRevisionOk && !patchesDisabled && matFeat.supported &&
      tech === "Future" &&
      resolveMatFeatFlag(li.getProperty("MaterialFeatures"), {
        realistic: li.getProperty("RenderStyle") === "Realistic",
        weak: gpuBudget.weak === true,
      });
    matFeat.setEnabled(matFeatWanted);


    const volFogRaw = li.getProperty("VolumetricFog");


    volFogWanted = threeRevisionOk && resolveVolFogFlag(volFogRaw, weakIgnitionCtx);
    volFogQa.on = volFogWanted;
    volFogQa.flag = volFogRaw === true ? true : volFogRaw === false ? false : null;
    volFogQa.auto = volFogRaw !== true && volFogRaw !== false;


    const ssrRaw = li.getProperty("SSR");
    ssrCtx.weak = gpuBudget.weak === true;
    ssrCtx.tech = tech;
    ssrCtx.realistic = li.getProperty("RenderStyle") === "Realistic";
    ssrWanted = threeRevisionOk && resolveSsrFlag(ssrRaw, ssrCtx);
    ssrQa.on = ssrWanted;
    ssrQa.flag = ssrRaw === true ? true : ssrRaw === false ? false : null;
    ssrQa.auto = ssrRaw !== true && ssrRaw !== false;


    photoWanted = !!gpuBudget.weak && li.getProperty("PhotoMode") !== false;

    iesCkWanted = iesck.supported &&
      !patchesDisabled &&
      tech !== "Compatibility" &&
      gpuBudget.weak !== true &&
      anyIesCookieConfigured();
    iesck.setEnabled(iesCkWanted);

    areaPtWanted = areaPt.supported &&
      !patchesDisabled &&
      tech === "Future" &&
      gpuBudget.weak !== true &&
      (areaRectCount + areaTubeCount) > 0 &&
      resolveAreaPartsFlag(li.getProperty("AreaLightParts"), {
        realistic: li.getProperty("RenderStyle") === "Realistic",
        weak: gpuBudget.weak === true,
      });
    areaPt.setEnabled(areaPtWanted);


    mglWanted = !patchesDisabled && !holdFx("megalights") && megaLightsWantsMaterials({
      technology: tech,
      tierName: localLightTier(),
      megaLightsEnabled: li.getProperty("MegaLights"),
    });


    const patchSig = (fxWanted ? "F" : "") + (capsWanted ? "C" : "") + (transWanted ? "T" : "") + (matFeatWanted ? "M" : "") + (iesCkWanted ? "K" : "") + (areaPtWanted ? "A" : "") + (mglWanted ? "G" : "") + (substrateActive ? "S" + substratePipeline.signature() : "") + substrateSmPipeline.signature();                                 
    if (patchSig !== curPatchSig) {
      curPatchSig = patchSig;
      heavyShaderChange = true;                                           
      stripFxPatches();
      fxPatched = patchSig !== "";
      for (const m of externalMats) {
        if (!m) continue;
        substratePipeline.attachMaterial(m);
        if (matFeatWanted) matFeat.patchMaterial(m);
        if (fxWanted) { gi.patchMaterial(m); pcss.patchMaterial(m); farShadows.patchMaterial(m); }
        if (capsWanted) caps.patchMaterial(m);
        if (transWanted) trans.patchMaterial(m);                             
        hfog.patchMaterial(m);                                                        
        rprobes.patchMaterial(m);                                      
        specAa.patchMaterial(m);                                                  
        specOcc.patchMaterial(m);                                                   
        if (iesCkWanted) iesck.patchMaterial(m);          
        if (areaPtWanted) areaPt.patchMaterial(m);          
        llLocalLights.patchMaterial(m);                                            
        if (mglWanted) subscribeMaterialToMegaLights(m);                                           
        substrateSmPipeline.attachMaterial(m, null, "external-repatch");
      }
    }
    const modeKeyPrev = modeKey;
    modeKey = matKind + "|" + (shadowsOn ? 1 : 0) + "|" + Math.round(specScale * 100) + "|" + patchSig;
    if (modeKey !== modeKeyPrev) heavyShaderChange = true;             


    const fogColor = li.getProperty("FogColor") || { r: 0.75, g: 0.75, b: 0.75 };
    fog.color.setRGB(fogColor.r, fogColor.g, fogColor.b);
    fog.near = Math.max(0, Number(li.getProperty("FogStart")) || 0);
    fog.far = Math.max(fog.near + 1, Number(li.getProperty("FogEnd")) || 100000);


    const u = domeMat.uniforms;
    u.uTop.value.setRGB(st.skyTop.r, st.skyTop.g, st.skyTop.b);
    u.uHorizon.value.setRGB(st.skyHorizon.r, st.skyHorizon.g, st.skyHorizon.b);
    u.uSunColor.value.setRGB(st.sunColor.r, st.sunColor.g, st.sunColor.b);
    u.uSunDir.value.copy(sunDir);
    u.uMoonDir.value.copy(sunDir).multiplyScalar(-1);
    u.uStars.value = st.starAlpha;


    u.uSkyModel.value = skyModelOn ? 1 : 0;
    if (skyModelOn) {
      const sp = skyPhysicalUniforms({ turbidity: skyTurb, albedo: skyAlb, sunDir: { x: sunDir.x, y: sunDir.y, z: sunDir.z } });
      u.uSkyPhysBlend.value = sp.blend;
      u.uHwA.value.fromArray(sp.A);
      u.uHwB.value.fromArray(sp.B);
      u.uHwC.value.fromArray(sp.C);
      u.uHwD.value.fromArray(sp.D);
      u.uHwE.value.fromArray(sp.E);
      u.uHwF.value.fromArray(sp.F);
      u.uHwG.value.fromArray(sp.G);
      u.uHwH.value.fromArray(sp.H);
      u.uHwI.value.fromArray(sp.I);
      u.uHwZenith.value.fromArray(sp.zenith);
      u.uHwGround.value.setRGB(sp.ground[0], sp.ground[1], sp.ground[2]);
      curSkyPhys = {
        on: true,
        blend: Math.round(sp.blend * 1000) / 1000,
        turbidity: sp.turbidity,
        albedo: sp.albedo,
        elevDeg: Math.round(sp.elevDeg * 10) / 10,
        zenithY: Math.round(sp.zenithY * 1000) / 1000,
      };
    } else {
      u.uSkyPhysBlend.value = 0;
      curSkyPhys = null;
    }


    syncHdri(firstChildOfClass(li, "Sky"));
    syncEnvironment(st);


    const sky = firstChildOfClass(li, "Sky");
    const atmo = firstChildOfClass(li, "Atmosphere");
    const sunSize = sky ? clampNumber(Number(sky.getProperty("SunAngularSize")), 1, 90, 21) : 21;
    const moonSize = sky ? clampNumber(Number(sky.getProperty("MoonAngularSize")), 1, 90, 11) : 11;
    u.uSunCos.value = Math.cos(((sunSize / 2) * Math.PI) / 180);
    u.uMoonCos.value = Math.cos(((moonSize / 2) * Math.PI) / 180);


    const sunTexV = sky ? celestialTextureFor(sky.getProperty("SunTextureId")) : null;
    const moonTexV = sky ? celestialTextureFor(sky.getProperty("MoonTextureId")) : null;
    u.uSunTex.value = sunTexV || whiteTex;
    u.uSunTexOn.value = sunTexV ? 1 : 0;
    u.uMoonTex.value = moonTexV || whiteTex;
    u.uMoonTexOn.value = moonTexV ? 1 : 0;
    const starCount = sky ? clampNumber(Number(sky.getProperty("StarCount")), 0, 10000, 3000) : 3000;
    u.uStarDensity.value = starCount / 10000;
    u.uCelestial.value = !sky || sky.getProperty("CelestialBodiesShown") !== false ? 1 : 0;

    if (atmo) {
      const density = clampNumber(Number(atmo.getProperty("Density")), 0, 1, 0.395);
      u.uAtmoDensity.value = density;
      u.uAtmoOffset.value = clampNumber(Number(atmo.getProperty("Offset")), 0, 1, 0);
      u.uAtmoGlare.value = clampNumber(Number(atmo.getProperty("Glare")), 0, 1, 0);
      u.uAtmoHaze.value = clampNumber(Number(atmo.getProperty("Haze")), 0, 10, 0);
      const ac = atmo.getProperty("Color") || { r: 0.78, g: 0.81, b: 0.91 };
      const dc = atmo.getProperty("Decay") || { r: 0.42, g: 0.44, b: 0.55 };
      u.uAtmoColor.value.setRGB(ac.r, ac.g, ac.b);
      u.uAtmoDecay.value.setRGB(dc.r, dc.g, dc.b);


      if (density > 0.01) {
        const reach = 6000 * (1.08 - density);
        if (fog.far > reach) {
          fog.far = Math.max(fog.near + 1, reach);
          tmpC.setRGB(ac.r, ac.g, ac.b);
          fog.color.lerp(tmpC, 0.65);
        }
      }
    } else {
      u.uAtmoDensity.value = 0;
      u.uAtmoGlare.value = 0;
      u.uAtmoHaze.value = 0;
      u.uAtmoOffset.value = 0;
    }


    curRenderStyle = resolveRenderStyle(li.getProperty("RenderStyle"));
    const hfogOn = curRenderStyle === "Realistic" && matKind !== "basic" && !patchesDisabled;
    const hfP = mapAtmosphereToHeightFog({
      hasAtmosphere: !!atmo,
      density: u.uAtmoDensity.value,
      offset: u.uAtmoOffset.value,
      haze: u.uAtmoHaze.value,
      glare: u.uAtmoGlare.value,
      fogStart: fog.near,
      fogEnd: fog.far,
    });
    hfog.setParams(hfP);


    hfog.setSun(sunDir, st.sunColor);
    hfog.setEnabled(hfogOn);

    const prbRaw = li.getProperty("ReflectionProbes");
    const prbResolved = prbRaw === true ? true : prbRaw === false ? false : null;
    const prbChildren = li.getChildren ? li.getChildren().filter((c) => c && c.className === "ReflectionProbe") : [];
    const prbList = prbChildren.map((c) => {
      const pos = c.getProperty ? c.getProperty("Position") : null;
      const size = c.getProperty ? c.getProperty("Size") : null;
      return sanitizeProbe({
        key: c,
        name: c.name || "ReflectionProbe",
        enabled: c.getProperty ? c.getProperty("Enabled") : true,
        shape: c.getProperty ? c.getProperty("Shape") : "Box",
        position: pos || { x: 0, y: 8, z: 0 },
        size: size || { x: 32, y: 16, z: 32 },
        priority: c.getProperty ? c.getProperty("Priority") : 0,
        resolution: c.getProperty ? c.getProperty("Resolution") : 64,
        blend: c.getProperty ? c.getProperty("BlendDistance") : 2,
      });
    });
    const prbOn = resolveProbesFlag(prbResolved, {
      realistic: curRenderStyle === "Realistic",
      weak: typeof gpuBudget !== "undefined" && gpuBudget && gpuBudget.weak,
      basic: matKind === "basic",
      patchesDisabled,
    });
    rprobes.setProbes(prbList);


    const rswStkOverride = typeof window !== "undefined" && window.__rswReflStack !== undefined
      ? window.__rswReflStack
      : null;
    const stackWanted = rswStkOverride !== null
      ? !!rswStkOverride
      : (curRenderStyle === "Realistic" &&
          !(typeof gpuBudget !== "undefined" && gpuBudget && gpuBudget.weak) &&
          !patchesDisabled &&
          matKind !== "basic");
    rprobes.configure({
      on: prbOn,
      budget: probeBudget({
        weak: typeof gpuBudget !== "undefined" && gpuBudget && gpuBudget.weak,
        forced: prbResolved === true,
        maxTex: renderer && renderer.capabilities ? renderer.capabilities.maxTextures : 8,
      }),
      stackOn: stackWanted,                                     
    });


    stackWantedCur = stackWanted;
    if (!stackWanted) ssrStackShare.uRswStkSsrOn.value = 0;


    if (hfogOn !== specAaAutoPrev) {
      specAaAutoPrev = hfogOn;
      specAa.configure({ on: hfogOn });
    }
    u.uHFogOn.value = hfogOn ? 1 : 0;
    u.uHFogSigma.value = hfP.sigma;
    u.uHFogFalloff.value = hfP.falloff;
    u.uHFogColor.value.copy(fog.color);
    u.uHFogSunK.value = hfP.sunK;
    u.uHFogSunAmp.value = hfP.sunAmp;


    const clWs = workspaceInst();
    const clTerrain = clWs ? firstChildOfClass(clWs, "Terrain") : null;
    const cloudsInst = (clTerrain && firstChildOfClass(clTerrain, "Clouds")) ||
      (clWs && firstChildOfClass(clWs, "Clouds")) ||
      firstChildOfClass(li, "Clouds");
    const clProps = sanitizeCloudsProps(cloudsInst ? {
      enabled: cloudsInst.getProperty("Enabled") !== false,
      cover: Number(cloudsInst.getProperty("Cover")),
      density: Number(cloudsInst.getProperty("Density")),
      color: cloudsInst.getProperty("Color"),
    } : null);
    const clGate = resolveCloudsGate({
      hasInstance: !!cloudsInst,
      enabled: clProps.enabled,
      cover: clProps.cover,
      density: clProps.density,
      weakGpu: !!(gpuBudget && gpuBudget.weak),
      tier: tierCtl.getTier(),
    });
    u.uCloudsOn.value = clGate.on ? 1 : 0;
    u.uCloudCover.value = clProps.cover;
    u.uCloudDensity.value = clProps.density;
    u.uCloudColor.value.setRGB(clProps.color.r, clProps.color.g, clProps.color.b);
    cloudAnimWeak = !!(gpuBudget && gpuBudget.weak);


    const nightOn = curRenderStyle === "Realistic";
    const moonPhase = sanitizeMoonPhase(sky ? sky.getProperty("MoonPhase") : null);
    u.uNightSky.value = nightOn ? 1 : 0;
    u.uMoonPhase.value = moonPhase;
    cloudsQa = {
      instance: !!cloudsInst,
      on: clGate.on,
      reason: clGate.reason,
      cover: Math.round(clProps.cover * 1000) / 1000,
      density: Math.round(clProps.density * 1000) / 1000,
      tier: tierCtl.getTier(),
    };
    nightSkyQa = {
      on: nightOn,
      moonPhase: Math.round(moonPhase * 1000) / 1000,
      starAlpha: Math.round(st.starAlpha * 1000) / 1000,
    };


    envcap.configure({
      plan: envCapturePlan({
        realistic: renderStyleProp === "Realistic",
        weak: !!(gpuBudget && gpuBudget.weak),
        pmremOk: !!(THREE.PMREMGenerator && THREE.CubeCamera && THREE.WebGLCubeRenderTarget),
        forced: typeof window !== "undefined" ? window.__rswEnvCapture : undefined,
        smLite: smLiteOn,                                                   
      }),
      signature: envCaptureSignature({
        skySig: envSkySignature(st),
        sunX: sunDir.x,
        sunY: sunDir.y,
        sunZ: sunDir.z,
        physBlend: u.uSkyPhysBlend ? u.uSkyPhysBlend.value : 0,
        cloudsOn: u.uCloudsOn ? u.uCloudsOn.value : 0,
        cloudCover: u.uCloudCover ? u.uCloudCover.value : 0,
        nightSky: u.uNightSky ? u.uNightSky.value : 0,
        stars: u.uStars ? u.uStars.value : 0,
      }),
      domeMaterial: domeMat,
    });


    if (!envcap.isReady() && typeof envSig === "string" && envSig.indexOf("envcap:") === 0) {
      envSig = null;
      syncEnvironment(st);
    }


    if (sky && hdriCtl.tex) {


      scene.background = hdriCtl.tex;
      u.uSkyMode.value = 1;
    } else if (sky) {
      let sig = "";
      for (const face of SKY_FACES) {
        const raw = sky.getProperty(face);
        sig += (typeof raw === "string" ? raw : "") + "\u0001";
      }
      if (sig !== skySignature) {
        skySignature = sig;
        rebuildSkyCube(sky);
      }
      scene.background = skyCube;
      u.uSkyMode.value = 1;
    } else {
      skySignature = null;
      if (skyCube) {
        skyCube.dispose();
        skyCube = null;


        refreshReflectanceEnvMaps();
      }
      scene.background = null;
      u.uSkyMode.value = 0;
    }


    const gtaoLiteOn = tech === "Future" && !holdFx("ao") &&
      li.getProperty("AmbientOcclusion") !== false &&
      gtaoLiteGate({

        flag: resolveIgnitionFlag(li.getProperty("AmbientOcclusionLite"), weakIgnitionCtx),
        weak: !!(gpuBudget && gpuBudget.weak),
        tierGtao: !!tierCfg.gtao,
        tierGtaoLite: !!tierCfg.gtaoLite,
      });


    const smLiteAoOn = tech === "ShadowMap" && matKind === "phong" &&
      !holdFx("ao") && li.getProperty("AmbientOcclusion") !== false;
    aoState.ao = (tech === "Future" && !holdFx("ao") && tierCfg.gtao && li.getProperty("AmbientOcclusion") !== false) || gtaoLiteOn || smLiteAoOn;
    aoState.lite = gtaoLiteOn || smLiteAoOn;


    aoState.noTemporal = smLiteAoOn;
    aoState.contact = tech === "Future" && !holdFx("contact") && tierCfg.contact && shadowsOn && li.getProperty("ContactShadows") !== false;


    aoState.csSteps = fusedContactSteps(!!(gpuBudget && gpuBudget.weak), tierCfg.contactSteps);


    csLocalWanted = !!(gpuBudget && gpuBudget.weak) && aoState.contact;


    if (!csLocalWanted) {
      aoState.csLocal.on = false;
      aoState.csLocal.range = 0;
      aoState.csLocal.steps = 0;
      aoState.csLocal.spread = 0;              
    }
    aoState.csScale = clampNumber(st.sunIntensity * 1.2, 0, 1, 1);


    aoState.bent = aoState.ao;
    const rswHemiSum = hemi.intensity + amb.intensity;
    aoState.hemiFrac = clampNumber(rswHemiSum / Math.max(rswHemiSum + sun.intensity, 1e-4), 0, 1, 0);


    const specOccAuto = specOccGate({
      realistic: hfogOn,
      weak: !!(gpuBudget && gpuBudget.weak),
      tierGtao: !!tierCfg.gtao,
      aoOn: !!aoState.ao,
      aoLite: !!aoState.lite,
      smLite: smLiteAoOn,
    });

    const specOccPhongAuto = specOccAuto && smLiteAoOn;
    if (specOccAuto !== specOccAutoPrev || specOccPhongAuto !== specOccPhongAutoPrev) {
      specOccAutoPrev = specOccAuto;
      specOccPhongAutoPrev = specOccPhongAuto;
      specOcc.configure({ on: specOccAuto, phongOn: specOccPhongAuto });
    }


    const rswSpecOccSt = specOcc.getState ? specOcc.getState() : null;
    aoState.specOccExternal = rswSpecOccSt
      ? !!(rswSpecOccSt.wanted && rswSpecOccSt.supported !== false)
      : !!specOccAuto;


    grade.exposure = exposure;
    grade.bright = photo ? 1 : (0.55 + brightness * 0.225) * (0.45 + 0.55 * st.ambientFactor);
    const avgR = (ambient.r + outdoor.r) * 0.5;
    const avgG = (ambient.g + outdoor.g) * 0.5;
    const avgB = (ambient.b + outdoor.b) * 0.5;
    grade.tint.r = clampNumber(1 + (avgR - 0.135) * 0.9, 0, 2, 1);
    grade.tint.g = clampNumber(1 + (avgG - 0.135) * 0.9, 0, 2, 1);
    grade.tint.b = clampNumber(1 + (avgB - 0.135) * 0.9, 0, 2, 1);
    grade.punch = tech === "Future" ? 1.06 : tech === "Voxel" ? 0.97 : 1;
    grade.lift = tech === "Voxel" ? 0.02 : 0;
    grade.sunIntensity = st.sunIntensity;


    giSun.dir[0] = lightDir.x; giSun.dir[1] = lightDir.y; giSun.dir[2] = lightDir.z;
    giSun.color[0] = sun.color.r; giSun.color[1] = sun.color.g; giSun.color[2] = sun.color.b;


    giSun.intensity = sun.intensity / LEGACY_LIGHT_SCALE;


    matFeat.setSunDirWorld(lightDir);
    matFeat.setSunColor(sun.color.r * sun.intensity, sun.color.g * sun.intensity, sun.color.b * sun.intensity);
    matFeat.setAmbient((hemi.intensity + amb.intensity) / LEGACY_LIGHT_SCALE);
    gi.setAmount(giActive ? (tech === "Future" ? 1.15 : 0.9) : 0);


    giBouncePlanCur = giBouncePlan({
      flag: li.getProperty("GlobalIllumination"),
      realistic: curRenderStyle === "Realistic",
      weak: !!(gpuBudget && gpuBudget.weak),
      tech,
      tier: tierCtl.getTier(),
      giActive: !!giActive,
    });
    gi.setBouncePlan(giBouncePlanCur);
    gi.setSpecAmount(
      giBouncePlanCur.on && giBouncePlanCur.specularGi
        ? giBouncePlanCur.specAmount
        : 0,
    );


    skyOcclusionOn = !!giActive && tech === "Future" && tierCfg.gtao;
    gi.setSkyAmount(skyOcclusionOn ? 1 : 0);

    farShadows.setSun({ x: lightDir.x, y: lightDir.y, z: lightDir.z, softness });
    giDirty = true;
    shadowsDirty = true;


    if (heavyShaderChange) warmupPending = true;
  }


  function collectGiJob() {
    const boxes = [];
    const meshesMap = getMeshes();
    const vals = meshesMap && meshesMap.values ? meshesMap.values() : [];
    for (const obj of vals) {
      if (boxes.length >= GI_MAX_BOXES) break;
      if (!obj || obj.visible === false) continue;
      if (obj.isInstancedMesh && obj.userData.__rswPool) {
        if (String(obj.userData.__rswPoolKey || "").slice(-3) === "|tr") continue;
        const me = obj.instanceMatrix.array;
        const co = obj.instanceColor ? obj.instanceColor.array : null;
        for (let i = 0; i < obj.count && boxes.length < GI_MAX_BOXES; i++) {
          const o = i * 16;
          const lx = Math.hypot(me[o], me[o + 1], me[o + 2]);
          const ly = Math.hypot(me[o + 4], me[o + 5], me[o + 6]);
          const lz = Math.hypot(me[o + 8], me[o + 9], me[o + 10]);
          if (Math.max(lx, ly, lz) < 0.05) continue;                        


          const sx = lx > 1e-6 ? lx : 1;
          const sy = ly > 1e-6 ? ly : 1;
          const sz = lz > 1e-6 ? lz : 1;
          boxes.push({
            c: [me[o + 12], me[o + 13], me[o + 14]],
            h: [lx / 2, ly / 2, lz / 2],
            axes: [
              [me[o] / sx, me[o + 1] / sx, me[o + 2] / sx],
              [me[o + 4] / sy, me[o + 5] / sy, me[o + 6] / sy],
              [me[o + 8] / sz, me[o + 9] / sz, me[o + 10] / sz],
            ],
            color: co ? [co[i * 3], co[i * 3 + 1], co[i * 3 + 2]] : [0.7, 0.7, 0.7],
          });
        }
        continue;
      }
      giBox3.setFromObject(obj);
      if (giBox3.isEmpty()) continue;
      giBox3.getCenter(giV1);
      giBox3.getSize(giV2);
      const maxDim = Math.max(giV2.x, giV2.y, giV2.z);
      if (!Number.isFinite(maxDim) || maxDim < 0.05 || maxDim > 2048) continue;
      let col = null;
      let skip = false;
      obj.traverse((nd) => {
        if (skip || col || !nd.isMesh || !nd.material || Array.isArray(nd.material)) return;
        const m = nd.material;
        if (m.wireframe || (m.transparent && m.opacity < 0.5)) { skip = true; return; }
        if (m.color) col = m.color;
      });
      if (skip) continue;
      boxes.push({
        c: [giV1.x, giV1.y, giV1.z],
        h: [giV2.x / 2, giV2.y / 2, giV2.z / 2],
        color: col ? [col.r, col.g, col.b] : [0.7, 0.7, 0.7],
      });
    }


    if (typeof getTerrainGiBoxes === "function" && boxes.length < GI_MAX_BOXES) {
      let tb = null;
      try {
        tb = getTerrainGiBoxes(GI_MAX_BOXES - boxes.length);
      } catch (_e) {
        tb = null;
      }
      if (Array.isArray(tb)) {
        for (const b of tb) {
          if (boxes.length >= GI_MAX_BOXES) break;
          if (b && b.c && b.h) boxes.push(b);
        }
      }
    }
    const lights = [];


    const giLightCap = giBouncePlanCur && giBouncePlanCur.on ? 64 : GI_MAX_LIGHTS;
    for (const entry of localLights.values()) {
      if (lights.length >= giLightCap) break;
      if (!entry.light.visible) continue;


      const isLtcRect = (entry.kind === "RectLight" || entry.kind === "TubeLight") && entry.areaMode === "ltc";          
      const rec = {
        pos: [entry.light.position.x, entry.light.position.y, entry.light.position.z],
        color: [entry.light.color.r, entry.light.color.g, entry.light.color.b],
        intensity: isLtcRect && typeof entry.__pointEquivI === "number"
          ? entry.__pointEquivI
          : entry.light.intensity,
        range: isLtcRect && entry.__rectRange ? entry.__rectRange : entry.light.distance,
      };
      if (entry.kind !== "PointLight" && entry.target) {
        tmpV.copy(entry.target.position).sub(entry.light.position);
        if (tmpV.lengthSq() > 1e-8) {
          tmpV.normalize();
          rec.dir = [tmpV.x, tmpV.y, tmpV.z];
          rec.cosAngle = Math.cos(entry.light.angle);
        }
      }
      lights.push(rec);
    }


    let focus = null;
    const ct = getCameraTarget ? getCameraTarget() : null;
    if (ct && Number.isFinite(ct.x) && Number.isFinite(ct.y) && Number.isFinite(ct.z)) {
      focus = [ct.x, ct.y, ct.z];
    } else if (camera && camera.position && Number.isFinite(camera.position.x)) {
      focus = [camera.position.x, camera.position.y, camera.position.z];
    }
    lastGiFocus = focus;


    const transBoxesForGi = [];
    if (transActive) {
      try {
        const meshesMap = getMeshes();
        if (meshesMap) {
          for (const obj of meshesMap.values()) {
            if (transBoxesForGi.length >= 64) break;
            if (!obj || !obj.isInstancedMesh || !obj.userData || !obj.userData.__rswPool) continue;
            if (obj.visible === false) continue;
            const key = String(obj.userData.__rswPoolKey || "");
            if (key.slice(-3) !== "|tr") continue;
            const matName = key.split("|")[1] || "";
            if (!isGlassMaterialName(matName)) continue;
            const me = obj.instanceMatrix ? obj.instanceMatrix.array : null;
            if (!me) continue;
            const co = obj.instanceColor ? obj.instanceColor.array : null;
            const n2 = Math.min(obj.count || 0, Math.floor(me.length / 16));
            for (let i = 0; i < n2 && transBoxesForGi.length < 64; i++) {
              const o = i * 16;
              const lx = Math.hypot(me[o], me[o + 1], me[o + 2]);
              const ly = Math.hypot(me[o + 4], me[o + 5], me[o + 6]);
              const lz = Math.hypot(me[o + 8], me[o + 9], me[o + 10]);
              if (Math.max(lx, ly, lz) < 0.05) continue;
              const cr = co ? co[i * 3] : 1;
              const cg = co ? co[i * 3 + 1] : 1;
              const cb = co ? co[i * 3 + 2] : 1;


              transBoxesForGi.push({
                c: [me[o + 12], me[o + 13], me[o + 14]],
                h: [
                  (Math.abs(me[o]) + Math.abs(me[o + 4]) + Math.abs(me[o + 8])) / 2,
                  (Math.abs(me[o + 1]) + Math.abs(me[o + 5]) + Math.abs(me[o + 9])) / 2,
                  (Math.abs(me[o + 2]) + Math.abs(me[o + 6]) + Math.abs(me[o + 10])) / 2,
                ],
                tint: { r: cr, g: cg, b: cb },
              });
            }
          }
        }
      } catch (_e) {}
    }

    lastGiTransBoxes = transBoxesForGi.length;


    const giLights = giBouncePlanCur && giBouncePlanCur.on
      ? pickTopLights(lights, GI_MAX_LIGHTS)
      : lights;
    let emissivesForGi = null;
    if (giBouncePlanCur && giBouncePlanCur.on && giBouncePlanCur.emissiveGi) {
      const emList = [];


      const emCap = Math.max(8, ((giBouncePlanCur.maxEmissives | 0) || 24) * 2);
      const meshesMapEm = getMeshes();
      if (meshesMapEm) {
        for (const obj of meshesMapEm.values()) {
          if (emList.length >= emCap) break;
          if (!obj || !obj.isInstancedMesh || !obj.userData || !obj.userData.__rswPool) continue;
          if (obj.visible === false) continue;
          const key = String(obj.userData.__rswPoolKey || "");
          if (key.slice(-3) === "|tr") continue;
          const matName = (key.split("|")[1] || "");


          let emNeon = matName === "Neon";
          if (!emNeon) {
            const emMat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
            emNeon = !!(emMat && emMat.userData && emMat.userData.__rswMatName === "Neon");
          }
          if (!emNeon) continue;
          const me = obj.instanceMatrix ? obj.instanceMatrix.array : null;
          if (!me) continue;
          const co = obj.instanceColor ? obj.instanceColor.array : null;
          const cnt = Math.min(obj.count || 0, Math.floor(me.length / 16));
          for (let i = 0; i < cnt && emList.length < emCap; i++) {
            const o = i * 16;
            const lx = Math.hypot(me[o], me[o + 1], me[o + 2]);
            const ly = Math.hypot(me[o + 4], me[o + 5], me[o + 6]);
            const lz = Math.hypot(me[o + 8], me[o + 9], me[o + 10]);
            if (Math.max(lx, ly, lz) < 0.05) continue;
            const sx = lx > 1e-6 ? lx : 1;
            const sy = ly > 1e-6 ? ly : 1;
            const sz = lz > 1e-6 ? lz : 1;
            emList.push({
              c: [me[o + 12], me[o + 13], me[o + 14]],
              h: [lx / 2, ly / 2, lz / 2],
              axes: [
                [me[o] / sx, me[o + 1] / sx, me[o + 2] / sx],
                [me[o + 4] / sy, me[o + 5] / sy, me[o + 6] / sy],
                [me[o + 8] / sz, me[o + 9] / sz, me[o + 10] / sz],
              ],
              color: co ? [co[i * 3], co[i * 3 + 1], co[i * 3 + 2]] : [1, 1, 1],
              nits: GI_NEON_NITS,
            });
          }
        }
      }
      emissivesForGi = sanitizeEmissives(emList, giBouncePlanCur.maxEmissives);
    }
    lastGiEmissives = emissivesForGi ? emissivesForGi.length : 0;
    return { boxes, sun: giSun, lights: giLights, focus, transBoxes: transBoxesForGi.length ? transBoxesForGi : undefined, emissives: emissivesForGi || undefined };
  }


  function giFrame() {
    if (!gi.supported || !giActive) return;
    const t = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();


    if (!giDirty && lastGiFocus) {
      const ct2 = getCameraTarget ? getCameraTarget() : null;
      if (ct2 && Number.isFinite(ct2.x) && Number.isFinite(ct2.y) && Number.isFinite(ct2.z)) {
        const fdx = ct2.x - lastGiFocus[0];
        const fdy = ct2.y - lastGiFocus[1];
        const fdz = ct2.z - lastGiFocus[2];
        if (fdx * fdx + fdy * fdy + fdz * fdz > 24 * 24) giDirty = true;
      }
    }
    if (giDirty && !gi.isWorking() && t - lastGiKick > 80) {
      giDirty = false;
      lastGiKick = t;
      const job = collectGiJob();
      gi.requestRebuild(job);


      if (farDirty && farShadows.isEnabled()) {
        farDirty = false;
        lastFarBake = t;


        passTiming.begin("far");
        farShadows.bake(job && job.boxes ? job.boxes : []);
        passTiming.end();
      }

      rtSun.syncScene(job ? job.boxes : []);
    }


    let giBudgetThis = 5;
    if (giProf.weak) {
      if (t - giLedgerStampF15 > 250) {
        giLedgerStampF15 = t;
        const led = passTiming.getLedger();
        giHeadroomMsF15 = led && Number.isFinite(led.headroomMs) ? led.headroomMs : NaN;
      }
      giBudgetThis = giStepBudgetMs(giProf, giHeadroomMsF15);
    }


    passTiming.begin("gi");                                            
    const giStepped = gi.step(giBudgetThis);
    passTiming.end();
    if (giStepped) {
      requestRender();


      if (!giAmbSynced) {
        giAmbSynced = true;
        lightingDirty = true;
      }
    }
    if (gi.isWorking()) requestRender();
  }


  function failShaderWarmup(error) {
    if (warmupError) return;
    warmupError = error instanceof Error ? error : new Error(String(error));
    warmupSlicer.cancel();
    warmupCompiling = false;
    warmupPending = false;
    warmupStager.cancel();
    warmupToastHide();
    logger.error("[Lighting] Shader preparation stopped without forcing a synchronous render.", warmupError);
    requestRender();
  }

  function kickWarmupCompile(nowStamp) {
    if (!renderer || typeof renderer.compile !== "function") return false;
    try {
      const renderableObjects = [];
      scene.traverse((object) => {
        if (object?.material && (object.isMesh || object.isPoints || object.isLine || object.isSprite)) {
          renderableObjects.push(object);
        }
      });
      const compilationUnits = dedupeCompileUnits(renderableObjects);


      if (!warmupSlicer.arm(compilationUnits, nowStamp)) return false;
      warmupCompiling = true;
      warmupStamp = nowStamp;
      const firstSlice = warmupSlicer.tick(warmupSliceCompileOne, warmupNowMs);
      if (firstSlice.fails) {
        failShaderWarmup(new Error("A material failed during shader preparation."));
      }
      requestRender();
      return true;
    } catch (error) {
      failShaderWarmup(error);
      return true;
    }
  }

  function advanceShaderWarmup(nowStamp) {
    const warmupElapsed = nowStamp - warmupStamp;
    if (warmupElapsed > WARMUP_TIMEOUT_MS) {
      failShaderWarmup(new Error("Shader preparation exceeded its loading deadline."));
      return true;
    }
    if (warmupSlicer.isActive()) {
      const compilationResult = warmupSlicer.tick(warmupSliceCompileOne, warmupNowMs);
      if (compilationResult.fails) {
        failShaderWarmup(new Error("A material failed during shader preparation."));
        return true;
      }
      if (warmupToastId) {
        const progress = warmupSlicer.progress();
        const stage = warmupStager.debug();
        warmupToastUpdate(
          stageToastMessage({ tech: curTech, compiling: true, ready: progress.idx, totalPrograms: progress.total }),
          warmupProgress({ idx: stage.idx, total: stage.total, compiling: true, ready: progress.idx, totalPrograms: progress.total }),
        );
      }
      requestRender();
      return true;
    }
    if (!warmupProgramsReady()) {
      requestRender();
      return true;
    }
    warmupCompiling = false;
    shadowsDirty = true;
    logger.info("[Lighting] Shader preparation completed in " + Math.round(warmupElapsed) + " ms (" + curTech + ").");
    return false;
  }

  function warmupProgramsReady() {
    try {
      return shaderProgramWarmup.step();
    } catch (error) {
      failShaderWarmup(error);
      return false;
    }
  }

  function isWarmingUp() {
    return warmupPending || warmupCompiling || warmupError !== null || environmentPrefilter.isPending();
  }


  let temporalUniformsOff = false;


  const vsmWinArgs = { cx: 0, cy: 0, cz: 0, half: 0, mapSize: 0, dirX: 0, dirY: 0, dirZ: 0 };
  const vsmCsmArgs = { on: true, count: 1 };
  const temporalArgs = { on: true, frame: 0 };


  const temporalOffArgs = { on: false, frame: 0, staticTaps: 17, staticBlockers: 16 };
  const rtFrameArgs = { nowMs: 0, emaMs: 0 };


  const maskCascadesBuf = [];
  const maskCascadePool = [
    { light: null, scale: 1, bias: 0, texel: 1 / 2048 },
    { light: null, scale: 1, bias: 0, texel: 1 / 2048 },
    { light: null, scale: 1, bias: 0, texel: 1 / 2048 },
    { light: null, scale: 1, bias: 0, texel: 1 / 2048 },
  ];
  const sunMaskCfgArgs = { cascades: maskCascadesBuf, count: 1, blend: 0.08, tan: 0.02, frame: 0, capKBase: 1 };
  const sunMaskOnArgs = { on: true, tex: null, invW: 0, invH: 0 };
  const sunMaskOffArgs = { on: false };


  function collectTransmitters(out) {
    out.length = 0;
    const meshesMap = getMeshes();
    if (!meshesMap) return out;
    for (const obj of meshesMap.values()) {
      if (out.length >= TRANS_MAX_PROXIES) break;
      if (!obj || !obj.isInstancedMesh || !obj.userData || !obj.userData.__rswPool) continue;
      if (obj.visible === false) continue;
      const key = String(obj.userData.__rswPoolKey || "");
      if (key.slice(-3) !== "|tr") continue;
      const matName = key.split("|")[1] || "";
      if (!isGlassMaterialName(matName)) continue;
      const me = obj.instanceMatrix ? obj.instanceMatrix.array : null;
      if (!me) continue;
      const co = obj.instanceColor ? obj.instanceColor.array : null;
      const alphaAttr = obj.geometry && obj.geometry.getAttribute ? obj.geometry.getAttribute("rswAlpha") : null;
      const n = Math.min(obj.count || 0, Math.floor(me.length / 16));
      for (let i = 0; i < n && out.length < TRANS_MAX_PROXIES; i++) {
        const o = i * 16;
        const ax = Math.hypot(me[o], me[o + 1], me[o + 2]);
        const ay = Math.hypot(me[o + 4], me[o + 5], me[o + 6]);
        const az = Math.hypot(me[o + 8], me[o + 9], me[o + 10]);
        if (Math.max(ax, ay, az) < 0.05) continue;
        const a = alphaAttr ? alphaAttr.array[i] : 1;
        if (a <= 0.02) continue;
        const t = transparencyFromPoolAlpha(a, matName);
        if (!isTransmitterTransparency(t)) continue;
        const cr = co ? co[i * 3] : 1;
        const cg = co ? co[i * 3 + 1] : 1;
        const cb = co ? co[i * 3 + 2] : 1;
        out.push({
          m: Array.from(me.subarray(o, o + 16)),
          tint: transmitterTint({ r: cr, g: cg, b: cb }, t),
        });
      }
    }
    return out;
  }

  function beforeRender() {
    if (disposed || warmupError) return;

    passTiming.frameStart();


    const nowStamp = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    const dtMs = lastFrameStamp > 0 ? nowStamp - lastFrameStamp : 0;
    if (dtMs > 0) shadowCtl.sample(dtMs, nowStamp);
    lastFrameStamp = nowStamp;


    const inWarmupF21 = warmupStager.isActive() || warmupCompiling || fxWarmup > 0;
    let sampleF21 = dtMs > 0 && inWarmupF21;
    if (!inWarmupF21 && warmupTailFrames > 0 && dtMs > 0) {
      if (dtMs >= 2000) {
        warmupTailFrames = 0;
      } else {
        warmupTailFrames -= 1;
        sampleF21 = true;
      }
    }
    if (sampleF21) {
      const wdResF21 = tdrWatchdog.sample(dtMs);
      if (wdResF21.slowTripped && warmupStager.isActive()) {
        warmupStager.pause(2);
        if (!warmupSlowLogged) {
          warmupSlowLogged = true;
          logger.warn("[Iluminação] Warmup escalonado (F21): " + tdrWatchdog.limits.slowRun + " frames seguidos acima de " + tdrWatchdog.limits.slowMs + " ms — rampa pausada por 2 frames para o driver respirar.");
        }
      }
      if (wdResF21.panic && !warmupTdrReported) {
        warmupTdrReported = true;
        logger.warn(buildTdrReport({
          kind: "frame acima de " + tdrWatchdog.limits.panicMs + " ms durante o warmup (quase-TDR)",
          tech: curTech,
          gpuReason: (gpuBudget && gpuBudget.reason) || "",
          stage: warmupStager.debug(),
          watchdog: tdrWatchdog.debug(),
          action: "nenhuma feature nova neste frame; rampa segue 1 feature/frame",
        }));
      }
    }

    const tierResult = tierCtl.sample({
      emaMs: shadowCtl.getEma ? shadowCtl.getEma() : 0,
      dtMs,


      costMs: lastFrameCostMs,
      nowMs: nowStamp,
      hold: isWarmingUp() || fxWarmup > 0,
    });


    photoState = photoMode.frame({
      nowMs: nowStamp,
      camera,
      enabled: photoWanted,
      busy: isWarmingUp() || fxWarmup > 0 || lightingDirty || shadowsDirty,


      baseScale: ADAPTIVE_RES_OFF ? 1 : effectiveRenderScale(tierCfg, !!(gpuBudget && gpuBudget.weak)),
    });


    setPostfxPhotoMode(!!(photoState && photoState.fullTaps));
    if (tierResult.changed) {
      tierChanges++;
      tierCfg = tierConfig(tierCtl.getTier());
      logger.warn("[Sombras] Tier " + tierResult.from + " → " + tierCtl.getTier() + " (" + tierResult.direction + "): " + tierResult.reason);


      const maxTexUnits =
        renderer.capabilities && renderer.capabilities.maxTextures
          ? renderer.capabilities.maxTextures
          : 16;


      const rtIdleExtraTex = rtSun.isEnabled() && !tierCfg.rt ? 1 : 0;


      if (!tierFitsTexUnits(tierCfg, maxTexUnits - rtIdleExtraTex, { far: tierFarEnabled(tierCfg, gpuBudget.weak), farUnits: farShadows.texUnits, rt: tierCfg.rt, rodizio: rodizioWanted, mask: maskWanted })) {
        logger.warn("[Sombras] Tier " + tierCtl.getTier() + " não cabe nas " + maxTexUnits + " texture units desta GPU — luzes locais serão limitadas pelo localShadowCap.");
      }
      lightingDirty = true;
      shadowsDirty = true;
    }


    const govRes = featGov.sample({
      flag: featGovWanted,
      baseCfg: tierConfig(tierCtl.getTier()),
      emaMs: shadowCtl.getEma ? shadowCtl.getEma() : 0,
      dtMs,
      costMs: lastFrameCostMs,
      nowMs: nowStamp,
      hold: isWarmingUp() || fxWarmup > 0,


      sceneKey: featGovSceneKey,
    });
    if (govRes.changed) {
      logger.warn("[Sombras][F19] Governor mosaico (" + govRes.direction + "): " + govRes.reason);
    }
    if (govRes.config !== tierCfg) {
      tierCfg = govRes.config;
      lightingDirty = true;
      shadowsDirty = true;
    }


    if (warmupCompiling && advanceShaderWarmup(nowStamp)) return;


    if (environmentPrefilter.isPending() && !lightingDirty && !structureDirty) {
      environmentPrefilter.step();
      requestRender();
      return;
    }


    if (fxWarmup > 0) {
      fxWarmup -= 1;
      lightingDirty = true;
      requestRender();
    } else if (warmupStager.isActive()) {


      const stgResF21 = warmupStager.tick();
      if (stgResF21.advanced) {
        lightingDirty = true;
        const dbgTickF21 = warmupStager.debug();
        warmupToastUpdate(
          stageToastMessage({ tech: curTech, idx: stgResF21.idx, total: stgResF21.total, next: dbgTickF21.next }),
          warmupProgress({ idx: stgResF21.idx, total: stgResF21.total }),
        );
        if (stgResF21.done) {

          warmupTailFrames = 2;
          const totalMsF21 = warmupStageStamp > 0 ? nowStamp - warmupStageStamp : 0;
          warmupStageFinish(true, totalMsF21);
          logger.info("[Iluminação] Warmup escalonado (F21) concluído em " + Math.round(totalMsF21) + " ms (" + curTech + ", " + stgResF21.total + " features, 1 por frame; pior frame " + Math.round(tdrWatchdog.debug().worstMs) + " ms).");
        }
      }
      requestRender();
    }
    if (structureDirty) {
      structureDirty = false;
      hostSkipRev++;                                                             
      rescanLights();
      rescanCharacters();          
    }
    if (lightingDirty) {
      lightingDirty = false;
      applyLighting();
    }
    if (vizDirty) {
      vizDirty = false;
      rebuildViz();
    }

    ensureMaterials();

    if (environmentPrefilter.isPending()) {
      environmentPrefilter.step();
      requestRender();
      return;
    }


    if (warmupPending) {
      warmupPending = false;
      if (kickWarmupCompile(nowStamp)) return;
    }


    dome.position.copy(camera.position);


    if (dome.material && dome.material.uniforms && dome.material.uniforms.uHFogCamY) {
      dome.material.uniforms.uHFogCamY.value = camera.position.y;
    }

    rprobes.frame({ renderer, scene, camera });


    envcap.frame({ renderer, camera });
    if (envcap.isReady() && !hdriCtl.tex) {
      const sigEc = "envcap:" + envcap.capturedSig();
      if (sigEc !== envSig) {
        if (envRT) { envRT.dispose(); envRT = null; }
        scene.environment = envcap.texture();
        envSig = sigEc;
      }
    }


    syncReflectanceEnvSource();


    if (envcap.pending() && !envCapPumpTimer && typeof setTimeout === "function") {
      envCapPumpTimer = setTimeout(() => {
        envCapPumpTimer = 0;
        if (!disposed) requestRender();
      }, 33);
    }


    if (dome.material && dome.material.uniforms && dome.material.uniforms.uSkyTime) {
      const duCl = dome.material.uniforms;
      const nowCl = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
      duCl.uSkyTime.value = (nowCl * 0.001) % 50000.0;
      const animCl = !cloudAnimWeak &&
        (duCl.uCloudsOn.value > 0.5 || (duCl.uNightSky.value > 0.5 && duCl.uStars.value > 0.02));
      if (animCl && !cloudAnimTimer && typeof setTimeout === "function") {
        cloudAnimTimer = setTimeout(() => {
          cloudAnimTimer = 0;
          if (!disposed) requestRender();
        }, Math.max(4, CLOUD_ANIM_MIN_MS - (nowCl - lastCloudAnimMs)));
      }
      lastCloudAnimMs = nowCl;
    }


    const domeFitScale = Math.min(1, (camera.far * 0.9) / 30000);
    if (dome.scale.x !== domeFitScale) dome.scale.setScalar(domeFitScale);
    const t = getCameraTarget ? getCameraTarget() : null;
    let focusMoved = false;
    if (t) {
      tmpV2.set(t.x || 0, t.y || 0, t.z || 0);
      if (tmpV2.distanceToSquared(lastSunFocus) > 0.0625) {
        lastSunFocus.copy(tmpV2);
        focusMoved = true;
      }
    }


    if (shadowsDirty && (boundsComputedAt === 0 || nowStamp - boundsComputedAt >= 250)) {
      cachedShadowBounds = computeSceneShadowBounds();
      boundsComputedAt = nowStamp;


      if (featGovWanted) {
        const _b = cachedShadowBounds;
        const _aabb = _b ? Math.round(Math.sqrt(
          Math.pow(_b.max[0] - _b.min[0], 2) +
          Math.pow(_b.max[1] - _b.min[1], 2) +
          Math.pow(_b.max[2] - _b.min[2], 2)
        )) : 0;
        const _nl = localLights.size;
        featGovSceneKey = sceneKeyFor({ lights: _nl, shadowLights: _nl, parts: 0, aabbSize: _aabb });
      }
    }


    let viewFitQuantumMoved = false;
    if (sunViewFitOn()) {
      const viewFitQuantum = sunViewFitDistanceQuantum(camera.position.distanceTo(lastSunFocus));
      if (viewFitQuantum !== lastSunViewFitQuantum) {
        lastSunViewFitQuantum = viewFitQuantum;
        viewFitQuantumMoved = true;
      }
    }
    if (shadowsDirty || focusMoved || csmActive || viewFitQuantumMoved) updateSunWindow();
    sun.position.copy(sunWinCenter).addScaledVector(lightDir, 500);
    sunTarget.position.copy(sunWinCenter);


    if (vsmWanted) {
      if (!csmActive) {


        vsmWinArgs.cx = sunWinCenter.x; vsmWinArgs.cy = sunWinCenter.y; vsmWinArgs.cz = sunWinCenter.z;
        vsmWinArgs.half = sunWinHalf; vsmWinArgs.mapSize = sun.shadow.mapSize.x;
        vsmWinArgs.dirX = lightDir.x; vsmWinArgs.dirY = lightDir.y; vsmWinArgs.dirZ = lightDir.z;
        vsm.syncWindow(vsmWinArgs);
      } else {


        vsmCsmArgs.count = csmCount;
        vsm.syncCsm(vsmCsmArgs);
      }
    }
    updateLocalLightsFrame();


    if (shadowAtlas && shadowAtlas.enabled) {
      const mlAtlasState = getMegaLightsState();
      const megaLightsDrivingAtlas = !!(mlAtlasState.atlasWanted
        && mlAtlasState.lights && mlAtlasState.lights.length > 0);


      if (megaLightsDrivingAtlas) {
        msmAtlasRedrawPolicy.planFrame({
          lights: mlAtlasState.lights,
          spotThreeLights: mlAtlasState.spotThreeLights,
          cubeFaces: mlAtlasState.cubeFaces,
          casterRevision: localShadowCasterRevision,
          invalidationPulse: llLocalShadowInvalidation.lastPulse(),
          tier: localLightTier(),
          technology: curTech,


          atlasGeneration: shadowAtlas.getAtlasTex(),
        });
        mlAtlasState.redrawPolicy = msmAtlasRedrawPolicy.policy();
      }
      const physicalAtlasState = megaLightsDrivingAtlas ? mlAtlasState : llAtlasFeed.frameState();
      physicalAtlasState.msmSchedule = resolveMsmAtlasScheduleRequest(mlAtlasState, localShadowCasterRevision,
        typeof window === 'undefined' ? {} : window.__rswMsm || {});
      shadowAtlas.frame(physicalAtlasState, renderer);
      if (shadowAtlas.getStats().msmSchedule?.pendingAfter > 0) requestRender();
      const atlasPlan = megaLightsDrivingAtlas ? null : llAtlasFeed.lastPlan();
      const msmSpotAtlasEnabled = llShadowAtlas.syncAtlasFrame({
        tier: localLightTier(),
        technology: curTech,
        camera,
        atlasTexture: shadowAtlas.getAtlasTex(),
        metaTexture: shadowAtlas.getMetaTex(),
        atlasSize: shadowAtlas.getAtlasSize(),
        pagedSpots: atlasPlan ? atlasPlan.pagedSpots : 0,
        legacySpotShadowCount: atlasPlan ? atlasPlan.legacyShadowMapCount : 0,
      });


      const pointCubePlan = megaLightsDrivingAtlas ? null : llPointFeed.lastPlan();
      const msmPointAtlasEnabled = llPointShadow.syncPointCubeFrame({
        tier: localLightTier(),
        technology: curTech,
        atlasReady: !!(shadowAtlas.getAtlasTex() && shadowAtlas.getMetaTex() && shadowAtlas.getAtlasSize() > 0),
        atlasLightCount: pointCubePlan ? pointCubePlan.atlasLightCount : 0,
        pageCount: pointCubePlan ? pointCubePlan.pageCount : 0,
        legacyShadowCount: pointCubePlan ? pointCubePlan.legacyShadowCount : 0,
      });


      const msmAtlasMeta = shadowAtlas.getMetaTex();
      bindMsmAtlasLightRows(msmLocalLightFeed.allLights, {
        metaData: msmAtlasMeta?.image?.data,
        spotRows: llAtlasFeed.frameState().lights, cubePages: llPointFeed.pages(),
      });
      collectMsmAtlasCoveredKeys({
        metaData: msmAtlasMeta && msmAtlasMeta.image ? msmAtlasMeta.image.data : null,
        spotRows: llAtlasFeed.frameState().lights,
        cubePages: llPointFeed.pages(),
        spotEnabled: msmSpotAtlasEnabled,
        pointEnabled: msmPointAtlasEnabled,
      }, msmAtlasCoveredKeys);
      msmLocalLightFeed.excludeMappedLightKeys(msmAtlasCoveredKeys);
    }
    updateIesCookieFrame();                                                                               


    if (lsrActive && !csmActive) {
      lsrSunManaged = true;
      if (sun.shadow.autoUpdate) {
        sun.shadow.autoUpdate = false;
        sun.shadow.needsUpdate = true;
      }
    } else if (lsrSunManaged) {
      lsrSunManaged = false;
      if (!csmActive && !vsmWanted) {
        sun.shadow.autoUpdate = true;
        sun.shadow.needsUpdate = true;
      }
    }
    updateCapsulesFrame(nowStamp);          

    if (maskWanted) {
      maskFrame = advanceTemporalFrame(maskFrame);
      sunMask.applyReset(temporalResets);
      renderer.getDrawingBufferSize(maskDrawSize);


      const cascades = maskCascadesBuf;
      cascades.length = 0;
      if (csmActive) {
        const sv = pcss.uniforms.uRswCsmScale.value;
        maskScaleArr[0] = sv.x; maskScaleArr[1] = sv.y; maskScaleArr[2] = sv.z; maskScaleArr[3] = sv.w;
        const c0 = maskCascadePool[0];
        c0.light = sun; c0.scale = sv.x; c0.bias = sun.shadow.bias; c0.texel = 1 / sun.shadow.mapSize.x;
        cascades.push(c0);
        for (let ci = 0; ci < csmGhosts.length && cascades.length < 4; ci++) {
          const g = csmGhosts[ci];
          if (!g.castShadow) continue;


          const cn = maskCascadePool[cascades.length];
          cn.light = g; cn.scale = maskScaleArr[ci + 1] || sv.x; cn.bias = g.shadow.bias; cn.texel = 1 / g.shadow.mapSize.x;
          cascades.push(cn);
        }
      } else {
        const c0 = maskCascadePool[0];
        c0.light = sun; c0.scale = pcss.uniforms.uRswPcssScale.value; c0.bias = sun.shadow.bias; c0.texel = 1 / sun.shadow.mapSize.x;
        cascades.push(c0);
      }
      sunMaskCfgArgs.count = cascades.length;
      sunMaskCfgArgs.blend = pcss.uniforms.uRswCsmBlend.value;
      sunMaskCfgArgs.tan = pcss.uniforms.uRswPcssTan.value;
      sunMaskCfgArgs.frame = maskFrame;
      sunMaskCfgArgs.capKBase = pcss.uniforms.uRswPcssScale.value;


      const maskPhotoFull = !!(photoState && photoState.enabled && photoState.fullTaps);


      if (!(warmupCompiling || fxWarmup > 0) && lastFrameCostMs > 0) {
        maskCostEma = maskCostEma > 0 ? maskCostEma * 0.9 + Math.min(lastFrameCostMs, 100) * 0.1 : Math.min(lastFrameCostMs, 100);
      }
      const maskFull = maskFullResDecision({
        flag: typeof window !== "undefined" ? window.__rswSunMaskFullRes : undefined,
        photoFull: maskPhotoFull,
        weak: gpuBudget.weak === true,
        wasFull: maskFullWas,
        nowMs: nowStamp,
        lastFlipMs: maskFullFlipMs,
        costEmaMs: maskCostEma,
      });
      if (maskFull !== maskFullWas) {
        maskFullWas = maskFull;
        maskFullFlipMs = nowStamp;
        if (maskFull && !maskFullLogged) {
          maskFullLogged = true;
          logger.warn("[Sombras][F32] Máscara do sol em resolução CHEIA (1:1, taps 8/6) também em movimento — freio por custo real (EMA " + maskCostEma.toFixed(1) + " ms) segue ativo.");
        }
      }
      sunMaskCfgArgs.taps = maskFull ? 8 : undefined;
      sunMaskCfgArgs.blockers = maskFull ? 6 : undefined;
      sunMask.configure(sunMaskCfgArgs);
      const ok = sunMask.render(renderer, maskDrawSize.x, maskDrawSize.y, maskFull ? 1 : undefined);
      const maskTex = sunMask.texture();
      sunMaskOnArgs.on = ok && !!maskTex;
      sunMaskOnArgs.tex = maskTex;
      sunMaskOnArgs.invW = ok ? 1 / maskDrawSize.x : 0;
      sunMaskOnArgs.invH = ok ? 1 / maskDrawSize.y : 0;
      pcss.setSunMask(sunMaskOnArgs);


      if (maskPhotoFull && sunMaskOnArgs.on && sunMask.debugState().frames < 12 && typeof requestRender === "function") requestRender();
    } else {
      pcss.setSunMask(sunMaskOffArgs);
      sunMask.release();
    }


    if (transActive) {
      transDirToSun.copy(sun.position).sub(sunTarget.position).normalize();
      if (transDirtyOnly) {


        if (shadowsDirty || transListSig === "") {
          collectTransmitters(transList);
          transListSig = transListSignature(transList);
        }
        transWin.center.x = sunWinCenter.x;
        transWin.center.y = sunWinCenter.y;
        transWin.center.z = sunWinCenter.z;
        transWin.half = Math.max(sunWinHalf * (csmActive ? 2.2 : 1), 40);
        transWin.dirToSun.x = transDirToSun.x;
        transWin.dirToSun.y = transDirToSun.y;
        transWin.dirToSun.z = transDirToSun.z;


        if (transList.length === 0 && transRenderedEmpty) {

        } else if (transGate.frame(transListSig, transWin).render) {
          trans.setTransmitters(transList);
          passTiming.begin("vidro");                        
          trans.render(renderer, transWin);
          passTiming.end();
          transRenderedEmpty = transList.length === 0;
        }
      } else {


        const tSig =
          Math.round(sunWinCenter.x) + "," + Math.round(sunWinCenter.y) + "," + Math.round(sunWinCenter.z) +
          "|" + Math.round(sunWinHalf) +
          "|" + transDirToSun.x.toFixed(2) + "," + transDirToSun.y.toFixed(2) + "," + transDirToSun.z.toFixed(2);
        if (shadowsDirty || tSig !== transSig) {
          transSig = tSig;
          collectTransmitters(transList);
          trans.setTransmitters(transList);
          transWin.center.x = sunWinCenter.x;
          transWin.center.y = sunWinCenter.y;
          transWin.center.z = sunWinCenter.z;
          transWin.half = Math.max(sunWinHalf * (csmActive ? 2.2 : 1), 40);
          transWin.dirToSun.x = transDirToSun.x;
          transWin.dirToSun.y = transDirToSun.y;
          transWin.dirToSun.z = transDirToSun.z;
          passTiming.begin("vidro");                        
          trans.render(renderer, transWin);
          passTiming.end();
        }
      }
      trans.setDitherFrame(temporalOn ? temporalFrame : 0);
    }


    if (pendingDynGi && !giDirty && nowStamp - lastDynGiKick >= 500) {
      pendingDynGi = false;
      lastDynGiKick = nowStamp;
      giDirty = true;
    }


    if (farDirty && (farShadows.isEnabled() || rtSun.isEnabled()) && (!giActive || !giDirty) && nowStamp - lastFarBake > 1000) {
      lastFarBake = nowStamp;
      farDirty = false;
      const fbJob = collectGiJob();
      if (farShadows.isEnabled()) {
        passTiming.begin("far");                        
        farShadows.bake(fbJob.boxes);
        passTiming.end();
      }


      rtSun.syncScene(fbJob.boxes);
    }


    giFrame();

    rtFrameArgs.nowMs = nowStamp;
    rtFrameArgs.emaMs = shadowCtl.getEma ? shadowCtl.getEma() : 0;


    rtSun.setShadowTier(tierCtl.getTier());

    passTiming.beginCpu("rt-cpu");
    rtSun.frame(rtFrameArgs);
    passTiming.endCpu();
    updateVizFrame();


    if (shadowsDirty && renderer.shadowMap.enabled) {
      if (csmActive) {
        sun.shadow.needsUpdate = true;
        for (const g of csmGhosts) {
          if (g.castShadow) g.shadow.needsUpdate = true;
        }
      } else if (vsmWanted || lsrSunManaged) {


        sun.shadow.autoUpdate = false;
        sun.shadow.needsUpdate = true;
      }


      if (lsrActive) {
        lsrCtl.markAllStale();


        const lsrStaleNow = lsrCtl.getStats().stale;
        if (lsrStaleNow > 0) {
          lsrPending = lsrStaleNow;
          requestRender();
        }
      }
      renderer.shadowMap.needsUpdate = true;


      passTiming.setFrameFlag("shadowRaster");
      shadowsDirty = false;


      vsm.noteFullPass();
    } else if (renderer.shadowMap.enabled && vsmWanted) {


      passTiming.begin("sombra-paginas");                        
      vsm.renderPending();
      passTiming.end();
    }


    if (clipmap.isActive()) clipmap.frame(camera, sun);


    clipmapRender.frame(scene, camera, sun, clipmap, tierCtl ? tierCtl.getTier() : "", pcss);


    if (lsrActive && lsrPulse && renderer.shadowMap.enabled) {
      renderer.shadowMap.needsUpdate = true;
    }


    if (localShadowRedrawPulse) {
      localShadowRedrawPulse = false;
      if (renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = true;
    }


    if (temporalOn) {
      temporalFrame = advanceTemporalFrame(temporalFrame);

      temporalArgs.frame = temporalFrame;

      const cp = camera.position;
      const cq = camera.quaternion;
      const camMoved = (Math.abs(cp.x - camPrev.x) > 0.02 || Math.abs(cp.y - camPrev.y) > 0.02 ||
        Math.abs(cp.z - camPrev.z) > 0.02 || Math.abs(cq.x - camPrev.qx) > 0.001 ||
        Math.abs(cq.y - camPrev.qy) > 0.001 || Math.abs(cq.z - camPrev.qz) > 0.001 ||
        Math.abs(cq.w - camPrev.qw) > 0.001);
      camPrev.x = cp.x; camPrev.y = cp.y; camPrev.z = cp.z;
      camPrev.qx = cq.x; camPrev.qy = cq.y; camPrev.qz = cq.z; camPrev.qw = cq.w;
      camMoveBoost = motionBoostStep(camMoveBoost, camMoved);


      const photoFull = !!(photoState && photoState.enabled && photoState.fullTaps);
      temporalArgs.boost = photoFull ? 1 : camMoveBoost;
      temporalArgs.boostTaps = photoFull ? 8 : tierCfg.motionTaps;
      pcss.setTemporal(temporalArgs);
      temporalUniformsOff = false;
    } else {


      const photoTaps = photoState && photoState.enabled && photoState.fullTaps;
      temporalOffArgs.staticTaps = photoTaps ? 17 : tierCfg.pcssTaps;
      temporalOffArgs.staticBlockers = photoTaps ? 16 : tierCfg.pcssBlockers;
      pcss.setTemporal(temporalOffArgs);
      temporalUniformsOff = true;
    }


    const smrtSteps = smrtStepsForTier(tierCtl.getTier());
    smrtArgs.on = smrtSteps > 0;
    smrtArgs.steps = smrtSteps;
    pcss.setSmrt(smrtArgs);
    smrtQa.on = smrtSteps > 0 && pcss.smrtSupported === true;
    smrtQa.steps = smrtSteps;


    rtSun.setRetraceTier(tierCtl.getTier());


    const mlFrameRequest = megaLightsFrameRequestBuf;
    mlFrameRequest.camera = camera;
    mlFrameRequest.technology = curLightingTechnology;
    mlFrameRequest.tierName = localLightTier();
    mlFrameRequest.megaLightsEnabled = mglWanted && !patchesDisabled;


    mlFrameRequest.lights = mlLights;


    mlFrameRequest.frameIndex = temporalFrame;
    mlFrameRequest.pixelWidth = renderer.domElement.width;
    mlFrameRequest.pixelHeight = renderer.domElement.height;
    mlFrameRequest.nowMilliseconds = nowStamp;
    mlFrameRequest.deltaMilliseconds = dtMs;
    substratePipeline.runFrame(mlFrameRequest);
    substrateSmPipeline.runFrame(mlFrameRequest);
    megaLightsDebug.beforeFrame(mlFrameRequest);
    megaLightsPipeline.runFrame(mlFrameRequest);
  }


  function getSunScreenInfo() {
    tmpV.copy(sunDir).multiplyScalar(1000).add(camera.position);
    tmpV.project(camera);
    camera.getWorldDirection(tmpV2);


    const visibility = computeSunScreenVisibility({
      ndcX: tmpV.x,
      ndcY: tmpV.y,
      ndcZ: tmpV.z,
      cameraForwardDotSunDirection: tmpV2.dot(sunDir),
      sunDirectionY: sunDir.y,
    });
    return {
      x: (tmpV.x + 1) / 2,
      y: (tmpV.y + 1) / 2,
      visible: isSunVisible(visibility),
      visibility,
      strength: grade.sunIntensity,
    };
  }


  function getGradeState() {
    return grade;
  }


  let postfxDietCache = null;
  let postfxPhotoMode = false;
  function getPostfxDietState() {
    const weak = !!(gpuBudget && gpuBudget.weak);
    if (!postfxDietCache || postfxDietCache.weakGpu !== weak || postfxDietCache.photo !== postfxPhotoMode) {
      postfxDietCache = postfxDietPlan({ weakGpu: weak, photoMode: postfxPhotoMode });
    }
    return postfxDietCache;
  }
  function setPostfxPhotoMode(v) {
    postfxPhotoMode = v === true;
  }


  let aeFlagRaw = null;
  const aePlanBuf = { active: false, on: false, reason: "auto-off-classic", cadence: 1, tier: null };
  function getAutoExposureState() {
    const weak = !!(gpuBudget && gpuBudget.weak);
    const tier = tierCtl.getTier();
    resolveAutoExposure(aeFlagRaw, { weak, tier }, aePlanBuf);
    aePlanBuf.active = aePlanBuf.on === true;
    aePlanBuf.cadence = aeMeasureCadence(weak);
    aePlanBuf.tier = tier;
    return aePlanBuf;
  }


  let caFlagRaw = 0;
  let grainFlagRaw = 0;
  let mbFlagRaw = null;                                                
  let taaFlagRaw = null;                                                 

  let mvFlagRaw = null;                                                          
  let upscaleFlagRaw = null;                                                          
  let playModeOn = false;                                                
  const filmFxBuf = {
    ca: 0, grain: 0, mbFlag: null, taaFlag: null,
    weak: false, tier: null, play: false, photo: false, renderStyle: null,
    mbOn: false, mbReason: "", taaOn: false, taaReason: "",
    shutter: 0, maxUv: 0, taps: 0, anyFinal: false, active: false,
  };
  function getFilmFxState() {
    filmFxBuf.ca = caFlagRaw;
    filmFxBuf.grain = grainFlagRaw;
    filmFxBuf.mbFlag = mbFlagRaw;
    filmFxBuf.taaFlag = taaFlagRaw;
    filmFxBuf.weak = !!(gpuBudget && gpuBudget.weak);
    filmFxBuf.tier = tierCtl.getTier();
    filmFxBuf.play = playModeOn;
    filmFxBuf.photo = postfxPhotoMode;
    filmFxBuf.renderStyle = renderStyleProp;

    return filmFxPlan(filmFxBuf, filmFxBuf);
  }
  function setPlayModeActive(v) {
    playModeOn = v === true;
  }


  const tsrBuf = {
    mvFlag: null, upscaleFlag: null,
    weak: false, mbOn: false, taaOn: false,
    mvOn: false, mvReason: "",
    upscaleOn: false, upscaleReason: "",
    active: false,
  };
  function getTsrState() {

    const fx = getFilmFxState();
    tsrBuf.mvFlag = mvFlagRaw;
    tsrBuf.upscaleFlag = upscaleFlagRaw;
    tsrBuf.weak = !!(gpuBudget && gpuBudget.weak);
    tsrBuf.mbOn = !!(fx && fx.mbOn);
    tsrBuf.taaOn = !!(fx && fx.taaOn);

    return tsrPlan(tsrBuf, tsrBuf);
  }


  let renderStyleProp = null;                                           
  let hdrPlanCache = null;
  let hdrStyleK = "x";
  let hdrDietK = null;
  function getHdrPipelineState() {
    const dietByte = shaderDiet.active();
    if (!hdrPlanCache || hdrStyleK !== renderStyleProp || hdrDietK !== dietByte) {
      hdrStyleK = renderStyleProp;
      hdrDietK = dietByte;
      hdrPlanCache = hdrPipelinePlan({ renderStyle: renderStyleProp, dietByte });
    }
    return hdrPlanCache;
  }


  let leFlag = null;                                                  
  let leStrengthRaw;                                           
  let leCache = null;
  let leFlagK = "x";
  let leWeakK = null;
  let leStrK = "x";
  let leStyleK = "x";
  function getLocalExposureState() {
    const weak = !!(gpuBudget && gpuBudget.weak);
    if (!leCache || leFlagK !== leFlag || leWeakK !== weak || leStrK !== leStrengthRaw || leStyleK !== renderStyleProp) {
      leFlagK = leFlag;
      leWeakK = weak;
      leStrK = leStrengthRaw;
      leStyleK = renderStyleProp;
      leCache = localExposurePlan({ flag: leFlag, weakGpu: weak, strength: leStrengthRaw, renderStyle: renderStyleProp });
    }
    return leCache;
  }


  let lfFlag = null;                                                  
  let lfIntensityRaw;                                           
  let lfCache = null;
  let lfFlagK = "x";
  let lfWeakK = null;
  let lfIntK = "x";
  let lfStyleK = "x";
  let lfSmLiteK = null;                                             
  let lfPhotoK = null;                                                  
  function getLensFlareState() {
    const weak = !!(gpuBudget && gpuBudget.weak);
    const smLiteOnNow = !!(smLitePlanNow && smLitePlanNow.on);
    const photoFull = postfxPhotoMode === true;
    if (!lfCache || lfFlagK !== lfFlag || lfWeakK !== weak || lfIntK !== lfIntensityRaw || lfStyleK !== renderStyleProp || lfSmLiteK !== smLiteOnNow || lfPhotoK !== photoFull) {
      lfFlagK = lfFlag;
      lfWeakK = weak;
      lfIntK = lfIntensityRaw;
      lfStyleK = renderStyleProp;
      lfSmLiteK = smLiteOnNow;
      lfPhotoK = photoFull;
      lfCache = lensFlarePlan({ flag: lfFlag, weakGpu: weak, intensity: lfIntensityRaw, renderStyle: renderStyleProp, smLite: smLiteOnNow, photoFull });
    }
    return lfCache;
  }


  const smLiteFxBuf = {
    on: false,
    vignette: 0,
    gradeTint: null,
    gradePunch: 1,
    flareLite: false,
    specIntensity: 1,
  };
  function getSmLiteFxState() {
    const p = smLitePlanNow;
    const on = !!(p && p.on);
    smLiteFxBuf.on = on;
    smLiteFxBuf.vignette = on && Number.isFinite(p.vignette) ? p.vignette : 0;
    smLiteFxBuf.gradeTint = on && Array.isArray(p.gradeTint) ? p.gradeTint : null;
    smLiteFxBuf.gradePunch = on && Number.isFinite(p.gradePunch) ? p.gradePunch : 1;


    smLiteFxBuf.flareLite = getLensFlareState().lite === true;
    smLiteFxBuf.specIntensity = on && Number.isFinite(p.specIntensity) ? p.specIntensity : 1;
    return smLiteFxBuf;
  }


  let upsharpFlag = null;                                                  
  let upsharpStrength;                                           
  let upsCache = null;
  let upsFlagK = "x";
  let upsWeakK = null;
  let upsScaleK = -1;
  let upsStrK = "x";
  function getUpscaleSharpenState() {
    const weak = !!(gpuBudget && gpuBudget.weak);


    const scale = ADAPTIVE_RES_OFF ? 1 : photoMode.scaleFor(
      1,
      effectiveRenderScale(tierCfg, weak)
    );
    if (!upsCache || upsFlagK !== upsharpFlag || upsWeakK !== weak || upsScaleK !== scale || upsStrK !== upsharpStrength) {
      upsFlagK = upsharpFlag;
      upsWeakK = weak;
      upsScaleK = scale;
      upsStrK = upsharpStrength;
      upsCache = upscaleSharpenPlan({ flag: upsharpFlag, weakGpu: weak, scale, strength: upsharpStrength });
    }
    return upsCache;
  }


  const shadowTemporalStateBuf = { active: false, resetCount: 0, frame: 0, halfDepth: false, byteHistory: false, mvOn: false };
  function getShadowTemporalState() {


    const st = shadowTemporalStateBuf;
    st.active = temporalOn;
    st.resetCount = temporalResets;
    st.frame = temporalFrame;
    st.halfDepth = !!(gpuBudget && gpuBudget.weak);


    st.byteHistory = shaderDiet.active();



    st.mvOn = !(gpuBudget && gpuBudget.weak);
    return st;
  }


  const megaLightsStateBuf = { active: false, lights: null, baseLum: 1, frame: 0, clusterWanted: false, specStrength: 0, atlasWanted: false, spotThreeLights: null, renderSceneDepth: null, redrawPolicy: null, atlas: null };
  function getMegaLightsState() {
    const st = megaLightsStateBuf;
    st.active = mlWanted && mlLights.length > 0;
    st.lights = mlLights;
    st.baseLum = mlBaseLum;
    st.frame = temporalFrame;
    const lighting = lightingInst();
    st.msmAllowed = !!lighting && shadowsEnabled && !patchesDisabled;
    if (!st.msmAllowed) msmLocalLightFeed.reset();
    st.technology = curTech;
    st.weakGpu = !!(gpuBudget && gpuBudget.weak);
    st.msmTier = tierCtl.getTier();
    st.megaLightsWanted = !!(mlWanted || mglWanted);
    st.MegaLightsSM = lighting ? lighting.getProperty("MegaLightsSM") : false;
    st.MegaLightsSMMode = lighting ? lighting.getProperty("MegaLightsSMMode") : 'A';
    st.MegaLightsSMStrength = lighting ? lighting.getProperty("MegaLightsSMStrength") : null;
    st.MegaLightsSMView = lighting ? lighting.getProperty("MegaLightsSMView") : "Composite";
    st.msmLights = msmLocalLightFeed.lights;
    st.msmAllLights = msmLocalLightFeed.allLights;
    st.msmPartition = msmNativePartition.describe();
    st.msmAtlasSchedule = shadowAtlas?.getStats().msmSchedule || null;
    st.msmCandidateCount = msmLocalLightFeed.state.candidateCount;
    st.msmResidentCount = msmLocalLightFeed.state.residentCount;
    st.msmAtlasResidentCount = msmLocalLightFeed.state.atlasResidentCount;
    st.msmBaseLum = (hemi.intensity * 0.5 + amb.intensity + sun.intensity * 0.5) / LEGACY_LIGHT_SCALE;

    st.clusterWanted = clWanted;
    st.specStrength = clSettingsBuf.specStrength;

    st.atlasWanted = atlasWanted;


    st.spotThreeLights = mlSpotBuf;


    st.renderSceneDepth = atlasDepthHook;


    const sa = mlAtlasStateBuf;
    sa.on = !!(atlasWanted && atlasDepthHook && shadowAtlas && shadowAtlas.enabled);
    sa.tex = sa.on ? shadowAtlas.getAtlasTex() : null;
    sa.metaTex = sa.on ? shadowAtlas.getMetaTex() : null;
    sa.size = sa.on ? shadowAtlas.getAtlasSize() : 0;
    sa.topCount = sa.on ? (shadowAtlas.getStats().topCount || 0) : 0;
    st.atlas = sa;
    return st;
  }


  let volFogWanted = false;

  const vfBiasBuf = [VF_BIAS_DEFAULT, VF_BIAS_DEFAULT, VF_BIAS_DEFAULT, VF_BIAS_DEFAULT];
  const volFogQa = { on: false, flag: null, auto: true, biases: vfBiasBuf };
  const volFogCascadesBuf = [];
  const volFogCascadePool = [];
  const volFogCandsBuf = [];
  const volFogCandPool = [];
  const volFogLightsBuf = [];
  const volFogCamScratch = { x: 0, y: 0, z: 0 };
  const volFogStateBuf = {
    active: false,
    camX: 0, camY: 0, camZ: 0,
    sunX: 0, sunY: 1, sunZ: 0,
    sunR: 0, sunG: 0, sunB: 0,
    ambR: 0, ambG: 0, ambB: 0,
    density: 0,
    aniso: 0.62,
    heightFalloff: 0.02,
    heightRef: 0,
    steps: 20,
    maxDist: 900,
    shadowsOn: false,
    cascades: volFogCascadesBuf,
    lights: volFogLightsBuf,


    localVolumetric: null,
    tier: null,
    technology: null,
    frame: 0,
    resetCount: 0,
  };
  function volFogPushCascade(sl) {



    if (!sl || !sl.castShadow || !sl.shadow || !sl.shadow.map || !sl.shadow.map.texture) return;
    if (volFogCascadesBuf.length >= 4) return;
    const i = volFogCascadesBuf.length;
    const slot = volFogCascadePool[i] || (volFogCascadePool[i] = { map: null, matrix: null, bias: 0.002 });
    slot.map = sl.shadow.map.texture;
    slot.matrix = sl.shadow.matrix;
    slot.bias = vfBiasBuf[i];                                                 
    volFogCascadesBuf.push(slot);
  }
  function getVolumetricFogState() {
    const st = volFogStateBuf;
    volFogCascadesBuf.length = 0;
    volFogLightsBuf.length = 0;
    st.active = !!volFogWanted;
    if (st.active) sanitizeVfCascadeBiases(typeof window !== "undefined" ? window.__rswVfBias : null, vfBiasBuf);          
    if (!st.active) return st;
    const cm = camera.matrixWorld.elements;
    st.camX = cm[12]; st.camY = cm[13]; st.camZ = cm[14];

    st.sunX = lightDir.x; st.sunY = lightDir.y; st.sunZ = lightDir.z;


    const sunAmp = Math.max(lightDir.y, 0) * (sun.intensity / LEGACY_LIGHT_SCALE);
    st.sunR = sun.color.r * sunAmp;
    st.sunG = sun.color.g * sunAmp;
    st.sunB = sun.color.b * sunAmp;


    const ambAmp = Math.max((hemi.intensity + amb.intensity) / LEGACY_LIGHT_SCALE, 0);
    st.ambR = (hemi.color.r + hemi.groundColor.r) * 0.5 * ambAmp;
    st.ambG = (hemi.color.g + hemi.groundColor.g) * 0.5 * ambAmp;
    st.ambB = (hemi.color.b + hemi.groundColor.b) * 0.5 * ambAmp;
    const du = domeMat && domeMat.uniforms ? domeMat.uniforms : null;
    st.density = densityFromAtmosphereJs(
      du && du.uAtmoDensity ? du.uAtmoDensity.value : undefined,
      du && du.uAtmoHaze ? du.uAtmoHaze.value : undefined
    );
    st.frame = temporalFrame;
    st.resetCount = temporalResets;


    volFogPushCascade(sun);
    if (csmActive) {
      for (const g of csmGhosts) volFogPushCascade(g);
    }
    st.shadowsOn = volFogCascadesBuf.length > 0;

    volFogCandsBuf.length = 0;
    let vfCi = 0;
    for (const e of localLights.values()) {
      const L = e && e.light;
      if (!L || L.visible === false) continue;


      const vfIsArea = (e.kind === "RectLight" || e.kind === "TubeLight") && typeof e.__pointEquivI === "number";          
      const vfInt = vfIsArea ? e.__pointEquivI : (Number(L.intensity) || 0);
      if (vfInt <= 0) continue;
      const cand = volFogCandPool[vfCi] || (volFogCandPool[vfCi] = { x: 0, y: 0, z: 0, range: 0, r: 0, g: 0, b: 0, intensity: 0 });
      vfCi += 1;
      const lm = L.matrixWorld.elements;
      cand.x = lm[12]; cand.y = lm[13]; cand.z = lm[14];

      cand.range = vfIsArea && e.__rectRange ? e.__rectRange : (Number(L.distance) > 0 ? Number(L.distance) : 60);
      cand.r = L.color.r; cand.g = L.color.g; cand.b = L.color.b;
      cand.intensity = vfInt;
      volFogCandsBuf.push(cand);
    }
    volFogCamScratch.x = st.camX; volFogCamScratch.y = st.camY; volFogCamScratch.z = st.camZ;
    pickVolLightsJs(volFogCandsBuf, volFogCamScratch, VOL_FOG_MAX_LIGHTS, volFogLightsBuf);


    st.localVolumetric = llVolumetricFeed.lastPlan();
    st.tier = localLightTier();
    st.technology = curLightingTechnology;
    return st;
  }


  let ssrWanted = false;


  let stackWantedCur = false;
  const ssrQa = { on: false, flag: null, auto: true };
  const ssrCtx = { weak: false, tech: "", realistic: false };
  const ssrStateBuf = { active: false, frame: 0, resetCount: 0 };
  function getSsrState() {
    const st = ssrStateBuf;
    st.active = !!ssrWanted;
    if (!st.active) return st;
    st.frame = temporalFrame;
    st.resetCount = temporalResets;


    st.stack = stackWantedCur ? 1 : 0;
    const pQaRaw = getPlanarQa();
    const rswPlanarOn = !!(pQaRaw && (pQaRaw.on === true || pQaRaw.active === true));
    st.stkPlanarOn = rswPlanarOn ? 1 : 0;

    if (rswPlanarOn && pQaRaw && pQaRaw.planePoint) {
      st.stkPlanarPx = pQaRaw.planePoint[0] || 0;
      st.stkPlanarPy = pQaRaw.planePoint[1] || 0;
      st.stkPlanarPz = pQaRaw.planePoint[2] || 0;
    } else {
      st.stkPlanarPx = 0; st.stkPlanarPy = 0; st.stkPlanarPz = 0;
    }
    if (rswPlanarOn && pQaRaw && pQaRaw.planeNormal) {
      st.stkPlanarNx = pQaRaw.planeNormal[0] || 0;
      st.stkPlanarNy = pQaRaw.planeNormal[1] || 1;
      st.stkPlanarNz = pQaRaw.planeNormal[2] || 0;
    } else {
      st.stkPlanarNx = 0; st.stkPlanarNy = 1; st.stkPlanarNz = 0;
    }

    const rswPrbStkBuf = rprobes.getStackState ? rprobes.getStackState(st) : st;
    st.stkProbeOn = rswPrbStkBuf.on || 0;

    st.stkProbeBlend = Number.isFinite(rswPrbStkBuf.blend) ? rswPrbStkBuf.blend : st.stkProbeOn;
    st.stkBoxMinX = rswPrbStkBuf.minX || 0;
    st.stkBoxMinY = rswPrbStkBuf.minY || 0;
    st.stkBoxMinZ = rswPrbStkBuf.minZ || 0;
    st.stkBoxMaxX = rswPrbStkBuf.maxX || 0;
    st.stkBoxMaxY = rswPrbStkBuf.maxY || 0;
    st.stkBoxMaxZ = rswPrbStkBuf.maxZ || 0;
    st.stkFeather = rswPrbStkBuf.feather || 0.15;
    return st;
  }


  const aoViewPrev = new Float64Array(19);
  let aoViewValid = false;
  function getAoState() {
    if (aoState.ao || aoState.contact) {
      camera.updateMatrixWorld();
      const cm = camera.matrixWorld.elements;
      let hit = aoViewValid &&
        aoViewPrev[16] === lightDir.x &&
        aoViewPrev[17] === lightDir.y &&
        aoViewPrev[18] === lightDir.z;
      if (hit) {
        for (let i = 0; i < 16; i++) {
          if (aoViewPrev[i] !== cm[i]) { hit = false; break; }
        }
      }
      if (!hit) {
        for (let i = 0; i < 16; i++) aoViewPrev[i] = cm[i];
        aoViewPrev[16] = lightDir.x;
        aoViewPrev[17] = lightDir.y;
        aoViewPrev[18] = lightDir.z;
        aoViewValid = true;
        aoMatTmp.copy(camera.matrixWorld).invert();
        aoDirTmp.copy(lightDir).transformDirection(aoMatTmp);
        aoState.sunDirView.x = aoDirTmp.x;
        aoState.sunDirView.y = aoDirTmp.y;
        aoState.sunDirView.z = aoDirTmp.z;


        aoDirTmp.set(0, 1, 0).transformDirection(aoMatTmp);
        aoState.upView.x = aoDirTmp.x;
        aoState.upView.y = aoDirTmp.y;
        aoState.upView.z = aoDirTmp.z;
      }


      aoState.temporal = temporalOn;
      aoState.resetCount = temporalResets;
      aoState.frame = temporalFrame;


      aoState.halfDepth = !!(gpuBudget && gpuBudget.weak);




      aoState.csLocal.on = false;


      aoState.csLocal.range = 0;
      aoState.csLocal.steps = 0;
      aoState.csLocal.spread = 0;              
      if (csLocalWanted && aoState.contact && localLights.size > 0) {
        let bestL = null;
        let bestEntry = null;
        let bestW = cfFuse.minWeight;
        for (const entry of localLights.values()) {
          const L = entry && entry.light;
          if (!L || !L.visible) continue;
          const dxl = L.position.x - cm[12];
          const dyl = L.position.y - cm[13];
          const dzl = L.position.z - cm[14];
          const dist2 = dxl * dxl + dyl * dyl + dzl * dzl;


          const cfLtcRect = (entry.kind === "RectLight" || entry.kind === "TubeLight") && entry.areaMode === "ltc";          
          let w = contactLightWeight(
            dist2,
            cfLtcRect && entry.__rectRange ? entry.__rectRange : L.distance || 0,
            contactLightLum(
              L.color.r, L.color.g, L.color.b,
              cfLtcRect && typeof entry.__pointEquivI === "number" ? entry.__pointEquivI : L.intensity,
            ),
          );


          if (w > 0 && (entry.kind === "SpotLight" || entry.kind === "SurfaceLight")) {
            const tgt = entry.target && entry.target.position;
            if (tgt) {

              const ax = tgt.x - L.position.x;
              const ay = tgt.y - L.position.y;
              const az = tgt.z - L.position.z;
              const al = Math.sqrt(ax * ax + ay * ay + az * az) || 1;

              const dist = Math.sqrt(dist2) || 1;
              const cosTo = (ax * (-dxl) + ay * (-dyl) + az * (-dzl)) / (al * dist);
              const cosHalf = (L.angle > 0) ? Math.cos(L.angle) : -1;
              w *= contactConeFactor(cosTo, cosHalf);
            }
          }
          if (w > bestW) { bestW = w; bestL = L; bestEntry = entry; }
        }
        if (bestL) {
          aoDirTmp.set(bestL.position.x, bestL.position.y, bestL.position.z).applyMatrix4(aoMatTmp);
          aoState.csLocal.pos.x = aoDirTmp.x;
          aoState.csLocal.pos.y = aoDirTmp.y;
          aoState.csLocal.pos.z = aoDirTmp.z;
          aoState.csLocal.range = Math.max(
            bestEntry && bestEntry.kind === "RectLight" && bestEntry.areaMode === "ltc" && bestEntry.__rectRange
              ? bestEntry.__rectRange
              : bestL.distance || 0,
            0.05,
          );



          aoState.csLocal.spread = 0;
          if (
            bestEntry && (bestEntry.kind === "RectLight" || bestEntry.kind === "TubeLight") &&
            bestEntry.areaMode === "ltc" && bestEntry.light
          ) {
            const bw2 = Number(bestEntry.light.width) || 0;
            const bh2 = Number(bestEntry.light.height) || 0;
            aoState.csLocal.spread = Math.max(bw2, bh2) * 0.5;
          }
          aoState.csLocal.steps = aoState.csSteps;
          aoState.csLocal.on = true;
        }
      }
    }
    return aoState;
  }


  if (typeof window !== "undefined") {


    window.__rswQaRebuildGi = () => {
      giDirty = true;
      requestRender();
    };


    window.__rswSpecAa = {
      get: () => specAa.getState(),
      set: (opts) => {
        const st = specAa.configure(opts);
        requestRender();
        return st;
      },
    };


    window.__rswSpecOcc = {
      get: () => specOcc.getState(),
      set: (opts) => {
        const st = specOcc.configure(opts);


        aoState.specOccExternal = !!(st && st.wanted && st.supported !== false);
        requestRender();
        return st;
      },
    };


    window.__rswGrading = {
      setWheels(w) {
        gradingHandle.wheels = w && typeof w === "object" ? w : null;
        gradingHandle.rev++;
        applyLighting();
        requestRender();
        return grade.grading;
      },
      setLutText(text, label) {
        gradingHandle.lutParsed = parseCubeLut(String(text || ""));
        gradingHandle.lutLabel = String(label || "console");
        gradingHandle.rev++;
        applyLighting();
        requestRender();
        return { size: gradingHandle.lutParsed.size, label: gradingHandle.lutLabel };
      },
      clearLut() {
        gradingHandle.lutParsed = null;
        gradingHandle.lutLabel = "";
        gradingHandle.rev++;
        applyLighting();
        requestRender();
        return true;
      },
      get() {
        return grade.grading;
      },
    };


    window.__rswCluster = {
      get: () => ({
        wanted: clWanted,
        on: clWanted && mlLights.length > 0,
        count: mlLights.length,
        specStrength: clSettingsBuf.specStrength,
        override: { on: clOverride.on, specStrength: clOverride.specStrength },
      }),
      set: (o) => {
        const v = o || {};
        if ("on" in v) clOverride.on = v.on === true ? true : v.on === false ? false : null;
        if ("specStrength" in v) {
          clOverride.specStrength = v.specStrength == null
            ? null
            : Math.min(1, Math.max(0, Number(v.specStrength) || 0));
        }
        if (clOverride.on === false) clWanted = false;
        else if (clOverride.on === true) clWanted = mlWanted;
        clSettingsBuf.specStrength = clOverride.specStrength == null
          ? CL_DEFAULTS.specStrength
          : clOverride.specStrength;
        return window.__rswCluster.get();
      },
    };
    window.__rswLightingQa = {


      localLights: () => llQa.getSnapshot(),







      megaLightsPipeline: () => megaLightsPipeline.snapshot(),
      substrate: () => substratePipeline.snapshot(),
      substrateApi: () => substratePipeline.api(),
      substrateSm: createSubstrateSmHostQa(substrateSmPipeline),


      auditTextures: () => {
        const entries = [];
        const seen = new Set();
        let rtSkipped = 0;
        const push = (slot, tex, name) => {
          if (!tex || !tex.isTexture) return;


          if (tex.isRenderTargetTexture) {
            const kr = (tex.uuid || name) + "|" + slot;
            if (!seen.has(kr)) { seen.add(kr); rtSkipped += 1; }
            return;
          }
          const k = (tex.uuid || name) + "|" + slot;
          if (seen.has(k)) return;
          seen.add(k);
          entries.push({ slot, name: name || tex.name || "", colorSpace: tex.colorSpace });
        };
        scene.traverse((node) => {
          const mats = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
          for (const m of mats) {
            for (const slot of AUDIT_TEXTURE_SLOTS) push(slot, m[slot], (m.name || node.name || "material") + "." + slot);
          }
        });
        push("background", scene.background, "scene.background");
        push("envMap", scene.environment, "scene.environment");
        const res = auditTextureColorSpaces(entries, {
          srgb: THREE.SRGBColorSpace,
          linear: THREE.NoColorSpace !== undefined ? THREE.NoColorSpace : "",
          linearAlt: THREE.LinearSRGBColorSpace,
        });


        return { ...res, skippedRenderTargets: rtSkipped };
      },
      get: () => ({
        tech: curTech,
        weakGpu: !!(gpuBudget && gpuBudget.weak),


        clipmap: clipmap.getStats(),


        clipmapRender: clipmapRender.getStats(),


        smrt: { injected: smrtQa.injected, on: smrtQa.on, steps: smrtQa.steps },


        f18: {
          mvShadow: shadowTemporalStateBuf.mvOn === true,
          retrace: rtSun.getStats().retrace,
        },

        areaLights: (() => {
          let ltcOn = 0, ptFallback = 0, tubesOn = 0;          
          for (const e of localLights.values()) {
            if (e.kind === "TubeLight") {          
              if (e.areaMode === "ltc") tubesOn++; else ptFallback++;
            } else if (e.kind === "RectLight") {
              if (e.areaMode === "ltc") ltcOn++; else ptFallback++;
            }
          }
          const plan = planAreaLights({
            weakGpu: !!(gpuBudget && gpuBudget.weak),
            maxTexUnits: renderer.capabilities && renderer.capabilities.maxTextures ? renderer.capabilities.maxTextures : 16,
            ltcReady,
          });
          return { ready: ltcReady, loading: ltcLoading, error: ltcError || null,
            tier: plan.tier, budget: plan.budget, reason: plan.reason,
            rects: ltcOn + ptFallback + tubesOn, ltcActive: ltcOn, tubes: tubesOn, pointFallback: ptFallback,          
            visibleLtc: areaActiveCount, texUnits: areaActiveCount > 0 ? LTC_TEX_UNITS : 0,
            partsPatch: areaPtWanted };          
        })(),

        surfaceAppearance: (typeof window !== "undefined" && window.__rswSurfaceQaF10 && window.__rswSurfaceQaF10.get()) || null,

        refraction: getRefractionQa(),


        planar: getPlanarQa(),


        localRotation: (() => {
          let active = 0;
          for (const e of localLights.values()) {
            if (e.light && e.light.castShadow) active += 1;
          }
          const st = lsrCtl.getStats();
          return {
            wanted: lsrWanted,
            on: lsrActive,
            budget: lsrBudget,
            active,
            pending: lsrPending,
            tracked: st.tracked,
            stale: st.stale,
          };
        })(),


        localShadowReuse: llLocalShadowReuse.status(llGateContextCache.contextFor(curTech)),
        gpuReason: (gpuBudget && gpuBudget.reason) || "",

        postfxDiet: getPostfxDietState(),

        filmFx: getFilmFxState(),

        tsr: getTsrState(),

        autoExposure: {
          plan: getAutoExposureState(),
          meter:
            typeof window !== "undefined" && window.__rswAutoExposureQa && typeof window.__rswAutoExposureQa.get === "function"
              ? window.__rswAutoExposureQa.get()
              : null,
        },


        hdr: getHdrPipelineState(),


        hdri: {
          status: hdriCtl.status,
          w: hdriCtl.width,
          h: hdriCtl.height,
          ms: Math.round(hdriCtl.ms),
          avgLum: hdriCtl.stats ? Math.round(hdriCtl.stats.avg * 1000) / 1000 : 0,
          maxLum: hdriCtl.stats ? Math.round(hdriCtl.stats.max * 100) / 100 : 0,
          error: hdriCtl.error,
        },


        grading: (() => {
          const p = grade.grading;
          if (!p) return { preset: "None", wbOn: false, wheelsOn: false, lutOn: false, lutSize: 0, lutSource: "none", signature: "" };
          return {
            preset: p.preset,
            wbOn: !!(p.wb && p.wb.on),
            wbTemp: p.wb ? p.wb.temp : 6500,
            wbTint: p.wb ? p.wb.tint : 0,
            wheelsOn: !!(p.wheels && p.wheels.on),
            lutOn: !!(p.lut && p.lut.on),
            lutSize: p.lut ? p.lut.size : 0,
            lutSource: p.lut ? p.lut.source : "none",
            lutAmount: p.lut ? p.lut.amount : 0,
            signature: p.signature,
          };
        })(),
        temporal: temporalOn,
        ao: !!aoState.ao,
        contact: !!aoState.contact,
        csm: csmActive,
        csmCascades: csmActive ? csmCount : 0,
        tier: tierCtl.getTier(),
        tierStatic: shadowTier.tier,

        clouds: cloudsQa,
        nightSky: nightSkyQa,
        tierChanges,


        tierRegret: tierCtl.getRegret ? tierCtl.getRegret() : null,
        emaMs: Math.round(((shadowCtl.getEma ? shadowCtl.getEma() : 0) || 0) * 10) / 10,
        csSteps: aoState.csSteps,


        csLocal: {
          wanted: csLocalWanted,
          on: !!aoState.csLocal.on,
          steps: aoState.csLocal.steps,
          range: Math.round(aoState.csLocal.range * 100) / 100,
          spread: Math.round((aoState.csLocal.spread || 0) * 100) / 100,              
        },
        rt: rtSun.isEnabled(),


        rtIdle: rtSun.getStats().idle,

        rtF20: { gate: rtSun.getStats().fullRes.gate, traceAb: rtSun.getStats().traceAb },
        skyOcclusion: skyOcclusionOn,
        bent: !!aoState.bent,

        aoLite: !!aoState.lite,
        aoTemporal: !!(aoState.ao && temporalOn),
        warming: warmupCompiling,
      warmupSlice: warmupSlicer.debug(),


        stagedWarmup: stagedWarmupOn,
        warmupStage: warmupStager.debug(),
        tdr: tdrWatchdog.debug(),
        fxPatched,

        trans: trans.getStats(),


        transDirty: transDirtyOnly ? transGate.getStats() : null,
        megaLights: { wanted: mlWanted, count: mlLights.length, baseLum: mlBaseLum },


        shadowAtlas: shadowAtlas ? Object.assign({}, shadowAtlas.getStats(), {
          wanted: atlasWanted,
          hook: !!atlasDepthHook,
          mlAtlasOn: !!(atlasWanted && atlasDepthHook && shadowAtlas.enabled),
        }) : null,
        lightCluster: { wanted: clWanted, on: clWanted && mlLights.length > 0, count: mlLights.length, specStrength: clSettingsBuf.specStrength },          


        pcssStaticTaps: tierCfg.pcssTaps,
        pcssStaticBlockers: tierCfg.pcssBlockers,
        farOn: farShadows.isEnabled(),


        farLite: farShadows.lite === true,
        farTexUnits: farShadows.isEnabled() ? (farShadows.texUnits === 1 ? 1 : 2) : 0,
        transActive: transActive,
        sunMapRes: sun.shadow.mapSize.x,


        shadowMapPlus: { on: curSmPlus, radius: curSmPlus ? sun.shadow.radius : 0, texelTarget: curSmPlus ? SM_PLUS_TEXEL_TARGET : 0 },


        sunViewFit: appliedSunViewFit
          ? {
              on: true,
              half: appliedSunViewFit.half,
              texel: appliedSunViewFit.texel,
              normalBias: appliedSunViewFit.normalBias,
              focusDistance: appliedSunViewFit.focusDistance,
              signature: appliedSunViewFit.signature,
            }
          : {
              on: false,
              half: sunWinHalf,
              texel: sunWinHalf > 0 ? (sunWinHalf * 2) / sun.shadow.mapSize.x : 0,
              normalBias: sun.shadow.normalBias,
              focusDistance: 0,
              signature: null,
            },


        shadowEdgeFilter: {
          on: shadowEdgeFilterOn,
          marker: SHADOW_EDGE_RADIUS_MARKER,
          taps: SHADOW_EDGE_TAP_COUNT,
          widthTexels: pcss.uniforms && pcss.uniforms.uRswShadowEdgeWidth ? pcss.uniforms.uRswShadowEdgeWidth.value : null,
          supported: pcss.shadowEdgeSupported === true,
        },


        photometry: photometryQa,


        lightPhotometry: lightPhotometryQa,


        skyPhysical: curSkyPhys, skyPhysicalDataset: getSkyPhysicalDataset(),                                             
        reflectionProbes: rprobes.getState(),                                  
        envCapture: envcap.getState(),                                            

        giBounce: {
          plan: giBouncePlanCur,
          emissives: lastGiEmissives,
          glue: gi.getBounceState ? gi.getBounceState() : null,
        },


        reflectionStack: (() => {
          const t = makeStackTelemetry();
          const pQa = getPlanarQa();
          const prbQa = rprobes.getState();
          const planarOn = !!(pQa && (pQa.on === true || pQa.active === true));
          const ssrOn = !!(ssrQa && (ssrQa.on === true || ssrQa.effective === true));
          const probeOn = !!(prbQa && prbQa.applied);
          t.on = planarOn || ssrOn || probeOn;
          t.layers.planar = planarOn;
          t.layers.ssr = ssrOn;
          t.layers.probe = probeOn;

          const rswStkPrbState = prbQa && prbQa.stack ? prbQa.stack : { on: false, xfade: false };
          t.stack = { on: rswStkPrbState.on, xfade: rswStkPrbState.xfade };


          const rswCnts = ssrStackShare.counts;
          const rswUsePixelCounts = rswStkPrbState.on === true &&
            rswCnts.at > -Infinity && rswCnts.total > 0;
          if (rswUsePixelCounts) {

            const rswDist = aggregateStackDistribution(rswCnts);
            t.distribution.planarPct = rswDist.planarPct;
            t.distribution.ssrPct = rswDist.ssrPct;
            t.distribution.probePct = rswDist.probePct;
            t.distribution.skyPct = rswDist.skyPct;
            t.distribution.total = rswDist.total;
            t.counter = "pixels";                 


            t.dominant = classifyDominantSource({
              planar: rswDist.planarPct / 100,
              ssr: rswDist.ssrPct / 100,
              probe: rswDist.probePct / 100,
              sky: rswDist.skyPct / 100,
            });
          } else {

            const w = resolveReflectionWeights({
              planar: { on: planarOn, conf: 1 },
              ssr: { on: ssrOn, conf: 1 },
              probe: { on: probeOn, conf: probeOn && prbQa.applied && Number.isFinite(prbQa.applied.blend) ? prbQa.applied.blend : probeOn ? 1 : 0 },
              stackOn: true,
            });
            t.distribution.planarPct = Math.round(w.planar * 1000) / 10;
            t.distribution.ssrPct = Math.round(w.ssr * 1000) / 10;
            t.distribution.probePct = Math.round(w.probe * 1000) / 10;
            t.distribution.skyPct = Math.round(w.sky * 1000) / 10;
            t.distribution.total = 1;
            t.counter = "frame";                                                
            t.dominant = classifyDominantSource(w);
          }
          return t;
        })(),


        iluminacao: (() => {
          const p = typeof window !== "undefined" ? window.__rswIlF1 : null;
          return {
            fase: "IL-F1",
            benchVersion: ILF1_BENCH_VERSION,
            scenes: ILF1_SCENE_IDS,
            armed: !!(p && typeof p.capture === "function"),
            baseline: p && typeof p.summary === "function" ? p.summary() : null,


            pipeline: {
              toneMapping: renderer && typeof renderer.toneMapping === "number" ? renderer.toneMapping : null,
              outputColorSpace: renderer ? String(renderer.outputColorSpace || "") : "",
              grade: {
                exposure: grade.exposure,
                bright: grade.bright,
                punch: grade.punch,
                lift: grade.lift,
                sunIntensity: grade.sunIntensity,
                tint: { r: grade.tint.r, g: grade.tint.g, b: grade.tint.b },
              },
              ibl: {
                on: !!(scene && scene.environment),
                faceSize: ENV_FACE_SIZE,
                skyboxCube: !!skyCube,
              },
              luzes: {
                sun: sun ? Math.round(sun.intensity * 1000) / 1000 : null,
                hemi: hemi ? Math.round(hemi.intensity * 1000) / 1000 : null,
                amb: amb ? Math.round(amb.intensity * 1000) / 1000 : null,
                locais: localLights && typeof localLights.size === "number" ? localLights.size : null,
              },
            },
          };
        })(),


        emissiveHdr: getEmissiveHdrState(),


        tonemap: { id: grade.tonemap | 0, name: TONEMAP_NAMES[grade.tonemap | 0] || "Legacy" },

          sunMask: sunMask.debugState(),

        biasF7: biasF7On(),
        planeBiasCap: pcss.uniforms.uRswPcssPlaneCap.value,
        sunNormalBias: sun.shadow.normalBias,


        renderScale: ADAPTIVE_RES_OFF ? 1 : effectiveRenderScale(tierCfg, !!(gpuBudget && gpuBudget.weak)),
        adaptiveResOff: ADAPTIVE_RES_OFF,


        upscaleSharpen: getUpscaleSharpenState(),


        localExposure: getLocalExposureState(),


        lensFlare: getLensFlareState(),


        giSlice: gi.getProfile ? gi.getProfile() : null,


        giMode: gi.mode,
        giActive: !!giActive,


        gi: (() => {
          const p = gi.getProfile ? gi.getProfile() : null;
          return {
            active: !!giActive,
            dim: p && Number.isFinite(p.dim) ? p.dim : null,
            lateralRays: !!(p && p.lateralRays),
            transBoxes: lastGiTransBoxes,
          };
        })(),


        specOcclusion: (() => {
          const s = specOcc.getState ? specOcc.getState() : null;
          const patchOn = !!(s && s.on && s.supported !== false);
          const compositeOn = !!(aoState.ao && aoState.bent && !aoState.specOccExternal);
          return Object.assign({ active: patchOn || compositeOn, compositeOn }, s || {});
        })(),


        photoMode: (() => {
          const s = photoMode.snapshot();
          if (!s) return { available: false, active: false, phase: "off" };
          return Object.assign(
            {
              available: !!s.enabled,
              active: !!(s.enabled && (s.phase === "converge" || s.phase === "full")),
            },
            s
          );
        })(),


        capsule: { wanted: capsWanted, blob: capsBlobMode, w: capsCurW, tierOn: tierCapsuleEnabled(tierCfg) },

        ledger: passTiming.getLedger(),

        matFeat: Object.assign({ wanted: matFeatWanted }, matFeat.getDebugState()),


        smRealistaLite: (() => {
          const ec = envcap.getState();
          const rswSmSo = specOcc.getState ? specOcc.getState() : null;
          return {
            on: curTech === "ShadowMap" && matKind === "phong",
            matKind: matKind,
            tech: curTech,
            aoLite: !!(aoState.lite && aoState.noTemporal),
            aoNoTemporal: !!aoState.noTemporal,
            specOccPhong: !!(rswSmSo && rswSmSo.phongOn),
            specOccPhongWanted: !!(rswSmSo && rswSmSo.phongWanted),
            iblLite: {
              on: smLiteOn && ec.on === true,
              sizePx: ec.size,
              ready: ec.ready === true,
              captures: ec.captures,
              reflSrc: lastReflEnvSrc ? (lastReflEnvSrc === skyCube ? "skyCube" : "captura") : "nenhuma",
            },


            pcssLite: {
              on: smLitePcssOn,
              marker: SM_LITE_RADIUS_MARKER,
              taps: SM_LITE_TAPS,
              pen: pcss.uniforms && pcss.uniforms.uRswSmLitePen ? pcss.uniforms.uRswSmLitePen.value : null,
              contact: pcss.uniforms && pcss.uniforms.uRswSmLiteCH ? pcss.uniforms.uRswSmLiteCH.value > 0.5 : null,
              supported: pcss.smLiteSupported === true,
            },


            f5: smLitePlanNow,


            ambTint: smLiteAmbQa,
          };
        })(),


        weakIgnition: weakIgnitionQa,


        volumetricFog: volFogQa,


        ssr: ssrQa,


        featureBudget: featGov.getState(),


        dieta: shaderDiet.getState(),


        heightFog: Object.assign({ style: curRenderStyle }, hfog.getState()),


        specAa: Object.assign({ style: curRenderStyle }, specAa.getState()),




          iesCookie: Object.assign({ wanted: iesCkWanted, overflow: iesCkOverflow, mappedLights: iesCkByLightId.size }, iesck.getState()),


        specOcc: Object.assign({ style: curRenderStyle }, specOcc.getState()),


        features: {
          csm: csmActive,
          csmCascades: csmActive ? csmCount : 0,


          csmRodizio: rodizioWanted,
          sunTexel0: sun.shadow.mapSize.x > 0 ? (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.x : 0,
          temporal: temporalOn,
          gtao: !!aoState.ao,
          gtaoLite: !!aoState.lite,
          contact: !!aoState.contact,
          contactSteps: aoState.csSteps,
          far: farShadows.isEnabled(),
          farLite: farShadows.lite === true,
          trans: transActive,
          rt: rtSun.isEnabled(),
          governor: featGovWanted ? featGov.getState() : null,
        },


      }),
    };
  }

  function dispose() {
    disposed = true;
    megaLightsDebug.dispose();
    megaLightsPipeline.dispose();
    substrateSmPipeline.dispose();
    substratePipeline.dispose();
    if (shadowAtlas && typeof shadowAtlas.dispose === 'function') shadowAtlas.dispose();       
    if (atlasDepthHook && typeof atlasDepthHook.dispose === 'function') atlasDepthHook.dispose();       
    atlasDepthHook = null;
    matFeat.dispose();          
    iesck.dispose();          
    areaPt.dispose();          


    if (cloudAnimTimer) { clearTimeout(cloudAnimTimer); cloudAnimTimer = 0; }
    cloudNoiseTex.dispose();
    if (stopShadowIdleInterval) stopShadowIdleInterval();

    warmupStager.cancel();
    warmupToastHide();
    if (renderer && renderer.domElement && typeof renderer.domElement.removeEventListener === "function") {
      renderer.domElement.removeEventListener("webglcontextlost", onWarmupContextLost);
    }
    renderer.shadowMap.autoUpdate = true;
    vsm.dispose();
    clipmap.dispose();                                                             
    clipmapRender.dispose();                                                         
    passTiming.dispose();                                          
    shaderDiet.dispose();                                                  
    gi.dispose();
    caps.dispose();          
    farShadows.dispose();
    rtSun.dispose();          
    sunMask.dispose();          
    trans.dispose();          
    rprobes.dispose();
    if (envCapPumpTimer) { clearTimeout(envCapPumpTimer); envCapPumpTimer = 0; }                                          
    envcap.dispose();                                                                                                            
    for (const off of subs) {
      try { off(); } catch (_e) {                   }
    }
    subs.length = 0;


    photoMode.reset();
    clearViz();
    for (const [id, entry] of Array.from(localLights)) removeLightEntry(id, entry);
    scene.remove(group);
    scene.fog = null;
    scene.background = null;
    scene.environment = null;
    hdriTexDispose();                               
    disposeHdriWorker();                                                 
    if (envRT) {
      envRT.dispose();
      envRT = null;
    }
    environmentPrefilter.dispose();
    if (skyCube) {
      skyCube.dispose();
      skyCube = null;
    }
    dome.geometry.dispose();
    domeMat.dispose();
    vizSphereGeo.dispose();
    vizConeGeo.dispose();
    vizPlaneGeo.dispose();
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }

    for (const g of csmGhosts) {
      if (g.shadow.map) {
        g.shadow.map.dispose();
        g.shadow.map = null;
      }
    }
  }


  const li0 = lightingInst();
  if (li0) sanitizeLighting(li0, null);


  function patchExternalMaterial(mat) {
    if (patchesDisabled || !mat) return;
    externalMats.add(mat);
    substratePipeline.attachMaterial(mat);
    if (matFeatWanted) matFeat.patchMaterial(mat);


    hfog.patchMaterial(mat);          


    rprobes.patchMaterial(mat);          
    specAa.patchMaterial(mat);         
    specOcc.patchMaterial(mat);          
    if (iesCkWanted) iesck.patchMaterial(mat);          
    if (areaPtWanted) areaPt.patchMaterial(mat);          
    if (curPatchSig !== "") {
      if (fxWanted) { gi.patchMaterial(mat); pcss.patchMaterial(mat); farShadows.patchMaterial(mat); }
      if (capsWanted) caps.patchMaterial(mat);
      if (transWanted) trans.patchMaterial(mat);
    }
    llLocalLights.patchMaterial(mat);
    if (mglWanted) subscribeMaterialToMegaLights(mat);
    substrateSmPipeline.attachMaterial(mat, null, "external");
  }


  const slSpotDir = new THREE.Vector3();
  const slToPoint = new THREE.Vector3();
  function sampleLightAt(x, y, z, out) {
    if (!out) out = { r: 1, g: 1, b: 1 };
    const inv = 1 / LEGACY_LIGHT_SCALE;
    const hemiI = hemi.intensity * 0.5 * inv;
    const ambI = amb.intensity * inv;
    const sunI = sun.intensity * 0.5 * inv;
    let r = (hemi.color.r + hemi.groundColor.r) * hemiI + amb.color.r * ambI + sun.color.r * sunI;
    let g = (hemi.color.g + hemi.groundColor.g) * hemiI + amb.color.g * ambI + sun.color.g * sunI;
    let b = (hemi.color.b + hemi.groundColor.b) * hemiI + amb.color.b * ambI + sun.color.b * sunI;
    for (const entry of localLights.values()) {
      const L = entry.light;
      if (!L.visible) continue;
      slToPoint.set(x - L.position.x, y - L.position.y, z - L.position.z);
      const d2 = slToPoint.lengthSq();


      const range = Math.max(
        entry.kind === "RectLight" && entry.areaMode === "ltc" && entry.__rectRange
          ? entry.__rectRange
          : L.distance || 0,
        0.05,
      );
      if (d2 >= range * range) continue;
      const d = Math.sqrt(d2);
      const q = d / range;
      const win = 1 - q * q;
      let att = (L.intensity / Math.max(d2, 1)) * win * win;
      if (entry.kind === "RectLight") {


        if (entry.areaMode === "ltc" && typeof entry.__pointEquivI === "number") {
          att = (entry.__pointEquivI / Math.max(d2, 1)) * win * win;
          const nx = entry.__areaNx || 0, ny = entry.__areaNy || 0, nz = entry.__areaNz || 0;
          if (slToPoint.x * nx + slToPoint.y * ny + slToPoint.z * nz <= 0) continue;
        }
      } else if (entry.kind !== "PointLight") {

        slSpotDir.copy(entry.target.position).sub(L.position).normalize();
        const cosTo = d > 1e-4 ? slToPoint.dot(slSpotDir) / d : 1;
        const cosA = Math.cos(L.angle || 0);
        const t = (cosTo - cosA) / Math.max(1 - cosA, 1e-3);
        if (t <= 0) continue;
        att *= Math.min(t, 1);
      }
      r += L.color.r * att;
      g += L.color.g * att;
      b += L.color.b * att;
    }
    out.r = Number.isFinite(r) ? Math.min(Math.max(r, 0), 2.5) : 1;
    out.g = Number.isFinite(g) ? Math.min(Math.max(g, 0), 2.5) : 1;
    out.b = Number.isFinite(b) ? Math.min(Math.max(b, 0), 2.5) : 1;
    return out;
  }


  let playShadowScale = 1;

  return {
    beforeRender,
    afterMegaLightsRender: (milliseconds) => megaLightsDebug.afterRender(milliseconds),
    isWarmingUp,


    isPreparingForDisplay: () => lightingDirty || substratePipeline.isPreparingForDisplay() || isWarmingUp() || fxWarmup > 0 || warmupStager.isActive(),
    getPreparationError: () => warmupError,
    getPreparationState: () => ({ lightingDirty, shaderPending: warmupPending, shaderCompiling: warmupCompiling,
      environmentPending: environmentPrefilter.isPending(), environmentProgress: environmentPrefilter.getProgress(),
      slice: warmupSlicer.progress(), programProgress: shaderProgramWarmup.getProgress(),
      stages: warmupStager.debug(), initialFramesRemaining: fxWarmup,
      substrateWaiting: substratePipeline.isPreparingForDisplay() }),


    setLastFrameCost(ms) {
      const v = Number(ms);
      lastFrameCostMs = Number.isFinite(v) && v > 0 ? v : 0;
      if (lastFrameCostMs > 0) substratePipeline.afterRender(lastFrameCostMs);
    },


    getRenderScale: () => ADAPTIVE_RES_OFF ? 1 : photoMode.scaleFor(
      1,
      effectiveRenderScale(tierCfg, !!(gpuBudget && gpuBudget.weak))
    ),





    getGlassRefractionEnv: () => {
      const li = lightingInst();
      return {
        weak: !!(gpuBudget && gpuBudget.weak),
        tier: tierCtl.getTier(),
        lightModel:
          curTech === "Compatibility" ? "basic" : curTech === "Future" ? "phong" : "lambert",
        flag: li && typeof li.getProperty === "function" ? li.getProperty("GlassRefraction") : null,
        ior: li && typeof li.getProperty === "function" ? li.getProperty("IndexOfRefraction") : null,


        patchesDisabled,
      };
    },


    getPlanarReflectionsEnv: () => {
      const li = lightingInst();
      const rs = li && typeof li.getProperty === "function" ? li.getProperty("RenderStyle") : null;
      return {
        weak: !!(gpuBudget && gpuBudget.weak),
        renderStyle: typeof rs === "string" ? rs : "Classic",
        flag: li && typeof li.getProperty === "function" ? li.getProperty("PlanarReflections") : null,
      };
    },
    getCinematicPostProcessState() {
      const li = lightingInst();
      return {
        technology: curLightingTechnology,
        safeMode: patchesDisabled || hardSafeMode,
        weak: !!(gpuBudget && gpuBudget.weak),
        flag: li && typeof li.getProperty === "function" ? li.getProperty("CinematicPostProcess") : null,
      };
    },
    getSunScreenInfo,
    sampleLightAt,
    getGradeState,

    getPostfxDietState,
    setPostfxPhotoMode,

    getHdrPipelineState,

    getUpscaleSharpenState,

      getLocalExposureState,
      getLensFlareState,                                                             
    getSmLiteFxState,                                                                         
    getAutoExposureState,         
    getShadowTemporalState,
    getMegaLightsState,          
    getVolumetricFogState,                                            


    getSubstrateState: () => substratePipeline.snapshot(),
    getSubstrateScreen: () => substratePipeline.screen(),
    whenSubstrateReady: () => substratePipeline.ready(),
    getSubstrateSmState: () => substrateSmPipeline.snapshot(),
    whenSubstrateSmReady: () => substrateSmPipeline.ready(),
    getLocalLightPatchRegistry: () => llLocalLights,
    setLocalVolumetricPassExtension: (extension) => {
      llVolumetricPassExtension = extension || null;
      return llVolumetricPassExtension !== null;
    },
    getSsrState,                                                        
    getAoState,


    setAoMask: (m) => specOcc.setMask(m),
    patchExternalMaterial,


    relightObject,
    markShadowsDirty,
    markGiDirty,


    setPlayShadowScale: (f) => {
      const v = Number(f);
      const s = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
      if (s === playShadowScale) return;
      playShadowScale = s;
      markShadowsDirty();
    },
    getPlayShadowScale: () => playShadowScale,
    getFilmFxState,                                                       
    getTsrState,                                                                             
    setPlayModeActive,                                                     

    getShadowPageStats: () => vsm.getStats(),

    getSunClipmapStats: () => clipmap.getStats(),


    getPassTiming: () => passTiming,

    getRtShadowStats: () => rtSun.getStats(),
    disableShaderPatches,

    reopenShaderPatches,
    dispose,
  };
}
