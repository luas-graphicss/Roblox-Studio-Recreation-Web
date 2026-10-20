import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { installSettingsPhase } from "./settingsBridge.js";

export { createSettingsSchema, DEFAULT_SETTINGS_SCHEMA } from "./settingsSchema.js";
export { createSettingsDocument, serializeSettingsDocument, deserializeSettingsDocument } from "./settingsDocument.js";
export { createSettingsSession } from "./settingsSession.js";
export { createVolumeResolver, SETTINGS_BLEND_POLICY } from "./volumeResolver.js";
export { attachSettingsSession, SETTINGS_SOURCE_KEY, RESOLVED_SETTINGS_RESOURCE, SETTINGS_PASS_ID } from "./settingsBridge.js";

export default Object.freeze({ id: "CP-F02", contractVersion: CONTRACT_VERSION, status: "implemented", install: installSettingsPhase });
