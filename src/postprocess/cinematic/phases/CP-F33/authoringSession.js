import { AUTHORING_API_VERSION } from "./authoringContract.js";
import { createPostProcessDocument, capturePresetState } from "./authoringDocument.js";
import { importPostProcessDocument } from "./authoringMigrations.js";
import { applyAuthoringCommands } from "./authoringCommands.js";
import { registerAuthoringSession } from "./authoringRegistry.js";
import { copyAuthoringData, freezeAuthoringData, canonicalJson, requireIdentifier, reject } from "./authoringData.js";

export function createPostProcessAuthoringSession({ document = {}, historyLimit = 64 } = {}) {
  if (!Number.isInteger(historyLimit) || historyLimit < 1 || historyLimit > 1024) throw new RangeError("History limit must be 1..1024");
  let authored = createPostProcessDocument(document);
  let serialized = canonicalJson(authored);
  let revision = 0;
  let busy = false;
  let snapshot = freezeAuthoringData({ document: authored, revision, canUndo: false, canRedo: false, changedSections: [] });
  const undoStack = []; const redoStack = [];
  const subscribers = new Set(); const guards = new Set(); const listenerErrors = [];
  function assertIdle() { if (busy) throw new Error("Authoring transactions and notifications cannot be nested"); }
  function commit(input, direction = "edit") {
    assertIdle();
    const validated = createPostProcessDocument(input);
    const nextSerialized = canonicalJson(validated);
    if (nextSerialized === serialized) return snapshot;
    busy = true;
    try {
      for (const guard of guards) guard(validated, authored);
      const changedSections = Object.keys(validated).filter(key => canonicalJson(validated[key]) !== canonicalJson(authored[key]));
      if (direction === "undo") { undoStack.pop(); redoStack.push(authored); }
      else if (direction === "redo") { redoStack.pop(); undoStack.push(authored); }
      else { undoStack.push(authored); redoStack.length = 0; }
      if (undoStack.length > historyLimit) undoStack.shift();
      authored = validated; serialized = nextSerialized; revision += 1;
      snapshot = freezeAuthoringData({ document: authored, revision, canUndo: undoStack.length > 0, canRedo: redoStack.length > 0, changedSections });
      for (const subscriber of [...subscribers]) {
        try { subscriber(snapshot); }
        catch (error) { listenerErrors.push(String(error?.message ?? error)); if (listenerErrors.length > 16) listenerErrors.shift(); }
      }
      return snapshot;
    } finally { busy = false; }
  }
  function edit(update) {
    assertIdle();
    if (typeof update !== "function") throw new TypeError("An edit must be a synchronous function");
    const draft = copyAuthoringData(authored);
    busy = true;
    try {
      const result = update(draft);
      if (result && typeof result.then === "function") { Promise.resolve(result).catch(() => {}); throw new TypeError("An authoring edit must be synchronous"); }
    } finally { busy = false; }
    return commit(draft);
  }
  const session = Object.freeze({
    apiVersion: AUTHORING_API_VERSION, snapshot: () => snapshot, export: () => serialized, replace: input => commit(input), edit,
    dispatch: commands => { assertIdle(); return commit(applyAuthoringCommands(copyAuthoringData(authored), commands)); },
    import(text, options) { assertIdle(); const result = importPostProcessDocument(text, options); commit(result.document); return result; },
    undo: () => { assertIdle(); return undoStack.length ? commit(undoStack.at(-1), "undo") : snapshot; },
    redo: () => { assertIdle(); return redoStack.length ? commit(redoStack.at(-1), "redo") : snapshot; },
    history: () => Object.freeze({ undo: undoStack.length, redo: redoStack.length, limit: historyLimit }),
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Subscriber must be a function");
      if (subscribers.size >= 128) throw new RangeError("Subscriber limit reached");
      subscribers.add(listener); return () => subscribers.delete(listener);
    },
    listenerErrors: () => Object.freeze([...listenerErrors]),
    savePreset({ id, name }) {
      requireIdentifier(id, "$.preset.id");
      return edit(draft => {
        const preset = { id, name, state: capturePresetState(draft) };
        const index = draft.presets.findIndex(entry => entry.id === id);
        if (index < 0) draft.presets.push(preset); else draft.presets[index] = preset;
      });
    },
    applyPreset: id => { assertIdle(); return commit(applyAuthoringCommands(copyAuthoringData(authored), [{ type: "preset", id }])); },
    removePreset(id) { return edit(draft => { const index = draft.presets.findIndex(preset => preset.id === id); if (index < 0) reject("unknown-preset", "$", "Preset does not exist"); draft.presets.splice(index, 1); }); }
  });
  registerAuthoringSession(session, Object.freeze({ addGuard(guard) { guards.add(guard); return () => guards.delete(guard); }, bindingCount: () => guards.size }));
  return session;
}
