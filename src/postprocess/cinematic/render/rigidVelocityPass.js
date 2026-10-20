const VERTEX = `
uniform mat4 previousModelMatrix;
uniform mat4 currentViewProjection;
uniform mat4 previousViewProjection;
varying vec4 currentClip;
varying vec4 previousClip;
void main() {
  currentClip = currentViewProjection * modelMatrix * vec4(position, 1.0);
  previousClip = previousViewProjection * previousModelMatrix * vec4(position, 1.0);
  gl_Position = currentClip;
}
`;
const FRAGMENT = `
uniform float historyValid;
varying vec4 currentClip;
varying vec4 previousClip;
void main() {
  if (currentClip.w <= 0.0 || previousClip.w <= 0.0 || historyValid < 0.5) {
    gl_FragColor = vec4(0.0);
    return;
  }
  vec2 currentUv = currentClip.xy / currentClip.w * 0.5 + 0.5;
  vec2 previousUv = previousClip.xy / previousClip.w * 0.5 + 0.5;
  gl_FragColor = vec4(currentUv - previousUv, 0.0, 1.0);
}
`;

export function createRigidVelocityPass(THREE) {
  const records = new Map();
  function clear() { for (const record of records.values()) record.material.dispose(); records.clear(); }
  return Object.freeze({
    render(renderer, scene, camera, target, frame) {
      const saved = [];
      const previousBackground = scene.background;
      const previousOverride = scene.overrideMaterial;
      scene.updateMatrixWorld(true);
      try {
        scene.background = null;
        scene.overrideMaterial = null;
        scene.traverse((object) => {
          if (!object.isMesh) return;
          let record = records.get(object.uuid);
          if (!record) {
            const material = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: { previousModelMatrix: { value: object.matrixWorld.clone() }, currentViewProjection: { value: new THREE.Matrix4() }, previousViewProjection: { value: new THREE.Matrix4() }, historyValid: { value: 0 } }, blending: THREE.NoBlending, toneMapped: false, side: THREE.DoubleSide });
            record = { material, previousMatrix: object.matrixWorld.clone(), valid: false };
            records.set(object.uuid, record);
          }
          saved.push({ object, material: object.material, record });
          record.material.uniforms.previousModelMatrix.value.copy(record.previousMatrix);
          record.material.uniforms.currentViewProjection.value.fromArray(frame.matrices.viewProjection);
          record.material.uniforms.previousViewProjection.value.fromArray(frame.matrices.previousViewProjection);
          record.material.uniforms.historyValid.value = record.valid && !frame.cameraCut ? 1 : 0;
          object.material = record.material;
        });
        renderer.setRenderTarget(target);
        renderer.setClearColor(0, 0);
        renderer.clear();
        renderer.render(scene, camera);
      } finally {
        for (const { object, material, record } of saved) {
          object.material = material;
          record.previousMatrix.copy(object.matrixWorld);
          record.valid = true;
        }
        scene.background = previousBackground;
        scene.overrideMaterial = previousOverride;
      }
    },
    reset: clear,
    dispose: clear
  });
}
