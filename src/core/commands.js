import { bus } from "./eventBus.js";
import { logger } from "./logger.js";

const MAX_HISTORY = 200;

function isCommand(c) {
  return !!c && typeof c === "object" &&
    typeof c.do === "function" && typeof c.undo === "function";
}

function isTyping(node) {
  if (!node) return false;
  const tag = (node.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || node.isContentEditable === true;
}

export class CommandManager {
  constructor(max = MAX_HISTORY) {
    this._undo = [];
    this._redo = [];
    this._max = Math.max(1, max | 0);
    this._applying = false;
  }


  execute(cmd) {
    if (!isCommand(cmd)) {
      logger.warn("CommandManager: comando inválido ignorado.");
      return false;
    }
    if (this._applying) {
      logger.warn("CommandManager: execução reentrante bloqueada.");
      return false;
    }
    if (!this._run(() => cmd.do())) return false;
    this._undo.push(cmd);
    if (this._undo.length > this._max) this._undo.shift();
    this._redo.length = 0;                             
    bus.emit("command:executed", { name: cmd.name || "command" });
    this._emitChanged();
    return true;
  }

  undo() {
    if (this._applying || this._undo.length === 0) return false;


    const cmd = this._undo[this._undo.length - 1];
    if (!this._run(() => cmd.undo())) return false;
    this._undo.pop();
    this._redo.push(cmd);
    bus.emit("command:undo", { name: cmd.name || "command" });
    this._emitChanged();
    return true;
  }

  redo() {
    if (this._applying || this._redo.length === 0) return false;

    const cmd = this._redo[this._redo.length - 1];
    if (!this._run(() => cmd.do())) return false;
    this._redo.pop();
    this._undo.push(cmd);
    bus.emit("command:redo", { name: cmd.name || "command" });
    this._emitChanged();
    return true;
  }

  canUndo() { return this._undo.length > 0; }
  canRedo() { return this._redo.length > 0; }
  getUndoSize() { return this._undo.length; }
  getRedoSize() { return this._redo.length; }

  clear() {
    this._undo.length = 0;
    this._redo.length = 0;
    this._emitChanged();
  }

  _run(fn) {
    this._applying = true;
    let ok = false;
    try {
      ok = fn() !== false;
    } catch (err) {
      logger.error("CommandManager: erro ao aplicar comando:", err);
      ok = false;
    } finally {
      this._applying = false;
    }
    return ok;
  }

  _emitChanged() {
    bus.emit("history:changed", {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      undo: this._undo.length,
      redo: this._redo.length,
    });
  }
}

export const commands = new CommandManager();


export function wireUndoRedoShortcuts(target) {
  const el = target || (typeof document !== "undefined" ? document : null);
  if (!el || typeof el.addEventListener !== "function") return () => {};
  const onKey = (e) => {
    if (e.defaultPrevented) return;                                                       
    if (!(e.ctrlKey || e.metaKey)) return;
    if (isTyping(e.target)) return;
    const key = (e.key || "").toLowerCase();
    if (key === "z") {
      e.preventDefault();
      if (e.shiftKey) commands.redo();
      else commands.undo();
    } else if (key === "y") {
      e.preventDefault();
      commands.redo();
    }
  };
  el.addEventListener("keydown", onKey);
  return () => el.removeEventListener("keydown", onKey);
}
