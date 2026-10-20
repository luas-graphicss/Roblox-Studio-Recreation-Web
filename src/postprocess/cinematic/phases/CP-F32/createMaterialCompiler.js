import { withShaderFailureGuard } from "./shaderFailureGuard.js";
import { withRendererState } from "../../render/rendererState.js";

export function createMaterialCompiler(adapter) {
  let geometry = null;
  let scene = null;
  let mesh = null;
  let camera = null;
  function initialize(material) {
    if (scene) return;
    const { THREE } = adapter;
    if (!THREE?.BufferGeometry || !adapter.renderer?.compile)
      throw new Error("Shader warmup requires a real compiler backend");
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)
    );
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    scene = new THREE.Scene();
    scene.add(mesh);
    camera = new THREE.Camera();
  }
  return Object.freeze({
    compile(material) {
      return withShaderFailureGuard(adapter, () => {
        if (typeof adapter.compileMaterial === "function") return adapter.compileMaterial(material);
        initialize(material);
        return withRendererState(adapter.THREE, adapter.renderer, () => {
          mesh.material = material;
          adapter.renderer.compile(scene, camera);
          const properties = adapter.renderer.properties.get(material);
          const programs = properties.programs ? [...properties.programs.values()] : [];
          if (programs.length === 0) throw new Error("Shader warmup did not produce a GPU program");
          for (const program of programs) {
            if (!adapter.context.getProgramParameter(program.program, adapter.context.LINK_STATUS))
              throw new Error(
                `Shader link failed: ${adapter.context.getProgramInfoLog(program.program)}`
              );
          }
          return { programs: programs.length };
        });
      });
    },
    dispose() {
      geometry?.dispose();
      geometry = null;
      scene = null;
      mesh = null;
      camera = null;
    }
  });
}
