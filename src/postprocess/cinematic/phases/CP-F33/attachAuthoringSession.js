import { AUTHORING_SESSION_KEY } from "./authoringContract.js";
import { requireAuthoringSession } from "./authoringRegistry.js";
import { createScopedSettingsBinding } from "./scopedSettingsBinding.js";
export function attachAuthoringSession(settings, session) {
  requireAuthoringSession(session);
  const binding = createScopedSettingsBinding(settings); binding.write(AUTHORING_SESSION_KEY, session);
  return () => binding.dispose();
}
