import {
  TRANS_RT_SIZE,
  TRANS_MAX_PROXIES,
  buildTransmitterFrag,
  buildTransmitterVert,
  buildTransmissionPars,
  buildTransmissionVertex,
  patchTransIntoLightsBegin,
  buildDitherGlsl,
  DITHER_FRAG_ANCHOR,
  DITHER_DISCARD,
  ditherShiftForFrame,
  isGlassMaterialName,
} from "../lighting/transmissionShadowCore.js";

const ANCHOR_LIGHTS = "#include <lights_fragment_begin>";
const ANCHOR_WORLDPOS = "#include <worldpos_vertex>";

export function createTransmissionShadows({ THREE, renderer, rtSize }) {


  const rtSizeNum = Math.floor(Number(rtSize));
  const rtDim = Number.isFinite(rtSizeNum) && rtSizeNum >= 64 && rtSizeNum <= 4096 ? rtSizeNum : TRANS_RT_SIZE;
  const isWebGL2 = !!(renderer && renderer.capabilities && renderer.capabilities.isWebGL2);

  const rawPatched = patchTransIntoLightsBegin(THREE.ShaderChunk.lights_fragment_begin || "");


  const supported = isWebGL2 && rawPatched.ok;
  let generation = 0;
  const uniforms = {
    uRswTransMap: { value: null },
    uRswTransMatrix: { value: new THREE.Matrix4() },
    uRswTransOn: { value: 0 },
  };
  const ditherShift = { value: new THREE.Vector2(0, 0) };
  const ditherMats = new Set();

  let rt = null;
  const proxyScene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-60, 60, 60, -60, 0.5, 1700);
  proxyScene.add(cam);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const proxies = [];
  let proxyCount = 0;

  const biasM = new THREE.Matrix4().set(
    0.5, 0, 0, 0.5,
    0, 0.5, 0, 0.5,
    0, 0, 0.5, 0.5,
    0, 0, 0, 1,
  );
  const tmpM = new THREE.Matrix4();
  const oldClear = new THREE.Color();

  function makeProxyMaterial() {
    const m = new THREE.ShaderMaterial({
      uniforms: { uRswTint: { value: new THREE.Color(1, 1, 1) } },
      vertexShader: buildTransmitterVert(),
      fragmentShader: buildTransmitterFrag(),
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.ZeroFactor;
    m.blendDst = THREE.SrcColorFactor;
    m.blendEquationAlpha = THREE.MinEquation;
    m.blendSrcAlpha = THREE.OneFactor;
    m.blendDstAlpha = THREE.OneFactor;
    m.side = THREE.DoubleSide;
    return m;
  }


  function setTransmitters(list) {
    const n = Math.min(list ? list.length : 0, TRANS_MAX_PROXIES);
    while (proxies.length < n) {
      const mesh = new THREE.Mesh(boxGeo, makeProxyMaterial());
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      proxyScene.add(mesh);
      proxies.push(mesh);
    }
    for (let i = 0; i < proxies.length; i++) {
      const mesh = proxies[i];
      if (i < n) {
        const it = list[i];
        mesh.matrix.fromArray(it.m);
        mesh.material.uniforms.uRswTint.value.setRGB(it.tint[0], it.tint[1], it.tint[2]);
        mesh.visible = true;
      } else {
        mesh.visible = false;
      }
    }
    proxyCount = n;
    return n;
  }


  function render(r, win) {
    if (!supported) return;
    if (proxyCount === 0) {
      uniforms.uRswTransOn.value = 0;
      return;
    }
    if (!rt) {
      rt = new THREE.WebGLRenderTarget(rtDim, rtDim, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
      });
    }
    const half = Math.max(20, Number(win.half) || 0);
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 0.5;
    cam.far = 1700;
    cam.position.set(
      win.center.x + win.dirToSun.x * 800,
      win.center.y + win.dirToSun.y * 800,
      win.center.z + win.dirToSun.z * 800,
    );
    cam.up.set(0, 1, 0);
    if (Math.abs(win.dirToSun.y) > 0.98) cam.up.set(0, 0, 1);              
    cam.lookAt(win.center.x, win.center.y, win.center.z);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    proxyScene.updateMatrixWorld(true);
    const oldT = r.getRenderTarget();
    r.getClearColor(oldClear);
    const oldA = r.getClearAlpha();
    r.setRenderTarget(rt);
    r.setClearColor(0xffffff, 1);
    r.clear(true, false, false);
    r.render(proxyScene, cam);
    r.setRenderTarget(oldT);
    r.setClearColor(oldClear, oldA);
    uniforms.uRswTransMap.value = rt.texture;
    tmpM.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    uniforms.uRswTransMatrix.value.multiplyMatrices(biasM, tmpM);
    uniforms.uRswTransOn.value = 1;
  }

  function setEnabled(on) {
    if (!on) uniforms.uRswTransOn.value = 0;
    else if (proxyCount > 0 && rt) uniforms.uRswTransOn.value = 1;
  }

  function isEnabled() {
    return uniforms.uRswTransOn.value > 0.5;
  }

  function bumpGeneration() {
    generation++;
  }


  function patchMaterial(mat) {
    if (!supported || !mat) return;
    if (!mat.userData) mat.userData = {};
    if (mat.userData.__rswTrans) return;
    mat.userData.__rswTrans = true;
    const prevCb = mat.onBeforeCompile;
    const prevKey = mat.customProgramCacheKey;
    mat.onBeforeCompile = function (shader, r) {
      if (typeof prevCb === "function") prevCb.call(this, shader, r);
      shader.uniforms.uRswTransMap = uniforms.uRswTransMap;
      shader.uniforms.uRswTransMatrix = uniforms.uRswTransMatrix;
      shader.uniforms.uRswTransOn = uniforms.uRswTransOn;
      if (
        shader.vertexShader.indexOf("vRswTransPos") === -1 &&
        shader.vertexShader.indexOf(ANCHOR_WORLDPOS) !== -1
      ) {
        shader.vertexShader =
          "varying vec3 vRswTransPos;\n" +
          shader.vertexShader.replace(ANCHOR_WORLDPOS, buildTransmissionVertex());
      }
      let frag = shader.fragmentShader;
      if (frag.indexOf("rswTransTint") !== -1) return;               
      if (frag.indexOf(ANCHOR_LIGHTS) !== -1) {
        frag = frag.replace(ANCHOR_LIGHTS, rawPatched.text);
      } else {
        const res = patchTransIntoLightsBegin(frag);
        if (!res.ok) return;                                              
        frag = res.text;
      }
      shader.fragmentShader = buildTransmissionPars() + "\n" + frag;
    };
    mat.customProgramCacheKey = function () {
      const prev = typeof prevKey === "function" ? prevKey.call(this) : "";
      return prev + "|rswTrans1g" + generation;
    };
    mat.needsUpdate = true;
  }


  function makeDitherOnBeforeCompile() {
    return function (shader) {
      shader.uniforms.uRswDitherShift = ditherShift;
      shader.vertexShader =
        "attribute float rswAlpha;\nvarying float vRswDA;\n" +
        shader.vertexShader.replace(
          "#include <begin_vertex>",
          "vRswDA = rswAlpha;\n\t#include <begin_vertex>",
        );
      shader.fragmentShader = (buildDitherGlsl() + "\n" + shader.fragmentShader).replace(
        DITHER_FRAG_ANCHOR,
        DITHER_FRAG_ANCHOR + DITHER_DISCARD,
      );
    };
  }


  function ensureDitherCaster(mesh, on) {
    if (!mesh || !mesh.userData) return false;
    const key = String(mesh.userData.__rswPoolKey || "");
    const matName = key.split("|")[1] || "";
    if (isGlassMaterialName(matName)) {
      mesh.castShadow = false;
      return false;
    }
    if (on) {
      if (!mesh.customDepthMaterial) {
        const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
        dm.onBeforeCompile = makeDitherOnBeforeCompile();
        dm.customProgramCacheKey = function () {
          return "rswDitherDepth1";
        };
        const sm = new THREE.MeshDistanceMaterial();
        sm.onBeforeCompile = makeDitherOnBeforeCompile();
        sm.customProgramCacheKey = function () {
          return "rswDitherDist1";
        };
        mesh.customDepthMaterial = dm;
        mesh.customDistanceMaterial = sm;
        ditherMats.add(dm);
        ditherMats.add(sm);
      }
      mesh.castShadow = true;
      return true;
    }
    mesh.castShadow = false;
    if (mesh.customDepthMaterial) {
      ditherMats.delete(mesh.customDepthMaterial);
      ditherMats.delete(mesh.customDistanceMaterial);
      mesh.customDepthMaterial.dispose();
      if (mesh.customDistanceMaterial) mesh.customDistanceMaterial.dispose();
      mesh.customDepthMaterial = undefined;
      mesh.customDistanceMaterial = undefined;
    }
    return false;
  }


  function setDitherFrame(frame) {
    const s = ditherShiftForFrame(frame);
    ditherShift.value.set(s[0], s[1]);
  }

  function getStats() {
    return {
      supported,
      on: isEnabled(),
      rtSize: rtDim,                                            
      proxies: proxyCount,
      ditherCasters: Math.floor(ditherMats.size / 2),
    };
  }

  function dispose() {
    for (const p of proxies) p.material.dispose();
    proxies.length = 0;
    proxyCount = 0;
    boxGeo.dispose();
    if (rt) {
      rt.dispose();
      rt = null;
    }
    ditherMats.clear();
    uniforms.uRswTransOn.value = 0;
  }

  return {
    supported,
    uniforms,
    setTransmitters,
    render,
    setEnabled,
    isEnabled,
    bumpGeneration,
    patchMaterial,
    ensureDitherCaster,
    setDitherFrame,
    getStats,
    dispose,
  };
}
