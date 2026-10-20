import { ENVCAP_FACES, pickEnvCapAction } from "../lighting/envCaptureCore.js";

const IDLE_EPS = 1e-4;
const IDLE_FRAMES = 5;

export function createEnvCapture(deps) {
  const THREE = deps && deps.THREE;
  const supported = !!(
    THREE && THREE.Scene && THREE.Mesh && THREE.SphereGeometry &&
    THREE.CubeCamera && THREE.WebGLCubeRenderTarget && THREE.PMREMGenerator
  );
  let on = false;
  let size = 64;
  let capScene = null;
  let capMesh = null;
  let cubeRT = null;
  let cubeCam = null;
  let pmrem = null;
  let pmremRT = null;
  let sig = null;                                   
  let capturedSigV = null;                                           
  let dirty = false;
  let facesDone = 0;
  let ready = false;
  let failed = false;
  let texType = "none";
  let captures = 0;
  let lastMs = 0;
  let lastX = NaN, lastY = NaN, lastZ = NaN;
  let lastQx = 0, lastQy = 0, lastQz = 0, lastQw = 1;
  let stillFrames = 0;

  function nowMs() {
    return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  }


  function camStill(camera) {
    if (!camera || !camera.position || !camera.quaternion) return false;
    const p = camera.position;
    const q = camera.quaternion;
    const still =
      Math.abs(p.x - lastX) < IDLE_EPS && Math.abs(p.y - lastY) < IDLE_EPS &&
      Math.abs(p.z - lastZ) < IDLE_EPS &&
      Math.abs(q.x - lastQx) < IDLE_EPS && Math.abs(q.y - lastQy) < IDLE_EPS &&
      Math.abs(q.z - lastQz) < IDLE_EPS && Math.abs(q.w - lastQw) < IDLE_EPS;
    lastX = p.x; lastY = p.y; lastZ = p.z;
    lastQx = q.x; lastQy = q.y; lastQz = q.z; lastQw = q.w;
    stillFrames = still ? stillFrames + 1 : 0;
    return stillFrames >= IDLE_FRAMES;
  }

  function releaseGpu() {
    if (pmremRT) { try { pmremRT.dispose(); } catch (_e) {          } pmremRT = null; }
    if (cubeRT) { try { cubeRT.dispose(); } catch (_e) {          } cubeRT = null; }
    cubeCam = null;
    ready = false;
    capturedSigV = null;
    facesDone = 0;


    dirty = true;
  }


  function configure(opts) {
    const o = opts && typeof opts === "object" ? opts : {};
    const plan = o.plan && typeof o.plan === "object" ? o.plan : { on: false };
    const wantOn = supported && !failed && plan.on === true && !!o.domeMaterial;


    const nextSize = Number.isFinite(plan.size) && plan.size > 0 ? plan.size : 64;
    if (nextSize !== size) {
      size = nextSize;
      if (cubeRT) {
        releaseGpu();
        dirty = true;
      }
    }
    if (!wantOn) {


      if (on) releaseGpu();
      on = false;
      return;
    }
    on = true;
    if (!capScene) {
      capScene = new THREE.Scene();
      capMesh = new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12), o.domeMaterial);
      capMesh.frustumCulled = false;
      capScene.add(capMesh);
    } else if (capMesh && capMesh.material !== o.domeMaterial) {
      capMesh.material = o.domeMaterial;
    }
    if (o.signature !== sig) {
      sig = o.signature;
      dirty = true;
      facesDone = 0;
    }
  }


  function frame(opts) {
    const o = opts && typeof opts === "object" ? opts : {};
    if (!o.renderer) return false;
    const idle = camStill(o.camera);
    const action = pickEnvCapAction({ on, dirty, facesDone, idle });
    if (action === "face") {
      facesDone++;
      return false;
    }
    if (action !== "finish") return false;
    try {
      const t0 = nowMs();
      if (!cubeRT) {
        const rtOpts = { generateMipmaps: false };
        if (THREE.HalfFloatType) { rtOpts.type = THREE.HalfFloatType; texType = "half"; } else { texType = "byte"; }
        if (THREE.LinearFilter) { rtOpts.minFilter = THREE.LinearFilter; rtOpts.magFilter = THREE.LinearFilter; }
        cubeRT = new THREE.WebGLCubeRenderTarget(size, rtOpts);
      }
      if (!cubeCam) cubeCam = new THREE.CubeCamera(1, 1000, cubeRT);
      cubeCam.position.set(0, 0, 0);
      cubeCam.updateMatrixWorld(true);
      cubeCam.update(o.renderer, capScene);
      if (!pmrem) pmrem = new THREE.PMREMGenerator(o.renderer);
      const rt = pmrem.fromCubemap(cubeRT.texture);
      if (pmremRT) { try { pmremRT.dispose(); } catch (_e) {          } }
      pmremRT = rt;
      ready = true;
      dirty = false;
      facesDone = 0;
      capturedSigV = sig;
      captures++;
      lastMs = Math.round((nowMs() - t0) * 10) / 10;
      return true;
    } catch (err) {


      failed = true;
      on = false;
      releaseGpu();
      try { console.warn("[Iluminação] IL-F15: captura do skydome falhou; seguindo no IBL 16px.", err); } catch (_e) {          }
      return false;
    }
  }

  function isReady() {
    return on && ready && !!pmremRT;
  }

  function texture() {
    return isReady() ? pmremRT.texture : null;
  }


  function cubeTexture() {
    return isReady() && cubeRT ? cubeRT.texture : null;
  }

  function capturedSig() {
    return capturedSigV || "";
  }


  function pending() {
    return on === true && dirty === true;
  }

  function getState() {
    return {
      supported,
      on,
      ready,
      failed,
      dirty,
      facesDone,
      size,
      texType,
      captures,
      lastMs,
      sig: sig || "",
      capturedSig: capturedSigV || "",
      idleFrames: IDLE_FRAMES,
      faces: ENVCAP_FACES,
    };
  }

  function dispose() {
    releaseGpu();
    if (pmrem) { try { pmrem.dispose(); } catch (_e) {          } pmrem = null; }
    if (capMesh) {

      try { capMesh.geometry.dispose(); } catch (_e) {          }
      capMesh = null;
    }
    capScene = null;
    on = false;
  }

  return { configure, frame, isReady, texture, cubeTexture, capturedSig, pending, getState, dispose };
}
