import {
  buildVelocityVertexGlsl,
  buildVelocityFragmentGlsl,
  mvDimsFor,
} from "../lighting/motionVectorsCore.js";


export function createMotionVectorsPass({ THREE, renderer, scene, camera }) {
  let mvRt = null;                                      
  let allocW = 0;
  let allocH = 0;
  let mvEnabled = false;

  const prevModelMap = new Map();


  const prevSeenMap = new Map();
  let frameStamp = 0;
  const prevVP = new THREE.Matrix4();
  let prevVPValid = false;


  const curVP = new THREE.Matrix4();
  const meshScratch = [];                                        
  const hiddenScratch = [];                                           
  const aliveScratch = new Set();                                  
  const prevClearColor = new THREE.Color();

  const neutralClearColor = new THREE.Color(0.5, 0.5, 0.5);


  const mat = new THREE.ShaderMaterial({
    vertexShader: buildVelocityVertexGlsl(),
    fragmentShader: buildVelocityFragmentGlsl(),
    uniforms: {
      uMvPrevViewProj: { value: new THREE.Matrix4() },
      uMvPrevModel:    { value: new THREE.Matrix4() },
    },
  });

  function makeRT(w, h) {
    const dims = mvDimsFor(w, h);
    return new THREE.WebGLRenderTarget(Math.max(1, dims.w | 0), Math.max(1, dims.h | 0), {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
  }

  function ensure(w, h) {
    const dims = mvDimsFor(w, h);
    if (allocW === dims.w && allocH === dims.h && mvRt) return;
    release();
    allocW = dims.w;
    allocH = dims.h;
    mvRt = makeRT(w, h);
    prevVPValid = false;
  }

  function release() {
    if (mvRt) { try { mvRt.dispose(); } catch (_e) {                       } }
    mvRt = null;
    allocW = 0;
    allocH = 0;
  }


  function applyState(tsrState) {
    const on = !!(tsrState && tsrState.mvOn);
    if (!on) {
      mvEnabled = false;

      prevVPValid = false;
      prevModelMap.clear();
      prevSeenMap.clear();
      return;
    }
    mvEnabled = true;
  }


  function collectMeshes() {
    meshScratch.length = 0;


    scene.traverseVisible((node) => {
      if (!node.isMesh || !node.visible || !node.geometry) return;
      if (node.isSkinnedMesh || node.isInstancedMesh) return;
      if (node.morphTargetInfluences && node.morphTargetInfluences.length > 0) return;
      meshScratch.push(node);
    });
    return meshScratch;
  }


  function render(w, h) {
    if (!mvEnabled) return false;
    ensure(w, h);
    if (!mvRt) return false;

    frameStamp++;


    if (scene.updateMatrixWorld) scene.updateMatrixWorld();
    if (camera.updateMatrixWorld) camera.updateMatrixWorld();                            
    curVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

    const meshes = collectMeshes();
    const prevRT = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.getClearColor(prevClearColor);
    const prevClearAlpha = renderer.getClearAlpha();

    renderer.setRenderTarget(mvRt);


    renderer.setClearColor(neutralClearColor, 0);
    renderer.clear(true, true, false);


    renderer.autoClear = false;


    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i];
      const prevM = prevModelMap.get(mesh.uuid);


      if (!prevM || prevSeenMap.get(mesh.uuid) !== frameStamp - 1) {


        if (prevM) prevM.copy(mesh.matrixWorld);
        else prevModelMap.set(mesh.uuid, mesh.matrixWorld.clone());
        prevSeenMap.set(mesh.uuid, frameStamp);
        continue;
      }
      mat.uniforms.uMvPrevModel.value.copy(prevM);
      mat.uniforms.uMvPrevViewProj.value.copy(prevVPValid ? prevVP : curVP);
      mat.uniformsNeedUpdate = true;
      const orig = mesh.material;
      mesh.material = mat;


      if (mesh.children.length > 0) {
        hiddenScratch.length = 0;
        for (const child of mesh.children) {
          if (child.visible) { child.visible = false; hiddenScratch.push(child); }
        }
        renderer.render(mesh, camera);
        for (const child of hiddenScratch) child.visible = true;
        hiddenScratch.length = 0;
      } else {
        renderer.render(mesh, camera);
      }
      mesh.material = orig;
    }


    renderer.autoClear = prevAutoClear;
    renderer.setClearColor(prevClearColor, prevClearAlpha);
    renderer.setRenderTarget(prevRT);


    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i];
      const prevM = prevModelMap.get(mesh.uuid);
      if (prevM) {
        prevM.copy(mesh.matrixWorld);
      } else {
        prevModelMap.set(mesh.uuid, mesh.matrixWorld.clone());
      }

      prevSeenMap.set(mesh.uuid, frameStamp);
    }

    if (prevModelMap.size > meshes.length + 32) {
      aliveScratch.clear();
      for (let i = 0; i < meshes.length; i++) aliveScratch.add(meshes[i].uuid);
      for (const k of prevModelMap.keys()) {
        if (!aliveScratch.has(k)) prevModelMap.delete(k);
      }
      for (const k of prevSeenMap.keys()) {
        if (!aliveScratch.has(k)) prevSeenMap.delete(k);
      }
      aliveScratch.clear();
    }
    prevVP.copy(curVP);
    prevVPValid = true;

    meshScratch.length = 0;
    return true;
  }


  function getTexture() {
    return mvRt ? mvRt.texture : null;
  }

  function getEnabled() { return mvEnabled; }

  function dispose() {
    release();
    try { mat.dispose(); } catch (_e) {              }
    prevModelMap.clear();
    prevSeenMap.clear();
    meshScratch.length = 0;
    hiddenScratch.length = 0;
    aliveScratch.clear();
  }

  return { render, getTexture, getEnabled, applyState, dispose };
}
