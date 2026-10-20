export const SUBSTRATE_SCREEN_VERTEX = `
varying vec2 vSbScreenUv;
void main() {
  vSbScreenUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export function createSubstrateScreenQuad(THREE, renderer, drawScene) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const mesh = new THREE.Mesh(geometry, null);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return {
    draw(material, target, viewport = null) {
      mesh.material = material;
      renderer.setRenderTarget(target);
      if (viewport) {
        const ratio = renderer.getPixelRatio();
        renderer.setViewport(viewport.x / ratio, viewport.y / ratio, viewport.width / ratio, viewport.height / ratio);
      }
      drawScene(scene, camera);
    },
    dispose() { geometry.dispose(); mesh.material = null; },
  };
}
