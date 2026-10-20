export function createVsmFrameScratch(THREE, probeWindowSizeInTexels) {
  const windowSize = Math.max(1, Math.floor(Number(probeWindowSizeInTexels) || 1));
  return {
    cameraWorldPosition: new THREE.Vector3(),
    lightWorldPosition: new THREE.Vector3(),
    targetWorldPosition: new THREE.Vector3(),
    lightDirection: new THREE.Vector3(),
    viewProjectionMatrix: new THREE.Matrix4(),
    preservedViewport: new THREE.Vector4(),
    preservedScissor: new THREE.Vector4(),
    preservedClearColor: new THREE.Color(),
    probeWindowPixels: new Uint8Array(windowSize * windowSize * 4),
  };
}
