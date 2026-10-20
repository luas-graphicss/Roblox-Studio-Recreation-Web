const bridge = {
  getActiveScript: null,
  insertAtCursor: null,
  forceSuggest: null,
};

export function registerEditorBridge(handlers) {
  if (!handlers || typeof handlers !== "object") return;
  if (typeof handlers.getActiveScript === "function") bridge.getActiveScript = handlers.getActiveScript;
  if (typeof handlers.insertAtCursor === "function") bridge.insertAtCursor = handlers.insertAtCursor;
  if (typeof handlers.forceSuggest === "function") bridge.forceSuggest = handlers.forceSuggest;
}

export function getActiveScriptInfo() {
  if (!bridge.getActiveScript) return null;
  try {
    return bridge.getActiveScript() || null;
  } catch (_) {
    return null;
  }
}

export function canInsertIntoScript() {
  return !!bridge.insertAtCursor && !!getActiveScriptInfo();
}

export function insertIntoActiveScript(code) {
  if (!bridge.insertAtCursor) return false;
  try {
    return bridge.insertAtCursor(String(code || "")) === true;
  } catch (_) {
    return false;
  }
}

export function forceCodeAssistSuggestion() {
  if (!bridge.forceSuggest) return false;
  try {
    bridge.forceSuggest();
    return true;
  } catch (_) {
    return false;
  }
}
