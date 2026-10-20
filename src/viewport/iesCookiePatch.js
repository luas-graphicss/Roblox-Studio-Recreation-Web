import {
  RSW_IESCK_ATLAS,
  RSW_IESCK_CELL,
  RSW_IESCK_GRID,
  RSW_IESCK_SLOTS,
  RSW_IESCK_MAX_SPOT,
  RSW_IESCK_MAX_POINT,
  RSW_IES_PRESETS,
  RSW_COOKIE_PRESETS,
  buildIesCookieGlsl,
  patchLightsFragmentForIesCookie,
  flagsForIesCookie,
  iesPresetProfile,
  iesProfileToCell,
  cookiePresetCell,
  sanitizeIesProfileRef,
  sanitizeLightFunctionRef,
  sanitizeCookieRotationDeg,
  predictLightOrder,
} from "../lighting/iesCookieCore.js";
import { assetStore } from "../assets/assetStore.js";
import { decodeIesDataUri, loadIesProfile, cookieCellFromDataUri } from "../assets/iesLoader.js";

export function createIesCookiePatch({ THREE }) {
  const chunk = THREE && THREE.ShaderChunk ? THREE.ShaderChunk.lights_fragment_begin : null;
  const patched = patchLightsFragmentForIesCookie(typeof chunk === "string" ? chunk : "");
  const glsl = buildIesCookieGlsl();
  let generation = 0;
  let patchedCount = 0;
  let slotPressure = 0;                                              


  const atlasData = new Uint8Array(RSW_IESCK_ATLAS * RSW_IESCK_ATLAS);
  atlasData.fill(255);
  let atlasTex = null;
  let texFormat = "none";
  const supported = patched.ok && !!(THREE && THREE.DataTexture);
  if (supported) {
    const fmt = THREE.RedFormat || THREE.LuminanceFormat;
    texFormat = THREE.RedFormat ? "red" : "luminance";
    atlasTex = new THREE.DataTexture(atlasData, RSW_IESCK_ATLAS, RSW_IESCK_ATLAS, fmt, THREE.UnsignedByteType);
    atlasTex.minFilter = THREE.LinearFilter;
    atlasTex.magFilter = THREE.LinearFilter;
    atlasTex.generateMipmaps = false;                                 
    if (THREE.ClampToEdgeWrapping) {
      atlasTex.wrapS = THREE.ClampToEdgeWrapping;
      atlasTex.wrapT = THREE.ClampToEdgeWrapping;
    }
    atlasTex.needsUpdate = true;
  }

  const uniforms = {
    uRswIesCkOn: { value: 0 },
    uRswIesCkAtlas: { value: atlasTex },


    uRswIesCkVUp: { value: new Float32Array([0, 1, 0]) },
    uRswIesCkVX: { value: new Float32Array([1, 0, 0]) },
    uRswIesCkVZ: { value: new Float32Array([0, 0, 1]) },
    uRswIesCkSpotA: { value: new Float32Array(RSW_IESCK_MAX_SPOT * 4) },
    uRswIesCkSpotB: { value: new Float32Array(RSW_IESCK_MAX_SPOT * 4) },
    uRswIesCkPointA: { value: new Float32Array(RSW_IESCK_MAX_POINT * 4) },
    uRswIesCkPointB: { value: new Float32Array(RSW_IESCK_MAX_POINT * 4) },
  };


  const slotByKey = new Map();
  const ies2dByKey = new Map();                                           
  let nextSlot = 1;
  let allocGen = 0;                                                        
  let asyncPending = 0;                                             

  function writeCellForKey(key, cell) {
    if (!supported || !cell || cell.length !== RSW_IESCK_CELL * RSW_IESCK_CELL) return 0;
    const k = String(key);
    const hit = slotByKey.get(k);
    if (hit !== undefined) return hit;
    if (nextSlot >= RSW_IESCK_SLOTS) {
      slotPressure++;
      return 0;
    }
    const slot = nextSlot++;
    slotByKey.set(k, slot);
    const x0 = (slot % RSW_IESCK_GRID) * RSW_IESCK_CELL;
    const y0 = Math.floor(slot / RSW_IESCK_GRID) * RSW_IESCK_CELL;
    for (let y = 0; y < RSW_IESCK_CELL; y++) {
      atlasData.set(cell.subarray(y * RSW_IESCK_CELL, (y + 1) * RSW_IESCK_CELL), (y0 + y) * RSW_IESCK_ATLAS + x0);
    }
    if (atlasTex) atlasTex.needsUpdate = true;
    return slot;
  }

  function releaseAllCells() {
    slotByKey.clear();
    ies2dByKey.clear();
    allocGen++;                                                             

    nextSlot = 1;
    slotPressure = 0;
    atlasData.fill(255);
    if (atlasTex) atlasTex.needsUpdate = true;
  }


  function resetAtlas() {
    releaseAllCells();
  }

  function localAssetRec(ref) {
    let rec = null;
    try { rec = assetStore.getById(ref); } catch (_e) { rec = null; }
    return rec && rec.local && rec.dataUri ? rec : null;
  }

  function allocCell(req) {
    const iesRef = sanitizeIesProfileRef(req && req.iesProfile);
    const lfRef = sanitizeLightFunctionRef(req && req.lightFunc);
    if (!supported || (iesRef === "" && lfRef === "")) return null;
    const handle = {
      ckRef: String((req && req.ckRef) || iesRef + "|" + lfRef + "|0"),
      iesSlot: 0,
      ckSlot: 0,
      ies2d: false,
      rotRad: (sanitizeCookieRotationDeg(req && req.lfRot) * Math.PI) / 180,
      error: "",
    };
    if (iesRef !== "") {
      const preset = iesRef.toLowerCase();
      if (RSW_IES_PRESETS.indexOf(preset) !== -1) {
        const prof = iesPresetProfile(preset);
        const slot = prof.ok ? writeCellForKey("ies:" + preset, iesProfileToCell(prof)) : 0;
        if (slot === 0) return null;                                     
        handle.iesSlot = slot;
        handle.ies2d = prof.nH > 1;
      } else {
        const key = "ies:" + iesRef;
        const hit = slotByKey.get(key);
        if (hit !== undefined) {
          handle.iesSlot = hit;
          handle.ies2d = ies2dByKey.get(key) === true;
        } else {
          const rec = localAssetRec(iesRef);
          if (!rec) {
            handle.error = "IesProfile não é preset nem Asset ID local";
          } else {
            const gen = allocGen;
            asyncPending++;
            loadIesProfile({ text: decodeIesDataUri(rec.dataUri) }).then((res) => {
              asyncPending--;
              if (gen !== allocGen) return;                                 
              if (!res.ok) { handle.error = "parse .ies: " + res.error; return; }
              const is2d = !!(res.meta && res.meta.nH > 1);
              ies2dByKey.set(key, is2d);
              handle.iesSlot = writeCellForKey(key, res.cell);                                   
              handle.ies2d = is2d;
            });
          }
        }
      }
    }
    if (lfRef !== "") {
      const ckPreset = lfRef.toLowerCase();
      const presetCell = RSW_COOKIE_PRESETS.indexOf(ckPreset) !== -1 ? cookiePresetCell(ckPreset) : null;
      if (presetCell) {
        const slot = writeCellForKey("ck:" + ckPreset, presetCell);
        if (slot === 0) return null;               
        handle.ckSlot = slot;
      } else {
        const key = "ck:" + lfRef;
        const hit = slotByKey.get(key);
        if (hit !== undefined) {
          handle.ckSlot = hit;
        } else {
          const rec = localAssetRec(lfRef);
          if (!rec || rec.section !== "images") {
            handle.error = "LightFunction não é preset nem imagem local";
          } else {
            const gen = allocGen;
            asyncPending++;
            cookieCellFromDataUri(rec.dataUri).then((cell) => {
              asyncPending--;
              if (gen !== allocGen) return;
              handle.ckSlot = writeCellForKey(key, cell);
            }).catch((err) => {
              asyncPending--;
              if (gen === allocGen) handle.error = "cookie: " + String((err && err.message) || err);
            });
          }
        }
      }
    }
    return handle;
  }


  const upHandleById = new Map();
  const upEntryById = new Map();

  function uploadFrame(fr) {
    if (!supported) return 0;


    const vm = fr && fr.viewMatrix && fr.viewMatrix.elements ? fr.viewMatrix.elements : null;
    if (vm) {
      const vx = uniforms.uRswIesCkVX.value;
      const vu = uniforms.uRswIesCkVUp.value;
      const vz = uniforms.uRswIesCkVZ.value;
      vx[0] = vm[0]; vx[1] = vm[1]; vx[2] = vm[2];
      vu[0] = vm[4]; vu[1] = vm[5]; vu[2] = vm[6];
      vz[0] = vm[8]; vz[1] = vm[9]; vz[2] = vm[10];
    }
    const cells = fr && fr.cells;
    const lights = fr && fr.lights;
    const orderBuf = fr && Array.isArray(fr.orderBuf) ? fr.orderBuf : [];
    orderBuf.length = 0;
    upHandleById.clear();
    upEntryById.clear();
    if (cells && typeof cells.forEach === "function") {
      cells.forEach((meta, handle) => {
        if (handle && meta) upHandleById.set(meta.id, handle);
      });
    }
    if (lights && typeof lights.forEach === "function") {
      lights.forEach((entry, id) => {
        const L = entry && entry.light;
        if (!L || L.visible === false) return;
        const type = L.isSpotLight ? "spot" : L.isPointLight ? "point" : null;
        if (!type) return;


        orderBuf.push({ id, type, castShadow: !!L.castShadow, hasMap: !!L.map, visible: true });
        upEntryById.set(id, entry);
      });
    }
    const order = predictLightOrder(orderBuf);
    let active = 0;
    for (let i = 0; i < RSW_IESCK_MAX_SPOT; i++) {
      const id = order.spotIds[i];
      const h = id !== undefined ? upHandleById.get(id) : undefined;
      const entry = id !== undefined ? upEntryById.get(id) : undefined;
      if (h && entry && (h.iesSlot > 0 || h.ckSlot > 0)) {
        const ang = entry.light && Number.isFinite(entry.light.angle) ? entry.light.angle : Math.PI / 4;
        const tanOuter = Math.tan(Math.min(Math.max(ang, 0.01), 1.55));
        setSpot(i, h.iesSlot, h.ckSlot, tanOuter, h.rotRad, 1, h.ies2d);
        active++;
      } else {
        setSpotNeutral(i);
      }
    }
    for (let i = 0; i < RSW_IESCK_MAX_POINT; i++) {
      const id = order.pointIds[i];
      const h = id !== undefined ? upHandleById.get(id) : undefined;
      if (h && h.iesSlot > 0) {


        setPoint(i, h.iesSlot, 0, -1, 0);
        active++;
      } else {
        setPointNeutral(i);
      }
    }
    setEnabled(active > 0);
    return active;
  }


  function setSpot(i, iesSlot, ckSlot, tanOuter, rotRad, scale, ies2d) {
    if (i < 0 || i >= RSW_IESCK_MAX_SPOT) return;
    const o = i * 4;
    const A = uniforms.uRswIesCkSpotA.value;
    const B = uniforms.uRswIesCkSpotB.value;
    A[o] = iesSlot;
    A[o + 1] = ckSlot;
    A[o + 2] = tanOuter;
    A[o + 3] = flagsForIesCookie(iesSlot > 0, ckSlot > 0);
    B[o] = Math.cos(rotRad || 0);
    B[o + 1] = Math.sin(rotRad || 0);
    B[o + 2] = scale > 0 ? scale : 1;
    B[o + 3] = ies2d ? 1 : 0;
  }

  function setSpotNeutral(i) {
    if (i < 0 || i >= RSW_IESCK_MAX_SPOT) return;
    uniforms.uRswIesCkSpotA.value[i * 4 + 3] = 0;
  }

  function setPoint(i, iesSlot, ax, ay, az) {
    if (i < 0 || i >= RSW_IESCK_MAX_POINT) return;
    const o = i * 4;
    const A = uniforms.uRswIesCkPointA.value;
    const B = uniforms.uRswIesCkPointB.value;
    A[o] = iesSlot;
    A[o + 1] = iesSlot > 0 ? 1 : 0;
    A[o + 2] = ax;
    A[o + 3] = ay;
    B[o] = az;
  }

  function setPointNeutral(i) {
    if (i < 0 || i >= RSW_IESCK_MAX_POINT) return;
    uniforms.uRswIesCkPointA.value[i * 4 + 1] = 0;
  }

  function clearAllLights() {
    for (let i = 0; i < RSW_IESCK_MAX_SPOT; i++) setSpotNeutral(i);
    for (let i = 0; i < RSW_IESCK_MAX_POINT; i++) setPointNeutral(i);
  }


  function patchMaterial(mat) {
    if (!supported || !mat) return;
    const ud = mat.userData || (mat.userData = {});
    if (ud.__rswIesCk) return;                                                
    ud.__rswIesCk = true;
    patchedCount++;
    const prevCompile = mat.onBeforeCompile;
    const prevKey = mat.customProgramCacheKey;
    mat.onBeforeCompile = function (shader, rendererArg) {
      if (typeof prevCompile === "function") prevCompile.call(this, shader, rendererArg);

      if (shader.fragmentShader.indexOf("#include <lights_pars_begin>") === -1) return;
      if (shader.fragmentShader.indexOf("rswIesCkSpot(") !== -1) return;               
      for (const nome of Object.keys(uniforms)) shader.uniforms[nome] = uniforms[nome];
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <lights_pars_begin>",
        "#include <lights_pars_begin>\n" + glsl
      );
      if (shader.fragmentShader.indexOf("#include <lights_fragment_begin>") !== -1) {
        shader.fragmentShader = shader.fragmentShader.replace("#include <lights_fragment_begin>", patched.text);
      } else {


        const p2 = patchLightsFragmentForIesCookie(shader.fragmentShader);
        if (p2.ok) shader.fragmentShader = p2.text;
      }
    };
    mat.customProgramCacheKey = function () {
      const base = typeof prevKey === "function" ? String(prevKey.call(this)) : "";
      return base + "|rswIesCk" + generation;
    };
    mat.needsUpdate = true;
  }

  function setEnabled(on) {
    uniforms.uRswIesCkOn.value = on ? 1 : 0;
  }

  function bumpGeneration() {
    generation++;
  }

  function getState() {
    return {
      supported,
      anchors: patched.anchors,
      enabled: uniforms.uRswIesCkOn.value > 0.5,
      patched: patchedCount,
      cells: slotByKey.size,
      slotPressure,
      pendingLoads: asyncPending,
      texFormat,
      generation,
    };
  }

  function dispose() {
    if (atlasTex) {
      atlasTex.dispose();
      atlasTex = null;
    }
    slotByKey.clear();
  }

  const api = {
    supported,
    anchors: patched.anchors,
    uniforms,
    patchMaterial,
    setEnabled,
    setSpot,
    setSpotNeutral,
    setPoint,
    setPointNeutral,
    clearAllLights,
    writeCellForKey,
    releaseAllCells,
    resetAtlas,
    allocCell,
    uploadFrame,
    bumpGeneration,
    getState,
    dispose,
  };


  if (typeof window !== "undefined") {
    window.__rswIesCookie = window.__rswIesCookie || {};
    window.__rswIesCookie.patchState = () => getState();
  }

  return api;
}
