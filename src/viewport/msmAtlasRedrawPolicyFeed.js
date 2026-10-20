import {
  isLocalLightFlagActive,
  registerLocalLightFlag,
  resolveLocalLightFlag,
  setLocalLightFlagOverride,
} from "../lighting/llFeatureFlags.js";
import { describeLocalLightTechnologyGate, isLocalLightTechnology } from "../lighting/llTechnologyGate.js";
import {
  MSM_PAGE_FINGERPRINT_UNKNOWN,
  computeMsmAtlasPageFingerprint,
} from "../lighting/megalightsSm/msmAtlasPageFingerprintCore.js";
import { createMsmAtlasRedrawPolicy } from "../lighting/megalightsSm/msmAtlasRedrawPolicyCore.js";

export const MSM_ATLAS_REDRAW_FLAG_ID = "MsmAtlasRedrawPolicy";
export const MSM_ATLAS_REDRAW_FEED_PHASE_ID = "MSM-O1";


export const MSM_ATLAS_REDRAW_FEED_REASON = Object.freeze({
  ACTIVE: "active",
  FLAG_OFF: "flag-off",
  TECHNOLOGY_OFF: "technology-off",
  UNKNOWN_CASTER_REVISION: "unknown-caster-revision",
  NO_PAGES: "no-pages",
});


registerLocalLightFlag({
  id: MSM_ATLAS_REDRAW_FLAG_ID,
  phase: MSM_ATLAS_REDRAW_FEED_PHASE_ID,
  description:
    "MSM shadow atlas keeps the pages whose content did not change instead of redrawing every page every frame",
  defaultsByTier: { fraco: true, medio: true, forte: true },
});

const ORIGIN_TARGET = Object.freeze({ x: 0, y: 0, z: 0 });


export function createMsmAtlasRedrawPolicyFeed(options) {
  const settings = options && typeof options === "object" ? options : {};
  const logger = settings.logger && typeof settings.logger === "object" ? settings.logger : null;

  const policyCore = createMsmAtlasRedrawPolicy({ perf: settings.perf, tier: settings.tier });


  const pagePool = [];
  const pageFrameList = [];
  const spotByAtlasId = new Map();

  const pulse = {
    phase: MSM_ATLAS_REDRAW_FEED_PHASE_ID,
    active: false,
    reason: MSM_ATLAS_REDRAW_FEED_REASON.FLAG_OFF,
    tier: "",
    technology: "",
    sceneRevision: "",
    persistent: false,
    pageCount: 0,
    namedPageCount: 0,
    keptPageCount: 0,
    dirtyPageCount: 0,
    healed: false,
    watchdogRedraws: 0,
    skipReason: "",
    cubeFacePageCount: 0,
  };

  const totals = { frames: 0, activeFrames: 0, standDownFrames: 0, namedPages: 0, keptPages: 0 };


  let invalidationPulseCount = 0;

  function pageAt(index) {
    while (index >= pagePool.length) {
      pagePool.push({ pageId: "", lightId: "", importance: 0, fingerprint: MSM_PAGE_FINGERPRINT_UNKNOWN });
    }
    const page = pagePool[index];
    pageFrameList[index] = page;
    return page;
  }

  function publishPulse(reason, tier, technology, sceneRevision, report) {
    pulse.reason = reason;
    pulse.tier = tier;
    pulse.technology = technology;
    pulse.sceneRevision = sceneRevision;
    pulse.active = reason === MSM_ATLAS_REDRAW_FEED_REASON.ACTIVE;
    pulse.persistent = report ? report.persistent === true : false;
    pulse.pageCount = report ? report.pageCount : 0;
    pulse.namedPageCount = report ? report.namedPageCount : 0;
    pulse.keptPageCount = report ? report.keptPageCount : 0;
    pulse.dirtyPageCount = report ? report.dirtyPageCount : 0;
    pulse.healed = report ? report.healed === true : false;
    pulse.watchdogRedraws = report ? report.watchdogRedraws : 0;
    pulse.skipReason = report ? report.skipReason : "";
    if (pulse.active) {
      totals.activeFrames += 1;
      totals.namedPages += pulse.namedPageCount;
      totals.keptPages += pulse.keptPageCount;
    } else {
      totals.standDownFrames += 1;
    }
    return pulse;
  }


  function standDown(reason, tier, technology) {
    const report = policyCore.planFrame({ pages: [], sceneRevision: 0 });
    pulse.cubeFacePageCount = 0;
    return publishPulse(reason, tier, technology, "", report);
  }

  function indexSpotMirrors(spotThreeLights) {
    spotByAtlasId.clear();
    if (!Array.isArray(spotThreeLights)) return;
    for (let index = 0; spotThreeLights.length > index; index += 1) {
      const spot = spotThreeLights[index];
      if (!spot || !spot.isSpotLight) continue;
      if (!spot.userData || !spot.userData.__rswAtlasId) continue;
      spotByAtlasId.set(spot.userData.__rswAtlasId, spot);
    }
  }



















  function planFrame(input) {
    const request = input && typeof input === "object" ? input : {};
    const tier = typeof request.tier === "string" ? request.tier : "";
    const technology = typeof request.technology === "string" ? request.technology : "";
    totals.frames += 1;

    if (!isLocalLightFlagActive(MSM_ATLAS_REDRAW_FLAG_ID, tier)) {
      return standDown(MSM_ATLAS_REDRAW_FEED_REASON.FLAG_OFF, tier, technology);
    }
    if (!isLocalLightTechnology(technology)) {
      return standDown(MSM_ATLAS_REDRAW_FEED_REASON.TECHNOLOGY_OFF, tier, technology);
    }

    const casterRevision = Number(request.casterRevision);
    if (!Number.isFinite(casterRevision)) {


      if (logger && typeof logger.warn === "function") {
        logger.warn("MSM-O1: no caster revision on this frame, atlas keeps the legacy full redraw");
      }
      return standDown(MSM_ATLAS_REDRAW_FEED_REASON.UNKNOWN_CASTER_REVISION, tier, technology);
    }

    const invalidationPulse =
      request.invalidationPulse && typeof request.invalidationPulse === "object" ? request.invalidationPulse : null;
    if (invalidationPulse && (invalidationPulse.healed === true || invalidationPulse.casterOverflow === true)) {
      invalidationPulseCount += 1;
    }


    const sceneRevision = casterRevision + ":" + invalidationPulseCount;

    const lights = Array.isArray(request.lights) ? request.lights : [];
    indexSpotMirrors(request.spotThreeLights);

    let pageCount = 0;
    for (let index = 0; lights.length > index; index += 1) {
      const light = lights[index];
      if (!light || !light.id) continue;


      const spot = spotByAtlasId.get(light.id);
      if (!spot) continue;

      const spotPosition = spot.position;
      const target = spot.target && spot.target.position ? spot.target.position : ORIGIN_TARGET;


      const range = Math.max(0.1, Number(light.range) || spot.distance || 1);
      const coneAngle = spot.angle || 0.8;

      const page = pageAt(pageCount);
      page.pageId = light.id;
      page.lightId = light.id;


      page.importance = lights.length - index;
      page.fingerprint = computeMsmAtlasPageFingerprint({
        pageId: light.id,
        lightId: light.id,
        kind: "spot",
        cubeFace: -1,
        positionX: spotPosition.x,
        positionY: spotPosition.y,
        positionZ: spotPosition.z,


        directionX: target.x - spotPosition.x,
        directionY: target.y - spotPosition.y,
        directionZ: target.z - spotPosition.z,
        coneAngle: coneAngle,
        range: range,
        sceneRevision: sceneRevision,
      });
      pageCount += 1;
    }


    const cubeFaces = Array.isArray(request.cubeFaces) ? request.cubeFaces : [];
    let cubeFacePageCount = 0;
    for (let index = 0; cubeFaces.length > index; index += 1) {
      const face = cubeFaces[index];
      if (!face || !face.id) continue;
      const page = pageAt(pageCount);
      page.pageId = face.id;
      page.lightId = face.id;
      page.importance = 0;
      page.fingerprint = MSM_PAGE_FINGERPRINT_UNKNOWN;
      pageCount += 1;
      cubeFacePageCount += 1;
    }


    pageFrameList.length = pageCount;
    pulse.cubeFacePageCount = cubeFacePageCount;

    if (!(pageCount >= 1)) {
      return standDown(MSM_ATLAS_REDRAW_FEED_REASON.NO_PAGES, tier, technology);
    }

    const report = policyCore.planFrame({
      pages: pageFrameList,
      sceneRevision: sceneRevision,
      atlasGeneration: request.atlasGeneration === undefined ? null : request.atlasGeneration,
      frozen: request.frozen === true,
    });

    return publishPulse(MSM_ATLAS_REDRAW_FEED_REASON.ACTIVE, tier, technology, sceneRevision, report);
  }

  return {
    phaseId: MSM_ATLAS_REDRAW_FEED_PHASE_ID,
    flagId: MSM_ATLAS_REDRAW_FLAG_ID,
    textureUnits: 0,

    planFrame: planFrame,


    policy() {
      return policyCore.policy();
    },


    setFlag(value) {
      return setLocalLightFlagOverride(MSM_ATLAS_REDRAW_FLAG_ID, value);
    },

    isActive(tier, technology) {
      return isLocalLightFlagActive(MSM_ATLAS_REDRAW_FLAG_ID, tier) && isLocalLightTechnology(technology);
    },


    reset(reason) {
      policyCore.invalidateEveryPage(reason);
      return true;
    },

    lastPulse() {
      return pulse;
    },


    status(tier, technology) {
      return {
        phase: MSM_ATLAS_REDRAW_FEED_PHASE_ID,
        flag: resolveLocalLightFlag(MSM_ATLAS_REDRAW_FLAG_ID, { tier: tier }),
        technologyGate: describeLocalLightTechnologyGate(technology),
        textureUnits: 0,
      };
    },

    stats() {
      return {
        phase: MSM_ATLAS_REDRAW_FEED_PHASE_ID,
        frames: totals.frames,
        activeFrames: totals.activeFrames,
        standDownFrames: totals.standDownFrames,
        namedPages: totals.namedPages,
        keptPages: totals.keptPages,
        invalidationPulseCount: invalidationPulseCount,
        policy: policyCore.stats(),
      };
    },
  };
}
