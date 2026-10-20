import { requireAuthoringSession } from "./authoringRegistry.js";
import { authoringTextBytes } from "./authoringText.js";
import { callSynchronousHost } from "./synchronousHost.js";

export function createAuthoringPersistence({ storage, key = "CP-F33.document.v2" }) {
  if (typeof storage?.getItem !== "function" || typeof storage?.setItem !== "function" || typeof key !== "string" || !key.trim()) throw new TypeError("Persistence requires explicit storage and a nonempty key");
  return Object.freeze({
    save(session) {
      const text = requireAuthoringSession(session).export();
      callSynchronousHost(storage, "setItem", key, text);
      if (callSynchronousHost(storage, "getItem", key) !== text) throw new Error("Storage write was not acknowledged");
      return Object.freeze({ key, characters: text.length, bytes: authoringTextBytes(text) });
    },
    load(session, options) {
      requireAuthoringSession(session);
      const text = callSynchronousHost(storage, "getItem", key);
      if (text === null) return Object.freeze({ loaded: false, diagnostics: [] });
      const result = session.import(text, options);
      return Object.freeze({ loaded: true, diagnostics: result.diagnostics });
    }
  });
}
