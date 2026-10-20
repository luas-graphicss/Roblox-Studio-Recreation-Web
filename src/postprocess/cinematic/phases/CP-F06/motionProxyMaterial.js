import { buildMotionShaders } from "./motionShaders.js";
import { MOTION_LIMITS } from "./motionContract.js";

export function createMotionProxyMaterial(THREE, source, policy, fallback, particleRange) {
  return new THREE.ShaderMaterial({
    vertexShader: source.vertex,
    fragmentShader: source.fragment,
    blending: THREE.NoBlending,
    depthTest: true,
    depthWrite: true,
    toneMapped: false,
    side: policy.side,
    visible: policy.included,
    uniforms: {
      motionCurrentViewProjection: { value: new THREE.Matrix4() },
      motionPreviousViewProjection: { value: new THREE.Matrix4() },
      motionCurrentView: { value: new THREE.Matrix4() },
      motionPreviousView: { value: new THREE.Matrix4() },
      motionJitter: { value: new THREE.Vector2() },
      previousJitter: { value: new THREE.Vector2() },
      motionSize: { value: new THREE.Vector2() },
      particleSizeRange: { value: new THREE.Vector2(particleRange[0], particleRange[1]) },
      pointUvTransform: { value: new THREE.Matrix3() },
      outputMode: { value: 0 },
      historyValid: { value: 0 },
      previousVisibilityAvailable: { value: 0 },
      isParticle: { value: 0 },
      particleSize: { value: 1 },
      previousParticleSize: { value: 1 },
      attenuateParticle: { value: 0 },
      attenuatePreviousParticle: { value: 0 },
      perspectiveCamera: { value: 1 },
      opacity: { value: 1 },
      alphaThreshold: { value: 0 },
      translucent: { value: 0 },
      colorMap: { value: fallback },
      alphaMap: { value: fallback },
      hasMap: { value: 0 },
      hasAlphaMap: { value: 0 },
      surfaceIdentity: { value: new THREE.Vector3() },
      previousIdentity: { value: fallback },
      previousDepth: { value: fallback },
      sceneDepth: { value: fallback },
      depthTolerance: { value: MOTION_LIMITS.depthQuantizationTolerance },
      globalPlanes: { value: [] },
      localPlanes: { value: [] },
      localIntersection: { value: 0 },
    },
  });
}

export function motionPlanesFor(renderer, policy) {
  return {
    global: renderer.clippingPlanes ?? [],
    local: renderer.localClippingEnabled ? (policy.material?.clippingPlanes ?? []) : [],
  };
}

export function createMotionMaterials(THREE, renderer, snapshot, fallback, particleRange) {
  return snapshot.materials.map((policy, index) => {
    const planes = motionPlanesFor(renderer, policy);
    const source = buildMotionShaders(index, planes.global.length, planes.local.length);
    return createMotionProxyMaterial(THREE, source, policy, fallback, particleRange);
  });
}
