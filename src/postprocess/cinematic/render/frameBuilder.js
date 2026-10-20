export function createFrameBuilder(THREE) {
  const previousViewProjection = new THREE.Matrix4();
  const previousProjection = new THREE.Matrix4();
  let initialized = false;
  return Object.freeze({
    build({ camera, frameId, timeSeconds, deltaSeconds, width, height, generation, cameraCut = false }) {
      camera.updateMatrixWorld(true);
      const viewProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      if (!initialized || cameraCut) { previousViewProjection.copy(viewProjection); previousProjection.copy(camera.projectionMatrix); }
      const frame = {
        frameId,
        viewId: "cinematic-main",
        generation,
        timeSeconds,
        deltaSeconds,
        cameraCut: cameraCut || !initialized,
        preExposure: 1,
        previousPreExposure: 1,
        renderSize: { width, height },
        outputSize: { width, height },
        jitterPixels: [0, 0],
        previousJitterPixels: [0, 0],
        referenceMode: false,
        qualityTier: "diagnostic",
        matrices: {
          view: camera.matrixWorldInverse.toArray(),
          projection: camera.projectionMatrix.toArray(),
          viewProjection: viewProjection.toArray(),
          inverseViewProjection: viewProjection.clone().invert().toArray(),
          previousViewProjection: previousViewProjection.toArray(),
          previousProjection: previousProjection.toArray()
        },
        camera: { nearMeters: camera.near, farMeters: camera.far, focalLengthMm: camera.getFocalLength(), sensorWidthMm: camera.getFilmWidth(), sensorHeightMm: camera.getFilmHeight(), focusDistanceMeters: 6, apertureFNumber: 2.8, minApertureFNumber: 1.4, bladeCount: 7, shutterSeconds: 1 / 120, shutterAngleDegrees: 180, iso: 100, squeezeFactor: 1, overscan: 1 }
      };
      previousViewProjection.copy(viewProjection);
      previousProjection.copy(camera.projectionMatrix);
      initialized = true;
      return frame;
    },
    finalizeCamera(frame, camera) {
      camera.updateMatrixWorld(true);
      const viewProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      const matrices = { ...frame.matrices, view: camera.matrixWorldInverse.toArray(), projection: camera.projectionMatrix.toArray(), viewProjection: viewProjection.toArray(), inverseViewProjection: viewProjection.clone().invert().toArray() };
      if (frame.cameraCut) { matrices.previousViewProjection = [...matrices.viewProjection]; matrices.previousProjection = [...matrices.projection]; }
      previousViewProjection.copy(viewProjection);
      previousProjection.copy(camera.projectionMatrix);
      return { ...frame, matrices, camera: { ...frame.camera, nearMeters: camera.near, farMeters: camera.far, focalLengthMm: camera.getFocalLength(), sensorWidthMm: camera.getFilmWidth(), sensorHeightMm: camera.getFilmHeight() } };
    },
    reset() { initialized = false; }
  });
}
