import { createSettingsSchema, createSettingsSession, SETTINGS_SOURCE_KEY } from "../CP-F02/index.js";
import { MATERIAL_SESSION_KEY } from "../CP-F26/index.js";
import { OUTPUT_SETTINGS_KEY } from "../CP-F28/index.js";
import { CAMERA_SETTINGS_KEY } from "../CP-F03/cameraIdentifiers.js";
import { authoringSessionInternals } from "./authoringRegistry.js";
import { createScopedSettingsBinding } from "./scopedSettingsBinding.js";
import { createMaterialAuthoringBinding } from "./materialAuthoringBinding.js";
import { callSynchronousHost } from "./synchronousHost.js";
import { canonicalJson, translateAuto, freezeAuthoringData, reject } from "./authoringData.js";

export function createRuntimeAuthoringBinding(session, services, { lightingBridge } = {}) {
  const internals = authoringSessionInternals(session);
  if (internals.bindingCount()) throw new Error("An authoring session can own only one runtime binding");
  const initial = session.snapshot().document;
  const settingsSession = createSettingsSession({ schema: createSettingsSchema(initial.settingsSchema), document: initial.settings });
  const materials = createMaterialAuthoringBinding(initial.materials);
  const scoped = createScopedSettingsBinding(services.settings); const signatures = new Map();
  let viewKeys = new Set(); let lastRevision = -1; let disposed = false;
  if (lightingBridge && ![lightingBridge.validate, lightingBridge.apply, lightingBridge.release].every(value => typeof value === "function")) throw new TypeError("Lighting bridge requires validate, apply and release");
  function validate(document, previous = initial) {
    for (const section of ["materials", "settingsSchema"]) if (canonicalJson(document[section]) !== canonicalJson(previous[section])) reject("requires-reinstall", `$.${section}`, "Structural changes require detaching and reinstalling affected phases");
    if (Object.keys(document.lighting).length && !lightingBridge) reject("missing-lighting-bridge", "$.lighting", "Provide an explicit host-owned lighting bridge");
    if (lightingBridge && callSynchronousHost(lightingBridge, "validate", document.lighting) === false) reject("invalid-lighting-value", "$.lighting", "The host rejected the lighting document");
  }
  validate(initial);
  const removeGuard = internals.addGuard(validate);
  function writeChanged(key, value) {
    const signature = canonicalJson(value);
    if (signature !== signatures.get(key)) { scoped.write(key, freezeAuthoringData(value)); signatures.set(key, signature); }
  }
  function sync() {
    if (disposed) throw new Error("Authoring runtime is disposed");
    scoped.verify();
    const snapshot = session.snapshot();
    if (snapshot.revision === lastRevision) return snapshot;
    const document = snapshot.document;
    settingsSession.replace(document.settings); materials.update(document.materialControls);
    writeChanged(CAMERA_SETTINGS_KEY, translateAuto(document.camera.global));
    const nextKeys = new Set();
    for (const [id, configuration] of Object.entries(document.camera.views)) {
      const key = `${CAMERA_SETTINGS_KEY}.${id}`; nextKeys.add(key); writeChanged(key, translateAuto(configuration));
    }
    for (const key of viewKeys) if (!nextKeys.has(key)) { scoped.restore(key); signatures.delete(key); }
    viewKeys = nextKeys;
    writeChanged(OUTPUT_SETTINGS_KEY, translateAuto(document.output)); lastRevision = snapshot.revision;
    return snapshot;
  }
  function dispose() {
    if (disposed) return; disposed = true; removeGuard();
    const errors = [];
    try { if (lightingBridge) callSynchronousHost(lightingBridge, "release"); } catch (error) { errors.push(error); }
    try { scoped.dispose(); } catch (error) { errors.push(error); }
    signatures.clear(); viewKeys.clear();
    if (errors.length) throw new AggregateError(errors, "Authoring binding cleanup reported host errors");
  }
  try { scoped.write(SETTINGS_SOURCE_KEY, settingsSession); scoped.write(MATERIAL_SESSION_KEY, materials.session); sync(); }
  catch (error) { dispose(); throw error; }
  return Object.freeze({ prepare() { const snapshot = sync(); if (lightingBridge) callSynchronousHost(lightingBridge, "apply", snapshot.document.lighting); return snapshot; }, dispose });
}
