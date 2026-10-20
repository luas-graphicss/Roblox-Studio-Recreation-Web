import {
  SA_MAX_SLOTS,
  SA_RES_LADDER,
  saResFor,
  saStepRes,
} from "../shadowAtlasCore.js";
import { MGL_LIGHT_SHAPE, MGL_TIER_DEFAULTS } from "./mlPipelineContract.js";

export const VSM_REFUSAL = Object.freeze({
  tierAllowsNoPages: "vsm.tierAllowsNoPages",
  lightCastsNoShadow: "vsm.lightCastsNoShadow",
  cubePagesNotImplemented: "vsm.cubePagesNotImplemented",
  shapeHasNoShadowPage: "vsm.shapeHasNoShadowPage",
  invalidLightGeometry: "vsm.invalidLightGeometry",
  beyondTierLightLimit: "vsm.beyondTierLightLimit",
});


export function virtualShadowMapLightLimitFor(tierName) {
  const tier = MGL_TIER_DEFAULTS[tierName] || MGL_TIER_DEFAULTS.medio;
  const declaredLimit = Math.max(0, Math.floor(Number(tier.virtualShadowMapLightLimit) || 0));
  return Math.min(declaredLimit, SA_MAX_SLOTS);
}


export function estimateIlluminanceAtViewer(light) {
  const intensity = Number(light && light.intensity);
  if (!Number.isFinite(intensity) || intensity <= 0) return 0;
  const distance = Number(light && light.distanceToViewer);
  const safeDistance = Number.isFinite(distance) && distance > 0 ? distance : 1;
  return intensity / (1 + safeDistance * safeDistance);
}

function shapeRefusalFor(light) {
  const shape = light.shape || MGL_LIGHT_SHAPE.sphere;
  if (shape === MGL_LIGHT_SHAPE.sphere) {
    if (light.isSpot) return null;
    return {
      code: VSM_REFUSAL.cubePagesNotImplemented,
      detail: "an omni sphere light needs 6 cube faces in the atlas; declared residual of ML-F15",
    };
  }
  return {
    code: VSM_REFUSAL.shapeHasNoShadowPage,
    detail: "shape \"" + shape + "\" has no shadow page in this phase; declared residual of ML-F15",
  };
}

function geometryRefusalFor(light) {
  if (!light || typeof light.id !== "string" || light.id.length === 0) {
    return { code: VSM_REFUSAL.invalidLightGeometry, detail: "a page request needs a stable light id" };
  }
  const attenuationRadius = Number(light.attenuationRadius);
  if (!Number.isFinite(attenuationRadius) || attenuationRadius <= 0) {
    return { code: VSM_REFUSAL.invalidLightGeometry, detail: "attenuation radius must be finite and positive" };
  }
  const coneAngle = Number(light.coneAngle);
  if (!Number.isFinite(coneAngle) || coneAngle <= 0 || coneAngle >= Math.PI / 2) {
    return { code: VSM_REFUSAL.invalidLightGeometry, detail: "cone half angle must be inside (0, PI/2)" };
  }
  return null;
}


export function planPageRequests(input) {
  const settings = input || {};
  const tierName = settings.tierName || "medio";
  const limit = virtualShadowMapLightLimitFor(tierName);
  const previousResolutionById = settings.previousResolutionById || {};
  const lights = Array.isArray(settings.lights) ? settings.lights : [];
  const refused = [];


  if (limit === 0) {
    lights.forEach((light) => {
      refused.push({
        id: (light && light.id) || "?",
        code: VSM_REFUSAL.tierAllowsNoPages,
        detail: "tier " + tierName + " allows 0 light(s) with virtual shadow map pages",
      });
    });
    return { tierName, limit, eligibleCount: 0, requests: [], refused, resolutionLadder: SA_RES_LADDER };
  }

  const eligible = [];
  lights.forEach((light) => {
    const geometryRefusal = geometryRefusalFor(light);
    if (geometryRefusal) {
      refused.push({ id: (light && light.id) || "?", code: geometryRefusal.code, detail: geometryRefusal.detail });
      return;
    }
    if (!light.castsShadow) {
      refused.push({
        id: light.id,
        code: VSM_REFUSAL.lightCastsNoShadow,
        detail: "the VSM path is for lights that HAVE a shadow map; this one has none",
      });
      return;
    }
    const shapeRefusal = shapeRefusalFor(light);
    if (shapeRefusal) {
      refused.push({ id: light.id, code: shapeRefusal.code, detail: shapeRefusal.detail });
      return;
    }
    eligible.push({
      id: light.id,
      shape: light.shape || MGL_LIGHT_SHAPE.sphere,
      priority: estimateIlluminanceAtViewer(light),
    });
  });




  eligible.sort((first, second) => second.priority - first.priority || first.id.localeCompare(second.id));

  const requests = [];
  const pageCount = Math.min(eligible.length, limit);
  eligible.forEach((light, index) => {
    if (index >= limit) {
      refused.push({
        id: light.id,
        code: VSM_REFUSAL.beyondTierLightLimit,
        detail: "tier " + tierName + " allows " + limit + " light(s) with pages; this one ranked " + index,
      });
      return;
    }
    const requestedResolution = saResFor(index, pageCount);
    const previousResolution = Number(previousResolutionById[light.id]) || 0;
    const resolution = previousResolution > 0
      ? saStepRes(previousResolution, requestedResolution)
      : requestedResolution;
    requests.push({
      id: light.id,
      rank: index,
      res: resolution,
      requestedRes: requestedResolution,
      previousRes: previousResolution > 0 ? previousResolution : null,
      shape: light.shape,
      priority: light.priority,
    });
  });

  return { tierName, limit, eligibleCount: eligible.length, requests, refused, resolutionLadder: SA_RES_LADDER };
}


export function resolutionByLightId(requests) {
  const resolutionById = {};
  (requests || []).forEach((request) => {
    if (request && request.id) resolutionById[request.id] = request.res;
  });
  return resolutionById;
}
