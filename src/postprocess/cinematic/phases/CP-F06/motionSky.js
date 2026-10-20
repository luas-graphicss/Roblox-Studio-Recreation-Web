import { MOTION_SKY_FRAGMENT } from "./motionSkyShader.js";

export function createMotionSky(adapter) {
  const { THREE } = adapter;
  const material = adapter.createMaterial(MOTION_SKY_FRAGMENT, {
    inverseCurrentViewProjection: { value: new THREE.Matrix4() },
    previousViewProjection: { value: new THREE.Matrix4() },
    cameraPositionWorld: { value: new THREE.Vector3() },
    renderSize: { value: new THREE.Vector2() },
    currentJitter: { value: new THREE.Vector2() },
    previousJitter: { value: new THREE.Vector2() },
    historyValid: { value: 0 },
    outputMode: { value: 0 },
    previousIdentity: { value: null },
    sceneDepth: { value: null },
  });
  const inverseView = new THREE.Matrix4();
  return Object.freeze({
    draw(target, cameraState, previous, fallbackTexture, outputMode, sceneDepth) {
      const uniforms = material.uniforms;
      uniforms.inverseCurrentViewProjection.value.fromArray(cameraState.viewProjection).invert();
      uniforms.previousViewProjection.value.fromArray(
        previous?.camera.viewProjection ?? cameraState.viewProjection,
      );
      uniforms.cameraPositionWorld.value.setFromMatrixPosition(
        inverseView.fromArray(cameraState.view).invert(),
      );
      uniforms.renderSize.value.set(cameraState.width, cameraState.height);
      uniforms.currentJitter.value.fromArray(cameraState.jitter);
      uniforms.previousJitter.value.fromArray(previous?.camera.jitter ?? cameraState.jitter);
      uniforms.historyValid.value = previous?.sky === "infinite" ? 1 : 0;
      uniforms.previousIdentity.value = previous?.targets.identity.texture ?? fallbackTexture;
      uniforms.sceneDepth.value = sceneDepth.texture;
      uniforms.outputMode.value = outputMode;
      adapter.draw(material, target);
    },
    dispose() {
      material.dispose();
    },
  });
}
