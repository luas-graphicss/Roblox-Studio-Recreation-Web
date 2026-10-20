export function captureProjectionElements(base, request) {
  if (!base || base.length !== 16 || !Array.from(base).every(Number.isFinite)) throw new Error("Capture requires a finite unjittered projection matrix");
  const { tile, fullSize, options, jitterPixels } = request;
  if (!tile || !fullSize || !options || !Array.isArray(jitterPixels) || jitterPixels.length !== 2 || !jitterPixels.every((value) => Number.isFinite(value) && Math.abs(value) <= 0.5)) throw new Error("Capture projection requires an explicit tile and jitter");
  const result = Array.from(base);
  const scaleX = options.width / tile.width;
  const scaleY = options.height / tile.height;
  const offsetX = (fullSize.width - 2 * tile.origin[0] - tile.width - 2 * jitterPixels[0]) / tile.width;
  const offsetY = (fullSize.height - 2 * tile.origin[1] - tile.height - 2 * jitterPixels[1]) / tile.height;
  for (let column = 0; column < 4; column += 1) {
    result[column * 4] = scaleX * base[column * 4] + offsetX * base[column * 4 + 3];
    result[column * 4 + 1] = scaleY * base[column * 4 + 1] + offsetY * base[column * 4 + 3];
  }
  return Object.freeze(result);
}

export function applyCaptureProjection(camera, unjitteredProjection, request) {
  if (!camera?.projectionMatrix?.fromArray || !camera.projectionMatrixInverse?.copy) throw new Error("Capture camera must expose projection and inverse matrices");
  camera.projectionMatrix.fromArray(captureProjectionElements(unjitteredProjection.elements ?? unjitteredProjection, request));
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
