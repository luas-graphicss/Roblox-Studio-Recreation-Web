import {
  DEFAULT_ATTENUATION_RADIUS,
  DEFAULT_SPHERE_SOURCE_RADIUS,
  MGL_INTENSITY_SOURCE,
  MGL_LIGHT_FLAG,
  MGL_LIGHT_SHAPE_INDEX,
  assignLightDescriptor,
  createLightDescriptor,
  validateLightDescriptor,
} from "./mlLightSceneDataCore.js";
import { createLightIdentityTable } from "./mlLightIdCore.js";
import {
  MGL_LIGHTS_PER_TEXTURE_ROW,
  MGL_LIGHT_TEXELS_PER_LIGHT,
  clearLightInArray,
  lightTextureSize,
  packLightIntoArray,
  paddedCapacityFor,
  requiredFloatCount,
  unpackLightFromArray,
} from "./mlLightPackingCore.js";

export const LIGHT_SCENE_DATA_OWNER = "ML-F4";


export const DEFAULT_LIGHT_CAPACITY = MGL_LIGHTS_PER_TEXTURE_ROW;

function isLocalLight(node) {


  return (
    node.isLight === true &&
    node.isAmbientLight !== true &&
    node.isHemisphereLight !== true &&
    node.isDirectionalLight !== true
  );
}


export function createLightSceneDataPass(dependencies) {
  const settings = dependencies && typeof dependencies === "object" ? dependencies : {};
  const THREE = settings.THREE || null;
  const bench = settings.bench || null;
  const lightRig = settings.lightRig || null;
  const telemetry = settings.telemetry || null;
  const candelaFor = typeof settings.candelaFor === "function" ? settings.candelaFor : null;

  const descriptorsBySlot = [];
  const collectedLights = [];
  const handledTubeGroups = new Set();
  const metadataByName = new Map();


  const lightInput = {
    shapeIndex: MGL_LIGHT_SHAPE_INDEX.sphere,
    positionView: [0, 0, 0],
    directionView: [0, 0, -1],
    color: [1, 1, 1],
    attenuationRadius: DEFAULT_ATTENUATION_RADIUS,
    intensityCandela: 0,
    intensitySource: MGL_INTENSITY_SOURCE.rendererIntensity,
    coneCosOuter: -1,
    coneCosInner: -1,
    sourceRadiusOrWidth: DEFAULT_SPHERE_SOURCE_RADIUS,
    sourceLengthOrHeight: 0,
    flags: 0,
    atlasSlot: -1,
    functionSlot: -1,
  };

  const temporaryPosition = THREE ? new THREE.Vector3() : null;
  const temporaryTarget = THREE ? new THREE.Vector3() : null;
  const temporaryDirection = THREE ? new THREE.Vector3() : null;
  const temporaryQuaternion = THREE ? new THREE.Quaternion() : null;

  const identity = createLightIdentityTable({
    onSlotReleased(slotIndex) {
      if (packedFloats) clearLightInArray(packedFloats, slotIndex);
    },
  });

  let packedFloats = null;
  let packedTexture = null;
  let capacity = 0;
  let frameCounter = 0;
  let lightCountAtLastMetadataRefresh = -1;
  let metadataRefreshedThisFrame = false;

  let capacityGrowthCount = 0;
  let metadataRefreshCount = 0;
  let refusedLightCount = 0;
  let lightsWithoutMetadataCount = 0;
  let attenuationFallbackCount = 0;
  let skippedNonLocalLightCount = 0;
  let photometricLightCount = 0;
  let lastPublishedSignature = "";


  const handle = {
    owner: LIGHT_SCENE_DATA_OWNER,
    ready: false,
    reason: "not executed yet",
    texture: null,
    floats: null,
    capacity: 0,
    lightCount: 0,
    textureWidth: 0,
    textureHeight: 0,
    texelsPerLight: MGL_LIGHT_TEXELS_PER_LIGHT,
    lightsPerRow: MGL_LIGHTS_PER_TEXTURE_ROW,
    frameIndex: 0,
    lightIdOfSlot(slotIndex) {
      return identity.lightIdOfSlot(slotIndex);
    },
    generationOfSlot(slotIndex) {
      return identity.generationOfSlot(slotIndex);
    },
    readLightAt(slotIndex) {
      return packedFloats ? unpackLightFromArray(packedFloats, slotIndex) : null;
    },
  };

  function resolveSceneRoot() {
    if (!bench) return null;
    return bench.scene || bench.sceneRoot || null;
  }

  function resolveCamera(frameContext) {
    if (frameContext && frameContext.camera) return frameContext.camera;
    return bench && bench.camera ? bench.camera : null;
  }

  function descriptorForSlot(slotIndex) {
    let descriptor = descriptorsBySlot[slotIndex];
    if (!descriptor) {
      descriptor = createLightDescriptor();
      descriptorsBySlot[slotIndex] = descriptor;
    }
    return descriptor;
  }

  function ensureCapacity(requiredLightCount) {
    if (requiredLightCount <= capacity && packedFloats) return false;
    const grownCapacity = paddedCapacityFor(Math.max(requiredLightCount, DEFAULT_LIGHT_CAPACITY));
    const size = lightTextureSize(grownCapacity);
    const grownFloats = new Float32Array(requiredFloatCount(grownCapacity));
    if (packedFloats) grownFloats.set(packedFloats);

    if (packedTexture && typeof packedTexture.dispose === "function") packedTexture.dispose();
    packedFloats = grownFloats;
    capacity = grownCapacity;
    packedTexture = THREE
      ? new THREE.DataTexture(packedFloats, size.width, size.height, THREE.RGBAFormat, THREE.FloatType)
      : null;
    if (packedTexture) {


      packedTexture.magFilter = THREE.NearestFilter;
      packedTexture.minFilter = THREE.NearestFilter;
      packedTexture.generateMipmaps = false;
      packedTexture.wrapS = THREE.ClampToEdgeWrapping;
      packedTexture.wrapT = THREE.ClampToEdgeWrapping;
      packedTexture.needsUpdate = true;
    }

    handle.texture = packedTexture;
    handle.floats = packedFloats;
    handle.capacity = capacity;
    handle.textureWidth = size.width;
    handle.textureHeight = size.height;
    capacityGrowthCount++;
    return true;
  }

  function collectLight(node) {
    if (node.isGroup === true) {
      const groupMetadata = metadataByName.get(node.name);
      if (groupMetadata && groupMetadata.shape === "tube") {
        handledTubeGroups.add(node);
        collectedLights.push(node);
      }
      return;
    }
    if (node.isLight !== true) return;
    if (!isLocalLight(node)) {
      skippedNonLocalLightCount++;
      return;
    }

    if (node.parent && handledTubeGroups.has(node.parent)) return;
    collectedLights.push(node);
  }

  function collectLights(sceneRoot) {
    collectedLights.length = 0;
    handledTubeGroups.clear();
    skippedNonLocalLightCount = 0;
    sceneRoot.traverse(collectLight);
  }


  function refreshMetadata() {
    metadataByName.clear();
    if (lightRig && typeof lightRig.list === "function") {
      const entries = lightRig.list();
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        metadataByName.set(entry.name, entry);
      }
    }
    metadataRefreshCount++;
    metadataRefreshedThisFrame = true;
  }

  function metadataFor(object) {
    const entry = metadataByName.get(object.name);
    if (entry) return entry;
    lightsWithoutMetadataCount++;
    return null;
  }

  function readSourceGeometry(light, metadata, shapeIndex) {
    if (shapeIndex === MGL_LIGHT_SHAPE_INDEX.rect) {
      lightInput.sourceRadiusOrWidth = light.width > 0 ? light.width : 1;
      lightInput.sourceLengthOrHeight = light.height > 0 ? light.height : 1;
      return;
    }
    const descriptor = metadata && metadata.descriptor ? metadata.descriptor : null;
    const sourceRadius =
      descriptor && descriptor.sourceRadius > 0 ? descriptor.sourceRadius : DEFAULT_SPHERE_SOURCE_RADIUS;
    lightInput.sourceRadiusOrWidth = sourceRadius;
    if (shapeIndex === MGL_LIGHT_SHAPE_INDEX.tube && descriptor && descriptor.start && descriptor.end) {
      const deltaX = descriptor.end[0] - descriptor.start[0];
      const deltaY = descriptor.end[1] - descriptor.start[1];
      const deltaZ = descriptor.end[2] - descriptor.start[2];
      lightInput.sourceLengthOrHeight = Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ);
      return;
    }
    lightInput.sourceLengthOrHeight = 0;
  }

  function readEmissionDirection(object, camera) {
    if (object.isSpotLight === true && object.target) {
      object.target.getWorldPosition(temporaryTarget);
      object.getWorldPosition(temporaryDirection);
      temporaryDirection.subVectors(temporaryTarget, temporaryDirection);
    } else {

      object.getWorldQuaternion(temporaryQuaternion);
      temporaryDirection.set(0, 0, -1).applyQuaternion(temporaryQuaternion);
    }
    temporaryDirection.transformDirection(camera.matrixWorldInverse);
    lightInput.directionView[0] = temporaryDirection.x;
    lightInput.directionView[1] = temporaryDirection.y;
    lightInput.directionView[2] = temporaryDirection.z;
  }

  function readIntensity(object, metadata) {
    if (candelaFor) {
      const candela = candelaFor(object, metadata);
      if (Number.isFinite(candela)) {
        lightInput.intensityCandela = candela;
        lightInput.intensitySource = MGL_INTENSITY_SOURCE.photometricCandela;
        photometricLightCount++;
        return;
      }
    }
    lightInput.intensitySource = MGL_INTENSITY_SOURCE.rendererIntensity;
    if (object.isGroup === true) {
      let total = 0;
      for (let index = 0; index < object.children.length; index++) {
        const child = object.children[index];
        if (child.isLight === true) total += child.intensity;
      }
      lightInput.intensityCandela = total;
      return;
    }
    lightInput.intensityCandela = object.intensity;
  }

  function readColor(object) {
    const colorSource =
      object.color ||
      (object.isGroup === true && object.children.length > 0 ? object.children[0].color : null);
    lightInput.color[0] = colorSource ? colorSource.r : 1;
    lightInput.color[1] = colorSource ? colorSource.g : 1;
    lightInput.color[2] = colorSource ? colorSource.b : 1;
  }

  function shapeIndexOf(object, metadata) {
    if (object.isRectAreaLight === true) return MGL_LIGHT_SHAPE_INDEX.rect;
    if (metadata && metadata.shape === "tube") return MGL_LIGHT_SHAPE_INDEX.tube;
    return MGL_LIGHT_SHAPE_INDEX.sphere;
  }

  function fillInputFrom(object, metadata, camera) {
    const shapeIndex = shapeIndexOf(object, metadata);
    lightInput.shapeIndex = shapeIndex;

    object.getWorldPosition(temporaryPosition);
    temporaryPosition.applyMatrix4(camera.matrixWorldInverse);
    lightInput.positionView[0] = temporaryPosition.x;
    lightInput.positionView[1] = temporaryPosition.y;
    lightInput.positionView[2] = temporaryPosition.z;

    readEmissionDirection(object, camera);
    readColor(object);
    readIntensity(object, metadata);
    readSourceGeometry(object, metadata, shapeIndex);

    const distance = object.distance;
    if (distance > 0) {
      lightInput.attenuationRadius = distance;
    } else {
      lightInput.attenuationRadius = DEFAULT_ATTENUATION_RADIUS;
      attenuationFallbackCount++;
    }

    const isSpot = object.isSpotLight === true;
    if (isSpot) {
      const outerAngle = object.angle;
      const penumbra = object.penumbra > 0 ? object.penumbra : 0;
      lightInput.coneCosOuter = Math.cos(outerAngle);
      lightInput.coneCosInner = Math.cos(outerAngle * (1 - penumbra));
    } else {
      lightInput.coneCosOuter = -1;
      lightInput.coneCosInner = -1;
    }

    let flags = 0;
    if (object.castShadow === true) flags |= MGL_LIGHT_FLAG.castsShadow;
    if (isSpot) flags |= MGL_LIGHT_FLAG.isSpot;
    if (metadata && metadata.descriptor && metadata.descriptor.textured === true) {
      flags |= MGL_LIGHT_FLAG.texturedSource;
    }
    lightInput.flags = flags;


    lightInput.atlasSlot = -1;
    lightInput.functionSlot = -1;
  }

  function publishTelemetry() {
    if (!telemetry || typeof telemetry.phase !== "function") return;
    const signature = [
      handle.ready ? "ready" : "idle",
      handle.lightCount,
      handle.capacity,
      capacityGrowthCount,
      refusedLightCount,
      photometricLightCount > 0 ? "photometric" : "renderer",
    ].join("|");
    if (signature === lastPublishedSignature) return;
    lastPublishedSignature = signature;
    telemetry.phase(LIGHT_SCENE_DATA_OWNER, {
      pass: "lightSceneData",
      ready: handle.ready,
      reason: handle.reason,
      lights: handle.lightCount,
      capacity: handle.capacity,
      texture: handle.textureWidth + "x" + handle.textureHeight + " rgba32f",
      texelsPerLight: MGL_LIGHT_TEXELS_PER_LIGHT,
      capacityGrowthCount,
      metadataRefreshCount,
      refusedLights: refusedLightCount,
      lightsWithoutMetadata: lightsWithoutMetadataCount,
      attenuationFallbacks: attenuationFallbackCount,
      intensitySource:
        photometricLightCount > 0
          ? MGL_INTENSITY_SOURCE.photometricCandela
          : MGL_INTENSITY_SOURCE.rendererIntensity,
      identity: identity.stats(),
    });
  }

  function reportNotReady(reason) {
    handle.ready = false;
    handle.reason = reason;
    publishTelemetry();
    return handle;
  }

  function execute(frameContext) {
    const sceneRoot = resolveSceneRoot();
    const camera = resolveCamera(frameContext);
    frameCounter++;
    handle.frameIndex = frameCounter;

    if (!THREE) return reportNotReady("three.js was not provided to the pass");
    if (!sceneRoot) return reportNotReady("the bench exposed no scene");
    if (!camera) return reportNotReady("the frame carried no camera: view space positions are impossible");


    metadataRefreshedThisFrame = false;
    lightsWithoutMetadataCount = 0;
    attenuationFallbackCount = 0;
    photometricLightCount = 0;

    collectLights(sceneRoot);
    if (collectedLights.length !== lightCountAtLastMetadataRefresh) {
      refreshMetadata();


      collectLights(sceneRoot);
      lightCountAtLastMetadataRefresh = collectedLights.length;
    }

    ensureCapacity(collectedLights.length);
    identity.beginFrame(frameCounter);

    let packedLightCount = 0;
    let highestSlot = -1;
    for (let index = 0; index < collectedLights.length; index++) {
      const object = collectedLights[index];
      const metadata = metadataFor(object);
      const entry = identity.acquire(object.uuid);
      if (entry.slotIndex >= capacity) ensureCapacity(entry.slotIndex + 1);

      const descriptor = descriptorForSlot(entry.slotIndex);
      fillInputFrom(object, metadata, camera);
      assignLightDescriptor(descriptor, lightInput);
      descriptor.lightId = entry.lightId;
      descriptor.slotIndex = entry.slotIndex;
      descriptor.generation = entry.generation;


      if (entry.isNew || metadataRefreshedThisFrame) {
        const validation = validateLightDescriptor(descriptor);
        if (!validation.valid) {
          refusedLightCount++;
          clearLightInArray(packedFloats, entry.slotIndex);
          if (telemetry && typeof telemetry.error === "function") {
            telemetry.error(
              'light "' + object.name + '" refused: ' + validation.problems.join("; "),
              LIGHT_SCENE_DATA_OWNER,
            );
          }
          continue;
        }
      }

      packLightIntoArray(packedFloats, entry.slotIndex, descriptor);
      if (entry.slotIndex > highestSlot) highestSlot = entry.slotIndex;
      packedLightCount++;
    }


    if (identity.activeCount() > collectedLights.length) identity.releaseUnseen();

    handle.ready = true;
    handle.reason = "";
    handle.lightCount = packedLightCount;
    handle.highestSlot = highestSlot;
    if (packedTexture) packedTexture.needsUpdate = true;

    publishTelemetry();
    if (frameContext) frameContext.lightSceneData = handle;
    return handle;
  }

  return {
    owner: LIGHT_SCENE_DATA_OWNER,
    execute(frameContext) {
      execute(frameContext);
      return frameContext;
    },
    handle() {
      return handle;
    },
    texture() {
      return packedTexture;
    },

    inspect() {
      return {
        owner: LIGHT_SCENE_DATA_OWNER,
        ready: handle.ready,
        reason: handle.reason,
        lightCount: handle.lightCount,
        capacity,
        textureWidth: handle.textureWidth,
        textureHeight: handle.textureHeight,
        texelsPerLight: MGL_LIGHT_TEXELS_PER_LIGHT,
        floatCount: packedFloats ? packedFloats.length : 0,
        capacityGrowthCount,
        metadataRefreshCount,
        refusedLightCount,
        lightsWithoutMetadataCount,
        attenuationFallbackCount,
        skippedNonLocalLightCount,
        photometricLightCount,
        intensitySource:
          photometricLightCount > 0
            ? MGL_INTENSITY_SOURCE.photometricCandela
            : MGL_INTENSITY_SOURCE.rendererIntensity,
        identity: identity.stats(),
      };
    },
    readLightAt(slotIndex) {
      return handle.readLightAt(slotIndex);
    },
    dispose() {
      if (packedTexture && typeof packedTexture.dispose === "function") packedTexture.dispose();
      packedTexture = null;
      packedFloats = null;
      capacity = 0;
      descriptorsBySlot.length = 0;
      collectedLights.length = 0;
      handledTubeGroups.clear();
      metadataByName.clear();
      identity.clear();
      handle.ready = false;
      handle.reason = "disposed";
      handle.texture = null;
      handle.floats = null;
      handle.capacity = 0;
      handle.lightCount = 0;
    },
  };
}
