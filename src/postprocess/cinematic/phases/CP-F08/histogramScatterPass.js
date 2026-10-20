import { withRendererState } from "../../render/rendererState.js";
import { HISTOGRAM_SCATTER_VERTEX, HISTOGRAM_SCATTER_FRAGMENT } from "./histogramShaders.js";

export function createHistogramScatterPass(adapter, uniforms) {
  const { THREE, renderer } = adapter;
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
  const material = new THREE.ShaderMaterial({
    vertexShader: HISTOGRAM_SCATTER_VERTEX,
    fragmentShader: HISTOGRAM_SCATTER_FRAGMENT,
    uniforms,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  scene.add(points);
  let disposed = false;
  return Object.freeze({
    draw(target, pixelCount) {
      if (disposed) throw new Error("CP-F08 histogram scatter is disposed");
      geometry.instanceCount = pixelCount;
      return withRendererState(THREE, renderer, () => {
        renderer.setRenderTarget(target);
        renderer.setScissorTest(false);
        renderer.setClearColor(0, 0);
        renderer.clear();
        renderer.render(scene, camera);
        if (adapter.errors().length) throw new Error(`CP-F08 scatter shader failed: ${JSON.stringify(adapter.errors().at(-1))}`);
      });
    },
    dispose() { if (disposed) return; disposed = true; geometry.dispose(); material.dispose(); }
  });
}
