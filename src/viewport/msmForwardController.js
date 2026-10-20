import { createMegaLightsSmComposite } from './megaLightsSmComposite.js';
import { expandMsmShaderIncludes } from '../lighting/megalightsSm/msmShaderInspectionCore.js';
import { verifyShaderAnchors } from '../lighting/megalightsSm/msmPatchAnchorCore.js';
import { MSM_INJECTION_FRAGMENT_ANCHORS, MSM_INJECTION_VERTEX_ANCHORS,
  MSM_INJECTION_REQUIRED_SYMBOLS } from '../lighting/megalightsSm/msmCompositeInjectionGlsl.js';
import { setMsmForwardInjectionReservation } from '../lighting/megalightsSm/msmMaterialTextureAccountingCore.js';

import { resolveMsmForwardLightSegments } from '../lighting/megalightsSm/msmForwardLightSegmentsCore.js';
import { classifyMsmForwardReceiver } from './msmForwardReceiverPolicy.js';
import { resolveMsmForwardSpecular } from './msmForwardSpecular.js';

export function createMsmForwardController({ THREE, scene }) {
  const representativePosition = new THREE.Vector3();
  const composite = createMegaLightsSmComposite({ shaderChunks: THREE.ShaderChunk,
    consumerReady: true, previousViewProjection: new THREE.Matrix4(),
    forwardSpecular: true, representativePosition });
  const patched = new Set();
  const reservationOwner = Symbol('MSM forward controller');
  const stockChecks = new WeakMap();
  function checkStockShader(shader) {
    let result = stockChecks.get(shader);
    if (!result) {
      result = verifyShaderAnchors({ fragmentShader: shader.fragmentShader, vertexShader: shader.vertexShader,
        symbolSource: expandMsmShaderIncludes(shader.fragmentShader, THREE.ShaderChunk),
        fragmentAnchors: MSM_INJECTION_FRAGMENT_ANCHORS, vertexAnchors: MSM_INJECTION_VERTEX_ANCHORS,
        requiredSymbols: MSM_INJECTION_REQUIRED_SYMBOLS });
      stockChecks.set(shader, result);
    }
    return result;
  }
  const restoredLights = [];
  const frozenMatrix = new THREE.Matrix4();
  let active = false;
  let mode = 'A';
  let reason = 'screen-mode';
  let stochasticCount = 0;

  function restoreLights() {
    composite.setInjectionEnabled(false);
    for (const saved of restoredLights) {
      saved.light.visible = saved.visible;
      saved.light.intensity = saved.intensity;
    }
    restoredLights.length = 0;
  }

  function releaseMaterials() {
    composite.setInjectionEnabled(false);
    for (const material of patched) composite.unpatchMaterial(material);
    patched.clear();
    setMsmForwardInjectionReservation(false, reservationOwner);
  }

  function resolveMode(requestedMode) {
    restoreLights();
    mode = 'A';
    active = false;
    composite.setInjectionEnabled(false);
    if (requestedMode !== 'B' || !scene) {
      reason = requestedMode === 'B' ? 'missing-scene' : 'screen-mode';
      releaseMaterials();
      return mode;
    }
    const receivers = new Set();
    let unsupported = '';
    scene.traverseVisible(object => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        const receiver = classifyMsmForwardReceiver(material, object);
        if (receiver.kind === 'ignored') continue;
        const shader = THREE.ShaderLib[receiver.shaderName];
        if (receiver.kind !== 'supported' || !shader) {
          unsupported = receiver.reason || 'missing-stock-shader';
          continue;
        }
        const check = checkStockShader(shader);
        if (!check.ok) unsupported = check.reason;
        else receivers.add(material);
      }
    });
    if (unsupported || receivers.size === 0) {
      reason = unsupported || 'no-supported-receivers';
      releaseMaterials();
      return mode;
    }
    for (const material of patched) {
      if (!receivers.has(material)) { composite.unpatchMaterial(material); patched.delete(material); }
    }
    for (const material of receivers) {
      const record = material.userData?.__rswMsmInjection;
      if (!patched.has(material) || !record || material.onBeforeCompile !== record.patchHandler ||
          material.customProgramCacheKey !== record.keyHandler || material.onBeforeRender !== record.renderHandler) {
        composite.patchMaterial(material);
        patched.add(material);
      }
    }
    mode = 'B';
    reason = 'waiting-for-history';
    setMsmForwardInjectionReservation(true, reservationOwner);
    return mode;
  }

  function prepare({ texture, previousViewProjection, lights, strength, preserveLightIndices, tier, specular }) {
    restoreLights();
    active = false;
    stochasticCount = 0;
    composite.setInjectionEnabled(false);
    if (mode !== 'B' || !texture || !(strength > 0)) return false;
    const byId = new Map();
    scene.traverseVisible(object => { if (object.isLight) byId.set(object.uuid, object); });
    const owned = lights.map(record => record.threeLight || byId.get(record.lightKey));
    if (owned.some(light => !light)) { reason = 'missing-forward-light-handle'; return false; }
    frozenMatrix.copy(previousViewProjection);
    composite.setInjectionEnabled(true);
    const specularEnabled = resolveMsmForwardSpecular({ tier, enabled: specular, lights, target: representativePosition });
    for (const light of owned) {
      restoredLights.push({ light, intensity: light.intensity, visible: light.visible });


      if (preserveLightIndices) light.intensity = 0;
      else light.visible = false;
    }
    const nativeLightSegments = resolveMsmForwardLightSegments(byId.values());
    composite.syncFrame({ historyTexture: texture, previousViewProjection: frozenMatrix, injectionGain: 1,
      specularEnabled, nativeLightSegments });
    stochasticCount = owned.length;
    active = true;
    reason = '';
    return true;
  }

  return {
    resolveMode, prepare, restoreLights,
    describe: () => ({ mode, active, reason, stochasticCount, ...composite.getTelemetry() }),
    dispose: () => { restoreLights(); releaseMaterials(); active = false; },
  };
}
