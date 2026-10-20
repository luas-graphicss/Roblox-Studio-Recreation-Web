import {
  DEFAULT_GLASS_IOR,
  REFR_CACHE_KEY,
  buildGlassRefrFragMain,
  buildGlassRefrFragPars,
  glassShaderStatics,
  grabPlan,
  isRefractiveMaterialName,
  shouldGrab,
} from "../lighting/refractionCore.js";


const sceneUniforms = {
  uRswScene: { value: null },
  uRswSceneSize: { value: { x: 1, y: 1 } },
  uRswSceneOn: { value: 0 },
};


const matUniformsByName = new Map();
let curGlassIor = DEFAULT_GLASS_IOR;
let lastStats = null;                                                               

function staticsUniformsFor(name) {
  let u = matUniformsByName.get(name);
  if (!u) {
    const s = glassShaderStatics(name, curGlassIor);
    u = {
      uRswGlassF0: { value: s.f0 },
      uRswGlassOff: { value: s.offset },
      uRswGlassMip: { value: s.mip },
      uRswGlassThk: { value: s.thick },
      uRswGlassAbs: { value: { x: s.absorb[0], y: s.absorb[1], z: s.absorb[2] } },
    };
    matUniformsByName.set(name, u);
  }
  return u;
}


export function setGlassIndexOfRefraction(ior) {
  const v = Number(ior);
  const next = Number.isFinite(v) ? Math.min(3, Math.max(1, v)) : DEFAULT_GLASS_IOR;
  if (next === curGlassIor) return;
  curGlassIor = next;
  const u = matUniformsByName.get("Glass");
  if (u) {
    const s = glassShaderStatics("Glass", curGlassIor);
    u.uRswGlassF0.value = s.f0;
    u.uRswGlassOff.value = s.offset;
  }
}


export function glassRefractionKeyFor() {
  return REFR_CACHE_KEY;
}


export function glassRefractionPatchFor(name) {
  if (!isRefractiveMaterialName(name)) return null;
  const statics = staticsUniformsFor(name);
  return function (shader) {
    Object.assign(shader.uniforms, sceneUniforms, statics);
    shader.fragmentShader =
      buildGlassRefrFragPars() +
      "\n" +
      shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\n" + buildGlassRefrFragMain(),
      );
  };
}


export function markGlassMaterial(mat, name) {
  if (!mat || !isRefractiveMaterialName(name)) return;
  if (!mat.userData) mat.userData = {};
  mat.userData.__rswGlassRefr = name;
}


export function getRefractionQa() {
  return lastStats;
}

export function createRefractionPass(opts) {
  const THREE = opts.THREE;
  const scene = opts.scene;
  let target = null;
  let tw = 0;
  let th = 0;
  let interleaveBit = 0;
  let disposed = false;


  let lastCallMs = NaN;
  const tmpSize = new THREE.Vector2();


  const grabFrustum = new THREE.Frustum();
  const grabViewInv = new THREE.Matrix4();
  const grabProjView = new THREE.Matrix4();
  const grabSphereTmp = new THREE.Sphere();
  const sphereCache = new WeakMap();                                      
  const prevCam = { valid: false, m: new Float64Array(16), p: new Float64Array(16) };
  const glassList = [];
  const prevVisible = [];
  const stats = {
    on: false,
    eligible: false,
    glassMeshes: 0,
    grabs: 0,
    skips: 0,
    w: 0,
    h: 0,
    cpuMs: 0,
    ior: curGlassIor,
  };

  function publish() {
    stats.ior = curGlassIor;
    lastStats = {
      on: stats.on,
      eligible: stats.eligible,
      glassMeshes: stats.glassMeshes,
      grabs: stats.grabs,
      skips: stats.skips,
      w: stats.w,
      h: stats.h,
      cpuMs: stats.cpuMs,
      ior: stats.ior,
    };
  }

  function sameCamera(camera) {
    const m = camera.matrixWorld.elements;
    const p = camera.projectionMatrix.elements;
    let same = prevCam.valid;
    for (let i = 0; i < 16; i++) {
      if (prevCam.m[i] !== m[i] || prevCam.p[i] !== p[i]) {
        same = false;
        break;
      }
    }
    if (!same) {
      for (let i = 0; i < 16; i++) {
        prevCam.m[i] = m[i];
        prevCam.p[i] = p[i];
      }
      prevCam.valid = true;
    }
    return same;
  }


  function glassOnScreen(mesh) {
    let sphere = null;
    if (mesh.isInstancedMesh) {
      if (typeof mesh.computeBoundingSphere !== "function") return true;
      const ver = mesh.instanceMatrix ? mesh.instanceMatrix.version : -1;
      let c = sphereCache.get(mesh);
      if (!c || c.version !== ver || c.count !== mesh.count) {
        mesh.computeBoundingSphere();
        c = { version: ver, count: mesh.count, sphere: mesh.boundingSphere };
        sphereCache.set(mesh, c);
      }
      sphere = c.sphere;
    } else if (mesh.geometry) {
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      sphere = mesh.geometry.boundingSphere;
    }
    if (!sphere) return true;
    grabSphereTmp.copy(sphere);
    mesh.updateWorldMatrix(true, false);
    grabSphereTmp.applyMatrix4(mesh.matrixWorld);
    return grabFrustum.intersectsSphere(grabSphereTmp);
  }


  function collectGlass(list) {
    let n = 0;
    const stack = [scene];
    while (stack.length) {
      const node = stack.pop();
      if (!node || node.visible === false) continue;
      if (node.isMesh && node.material) {
        const m = node.material;
        const glass = Array.isArray(m)
          ? m.some((x) => x && x.userData && x.userData.__rswGlassRefr)
          : !!(m.userData && m.userData.__rswGlassRefr);


        if (glass && (node.count === undefined || node.count > 0) && glassOnScreen(node)) list[n++] = node;
      }
      const ch = node.children;
      if (ch) for (let i = 0; i < ch.length; i++) stack.push(ch[i]);
    }
    list.length = n;
    return n;
  }

  function ensureTarget(w, h) {
    if (target && tw === w && th === h) return;
    if (target) target.dispose();


    target = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, stencilBuffer: false });
    target.texture.generateMipmaps = true;
    target.texture.minFilter = THREE.LinearMipmapLinearFilter;
    target.texture.magFilter = THREE.LinearFilter;
    tw = w;
    th = h;
  }


  function render(renderer, camera, env) {
    if (disposed || !renderer || !camera) return;
    const t0 = typeof performance !== "undefined" ? performance.now() : 0;


    const continuous = Number.isFinite(lastCallMs) && t0 - lastCallMs < 100;
    lastCallMs = t0;
    stats.eligible = !!(env && env.eligible);
    setGlassIndexOfRefraction(env ? env.ior : null);
    if (!stats.eligible) {
      sceneUniforms.uRswSceneOn.value = 0;
      stats.on = false;
      stats.glassMeshes = 0;
      glassList.length = 0;                                                   
      publish();
      return;
    }
    camera.updateMatrixWorld();
    grabViewInv.copy(camera.matrixWorld).invert();
    grabProjView.multiplyMatrices(camera.projectionMatrix, grabViewInv);
    grabFrustum.setFromProjectionMatrix(grabProjView);
    const n = collectGlass(glassList);
    stats.glassMeshes = n;
    if (!n) {
      sceneUniforms.uRswSceneOn.value = 0;
      stats.on = false;
      publish();
      return;
    }
    const plan = shouldGrab({ camSame: sameCamera(camera), interleaveBit, glassCount: n, continuous });
    interleaveBit = plan.nextBit;
    if (!plan.render && sceneUniforms.uRswSceneOn.value > 0.5 && target) {


      stats.skips++;
      stats.on = true;
      glassList.length = 0;                                                
      publish();
      return;
    }
    renderer.getDrawingBufferSize(tmpSize);
    const g = grabPlan({ w: tmpSize.x, h: tmpSize.y });
    ensureTarget(g.w, g.h);
    const sm = renderer.shadowMap;
    const prevShadowAuto = sm ? sm.autoUpdate : null;
    const prevTarget = renderer.getRenderTarget();

    sceneUniforms.uRswSceneOn.value = 0;
    for (let i = 0; i < n; i++) {
      prevVisible[i] = glassList[i].visible;
      glassList[i].visible = false;
    }
    try {


      if (sm && renderer.info && renderer.info.render && renderer.info.render.frame > 0) {
        sm.autoUpdate = false;
      }
      renderer.setScissorTest(false);                                         
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, camera);
    } finally {
      renderer.setRenderTarget(prevTarget || null);
      if (sm && prevShadowAuto !== null) sm.autoUpdate = prevShadowAuto;
      for (let i = 0; i < n; i++) glassList[i].visible = prevVisible[i];
      glassList.length = 0;
      prevVisible.length = 0;
    }
    sceneUniforms.uRswScene.value = target.texture;


    sceneUniforms.uRswSceneSize.value.x = tmpSize.x;
    sceneUniforms.uRswSceneSize.value.y = tmpSize.y;
    sceneUniforms.uRswSceneOn.value = 1;
    stats.on = true;
    stats.grabs++;
    stats.w = g.w;
    stats.h = g.h;
    const t1 = typeof performance !== "undefined" ? performance.now() : 0;
    stats.cpuMs = Math.round((t1 - t0) * 100) / 100;
    publish();
  }

  function dispose() {
    disposed = true;
    if (target) {
      target.dispose();
      target = null;
    }
    sceneUniforms.uRswSceneOn.value = 0;
    sceneUniforms.uRswScene.value = null;
    if (lastStats) {
      lastStats = { ...lastStats, on: false };
    }
  }

  return { render, dispose, getStats: () => lastStats };
}
