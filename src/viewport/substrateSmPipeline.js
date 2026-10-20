import { SSM_RELEASE_MANIFEST } from '../lighting/substrateSm/ssmReleaseManifest.js';
import {
  readSubstrateSmHostConfiguration,
  resolveSubstrateSmHostGate,
  sameSubstrateSmHostConfiguration,
} from './substrateSm/ssmHostGate.js';

const settled = Promise.resolve();

export function createSubstrateSmPipeline(setup = {}) {
  const loadDriver = setup.loadDriver ?? (() => import('./substrateSm/ssmHostBridge.js'));
  const manifest = setup.releaseManifest ?? SSM_RELEASE_MANIFEST;
  let configuration = null;
  let gateCode = 'SSM_HOST_NOT_CONFIGURED';
  let driver = null;
  let pending = null;
  let epoch = 0;
  let revision = 0;
  let disposed = false;
  let failure = null;
  let runtimeLoaded = false;
  let suspended = false;

  function reportError(error) {
    try { setup.onError?.(error); } catch { return false; }
    return true;
  }

  function releaseDriver(reason) {
    const previous = driver;
    driver = null;
    try { previous?.dispose(reason); } catch (error) { reportError(error); }
  }

  function notifyReady() {
    if (disposed) return;
    try { setup.onReady?.(); } catch (error) { reportError(error); }
  }

  function fail(error) {
    failure = error instanceof Error ? error.message : String(error);
    gateCode = 'SSM_HOST_RUNTIME_FAILED';
    releaseDriver(gateCode);
    reportError(error);
  }

  function beginLoad() {
    const loadEpoch = epoch;
    const operation = Promise.resolve().then(() => {
      if (disposed || loadEpoch !== epoch || gateCode !== null) return null;
      return loadDriver();
    }).then(module => {
      if (module === null) return;
      runtimeLoaded = true;
      if (disposed || loadEpoch !== epoch || gateCode !== null) return;
      if (typeof module.createSubstrateSmHostBridge !== 'function') {
        throw new TypeError('SSM_HOST_BRIDGE_FACTORY_REQUIRED');
      }
      const created = module.createSubstrateSmHostBridge({
        ...setup,
        readConfiguration: () => configuration,
        releaseManifest: manifest,
        onStateChanged: notifyReady,
      });
      if (disposed || loadEpoch !== epoch || gateCode !== null) {
        created.dispose('SSM_HOST_LOAD_SUPERSEDED');
        return;
      }
      driver = created;
      driver.configure(configuration);
      revision += 1;
      notifyReady();
    }).catch(error => {
      if (!disposed && loadEpoch === epoch) {
        fail(error);
        notifyReady();
      }
    }).finally(() => {
      if (pending === operation) pending = null;
    });
    pending = operation;
  }

  function configure(input) {
    if (disposed) return false;
    const next = readSubstrateSmHostConfiguration({
      ...input,
      contextGeneration: input?.contextGeneration ?? configuration?.contextGeneration ?? 0,
      projectGeneration: input?.projectGeneration ?? configuration?.projectGeneration ?? 0,
    });
    if (!suspended && sameSubstrateSmHostConfiguration(configuration, next)) return wantsMaterials();
    suspended = false;
    const previousGate = gateCode;
    configuration = next;
    gateCode = resolveSubstrateSmHostGate(configuration, manifest);
    epoch += 1;
    failure = null;
    if (gateCode !== null) {
      releaseDriver(gateCode);
      if (previousGate === null) revision += 1;
      return false;
    }
    if (driver) {
      try {
        driver.configure(configuration);
        revision += 1;
      } catch (error) { fail(error); }
    } else beginLoad();
    return wantsMaterials();
  }

  function wantsMaterials() {
    return !disposed && gateCode === null && driver !== null && failure === null;
  }

  function attachMaterial(material, mesh = null, site = 'external') {
    if (!wantsMaterials()) return false;
    try { return driver.attachMaterial(material, mesh, site) === true; }
    catch (error) { fail(error); return false; }
  }

  function detachMaterial(material, reason = 'SSM_HOST_MATERIAL_DETACHED') {
    if (!driver) return false;
    try { return driver.detachMaterial(material, reason) === true; }
    catch (error) { fail(error); return false; }
  }

  function invalidateSource(instance, property) {
    if (!driver) return false;
    try { return driver.invalidateSource(instance, property) === true; }
    catch (error) { fail(error); return false; }
  }

  function invalidateStructure(event) {
    if (!driver) return false;
    try { return driver.invalidateStructure(event) === true; }
    catch (error) { fail(error); return false; }
  }

  function runFrame(frame) {
    if (!wantsMaterials()) return false;
    try { return driver.runFrame(frame) === true; }
    catch (error) { fail(error); return false; }
  }

  function contextLost() {
    if (disposed || !configuration) return;
    configure({ ...configuration, contextAvailable: false });
  }

  function contextRestored() {
    if (disposed || !configuration) return;
    configure({ ...configuration, contextAvailable: true, contextGeneration: configuration.contextGeneration + 1 });
  }

  function resetProject() {
    if (disposed || !configuration) return;
    epoch += 1;
    releaseDriver('SSM_HOST_PROJECT_CHANGED');
    configure({ ...configuration, projectGeneration: configuration.projectGeneration + 1 });
  }

  function suspend(reason = 'SSM_SAFE_MODE') {
    if (disposed) return;
    epoch += 1;
    suspended = true;
    gateCode = reason;
    releaseDriver(reason);
  }

  function retry() {
    if (disposed || !configuration || gateCode !== 'SSM_HOST_RUNTIME_FAILED') return false;
    const current = configuration;
    configuration = null;
    configure(current);
    return true;
  }

  function snapshot() {
    return {
      phase: 'SSM-F25',
      state: disposed ? 'disposed' : failure ? 'fallback' : driver ? 'ready' : gateCode === null ? 'preparing' : 'dormant',
      code: disposed ? 'SSM_HOST_DISPOSED' : gateCode,
      requested: configuration?.enabled ?? null,
      requestedQuality: configuration ? configuration.quality : 'Auto',
      runtimeLoaded,
      runtimeReady: driver !== null,
      applied: false,
      registered: 0,
      releaseStatus: manifest.status,
      contextGeneration: configuration?.contextGeneration ?? 0,
      projectGeneration: configuration?.projectGeneration ?? 0,
      failure,
      ...(driver?.snapshot() ?? {}),
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    epoch += 1;
    gateCode = 'SSM_HOST_DISPOSED';
    releaseDriver(gateCode);
    configuration = null;
  }

  return Object.freeze({
    configure, wantsMaterials, attachMaterial, detachMaterial, invalidateSource, invalidateStructure,
    runFrame, contextLost, contextRestored, resetProject, suspend, retry, snapshot, dispose,
    owns: material => wantsMaterials() && driver.owns(material) === true,
    signature: () => wantsMaterials() ? `ssm-host-${revision}` : '',
    ready: () => pending ?? settled,
    isPreparingForDisplay: () => false,
    getDiagnostics: () => driver?.getDiagnostics() ?? snapshot(),
  });
}
