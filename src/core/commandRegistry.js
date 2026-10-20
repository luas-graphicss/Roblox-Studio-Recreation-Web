import { logger } from "./logger.js";

function isTyping(node) {
  if (!node || typeof node !== "object") return false;
  const tag = (node.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (node.isContentEditable === true) return true;
  return false;
}

class CommandRegistry {
  constructor() {
    this._cmds = new Map();
    this._wired = false;
    this._isBlocked = () => false;
  }

  register(id, def) {
    if (!id || typeof id !== "string" || !def || typeof def.run !== "function") {
      logger.warn("CommandRegistry.register: definição inválida para \"" + String(id) + "\".");
      return;
    }
    this._cmds.set(id, {
      id,
      label: typeof def.label === "string" ? def.label : id,
      run: def.run,
      enabled: typeof def.enabled === "function" ? def.enabled : () => true,
      checked: typeof def.checked === "function" ? def.checked : null,
      shortcut: typeof def.shortcut === "string" ? def.shortcut : null,
      skipWhenTyping: !!def.skipWhenTyping,
    });
  }

  get(id) {
    return this._cmds.get(id) || null;
  }

  has(id) {
    return this._cmds.has(id);
  }

  isEnabled(id) {
    const c = this._cmds.get(id);
    if (!c) return false;
    try {
      return c.enabled() !== false;
    } catch (e) {
      logger.warn("CommandRegistry: enabled() falhou em " + id + ": " + (e && e.message));
      return false;
    }
  }

  isChecked(id) {
    const c = this._cmds.get(id);
    if (!c || !c.checked) return false;
    try {
      return !!c.checked();
    } catch (_) {
      return false;
    }
  }

  shortcutText(id) {
    const c = this._cmds.get(id);
    return c && c.shortcut ? c.shortcut : "";
  }

  run(id) {
    const c = this._cmds.get(id);
    if (!c) {
      logger.warn("CommandRegistry: comando desconhecido \"" + id + "\".");
      return false;
    }
    if (!this.isEnabled(id)) return false;
    try {
      c.run();
      return true;
    } catch (e) {


      logger.error(
        "Erro ao executar comando " + id + ": " + ((e && e.message) || String(e)),
        { source: "Studio" },
      );
      return false;
    }
  }

  setBlocker(fn) {
    if (typeof fn === "function") this._isBlocked = fn;
  }


  wireGlobalShortcuts(target) {
    if (this._wired) return;
    this._wired = true;
    const el = target || document;
    el.addEventListener("keydown", (e) => this._onKey(e));
  }

  _match(e, sc) {
    const parts = sc.split("+").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return false;
    const key = parts[parts.length - 1];
    const mods = parts.slice(0, -1).map((m) => m.toLowerCase());
    const needCtrl = mods.includes("ctrl") || mods.includes("cmd");
    const needShift = mods.includes("shift");
    const needAlt = mods.includes("alt");
    const ctrl = e.ctrlKey || e.metaKey;
    if (!!needCtrl !== !!ctrl) return false;
    if (!!needShift !== !!e.shiftKey) return false;
    if (!!needAlt !== !!e.altKey) return false;
    const ek = e.key || "";
    if (/^F\d{1,2}$/.test(key)) return ek === key;
    if (key.toLowerCase() === "delete") return ek === "Delete" || ek === "Del";
    return ek.toLowerCase() === key.toLowerCase();
  }

  _onKey(e) {
    if (e.defaultPrevented) return;                                                      
    if (this._isBlocked()) return;                                          
    for (const c of this._cmds.values()) {
      if (!c.shortcut) continue;
      if (!this._match(e, c.shortcut)) continue;
      if (c.skipWhenTyping && isTyping(e.target)) return;                            
      e.preventDefault();
      this.run(c.id);
      return;
    }
  }
}

export const commandRegistry = new CommandRegistry();
export { isTyping };
