import { describeMsmWake } from "./msmWakeDecisionCore.js";
import { isMsmAwakeNow } from "./msmWakeFastPathCore.js";


export const MSM_ATLAS_WAKE_REASON = Object.freeze({
  AUTHOR_VETO: "author set ShadowAtlas to false - absolute veto, the MSM does not argue",
  MSM_ASLEEP: "MSM is asleep this frame, so it needs no page",
  NO_GPU_ROOM: "GPU cannot host the atlas at a useful size",
  NO_CONSUMER: "no MSM pass reads the atlas yet - waking it would burn VRAM for nothing",
  WANTED: "MSM wants the atlas awake to get a real shadow on the ShadowMap path",
});


export const MSM_ATLAS_MINIMUM_MAX_TEXTURE_SIZE = 2048;


export const MSM_ATLAS_SAMPLE_CONSUMER_READY = true;


export const MSM_ATLAS_WAKE_REQUEST_ARGUMENT_ORDER = Object.freeze([
  "shadowAtlasProperty",
  "technology",
  "megaLightsWanted",
  "tier",
  "flag",
  "weakGpu",
  "maxTextureSize",
  "sampleReadsAtlas",
]);


export function describeMsmAtlasWakeRequest(input) {
  const source = input && typeof input === "object" ? input : {};


  if (source.shadowAtlasProperty === false) {
    return buildRequest(false, MSM_ATLAS_WAKE_REASON.AUTHOR_VETO, null);
  }


  const wake = describeMsmWake({
    technology: source.technology,
    megaLightsWanted: source.megaLightsWanted,
    tier: source.tier,
    flag: source.flag,
    weakGpu: source.weakGpu,
  });
  if (wake.awake !== true) {
    return buildRequest(false, MSM_ATLAS_WAKE_REASON.MSM_ASLEEP + " - " + wake.reason, wake);
  }



  const maxTextureSize = Math.floor(Number(source.maxTextureSize));
  if (!(maxTextureSize >= MSM_ATLAS_MINIMUM_MAX_TEXTURE_SIZE)) {
    return buildRequest(false, MSM_ATLAS_WAKE_REASON.NO_GPU_ROOM, wake);
  }







  if (source.sampleReadsAtlas !== true) {
    return buildRequest(false, MSM_ATLAS_WAKE_REASON.NO_CONSUMER, wake);
  }

  return buildRequest(true, MSM_ATLAS_WAKE_REASON.WANTED, wake);
}


const NO_REQUEST = Object.freeze({});














export function msmWantsShadowAtlas(input) {
  const source = input && typeof input === "object" ? input : NO_REQUEST;
  if (source.shadowAtlasProperty === false) return false;
  if (source.sampleReadsAtlas !== true) return false;
  if (!(Math.floor(Number(source.maxTextureSize)) >= MSM_ATLAS_MINIMUM_MAX_TEXTURE_SIZE)) return false;
  return isMsmAwakeNow(source);
}

function buildRequest(wanted, reason, wake) {
  return Object.freeze({ wanted, reason, wake });
}
