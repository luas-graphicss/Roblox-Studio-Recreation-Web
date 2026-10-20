import { createDeferredAttachmentReadback } from "./mlDeferredAttachmentReadback.js";

export const SURFACE_ATTACHMENT_NAMES = Object.freeze([
  "sceneDepth",
  "sceneNormal",
  "sceneAlbedo",
  "sceneVelocity",
]);

export const NEUTRAL_ENCODED_VELOCITY = Object.freeze([0.5, 0.5]);

function clampToUnit(value) {
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber)) return 0;
  if (asNumber > 1) return 1;
  if (asNumber > 0) return asNumber;
  return 0;
}


export function createGBufferSurfaceReader(dependencies) {
  const settings = dependencies || {};
  const readAttachmentPixels =
    typeof settings.readAttachmentPixels === "function" ? settings.readAttachmentPixels : null;

  const attachmentReadback = createDeferredAttachmentReadback({
    readAttachmentPixels,
    attachmentNames: SURFACE_ATTACHMENT_NAMES,
  });


  let depthPixels = null;
  let normalPixels = null;
  let albedoPixels = null;
  let albedoWasRequested = false;
  let velocityPixels = null;
  let velocityWasRequested = false;

  const frame = {
    attachmentWidth: 0,
    attachmentHeight: 0,
    tangentOfHalfVerticalFieldOfView: 1,
    aspectRatio: 1,
    worldToViewRotation: null,


    missingAttachments: [],

    lattice: null,
  };


  const reusedSurface = {
    coverage: 0,
    roughness: 1,
    metalness: 0,
    linearViewDepth: 0,
    positionView: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 0, z: 1 },
    viewDirection: { x: 0, y: 0, z: 1 },
    albedo: { r: 0, g: 0, b: 0 },
  };
  const reusedVelocity = { encodedVelocity: [0.5, 0.5], velocityIsValid: false };


  let lastDecodedPixelOffset = -1;


  function albedoPixelsOfThisFrame() {
    if (!albedoWasRequested) {
      albedoWasRequested = true;
      albedoPixels = attachmentReadback.pixelsFor("sceneAlbedo");
    }
    return albedoPixels;
  }

  function velocityPixelsOfThisFrame() {
    if (!velocityWasRequested) {
      velocityWasRequested = true;
      velocityPixels = attachmentReadback.pixelsFor("sceneVelocity");
    }
    return velocityPixels;
  }


  function beginFrame(request) {
    const input = request || {};
    const requestedWidth = Math.max(0, Math.floor(Number(input.width) || 0));
    const requestedHeight = Math.max(0, Math.floor(Number(input.height) || 0));
    const rotation = input.worldToViewRotation;

    frame.tangentOfHalfVerticalFieldOfView =
      Number(input.tangentOfHalfVerticalFieldOfView) || 1;
    frame.aspectRatio = Number(input.aspectRatio) || 1;
    frame.worldToViewRotation =
      Array.isArray(rotation) && rotation.length === 9 ? rotation : null;
    frame.missingAttachments = [];
    frame.attachmentWidth = 0;
    frame.attachmentHeight = 0;
    frame.lattice =
      input.lattice && typeof input.lattice.texelOffsetForFullPixel === "function"
        ? input.lattice
        : null;


    lastDecodedPixelOffset = -1;
    depthPixels = null;
    normalPixels = null;
    albedoPixels = null;
    albedoWasRequested = false;
    velocityPixels = null;
    velocityWasRequested = false;

    const forbiddenAttachments = [];
    if (input.readVelocity === false) forbiddenAttachments.push("sceneVelocity");
    if (input.readAlbedo === false) forbiddenAttachments.push("sceneAlbedo");
    const canRead = attachmentReadback.beginFrame({
      width: requestedWidth,
      height: requestedHeight,
      skipAttachmentNames: forbiddenAttachments,


      gather: gatherRequestFor(frame.lattice),
    });
    if (!canRead) return describeFrame(false);

    depthPixels = attachmentReadback.pixelsFor("sceneDepth");
    normalPixels = attachmentReadback.pixelsFor("sceneNormal");


    const readbackReport = attachmentReadback.describeFrame();
    frame.attachmentWidth = readbackReport.width;
    frame.attachmentHeight = readbackReport.height;

    if (!frame.worldToViewRotation) frame.missingAttachments.push("worldToViewRotation");
    const ready = !!(
      depthPixels &&
      normalPixels &&
      frame.worldToViewRotation &&
      frame.attachmentWidth >= 1 &&
      frame.attachmentHeight >= 1
    );
    return describeFrame(ready);
  }

  function describeFrame(ready) {
    const readbackReport = attachmentReadback.describeFrame();
    return {
      ready: !!ready,
      width: frame.attachmentWidth,
      height: frame.attachmentHeight,


      readbackCount: readbackReport.readCount,
      deferredAttachments: readbackReport.deferredAttachmentNames,
      forbiddenAttachments: readbackReport.forbiddenAttachmentNames,
      missingAttachments: readbackReport.missingAttachmentNames.concat(frame.missingAttachments),
      readsGBufferBackToTheCpu: true,

      gathered: !!frame.lattice,
      gatheredTexelCount: frame.lattice ? frame.lattice.columnCount() * frame.lattice.rowCount() : 0,
      fullTexelCount: frame.attachmentWidth * frame.attachmentHeight,


      offLatticeRequestCount: frame.lattice ? frame.lattice.offLatticeRequestCount() : 0,
      mustStayZero: "offLatticeRequestCount",
    };
  }


  function gatherRequestFor(lattice) {
    if (!lattice || !lattice.isBuilt()) return null;
    const sourceColumns = lattice.sourceColumns();
    const sourceRows = lattice.sourceRows();
    if (!sourceColumns || !sourceRows) return null;
    return {
      sourceColumns,
      columnCount: lattice.columnCount(),
      sourceRows,
      rowCount: lattice.rowCount(),
      latticeRevision: lattice.revision(),
    };
  }


  function offsetOfFullPixel(fullX, fullY) {
    const width = frame.attachmentWidth;
    const height = frame.attachmentHeight;
    if (!(width >= 1) || !(height >= 1)) return -1;
    if (!(fullX >= 0) || !(fullY >= 0) || fullX >= width || fullY >= height) return -1;


    if (frame.lattice) return frame.lattice.texelOffsetForFullPixel(fullX, fullY);
    return ((height - 1 - fullY) * width + fullX) * 4;
  }

  function rotateWorldNormalIntoView(worldX, worldY, worldZ, target) {
    const rotation = frame.worldToViewRotation;
    target.x = rotation[0] * worldX + rotation[1] * worldY + rotation[2] * worldZ;
    target.y = rotation[3] * worldX + rotation[4] * worldY + rotation[5] * worldZ;
    target.z = rotation[6] * worldX + rotation[7] * worldY + rotation[8] * worldZ;
    const length = Math.sqrt(target.x * target.x + target.y * target.y + target.z * target.z);
    if (!(length > 1e-8)) {
      target.x = 0;
      target.y = 0;
      target.z = 1;
      return;
    }
    target.x /= length;
    target.y /= length;
    target.z /= length;
  }


  function readSurfaceAtFullPixel(fullX, fullY) {
    const pixelX = Math.floor(Number(fullX));
    const pixelY = Math.floor(Number(fullY));
    const offset = offsetOfFullPixel(pixelX, pixelY);

    if (offset === -1 || !depthPixels || !normalPixels || !frame.worldToViewRotation) {
      lastDecodedPixelOffset = -1;
      reusedSurface.coverage = 0;
      reusedSurface.linearViewDepth = 0;
      return reusedSurface;
    }


    if (offset === lastDecodedPixelOffset) return reusedSurface;
    lastDecodedPixelOffset = offset;

    reusedSurface.coverage = clampToUnit(depthPixels[offset + 3]);
    const linearViewDepth = Number(depthPixels[offset]);
    reusedSurface.linearViewDepth = Number.isFinite(linearViewDepth) ? linearViewDepth : 0;
    reusedSurface.roughness = clampToUnit(normalPixels[offset + 3]);


    const albedoOfThisFrame = albedoPixelsOfThisFrame();
    if (albedoOfThisFrame) {
      reusedSurface.albedo.r = Number(albedoOfThisFrame[offset]) || 0;
      reusedSurface.albedo.g = Number(albedoOfThisFrame[offset + 1]) || 0;
      reusedSurface.albedo.b = Number(albedoOfThisFrame[offset + 2]) || 0;
      reusedSurface.metalness = clampToUnit(albedoOfThisFrame[offset + 3]);
    }

    rotateWorldNormalIntoView(
      (Number(normalPixels[offset]) || 0) * 2 - 1,
      (Number(normalPixels[offset + 1]) || 0) * 2 - 1,
      (Number(normalPixels[offset + 2]) || 0) * 2 - 1,
      reusedSurface.normal,
    );


    const normalizedDeviceX = ((pixelX + 0.5) / frame.attachmentWidth) * 2 - 1;
    const normalizedDeviceY = 1 - ((pixelY + 0.5) / frame.attachmentHeight) * 2;
    const depth = reusedSurface.linearViewDepth;
    reusedSurface.positionView.x =
      normalizedDeviceX * frame.tangentOfHalfVerticalFieldOfView * frame.aspectRatio * depth;
    reusedSurface.positionView.y =
      normalizedDeviceY * frame.tangentOfHalfVerticalFieldOfView * depth;
    reusedSurface.positionView.z = -depth;

    const distanceToEye = Math.sqrt(
      reusedSurface.positionView.x * reusedSurface.positionView.x +
        reusedSurface.positionView.y * reusedSurface.positionView.y +
        reusedSurface.positionView.z * reusedSurface.positionView.z,
    );
    if (distanceToEye > 1e-8) {
      reusedSurface.viewDirection.x = -reusedSurface.positionView.x / distanceToEye;
      reusedSurface.viewDirection.y = -reusedSurface.positionView.y / distanceToEye;
      reusedSurface.viewDirection.z = -reusedSurface.positionView.z / distanceToEye;
    } else {
      reusedSurface.viewDirection.x = 0;
      reusedSurface.viewDirection.y = 0;
      reusedSurface.viewDirection.z = 1;
    }

    return reusedSurface;
  }


  function readVelocityAtFullPixel(fullX, fullY) {
    const offset = offsetOfFullPixel(Math.floor(Number(fullX)), Math.floor(Number(fullY)));


    const velocityOfThisFrame = offset === -1 ? null : velocityPixelsOfThisFrame();
    if (offset === -1 || !velocityOfThisFrame) {
      reusedVelocity.encodedVelocity[0] = NEUTRAL_ENCODED_VELOCITY[0];
      reusedVelocity.encodedVelocity[1] = NEUTRAL_ENCODED_VELOCITY[1];
      reusedVelocity.velocityIsValid = false;
      return reusedVelocity;
    }
    reusedVelocity.encodedVelocity[0] = Number(velocityOfThisFrame[offset]) || 0;
    reusedVelocity.encodedVelocity[1] = Number(velocityOfThisFrame[offset + 1]) || 0;
    reusedVelocity.velocityIsValid = clampToUnit(velocityOfThisFrame[offset + 3]) > 0.5;
    return reusedVelocity;
  }

  return {
    beginFrame,
    readSurfaceAtFullPixel,
    readVelocityAtFullPixel,
    describe: () => describeFrame(!!depthPixels),
  };
}
