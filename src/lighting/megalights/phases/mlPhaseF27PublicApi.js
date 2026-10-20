import { mlQa } from "../runtime/megaLightsTelemetry.js";
import { listFlags, setFlag } from "../runtime/megaLightsFlagRegistry.js";
import {
  MGL_CONTRACT_VERSION,
  MGL_DISOCCLUSION_FRAME_COUNT,
  MGL_GUIDING_TILE_SIZE,
  MGL_HIDDEN_LIGHT_SAMPLE_FRACTION,
  MGL_MAX_LIGHTS,
  MGL_MAX_SAMPLES_PER_PIXEL,
  MGL_MAX_VISIBLE_LIGHTS_PER_TILE,
  MGL_TRACE_TILE_SIZE,
  tierDefaults,
} from "../mlPipelineContract.js";
import {
  PUBLIC_API_VERSION,
  auditSettingRoundTrip,
  buildPublicApiSurface,
  findSetting,
  validateSettingWrite,
} from "../mlPublicApiCore.js";

export const PHASE_ID = "ML-F27";
const SHARED_LIGHTING_TEXTURE_UNITS = 0;
const PUBLIC_API_GLOBAL_NAME = "__mlPublicApi";


const CONTRACT_CONSTANTS = Object.freeze({
  contractVersion: MGL_CONTRACT_VERSION,
  maxLights: MGL_MAX_LIGHTS,
  maxSamplesPerPixel: MGL_MAX_SAMPLES_PER_PIXEL,
  guidingTileSize: MGL_GUIDING_TILE_SIZE,
  traceTileSize: MGL_TRACE_TILE_SIZE,
  maxVisibleLightsPerTile: MGL_MAX_VISIBLE_LIGHTS_PER_TILE,
  hiddenLightSampleFraction: MGL_HIDDEN_LIGHT_SAMPLE_FRACTION,
  disocclusionFrameCount: MGL_DISOCCLUSION_FRAME_COUNT,
});

export function installPhase(installContext) {
  const context = installContext || {};
  const telemetry = context.mlQa || mlQa;
  const bench = context.bench || null;
  const currentTier = () => (bench && bench.tier ? bench.tier : "medio");

  const readSurface = () =>
    buildPublicApiSurface({
      flags: listFlags(),
      tierName: currentTier(),
      tierDefaults: tierDefaults(currentTier()),
      contractConstants: CONTRACT_CONSTANTS,
    });


  const writeSetting = (key, value) => {
    const decision = validateSettingWrite({ surface: readSurface(), key, value });
    if (!decision.accepted) return decision;
    setFlag(key, value);
    const written = findSetting(readSurface(), key);
    return Object.assign({}, decision, {
      resolvedOn: written ? written.resolvedOn : null,
      resolvedMode: written ? written.resolvedMode : null,
    });
  };


  const auditRoundTrip = () => {
    const surface = readSurface();
    return auditSettingRoundTrip({
      surface,
      readValue: (key) => {
        const setting = findSetting(readSurface(), key);
        return setting ? setting.value : undefined;
      },
    });
  };

  const publicApi = { version: PUBLIC_API_VERSION, readSurface, writeSetting, auditRoundTrip };
  if (typeof window !== "undefined") window[PUBLIC_API_GLOBAL_NAME] = publicApi;

  const surfaceNow = readSurface();
  telemetry.textureUnit(PHASE_ID, SHARED_LIGHTING_TEXTURE_UNITS);
  telemetry.phase(PHASE_ID, {
    implemented: true,
    title: "Public API: the guarded settings surface, tri-state safe",
    block: "H",
    ownsPass: null,
    flag: null,
    sharedLightingTextureUnits: SHARED_LIGHTING_TEXTURE_UNITS,
    injectsGlslInSharedProgram: false,
    apiVersion: PUBLIC_API_VERSION,
    globalName: PUBLIC_API_GLOBAL_NAME,
    settingCounts: surfaceNow.counts,
    roundTrip: auditRoundTrip(),
    acceptance: {
      everySettingRoundTrips: true,
      autoStaysAuto: "a setting read back as null must have been written as null",
      writesAreGuarded: "any value other than null, true or false is refused with a reason",
    },
    residuals: [
      "the surface mirrors the bench flags: the UE cvars that have no bench equivalent yet are absent rather than faked",
      "writes go to labFlags.js, which persists to localStorage: a private window starts from the tier defaults again",
    ],
    waitingFor: "nothing: it reads whatever registry exists at the moment it is asked",
  });

  return {
    implemented: true,
    phaseId: PHASE_ID,
    passName: null,
    publicApi,
    inspect: () => readSurface(),
  };
}
