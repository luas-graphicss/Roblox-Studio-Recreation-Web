import { DEFAULT_SETTINGS_SCHEMA, requireSettingsSchema } from "./settingsSchema.js";
import { createSettingsDocument, settingsDocumentSignatures } from "./settingsDocument.js";
import { canonicalStringify } from "./settingsValidation.js";

const sessions = new WeakSet();

export function createSettingsSession({ schema = DEFAULT_SETTINGS_SCHEMA, document = {}, historyLimit = 64 } = {}) {
  requireSettingsSchema(schema);
  if (!Number.isInteger(historyLimit) || historyLimit < 1 || historyLimit > 1024) throw new TypeError("History limit must be 1..1024");
  let authored = createSettingsDocument(schema, document);
  let serialized = canonicalStringify(authored);
  let signatures = settingsDocumentSignatures(authored);
  let state = Object.freeze({ document: authored, revisions: Object.freeze({ document: 0, spatial: 0, parameters: 0 }) });
  const undoStack = [];
  const redoStack = [];
  let editing = false;

  function apply(nextDocument) {
    const nextSignatures = settingsDocumentSignatures(nextDocument);
    state = Object.freeze({ document: nextDocument, revisions: Object.freeze({ document: state.revisions.document + 1, spatial: state.revisions.spatial + Number(signatures.spatial !== nextSignatures.spatial), parameters: state.revisions.parameters + Number(signatures.parameters !== nextSignatures.parameters) }) });
    signatures = nextSignatures;
    authored = nextDocument;
    serialized = canonicalStringify(authored);
    return state;
  }

  function replace(nextDocument) {
    if (editing) throw new Error("Nested settings edits are not allowed");
    const validated = createSettingsDocument(schema, nextDocument);
    if (canonicalStringify(validated) === serialized) return state;
    undoStack.push(authored);
    if (undoStack.length > historyLimit) undoStack.shift();
    redoStack.length = 0;
    return apply(validated);
  }

  const session = Object.freeze({
    schema,
    snapshot: () => state,
    replace,
    edit(update) {
      if (editing || typeof update !== "function") throw new TypeError("Expected a non-nested settings edit function");
      const draft = structuredClone(authored);
      editing = true;
      try {
        const result = update(draft);
        if (result && typeof result.then === "function") throw new TypeError("Settings edits must be synchronous");
      } finally { editing = false; }
      return replace(draft);
    },
    undo() {
      if (editing) throw new Error("Cannot undo inside an edit");
      if (undoStack.length === 0) return state;
      redoStack.push(authored);
      return apply(undoStack.pop());
    },
    redo() {
      if (editing) throw new Error("Cannot redo inside an edit");
      if (redoStack.length === 0) return state;
      undoStack.push(authored);
      return apply(redoStack.pop());
    },
    history: () => ({ undo: undoStack.length, redo: redoStack.length, limit: historyLimit })
  });
  sessions.add(session);
  return session;
}

export function requireSettingsSession(session) {
  if (!sessions.has(session)) throw new TypeError("CP-F02 requires a validated settings session, not a mutable document");
  return session;
}
