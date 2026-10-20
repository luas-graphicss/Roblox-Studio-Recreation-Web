import { buildGeomFrag, buildGeomVert } from "../lighting/sharedGeomCore.js";

export function createSharedDepth({ THREE, scene, camera }) {
  if (!THREE || !scene || !camera) {

    throw new Error("createSharedDepth: THREE, scene e camera são obrigatórios");
  }
  const depthMat = new THREE.MeshDepthMaterial();
  depthMat.depthPacking = THREE.RGBADepthPacking;
  depthMat.blending = THREE.NoBlending;
  const savedClear = new THREE.Color();

  let rt = null;
  let allocW = 0;
  let allocH = 0;
  let frameId = 0;                                               
  let renderedFrameId = -1;                                              
  let usedThisFrame = false;
  let idleFrames = 0;


  let frameMaxW = 0;
  let frameMaxH = 0;
  let prevMaxW = 0;
  let prevMaxH = 0;
  const IDLE_RELEASE_FRAMES = 60;                                           


  let wantsDepthTexture = false;
  let geomRT = null;
  let geomMat = null;
  let geomScene = null;
  let geomCam = null;
  let geomFrameId = -1;                                                
  let geomUsedThisFrame = false;
  let geomIdleFrames = 0;

  function releaseTarget() {
    if (rt) rt.dispose();
    rt = null;
    allocW = 0;
    allocH = 0;
    renderedFrameId = -1;
  }


  function releaseGeomTarget() {
    if (geomRT) geomRT.dispose();
    geomRT = null;
    geomFrameId = -1;
  }


  function beginFrame() {
    frameId += 1;
    prevMaxW = frameMaxW;
    prevMaxH = frameMaxH;
    frameMaxW = 0;
    frameMaxH = 0;
    if (usedThisFrame) {
      idleFrames = 0;
    } else if (rt) {
      idleFrames += 1;
      if (idleFrames >= IDLE_RELEASE_FRAMES) {
        releaseTarget();
        idleFrames = 0;
      }
    }
    usedThisFrame = false;

    if (geomUsedThisFrame) {
      geomIdleFrames = 0;
    } else if (geomRT) {
      geomIdleFrames += 1;
      if (geomIdleFrames >= IDLE_RELEASE_FRAMES) {
        releaseGeomTarget();
        geomIdleFrames = 0;
      }
    }
    geomUsedThisFrame = false;
  }

  function ensure(w, h) {
    if (rt && allocW === w && allocH === h && (!wantsDepthTexture || rt.depthTexture)) return;
    releaseTarget();
    allocW = w;
    allocH = h;
    rt = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    if (wantsDepthTexture) {
      rt.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
      rt.depthTexture.name = "sharedDepth.depth";
    }
  }

  function requestDepthTexture() {
    wantsDepthTexture = true;
  }

  function depthTexture() {
    return rt && rt.depthTexture ? rt.depthTexture : null;
  }

  function targetSize() {
    return { width: allocW, height: allocH };
  }

  function acquire(renderer, w, h) {
    if (!renderer) throw new Error("sharedDepth.acquire: renderer obrigatório");
    const pw = Math.max(1, w | 0);
    const ph = Math.max(1, h | 0);
    usedThisFrame = true;
    frameMaxW = Math.max(frameMaxW, pw);
    frameMaxH = Math.max(frameMaxH, ph);


    if (renderedFrameId === frameId && rt && allocW >= pw && allocH >= ph) {
      return rt.texture;
    }


    ensure(Math.max(frameMaxW, prevMaxW), Math.max(frameMaxH, prevMaxH));                                                      
    if (renderedFrameId === frameId) return rt.texture;                  
    renderedFrameId = frameId;
    renderer.getClearColor(savedClear);
    const savedAlpha = renderer.getClearAlpha();
    const savedOverride = scene.overrideMaterial;
    const savedBackground = scene.background;
    const savedShadowAuto = renderer.shadowMap.autoUpdate;
    const savedTarget = renderer.getRenderTarget();
    try {
      scene.overrideMaterial = depthMat;
      scene.background = null;
      renderer.shadowMap.autoUpdate = false;
      renderer.setClearColor(0xffffff, 1);
      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(scene, camera);
    } finally {
      scene.overrideMaterial = savedOverride;
      scene.background = savedBackground;
      renderer.shadowMap.autoUpdate = savedShadowAuto;
      renderer.setClearColor(savedClear, savedAlpha);
      renderer.setRenderTarget(savedTarget);
    }
    return rt.texture;
  }


  function ensureGeomPipeline() {
    if (geomMat) return;
    geomMat = new THREE.ShaderMaterial({
      uniforms: {
        tDepth: { value: null },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uInvProj: { value: new THREE.Vector2(1, 1) },
        uTexel: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: buildGeomVert(),
      fragmentShader: buildGeomFrag(),
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), geomMat);
    quad.frustumCulled = false;
    geomScene = new THREE.Scene();
    geomScene.add(quad);
    geomCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }


  function acquireGeom(renderer, w, h) {
    if (!renderer) throw new Error("sharedDepth.acquireGeom: renderer obrigatório");
    const gw = Math.max(1, w | 0);
    const gh = Math.max(1, h | 0);
    geomUsedThisFrame = true;
    if (geomFrameId === frameId && geomRT && geomRT.width === gw && geomRT.height === gh) {
      return geomRT.texture;                                    
    }
    const depthTex = acquire(renderer, gw, gh);
    ensureGeomPipeline();
    if (!geomRT || geomRT.width !== gw || geomRT.height !== gh) {
      releaseGeomTarget();

      geomRT = new THREE.WebGLRenderTarget(gw, gh, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: false,
        stencilBuffer: false,
      });
    }
    const u = geomMat.uniforms;
    u.tDepth.value = depthTex;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    const pe = camera.projectionMatrix.elements;


    u.uInvProj.value.set(pe[0] > 0 ? 1 / pe[0] : 1, pe[5] > 0 ? 1 / pe[5] : 1);
    u.uTexel.value.set(1 / gw, 1 / gh);
    const savedTarget = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(geomRT);
      renderer.render(geomScene, geomCam);
    } finally {
      renderer.setRenderTarget(savedTarget);
    }
    geomFrameId = frameId;
    return geomRT.texture;
  }

  function dispose() {
    releaseTarget();
    depthMat.dispose();

    releaseGeomTarget();
    if (geomScene) {
      const quad = geomScene.children[0];
      if (quad && quad.geometry) quad.geometry.dispose();
    }
    if (geomMat) geomMat.dispose();
    geomMat = null;
    geomScene = null;
    geomCam = null;
  }

  return { beginFrame, acquire, acquireGeom, requestDepthTexture, depthTexture, targetSize, dispose };
}
