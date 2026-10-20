import {
  LIGHT_FUNCTION_ATLAS_SIZE,
  LIGHT_FUNCTION_CONTENT_SLOT_CAPACITY,
  LIGHT_FUNCTION_NEUTRAL_SLOT,
  atlasByteLengthWithMipChain,
  buildSlotSafeMipChain,
  createAtlasPixels,
  describeAtlasGeometry,
  fillSlotSolid,
} from "./mlLightFunctionAtlasCore.js";
import { SLOT_ACQUIRE_OUTCOME, createLightFunctionSlotAllocator } from "./mlLightFunctionSlotAllocatorCore.js";
import {
  writeCookiePresetIntoSlot,
  writeIesPresetIntoSlot,
  writeIesProfileIntoSlot,
} from "./mlIesAtlasCore.js";
import { writeRectTextureIntoSlot } from "./mlRectTextureCore.js";
import {
  LIGHT_FUNCTION_ATLAS_SAMPLER_UNIFORM,
  LIGHT_FUNCTION_ATLAS_SIZE_UNIFORM,
  buildLightFunctionAtlasGlsl,
} from "./mlLightFunctionAtlasGlsl.js";

export const LIGHT_FUNCTION_ATLAS_OWNER = "ML-F6";


export const LIGHT_FUNCTION_KEY_PREFIX = Object.freeze({
  iesPreset: "iesPreset:",
  iesProfile: "iesProfile:",
  cookiePreset: "cookiePreset:",
  rectTexture: "rectTexture:",
});

export function createLightFunctionAtlasPass(dependencies) {
  const THREE = dependencies.THREE;
  const telemetry = dependencies.telemetry || null;
  const contentSlotBudgetByTier = dependencies.contentSlotBudgetByTier || {};

  const basePixels = createAtlasPixels();
  fillSlotSolid(basePixels, LIGHT_FUNCTION_NEUTRAL_SLOT, [255, 255, 255, 255]);

  const allocator = createLightFunctionSlotAllocator({});

  let atlasTexture = null;
  let mipChainIsStale = true;
  let internalFrameIndex = 0;
  let uploadCount = 0;
  let refusedRequestCount = 0;
  let lastPublishedSignature = "";
  let lastAppliedBudget = LIGHT_FUNCTION_CONTENT_SLOT_CAPACITY;



  const atlasHandle = {
    owner: LIGHT_FUNCTION_ATLAS_OWNER,
    ready: false,
    atlasSize: LIGHT_FUNCTION_ATLAS_SIZE,
    textureUnits: 1,
    texture: null,
    uniforms: null,
    slotOf: (key) => allocator.slotOf(key),
    neutralSlot: LIGHT_FUNCTION_NEUTRAL_SLOT,
  };

  function ensureTexture() {
    if (atlasTexture || !THREE) return atlasTexture;
    atlasTexture = new THREE.DataTexture(
      basePixels,
      LIGHT_FUNCTION_ATLAS_SIZE,
      LIGHT_FUNCTION_ATLAS_SIZE,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    atlasTexture.name = "mglLightFunctionAtlas";
    atlasTexture.magFilter = THREE.LinearFilter;
    atlasTexture.minFilter = THREE.LinearMipmapLinearFilter;
    atlasTexture.wrapS = THREE.ClampToEdgeWrapping;
    atlasTexture.wrapT = THREE.ClampToEdgeWrapping;
    atlasTexture.generateMipmaps = false;                                  
    atlasTexture.flipY = false;


    atlasTexture.colorSpace = THREE.NoColorSpace || atlasTexture.colorSpace;
    atlasTexture.needsUpdate = true;
    atlasHandle.texture = atlasTexture;
    atlasHandle.uniforms = {
      [LIGHT_FUNCTION_ATLAS_SAMPLER_UNIFORM]: { value: atlasTexture },
      [LIGHT_FUNCTION_ATLAS_SIZE_UNIFORM]: {
        value: new THREE.Vector2(LIGHT_FUNCTION_ATLAS_SIZE, LIGHT_FUNCTION_ATLAS_SIZE),
      },
    };
    return atlasTexture;
  }

  function refreshMipChain() {
    if (!atlasTexture) return;
    const chain = buildSlotSafeMipChain(basePixels);
    atlasTexture.mipmaps = [
      { data: basePixels, width: LIGHT_FUNCTION_ATLAS_SIZE, height: LIGHT_FUNCTION_ATLAS_SIZE },
    ].concat(chain.map((level) => ({ data: level.pixels, width: level.width, height: level.height })));
    atlasTexture.needsUpdate = true;
    uploadCount++;
  }

  function requestSlot(key, frameIndex, writeCellIntoSlot) {
    const acquired = allocator.acquire(key, frameIndex);
    if (acquired.outcome === SLOT_ACQUIRE_OUTCOME.refused) {
      refusedRequestCount++;
      return acquired;
    }
    if (acquired.outcome !== SLOT_ACQUIRE_OUTCOME.reused) {
      writeCellIntoSlot(acquired.slot);
      mipChainIsStale = true;
    }
    return acquired;
  }

  function frameIndexOf(frameContext) {
    const provided = frameContext ? Number(frameContext.frameIndex) : Number.NaN;
    return Number.isFinite(provided) ? provided : internalFrameIndex;
  }

  function publishWhenChanged() {
    if (!telemetry) return;
    const allocation = allocator.describe();
    const signature = [
      atlasHandle.ready,
      allocation.usedSlotCount,
      allocation.contentSlotBudget,
      allocation.evictionCount,
      allocation.refusedAcquireCount,
      uploadCount,
    ].join("|");
    if (signature === lastPublishedSignature) return;
    lastPublishedSignature = signature;
    telemetry.phase(LIGHT_FUNCTION_ATLAS_OWNER, {
      implemented: true,
      ready: atlasHandle.ready,
      atlasSize: LIGHT_FUNCTION_ATLAS_SIZE,
      textureUnitsDeclared: 1,
      contentSlotCapacity: allocation.contentSlotCapacity,
      contentSlotBudget: allocation.contentSlotBudget,
      usedSlotCount: allocation.usedSlotCount,
      evictionCount: allocation.evictionCount,
      refusedRequestCount: allocation.refusedAcquireCount,
      atlasUploadCount: uploadCount,
      atlasByteLength: atlasByteLengthWithMipChain(),
    });
  }

  return {

    execute(frameContext) {
      const frameIndex = frameIndexOf(frameContext);
      internalFrameIndex = frameIndex + 1;

      const tier = (frameContext && frameContext.tier) || "medio";
      const budgetForTier = Number(contentSlotBudgetByTier[tier]);
      const appliedBudget = allocator.setContentSlotBudget(
        Number.isFinite(budgetForTier) ? budgetForTier : LIGHT_FUNCTION_CONTENT_SLOT_CAPACITY,
      );
      lastAppliedBudget = appliedBudget;

      const texture = ensureTexture();
      if (texture && mipChainIsStale) {
        refreshMipChain();
        mipChainIsStale = false;
      }
      atlasHandle.ready = !!texture;
      if (frameContext) frameContext.lightFunctionAtlas = atlasHandle;
      publishWhenChanged();
      return frameContext;
    },

    requestIesPreset(presetName, frameIndex = 0) {
      const key = LIGHT_FUNCTION_KEY_PREFIX.iesPreset + String(presetName);
      return requestSlot(key, frameIndex, (slot) => writeIesPresetIntoSlot(basePixels, slot, presetName));
    },

    requestIesProfile(profileKey, profile, frameIndex = 0) {
      const key = LIGHT_FUNCTION_KEY_PREFIX.iesProfile + String(profileKey);
      return requestSlot(key, frameIndex, (slot) => writeIesProfileIntoSlot(basePixels, slot, profile));
    },

    requestCookiePreset(presetName, frameIndex = 0) {
      const key = LIGHT_FUNCTION_KEY_PREFIX.cookiePreset + String(presetName);
      return requestSlot(key, frameIndex, (slot) => writeCookiePresetIntoSlot(basePixels, slot, presetName));
    },

    requestRectTexture(textureKey, image, frameIndex = 0) {
      const key = LIGHT_FUNCTION_KEY_PREFIX.rectTexture + String(textureKey);
      return requestSlot(key, frameIndex, (slot) => writeRectTextureIntoSlot(basePixels, slot, image));
    },

    releaseLightFunction(key) {
      return allocator.release(key);
    },

    handle: () => atlasHandle,
    atlasPixels: () => basePixels,
    glsl: () => buildLightFunctionAtlasGlsl(),


    inspect() {
      return {
        owner: LIGHT_FUNCTION_ATLAS_OWNER,
        ready: atlasHandle.ready,
        geometry: describeAtlasGeometry(),
        allocation: allocator.describe(),
        appliedContentSlotBudget: lastAppliedBudget,
        atlasUploadCount: uploadCount,
        refusedRequestCount,
        renderPassesPerFrame: 0,
      };
    },

    dispose() {
      if (atlasTexture) atlasTexture.dispose();
      atlasTexture = null;
      atlasHandle.texture = null;
      atlasHandle.uniforms = null;
      atlasHandle.ready = false;
    },
  };
}
