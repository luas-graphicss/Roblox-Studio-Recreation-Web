import { createMegaLightsSmPipeline } from "./megaLightsSmPipeline.js";
import { createMsmForwardController } from './msmForwardController.js';
import { buildMsmScreenResolveGlsl, createMsmScreenResolve } from './msmScreenResolve.js';
import { getMsmTierPolicy } from '../lighting/megalightsSm/msmTierPolicy.js';
import {
  MSM_DEFAULT_STRENGTH,
  resolveMsmViewportSettings,
} from "../lighting/megalightsSm/msmViewportSettingsCore.js";
import {
  MSM_COMPOSITE_MODE_SCREEN,
  MSM_QA_GLOBAL_NAME,
  MSM_TELEMETRY_KEY,
} from "../lighting/megalightsSm/msmPipelineContract.js";
import {
  buildScreenCompositeGlsl,
  buildScreenCompositeUniformDeclarations,
} from "../lighting/megalightsSm/msmScreenCompositeGlsl.js";
import {
  buildDebugViewGlsl,
  buildDebugViewUniformDeclarations,
} from "../lighting/megalightsSm/msmDebugViewGlsl.js";

export const MSM_DEFAULT_TIER = "lite";
export const MSM_DEFAULT_COMPOSITE_STRENGTH = MSM_DEFAULT_STRENGTH;
export const MSM_COMPOSITE_SLEEP_REASON = Object.freeze({
  FLAG_OFF: "flag-off",
  NO_LIGHTS: "no-eligible-local-lights",
  GPU_PROFILE_SAYS_NO: "auto-strong-gpu",
});

import { readMsmRuntimeHost } from './msmRuntimeHost.js';
import { summarizeMsmTelemetry } from '../lighting/megalightsSm/msmTelemetryCore.js';

export function resolveMegaLightsSmWakeDecision(state) {
  const host = typeof window === "undefined" ? null : window[MSM_QA_GLOBAL_NAME];
  return resolveMsmViewportSettings(state, host || {});
}

function lightCounts(state) {
  return {
    lightCount: state && state.msmLights ? state.msmLights.length : 0,
    candidateCount: state ? state.msmCandidateCount || 0 : 0,
    residentShadowCount: state ? state.msmResidentCount || 0 : 0,
    atlasShadowCount: state ? state.msmAtlasResidentCount || 0 : 0,
    nativeShadowCount: state ? Math.max(0, (state.msmResidentCount || 0) - (state.msmAtlasResidentCount || 0)) : 0,
  };
}


export function isMegaLightsSmChainWanted(state, requestRender) {
  const host = readMsmRuntimeHost(requestRender);
  const decision = resolveMegaLightsSmWakeDecision(state);
  if (host && !decision.awake) {
    host.get = () => summarizeMsmTelemetry({
      enabled: false, compositing: false, flagToken: decision.token,
      sleepReason: decision.reason, tier: decision.tier,
      strength: decision.strength, view: decision.view,
      ...lightCounts(state),
    });
    host[MSM_TELEMETRY_KEY] = host.get;
  }
  return decision.awake;
}

export function createMegaLightsSmScreenCompositePass(dependencies) {
  const options = dependencies || {};
  const { THREE, FullScreenQuad } = options;
  if (!THREE || !FullScreenQuad) throw new Error("MSM composite requires THREE and FullScreenQuad");
  const samplePass = createMegaLightsSmPipeline({
    THREE, FullScreenQuad, renderer: options.renderer || null,
    camera: options.camera || null, sharedDepth: options.sharedDepth || null, scene: options.scene || null,
    getPassTiming: options.getPassTiming, requestRender: options.requestRender,
  });
  const forward = createMsmForwardController({ THREE, scene: options.scene || null });
  const uniforms = {
    tDiffuse: { value: null },
    tMsmIrradiance: { value: null },
    uMsmCompositeTexel: { value: new THREE.Vector2(1, 1) },
    uMsmCompositeStrength: { value: MSM_DEFAULT_STRENGTH },
    uMsmCompositeBaseLuminance: { value: 0 },
    uMsmCompositeOn: { value: 0 },
    uMsmCompositeDebugMode: { value: 0 },
  };
  const screenResolve = createMsmScreenResolve({ THREE, uniforms, sceneUniforms: samplePass.sceneUniforms() });
  const material = new THREE.ShaderMaterial({
    name: "MsmScreenComposite",
    uniforms,
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: [
      "precision highp float;", "varying vec2 vUv;", "uniform sampler2D tDiffuse;",
      buildScreenCompositeUniformDeclarations(), buildDebugViewUniformDeclarations(),
      buildScreenCompositeGlsl(), buildMsmScreenResolveGlsl(), buildDebugViewGlsl(),
      "void main() {",
      "  vec4 sceneColor = texture2D(tDiffuse, vUv);",
      "  vec3 compositedColor = msmResolveScreenColor(sceneColor.rgb, vUv);", 


      "  gl_FragColor = vec4(msmApplyDebugView(compositedColor, vUv, uMsmCompositeDebugMode * uMsmCompositeOn), sceneColor.a);",
      "}",
    ].join("\n"),
    depthTest: false,
    depthWrite: false,
  });
  const quad = new FullScreenQuad(material);
  const pass = {
    enabled: false, needsSwap: true, clear: false, renderToScreen: false,
    passId: "msm-screen-composite", compositeMode: MSM_COMPOSITE_MODE_SCREEN,
  };
  let frameWidth = 1;
  let frameHeight = 1;
  let compositedFrameCount = 0;
  let lastState = null;
  let activeMode = 'A';
  let sampledLights = [];
  let settings = resolveMsmViewportSettings(null);
  let sleepReason = MSM_COMPOSITE_SLEEP_REASON.NO_LIGHTS;

  pass.debugState = () => ({
    mode: activeMode,
    requestedMode: settings.mode,
    forward: forward.describe(),
    enabled: pass.enabled,
    compositing: uniforms.uMsmCompositeOn.value === 1 || forward.describe().active,
    flagToken: settings.token,
    wakeReason: settings.awake ? settings.reason : "",
    sleepReason,
    tier: settings.tier,
    strength: uniforms.uMsmCompositeStrength.value,
    view: settings.view,
    baseLuminance: uniforms.uMsmCompositeBaseLuminance.value,
    frameWidth, frameHeight, compositedFrameCount,
    ...lightCounts(lastState),
    sample: samplePass.describe(),
    upsample: screenResolve.describe(),
    atlasSchedule: lastState?.msmAtlasSchedule || null,
  });

  const getTelemetry = () => summarizeMsmTelemetry(pass.debugState());
  function publishTelemetry() {
    const host = readMsmRuntimeHost(options.requestRender);
    if (!host) return;
    host.get = getTelemetry;
    host.runtimeQuality = pass.enabled ? samplePass.qualitySettings() : null;
    host[MSM_TELEMETRY_KEY] = host.get;
  }

  pass.applyState = function applyState(state) {
    lastState = state || null;
    settings = resolveMegaLightsSmWakeDecision(lastState);
    activeMode = forward.resolveMode(settings.awake && settings.strength > 0 ? settings.mode : 'A');
    pass.compositeMode = activeMode;
    uniforms.uMsmCompositeStrength.value = settings.strength;
    uniforms.uMsmCompositeDebugMode.value = settings.debugMode;
    uniforms.uMsmCompositeOn.value = 0;
    sleepReason = settings.awake ? "" : settings.reason;
    if (!settings.awake) {
      pass.enabled = false;
      samplePass.applyState(null);
      publishTelemetry();
      return false;
    }
    const candidates = activeMode === 'B' ? lastState.msmAllLights || lastState.msmLights : lastState.msmLights;
    sampledLights = candidates.slice(0, getMsmTierPolicy(settings.tier).lightCap);
    pass.enabled = samplePass.applyState({
      tier: settings.tier, mode: activeMode, options: settings.phases, strength: settings.strength,
      proxyCandidates: lastState.msmProxyCandidates,
      lights: sampledLights, atlas: lastState.msmAtlas || lastState.atlas,
      frame: lastState.frame || 0,
    });
    const activeKeys = new Set(samplePass.activeLightKeys());
    sampledLights = sampledLights.filter(light => activeKeys.has(String(light.lightKey)));
    if (pass.enabled) forward.prepare({ texture: samplePass.irradianceTexture(),
      previousViewProjection: samplePass.previousViewProjection(),
      lights: sampledLights, strength: settings.strength, preserveLightIndices: !!lastState.atlas?.on,
      tier: settings.tier, specular: settings.phases.specular });
    if (!pass.enabled) sleepReason = samplePass.sleepReason() || MSM_COMPOSITE_SLEEP_REASON.NO_LIGHTS;
    uniforms.uMsmCompositeBaseLuminance.value = Number.isFinite(lastState.msmBaseLum)
      ? Math.max(0, lastState.msmBaseLum) : 0;
    publishTelemetry();
    return pass.enabled;
  };

  pass.isConverged = () => samplePass.isConverged() && !lastState?.msmPartition?.pending;
  pass.invalidateMaterialHistory = () => {
    forward.restoreLights();
    samplePass.invalidateMaterialHistory();
  };
  pass.afterRender = () => { forward.restoreLights(); samplePass.endFrame?.(); };

  pass.setSize = function setSize(width, height) {
    frameWidth = Math.max(1, Math.floor(width) || 1);
    frameHeight = Math.max(1, Math.floor(height) || 1);
  };

  pass.render = function render(renderer, writeBuffer, readBuffer) {
    forward.restoreLights();
    if (!renderer || !readBuffer) return;
    frameWidth = readBuffer.width || frameWidth;
    frameHeight = readBuffer.height || frameHeight;
    const sampled = pass.enabled && samplePass.render(renderer, frameWidth, frameHeight);
    const irradiance = sampled ? samplePass.irradianceTexture() : null;
    if (irradiance) {
      const reduced = samplePass.reducedSize();
      uniforms.tMsmIrradiance.value = irradiance;
      uniforms.uMsmCompositeTexel.value.set(1 / reduced.width, 1 / reduced.height);
      screenResolve.update({ tier: settings.tier, ...reduced });
      uniforms.uMsmCompositeOn.value = activeMode === 'A' ? 1 : 0;
      sleepReason = "";
      compositedFrameCount += 1;
    } else {
      uniforms.uMsmCompositeOn.value = 0;
      if (pass.enabled) sleepReason = samplePass.sleepReason() || sleepReason;
    }
    uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(pass.renderToScreen ? null : writeBuffer);
    if (pass.clear) renderer.clear();
    if (samplePass.measureComposite) samplePass.measureComposite(() => quad.render(renderer));
    else quad.render(renderer);
    publishTelemetry();
  };

  pass.dispose = function dispose() {
    pass.enabled = false;
    uniforms.uMsmCompositeOn.value = 0;
    sleepReason = "disposed";
    quad.dispose();
    material.dispose();
    samplePass.dispose();
    forward.dispose();
    const host = readMsmRuntimeHost(options.requestRender);
    if (host?.get === getTelemetry) host.runtimeQuality = null;

  };

  publishTelemetry();
  return pass;
}
