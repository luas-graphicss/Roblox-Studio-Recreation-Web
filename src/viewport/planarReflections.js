import {
  MIRROR_GAIN,
  MIRROR_SURFACE_OFFSET,
  PLANAR_CLIP_BIAS,
  TEXTURE_BIAS_ROWS,
  axesFromOrientationDeg,
  buildMirrorOverlayFrag,
  buildMirrorOverlayVert,
  mirrorPlaneFromPart,
  obliqueClipProjection,
  pickActivePlane,
  planarGrabPlan,
  planeWeight,
  shouldRenderPlanar,
} from "../lighting/planarReflectionCore.js";
import { getWorkspaceRoot } from "../core/editOps.js";

function identityElements() {
  const e = new Float32Array(16);
  e[0] = 1; e[5] = 1; e[10] = 1; e[15] = 1;
  return e;
}


export const waterPlanarUniforms = {
  uRswPlanar: { value: null },
  uRswPlanarMat: { value: { elements: identityElements() } },
  uRswPlanarOn: { value: 0 },
};


let lastStats = {
  eligible: false,
  on: false,
  plane: "none",
  w: 0,
  h: 0,
  mirrors: 0,
  renders: 0,
  reuses: 0,
  weight: 0,


  planePoint: null,
  planeNormal: null,
};
export function getPlanarQa() {
  return lastStats;
}


if (typeof window !== "undefined" && !window.__rswPlanarQa) {
  window.__rswPlanarQa = { get: getPlanarQa };
}

const MIRROR_SCAN_INTERVAL = 45;                                        

export function createPlanarReflections(opts) {
  const THREE = opts.THREE;
  const scene = opts.scene;
  let disposed = false;
  let target = null;
  let frame = 0;
  let interleaveBit = 0;
  let lastCamKey = "";
  let lastPlaneKey = "";
  let hasValidTexture = false;
  let renders = 0;
  let reuses = 0;


  let waterGeoId = "";
  let lastWaterMat = null;                                               

  let mirrorInsts = [];
  let lastScanFrame = -1e9;

  const virtualCamera = new THREE.PerspectiveCamera();
  virtualCamera.matrixAutoUpdate = true;
  const texMat = new THREE.Matrix4();
  const rotMat = new THREE.Matrix4();
  const planeTmp = new THREE.Plane();
  const boxTmp = new THREE.Box3();
  const frustum = new THREE.Frustum();
  const projViewTmp = new THREE.Matrix4();
  const viewInvTmp = new THREE.Matrix4();
  const sphereTmp = new THREE.Sphere();
  const camPos = new THREE.Vector3();
  const pointV = new THREE.Vector3();
  const normalV = new THREE.Vector3();
  const viewV = new THREE.Vector3();
  const lookAtV = new THREE.Vector3();
  const targetV = new THREE.Vector3();
  const uAxisV = new THREE.Vector3();
  const vAxisV = new THREE.Vector3();
  const posTmp = new THREE.Vector3();
  const sizeTmp = new THREE.Vector3();
  const overlayBasis = new THREE.Matrix4();


  let overlayMesh = null;
  let overlayMat = null;
  function ensureOverlay() {
    if (overlayMesh) return overlayMesh;
    overlayMat = new THREE.ShaderMaterial({
      uniforms: {
        uRswPlanar: { value: null },
        uRswPlanarMat: { value: new THREE.Matrix4() },
        uRswPlanarOn: { value: 0 },
        uRswMirrorGain: { value: MIRROR_GAIN },
        uRswMirrorTint: { value: new THREE.Color(1, 1, 1) },
      },
      vertexShader: buildMirrorOverlayVert(),
      fragmentShader: buildMirrorOverlayFrag(),
      fog: false,
      lights: false,
      transparent: false,
      depthTest: true,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      side: THREE.FrontSide,
    });
    const geo = new THREE.PlaneGeometry(1, 1);
    overlayMesh = new THREE.Mesh(geo, overlayMat);
    overlayMesh.name = "RswMirrorOverlay";
    overlayMesh.matrixAutoUpdate = false;
    overlayMesh.frustumCulled = false;                                          
    overlayMesh.visible = false;
    overlayMesh.renderOrder = 2;
    scene.add(overlayMesh);
    return overlayMesh;
  }

  function vec3Of(v) {
    if (!v || typeof v !== "object") return [0, 0, 0];
    return [Number(v.x) || 0, Number(v.y) || 0, Number(v.z) || 0];
  }

  function scanMirrors() {
    mirrorInsts = [];
    let ws = null;
    try {
      ws = getWorkspaceRoot();
    } catch (_) {
      ws = null;
    }
    if (!ws || typeof ws.getDescendants !== "function") return;
    let all = [];
    try {
      all = ws.getDescendants() || [];
    } catch (_) {
      all = [];
    }
    for (const inst of all) {
      try {
        if (!inst || typeof inst.getProperty !== "function") continue;
        if (typeof inst.isDestroyed === "function" && inst.isDestroyed()) continue;
        if (typeof inst.hasProperty === "function" && !inst.hasProperty("Mirror")) continue;
        if (inst.getProperty("Mirror") !== true) continue;
        mirrorInsts.push(inst);
      } catch (_) {                                                     }
    }
  }

  function mirrorCandidates(out) {
    if (frame - lastScanFrame >= MIRROR_SCAN_INTERVAL) {
      lastScanFrame = frame;
      scanMirrors();
    }
    for (const inst of mirrorInsts) {
      let desc = null;
      try {
        if (typeof inst.isDestroyed === "function" && inst.isDestroyed()) continue;


        if (typeof inst.hasProperty === "function" && inst.hasProperty("Transparency")) {
          const tr = Number(inst.getProperty("Transparency"));
          if (Number.isFinite(tr) && tr >= 0.99) continue;
        }
        const pos = vec3Of(inst.getProperty("Position"));
        const size = vec3Of(inst.getProperty("Size"));
        const hasOri = typeof inst.hasProperty === "function" ? inst.hasProperty("Orientation") : true;
        const ori = hasOri ? vec3Of(inst.getProperty("Orientation")) : [0, 0, 0];
        const axes = axesFromOrientationDeg(ori);
        desc = mirrorPlaneFromPart({
          size,
          position: pos,
          right: axes.right,
          up: axes.up,
          back: axes.back,
          camPos: [camPos.x, camPos.y, camPos.z],
        });
      } catch (_) {
        desc = null;
      }
      if (!desc || !(desc.area > 0.05)) continue;
      pointV.set(desc.point[0], desc.point[1], desc.point[2]);

      sphereTmp.center.copy(pointV);
      sphereTmp.radius = 0.5 * Math.hypot(desc.w, desc.h) + 0.5;
      if (!frustum.intersectsSphere(sphereTmp)) continue;
      viewV.copy(camPos).sub(pointV);
      const dist = Math.max(0.001, viewV.length());


      normalV.set(desc.normal[0], desc.normal[1], desc.normal[2]);
      const facing = viewV.dot(normalV) / dist;
      if (!(facing > 0.02)) continue;
      out.push({
        kind: "mirror",
        desc,
        weight: planeWeight({ area: desc.area, dist, facing }),
      });
    }
  }

  function waterCandidate(waterMesh, out) {
    if (!waterMesh || !waterMesh.visible || !waterMesh.geometry) return;
    const geo = waterMesh.geometry;
    if (waterGeoId !== geo.uuid) {
      if (!geo.boundingBox) geo.computeBoundingBox();
      waterGeoId = geo.uuid;
    }
    if (!geo.boundingBox || geo.boundingBox.isEmpty()) return;
    waterMesh.updateWorldMatrix(true, false);
    boxTmp.copy(geo.boundingBox).applyMatrix4(waterMesh.matrixWorld);
    const topY = boxTmp.max.y;


    if (!(camPos.y > topY + 0.05)) return;
    const sx = Math.max(0, boxTmp.max.x - boxTmp.min.x);
    const sz = Math.max(0, boxTmp.max.z - boxTmp.min.z);
    const area = sx * sz;
    if (!(area > 1)) return;
    if (!frustum.intersectsBox(boxTmp)) return;
    const cx = (boxTmp.min.x + boxTmp.max.x) * 0.5;
    const cz = (boxTmp.min.z + boxTmp.max.z) * 0.5;
    pointV.set(cx, topY, cz);
    const dist = Math.max(1, camPos.distanceTo(pointV));
    out.push({
      kind: "water",
      desc: {
        point: [cx, topY, cz],
        normal: [0, 1, 0],
        area,
      },
      mesh: waterMesh,
      weight: planeWeight({ area, dist, facing: 1 }),
    });
  }

  function setWaterConsume(on, waterMesh) {
    waterPlanarUniforms.uRswPlanarOn.value = on ? 1 : 0;
    const mat = waterMesh && waterMesh.material ? waterMesh.material : lastWaterMat;
    if (!mat) return;
    if (on) {



      if (mat.userData.__rswPlanarEnvBase === undefined) {
        mat.userData.__rswPlanarEnvBase = mat.envMapIntensity;
      }
      mat.envMapIntensity = mat.userData.__rswPlanarEnvBase * 0.15;
      lastWaterMat = mat;
    } else if (mat.userData && mat.userData.__rswPlanarEnvBase !== undefined) {
      mat.envMapIntensity = mat.userData.__rswPlanarEnvBase;
      delete mat.userData.__rswPlanarEnvBase;
      lastWaterMat = null;
    }
  }

  function setOff() {
    setWaterConsume(false, null);


    waterPlanarUniforms.uRswPlanar.value = null;
    if (overlayMesh) {
      overlayMesh.visible = false;
      if (overlayMat) overlayMat.uniforms.uRswPlanarOn.value = 0;
    }
  }

  function camKeyFor(camera, planeKey, w, h) {
    const e = camera.matrixWorld.elements;
    const p = camera.projectionMatrix.elements;
    let s = planeKey + "|" + w + "x" + h;
    for (let i = 0; i < 16; i += 4) s += "|" + e[i].toFixed(3) + "," + e[i + 1].toFixed(3) + "," + e[i + 2].toFixed(3) + "," + e[i + 3].toFixed(3);
    s += "#" + p[0].toFixed(4) + "," + p[5].toFixed(4) + "," + p[10].toFixed(5) + "," + p[14].toFixed(5);
    return s;
  }

  function renderReflection(renderer, camera, active) {
    const desc = active.desc;
    normalV.set(desc.normal[0], desc.normal[1], desc.normal[2]).normalize();
    pointV.set(desc.point[0], desc.point[1], desc.point[2]);

    viewV.subVectors(pointV, camPos);
    if (viewV.dot(normalV) > 0) return false;                         
    viewV.reflect(normalV).negate().add(pointV);
    rotMat.extractRotation(camera.matrixWorld);
    lookAtV.set(0, 0, -1).applyMatrix4(rotMat).add(camPos);
    targetV.subVectors(pointV, lookAtV).reflect(normalV).negate().add(pointV);
    virtualCamera.position.copy(viewV);
    virtualCamera.up.set(0, 1, 0).applyMatrix4(rotMat).reflect(normalV);
    virtualCamera.lookAt(targetV);
    virtualCamera.near = camera.near;
    virtualCamera.far = camera.far;
    virtualCamera.updateMatrixWorld();
    virtualCamera.projectionMatrix.copy(camera.projectionMatrix);

    const B = TEXTURE_BIAS_ROWS;
    texMat.set(B[0], B[1], B[2], B[3], B[4], B[5], B[6], B[7], B[8], B[9], B[10], B[11], B[12], B[13], B[14], B[15]);
    texMat.multiply(virtualCamera.projectionMatrix);
    texMat.multiply(virtualCamera.matrixWorldInverse);

    planeTmp.setFromNormalAndCoplanarPoint(normalV, pointV);
    planeTmp.applyMatrix4(virtualCamera.matrixWorldInverse);
    obliqueClipProjection(
      virtualCamera.projectionMatrix.elements,
      [planeTmp.normal.x, planeTmp.normal.y, planeTmp.normal.z, planeTmp.constant],
      PLANAR_CLIP_BIAS
    );


    const waterMesh = active.kind === "water" ? active.mesh : null;
    const waterWasVisible = waterMesh ? waterMesh.visible : false;
    const overlayWasVisible = overlayMesh ? overlayMesh.visible : false;
    const prevTarget = renderer.getRenderTarget();
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    const shadowsReady = !!(renderer.info && renderer.info.render && renderer.info.render.frame > 0);
    try {


      waterPlanarUniforms.uRswPlanar.value = null;                 
      waterPlanarUniforms.uRswPlanarOn.value = 0;
      if (waterMesh) waterMesh.visible = false;
      if (overlayMesh) overlayMesh.visible = false;
      if (shadowsReady) renderer.shadowMap.autoUpdate = false;                 
      renderer.setScissorTest(false);
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, virtualCamera);
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.shadowMap.autoUpdate = prevShadowAuto;
      if (waterMesh) waterMesh.visible = waterWasVisible;
      if (overlayMesh) overlayMesh.visible = overlayWasVisible;
    }
    return true;
  }

  return {


    render(renderer, camera, env) {
      if (disposed) return;
      frame++;
      const eligible = !!(env && env.eligible) && !!renderer && !!camera;
      if (!eligible) {
        setOff();
        hasValidTexture = false;
        lastStats = { eligible: false, on: false, plane: "none", w: 0, h: 0, mirrors: mirrorInsts.length, renders, reuses, weight: 0 };
        return;
      }
      camera.updateMatrixWorld();
      camera.getWorldPosition(camPos);
      viewInvTmp.copy(camera.matrixWorld).invert();
      projViewTmp.multiplyMatrices(camera.projectionMatrix, viewInvTmp);
      frustum.setFromProjectionMatrix(projViewTmp);

      const cands = [];
      waterCandidate(env ? env.waterMesh : null, cands);
      mirrorCandidates(cands);
      const idx = pickActivePlane(cands);
      if (idx < 0) {
        setOff();
        hasValidTexture = false;
        lastStats = { eligible: true, on: false, plane: "none", w: 0, h: 0, mirrors: mirrorInsts.length, renders, reuses, weight: 0 };
        return;
      }
      const active = cands[idx];
      const desc = active.desc;

      const size = renderer.getDrawingBufferSize(sizeTmp);
      const plan = planarGrabPlan({ w: size.x, h: size.y });
      if (!target) {
        target = new THREE.WebGLRenderTarget(plan.w, plan.h, { stencilBuffer: false });
        target.texture.minFilter = THREE.LinearFilter;
        target.texture.magFilter = THREE.LinearFilter;
        target.texture.generateMipmaps = false;
        hasValidTexture = false;
      } else if (target.width !== plan.w || target.height !== plan.h) {
        target.setSize(plan.w, plan.h);
        hasValidTexture = false;
      }
      const planeKey = active.kind + "|" + desc.point.map((v) => v.toFixed(1)).join(",") + "|" + desc.normal.map((v) => v.toFixed(2)).join(",");
      const camKey = camKeyFor(camera, planeKey, plan.w, plan.h);
      const camSame = hasValidTexture && camKey === lastCamKey && planeKey === lastPlaneKey;
      const sched = shouldRenderPlanar({ hasPlane: true, camSame, interleaveBit });
      interleaveBit = sched.nextBit;
      let ok = true;
      if (sched.render || !hasValidTexture) {
        ok = renderReflection(renderer, camera, active);
        if (ok) {
          renders++;
          hasValidTexture = true;
          lastCamKey = camKey;
          lastPlaneKey = planeKey;
        }
      } else {
        reuses++;
      }
      if (!ok || !hasValidTexture) {
        setOff();
        lastStats = { eligible: true, on: false, plane: "none", w: plan.w, h: plan.h, mirrors: mirrorInsts.length, renders, reuses, weight: 0 };
        return;
      }

      if (active.kind === "water") {
        waterPlanarUniforms.uRswPlanar.value = target.texture;
        waterPlanarUniforms.uRswPlanarMat.value = texMat;
        setWaterConsume(true, active.mesh);
        if (overlayMesh) {
          overlayMesh.visible = false;
          if (overlayMat) overlayMat.uniforms.uRswPlanarOn.value = 0;
        }
      } else {
        setWaterConsume(false, env ? (env.waterMesh && env.waterMesh.material ? env.waterMesh : null) : null);
        ensureOverlay();
        uAxisV.set(desc.uAxis[0], desc.uAxis[1], desc.uAxis[2]).multiplyScalar(desc.w);
        vAxisV.set(desc.vAxis[0], desc.vAxis[1], desc.vAxis[2]).multiplyScalar(desc.h);
        normalV.set(desc.normal[0], desc.normal[1], desc.normal[2]);
        posTmp.set(desc.point[0], desc.point[1], desc.point[2]).addScaledVector(normalV, MIRROR_SURFACE_OFFSET);
        overlayBasis.makeBasis(uAxisV, vAxisV, normalV);
        overlayBasis.setPosition(posTmp);
        overlayMesh.matrix.copy(overlayBasis);
        overlayMesh.matrixWorld.copy(overlayBasis);
        overlayMat.uniforms.uRswPlanar.value = target.texture;
        overlayMat.uniforms.uRswPlanarMat.value.copy(texMat);
        overlayMat.uniforms.uRswPlanarOn.value = 1;
        overlayMesh.visible = true;
      }


      const rswPP = (active.desc && active.desc.point) ? active.desc.point : null;
      const rswPN = (active.desc && active.desc.normal) ? active.desc.normal : null;
      lastStats = {
        eligible: true,
        on: true,
        plane: active.kind,
        w: plan.w,
        h: plan.h,
        mirrors: mirrorInsts.length,
        renders,
        reuses,
        weight: Math.round(active.weight * 1000) / 1000,
        planePoint: rswPP ? [rswPP.x || 0, rswPP.y || 0, rswPP.z || 0] : [0, 0, 0],
        planeNormal: rswPN ? [rswPN.x || 0, rswPN.y || 1, rswPN.z || 0] : [0, 1, 0],
      };
    },
    getQa() {
      return lastStats;
    },
    dispose() {
      disposed = true;
      setOff();
      waterPlanarUniforms.uRswPlanar.value = null;
      waterPlanarUniforms.uRswPlanarOn.value = 0;
      if (target) { target.dispose(); target = null; }
      if (overlayMesh) {
        scene.remove(overlayMesh);
        overlayMesh.geometry.dispose();
        if (overlayMat) overlayMat.dispose();
        overlayMesh = null;
        overlayMat = null;
      }
    },
  };
}
