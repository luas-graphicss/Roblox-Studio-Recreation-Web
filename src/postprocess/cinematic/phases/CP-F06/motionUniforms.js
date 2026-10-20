import { encodeSurfaceIdentity } from "./motionMaterialPolicy.js";
import { motionPlanesFor } from "./motionProxyMaterial.js";

export function updateMotionUniforms(
  THREE,
  renderer,
  material,
  policy,
  snapshot,
  cameraState,
  previous,
  camera,
  fallback,
  sceneDepth,
) {
  const uniforms = material.uniforms;
  material.visible = policy.included;
  material.side = policy.side;
  uniforms.motionCurrentViewProjection.value.fromArray(cameraState.viewProjection);
  uniforms.motionPreviousViewProjection.value.fromArray(
    previous?.camera.viewProjection ?? cameraState.viewProjection,
  );
  uniforms.motionCurrentView.value.fromArray(cameraState.view);
  uniforms.motionPreviousView.value.fromArray(previous?.camera.view ?? cameraState.view);
  uniforms.motionSize.value.set(cameraState.width, cameraState.height);
  uniforms.motionJitter.value.fromArray(cameraState.jitter);
  uniforms.previousJitter.value.fromArray(previous?.camera.jitter ?? cameraState.jitter);
  uniforms.historyValid.value = snapshot.historyValid ? 1 : 0;
  uniforms.previousVisibilityAvailable.value = previous ? 1 : 0;
  uniforms.previousIdentity.value = previous?.targets.identity.texture ?? fallback;
  uniforms.previousDepth.value = previous?.targets.identity.depthTexture ?? fallback;
  uniforms.sceneDepth.value = sceneDepth.texture;
  uniforms.surfaceIdentity.value.fromArray(encodeSurfaceIdentity(snapshot.surfaceId));
  uniforms.isParticle.value = snapshot.particle ? 1 : 0;
  uniforms.particleSize.value = snapshot.pointSize ?? 1;
  uniforms.previousParticleSize.value = snapshot.previousPointSize ?? 1;
  uniforms.attenuateParticle.value = snapshot.pointSizeAttenuation ? 1 : 0;
  uniforms.attenuatePreviousParticle.value = snapshot.previousPointSizeAttenuation ? 1 : 0;
  uniforms.perspectiveCamera.value = camera.isPerspectiveCamera ? 1 : 0;
  uniforms.opacity.value = policy.opacity ?? 0;
  uniforms.alphaThreshold.value = policy.alphaThreshold ?? 0;
  uniforms.translucent.value = policy.translucent ? 1 : 0;
  uniforms.hasMap.value = policy.map ? 1 : 0;
  uniforms.hasAlphaMap.value = policy.alphaMap ? 1 : 0;
  uniforms.colorMap.value = policy.map ?? fallback;
  uniforms.alphaMap.value = policy.alphaMap ?? fallback;
  const pointTexture = policy.alphaMap ?? policy.map;
  if (pointTexture?.matrixAutoUpdate) pointTexture.updateMatrix();
  if (pointTexture) uniforms.pointUvTransform.value.copy(pointTexture.matrix);
  else uniforms.pointUvTransform.value.identity();
  const planes = motionPlanesFor(renderer, policy);
  uniforms.globalPlanes.value = planes.global.map(
    (plane) => new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant),
  );
  uniforms.localPlanes.value = planes.local.map(
    (plane) => new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant),
  );
  uniforms.localIntersection.value = policy.material?.clipIntersection ? 1 : 0;
}
