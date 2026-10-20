import * as contract from '../lighting/substrate/sbMaterialContract.js';
import { SB_PHASE_MANIFEST } from '../lighting/substrate/sbPhaseManifest.js';
import { createSubstrateFeatureFlags } from '../lighting/substrate/runtime/substrateFeatureFlags.js';
import { createSubstrateTelemetry } from '../lighting/substrate/runtime/substrateTelemetry.js';
import { createSubstrateFrameGraph } from '../lighting/substrate/runtime/substrateFrameGraph.js';
import { createSubstrateShaderRegistry } from '../lighting/substrate/runtime/substrateShaderRegistry.js';
import { createSubstrateMaterialRuntime } from '../lighting/substrate/runtime/substrateMaterialRuntime.js';
import { setSubstrateHostSurface, releaseSubstrateHostSurface } from '../lighting/substrate/runtime/substrateHostSurface.js';
import { REQUIRED_RUNTIME_FLAGS } from '../lighting/substrate/sbRuntimeFeaturePolicy.js';
import { installRuntimeControlBridge } from '../lighting/substrate/sbRuntimeControlBridge.js';
import { substrateWantsMaterials } from './substratePipeline.js';
import { RUNTIME_SCREEN_UNIFORMS } from '../lighting/substrate/sbRuntimeClosureShader.js';
const SCREEN_UNIFORM_DEFAULTS = Object.freeze([
  [RUNTIME_SCREEN_UNIFORMS.dbuffer, null], [RUNTIME_SCREEN_UNIFORMS.dbufferSize, [1, 1]], [RUNTIME_SCREEN_UNIFORMS.dbufferOn, 0],
  [RUNTIME_SCREEN_UNIFORMS.dbufferParams, [0.5, 1, 1, 0]], [RUNTIME_SCREEN_UNIFORMS.oitAccumulate, 0], [RUNTIME_SCREEN_UNIFORMS.reflectionTracking, 1],
  [RUNTIME_SCREEN_UNIFORMS.dbufferNormal, null], [RUNTIME_SCREEN_UNIFORMS.sceneColor, null], [RUNTIME_SCREEN_UNIFORMS.sceneDepth, null],
  [RUNTIME_SCREEN_UNIFORMS.sceneParams, [0.1, 1000, 0, 0]], [RUNTIME_SCREEN_UNIFORMS.sceneSize, [1, 1]],
]);
const DECAL_NORMAL_WEIGHT = 1;
export function createSubstrateEngineDriver({ THREE, renderer, scene, readConfiguration, onReady }) {
  const telemetry = createSubstrateTelemetry();
  const flags = createSubstrateFeatureFlags(() => ({ SubstrateEnabled: readConfiguration().enabledFlag }));
  const graph = createSubstrateFrameGraph(telemetry);
  const readTier = () => readConfiguration().tierName;
  const registry = createSubstrateShaderRegistry({ THREE, flags, telemetry, readTier });
  let initialized = false;
  let disposed = false;
  let camera = null;
  let lastFrame = null;
  let frames = 0;
  const phaseReports = [];
  let certificationSession = null;
  const screenEvidence = {};
  for (const [name, value] of SCREEN_UNIFORM_DEFAULTS) registry.registerUniform(name, { owner: 'engine', value: Array.isArray(value) ? [...value] : value });
  const screen = {
    active: () => allowed(),
    tier: readTier,
    flag: id => flags.isFlagActive(id, readTier()),
    setUniform(name, value) { return registry.setUniform(name, value); },
    readUniform: name => registry.readUniform(name),
    subsurfaceHosts: () => allowed() ? runtime.subsurfaceHosts() : [],
    translucentHosts: () => allowed() ? runtime.translucentHosts() : [],
    waterHosts: () => allowed() ? runtime.waterHosts() : [],
    decalParameters() {
      const decal = registry.readUniform('uSbDecal');
      const roughness = Array.isArray(decal) ? Number(decal[0]) : Number(decal?.x);
      return [Number.isFinite(roughness) ? roughness : 0.5, 1, DECAL_NORMAL_WEIGHT, 0];
    },
    reportEvidence(id, data) { screenEvidence[id] = { ...data, frame: frames, at: typeof performance !== 'undefined' ? performance.now() : Date.now() }; },
    evidence: () => ({ ...screenEvidence }),
  };
  const allowed = () => initialized && !disposed && substrateWantsMaterials(readConfiguration()) && REQUIRED_RUNTIME_FLAGS.every(id => flags.isFlagActive(id, readTier()));
  const runtime = createSubstrateMaterialRuntime({ THREE, flags, telemetry, readGate: allowed, readTier, readUniform: registry.readUniform });
  const bench = { THREE, renderer, scene, get camera() { return camera; }, tier: readTier, redraw: () => onReady?.() };
  const host = {
    host: 'engine', internals: { THREE, bench }, runtime, tier: readTier,
    flags: () => flags.listFlags(readTier()),
    flag(id, value) { if (value === undefined) return flags.flagState(id, readTier()); const result = flags.setFlag(id, value); runtime.refresh(); registry.healMaterials(); onReady?.(); return result; },
    heal: () => registry.healMaterials(), redraw: () => onReady?.(),
    screen, parityEvidence: () => ({ screen: { ...screenEvidence }, phases: phaseReports.map(report => ({ ...report })) }),
  };
  setSubstrateHostSurface(host);
  const context = {
    host: 'engine', THREE, renderer, scene, bench, contract, flags, patch: registry,
    passes: graph, frameStages: graph, telemetry, materialRuntime: runtime,
    materials: { currentPath: () => 'standard', paths: () => ['standard', 'physical', 'poolPhong', 'terreno', 'skinned'] },
    scenes: { registerScene() { return { accepted: false, reason: 'Lab scenes are not installed into the engine' }; } },
  };
  async function initialize() {
    for (const phase of SB_PHASE_MANIFEST) {
      if (disposed) return;
      if (phase.pendingReason) { phaseReports.push({ id: phase.id, state: 'pending', reason: phase.pendingReason }); continue; }
      try {
        await new Promise(resolve => setTimeout(resolve, 0));
        const module = await phase.load();
        if (disposed) return;
        const report = await module.installPhase(context);
        if (phase.id === "SB-F37" && report?.installed && report.session) certificationSession = report.session;
        const failed = report?.installed === false || report?.refusals?.length > 0;
        phaseReports.push({ id: phase.id, state: failed ? 'refused' : 'installed', summary: report?.summary ?? null, refusals: report?.refusals ?? [] });
      } catch (error) {
        phaseReports.push({ id: phase.id, state: 'failed', reason: error?.message || String(error) });
        telemetry.error(phase.id, error?.message || String(error));
      }
    }
    const missing = REQUIRED_RUNTIME_FLAGS.filter(id => !flags.flagState(id, readTier()).known);
    if (missing.length) throw new Error('Required Substrate phases did not install: ' + missing.join(', '));
    const requiredPhases = new Set(["SB-F2", "SB-F3", "SB-F4", "SB-F6", "SB-F8", "SB-F9", "SB-F31", "SB-F33"]);
    const failedPhases = phaseReports.filter(phase => requiredPhases.has(phase.id) && phase.state !== "installed");
    if (failedPhases.length) throw new Error("Required Substrate phase refusal: " + failedPhases.map(phase => phase.id).join(", "));
    installRuntimeControlBridge(host);
    initialized = true;
    telemetry.contractVersion(contract.SB_CONTRACT_VERSION);
    telemetry.threeRevision(THREE.REVISION);
  }
  function attachMaterial(material) {
    if (!allowed() || !material?.isMeshStandardMaterial) return false;
    material.userData.sbMaterialPath = material.userData.__rswSbPool ? 'poolPhong' : material.isMeshPhysicalMaterial ? 'physical' : 'standard';
    runtime.register(material);
    return registry.patchMaterial(material);
  }
  function detachMaterial(material) { registry.forgetMaterial(material); runtime.forget(material); }
  return {
    initialize, ready: () => initialized, wantsMaterials: allowed,
    configure() { if (initialized) runtime.refresh(); },
    signature: () => readTier() + ':' + flags.listFlags(readTier()).map(flag => flag.on ? '1' : '0').join(''),
    attachMaterial, detachMaterial, owns: runtime.owns,
    runFrame(request) {
      if (!allowed()) return;
      camera = request.camera;
      lastFrame = { ...request, THREE, renderer, scene, camera, tier: readTier(), tierDefaults: contract.tierDefaults(readTier()), frameSource: 'engine-render-loop', deltaMilliseconds: request.deltaMilliseconds || 0 };
      graph.runStage('beforeMaterials', lastFrame);
      graph.runPasses(lastFrame);
      graph.runStage('beforeRender', lastFrame);
      const tracking = flags.isFlagActive('SubstrateRoughnessTracking', readTier());
      registry.setUniform(RUNTIME_SCREEN_UNIFORMS.reflectionTracking, tracking ? 1 : 0);
      registry.setUniform(RUNTIME_SCREEN_UNIFORMS.dbufferParams, screen.decalParameters());
      if (frames % 30 === 0) {
        const counts = runtime.specializedHostCounts();
        screen.reportEvidence('specializedClosures', { ...counts, tier: readTier() });
        screen.reportEvidence('roughnessTracking', { on: tracking, consumer: 'ssr-alpha-roughness', hosts: counts.slab + counts.hair + counts.eye + counts.singleLayerWater });
        screen.reportEvidence('domains', { volume: counts.volume, unlit: counts.unlit, lightFunction: flags.isFlagActive('SubstrateDomainLightFunction', readTier()) });
      }
      frames++;
    },
    afterRender(milliseconds) { if (lastFrame && allowed()) { lastFrame.frameMilliseconds = milliseconds; graph.runStage('afterRender', lastFrame); } },
    contextRestored() { registry.bumpGeneration(); runtime.refresh(); },
    api: () => host,
    screen: () => screen,
    snapshot: () => ({ frames, phases: phaseReports, screenEvidence: { ...screenEvidence }, runtime: runtime.status(), graph: graph.snapshot(), shaders: registry.snapshot(), errors: telemetry.errors(), refusedPatches: telemetry.get().refusedPatches, parityCertification: certificationSession ? certificationSession.report() : null, parityCertified: certificationSession?.report().certified === true }),
    dispose() { disposed = true; runtime.dispose(); registry.dispose(); graph.dispose(); releaseSubstrateHostSurface(host); },
  };
}
