export const FULL_SCREEN_VERTEX_SHADER = [
  "void main() {",
  "  gl_Position = vec4(position.xy, 0.0, 1.0);",
  "}",
].join("\n");

export function createFullScreenQuad(THREE) {
  const geometry = new THREE.BufferGeometry();


  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );

  const scene = new THREE.Scene();


  scene.background = null;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mesh = new THREE.Mesh(geometry, null);
  mesh.frustumCulled = false;
  scene.add(mesh);

  return {
    render(renderer, material, renderTarget) {
      const previousRenderTarget = renderer.getRenderTarget();
      mesh.material = material;
      if (material && material.isShaderMaterial) material.uniformsNeedUpdate = true;
      renderer.setRenderTarget(renderTarget || null);
      renderer.render(scene, camera);
      renderer.setRenderTarget(previousRenderTarget);
    },

    dispose() {
      geometry.dispose();
      mesh.material = null;
      scene.remove(mesh);
    },
  };
}
