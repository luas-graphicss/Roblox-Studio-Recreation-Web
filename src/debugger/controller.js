import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { readJSON, writeJSON } from "../utils/storage.js";
import { engine, RuntimeEvents } from "../runtime/engine.js";
import { truthy } from "../runtime/lua/interpreter.js";
import { Events } from "../datamodel/index.js";
import * as bpStore from "./breakpoints.js";
import { summarize, typeOf } from "./inspect.js";

const MAX_WATCHES = 50;

class DebuggerController {
  constructor() {
    this.envs = [];                                                
    this.paused = [];                                                                                   
    this.selectedFrameIndex = 0;                                   
    this.step = null;                                                                 
    this.watches = [];                        
    this._watchId = 1;
    this._varsChangedQueued = false;
    this._wasmDebugAdviceShown = false;                                                    
    this._internalEngineOp = false;
    this._wired = false;
    this._loadWatches();
    this._wire();
  }


  isPaused() {
    return this.paused.length > 0;
  }
  isStepping() {
    return !!this.step;
  }
  pendingCount() {
    return Math.max(0, this.paused.length - 1);
  }
  current() {
    return this.paused.length ? this.paused[0] : null;
  }


  callStack() {
    const cur = this.current();
    if (!cur) return [];
    return cur.wstack || [];
  }

  selectedFrame() {
    const frames = this.callStack();
    if (!frames.length) return null;
    const i = Math.min(this.selectedFrameIndex, frames.length - 1);
    return frames[i];
  }

  selectFrame(index) {
    const frames = this.callStack();
    if (index < 0 || index >= frames.length) return;
    this.selectedFrameIndex = index;
    const fr = frames[index];
    if (fr.script) {
      bus.emit("debugger:focusLine", { instance: fr.script, line: fr.line, highlight: true });
    }
    this._evalAllWatches();
    bus.emit("debugger:stateChanged", { paused: true, frameSelected: true });
  }


  frameVariables() {
    const sel = this.selectedFrame();
    const cur = this.current();
    if (!sel || !cur) return { locals: [], upvalues: [], bridge: null };
    const fr = sel.frame;
    const bridge = cur.env && cur.env.bridge ? cur.env.bridge : null;

    const mapEntry = (e) => ({ name: e.name, value: e.value, summary: summarize(e.value, bridge) });
    return {
      locals: (fr.locals || []).map(mapEntry),
      upvalues: (fr.upvalues || []).map(mapEntry),
      bridge,
    };
  }


  _wire() {
    if (this._wired) return;
    this._wired = true;


    bus.on("runtime:envCreated", (p) => {
      if (p && p.env) this._attachEnv(p.env);
    });


    bus.on(RuntimeEvents.ModeChanged, (p) => {
      if (p && p.running === false) this._clearSession();
    });


    bus.on(RuntimeEvents.PausedChanged, (p) => {
      if (p && p.paused === false && this.paused.length && !this._internalEngineOp) {
        this.resume();
      }
    });


    bus.on("debugger:breakpointsChanged", () => this._refreshHookActivation());


    bus.on(Events.Destroying, (p) => {
      const inst = p && p.instance;
      if (!inst || engine.isRunning()) return;
      bpStore.removeForDeletedInstance(inst);
    });


    if (typeof document !== "undefined") {
      document.addEventListener("keydown", (e) => {
        if (!this.isPaused()) return;
        const k = e.key;


        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (k === "F5" && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          this.resume();
        } else if (k === "F10" && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          this.stepOver();
        } else if (k === "F11" && e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          this.stepOut();
        } else if (k === "F11") {
          e.preventDefault();
          e.stopPropagation();
          this.stepInto();
        }
      }, true);
    }
  }


  _attachEnv(env) {
    if (!env || !env.interp) return;
    const ctrl = this;
    let adapter;


    adapter = {
      env,
      wasm: true,
      _active: false,
      get active() { return this._active; },
      set active(v) {
        this._active = !!v;
        try {
          env.interp.debugSetActive(this._active);
        } catch (e) {

          if (this._active && !ctrl._wasmDebugAdviceShown && env.logger) {
            ctrl._wasmDebugAdviceShown = true;
            env.logger.warn(
              "Debugger indisponível nesta build da VM Luau (WASM). Recompile o .wasm (tools/luau-wasm/build.cmd) para habilitar breakpoints, step, locals e watch.",
              { source: "Debugger" },
            );
          }
        }
      },
      linesFor: (script) => ctrl._wasmLinesFor(script),
      onParked: (thread, info) => ctrl._onWasmParked(env, thread, info),
    };
    env.interp.debug = adapter;
    env.__debugAdapter = adapter;
    this.envs.push(env);
    this._refreshHookActivation();
  }

  _wasmLinesFor(script) {
    const rec = bpStore.recordForInstance(script);
    if (!rec) return [];
    const lines = [];
    for (const bp of rec.lines.values()) {
      if (bp.enabled && bp.valid !== false) lines.push(bp.line);
    }
    return lines;
  }

  _refreshHookActivation() {
    const active = bpStore.hasEnabledBreakpoints() || !!this.step || this.paused.length > 0;
    for (const env of this.envs) {
      if (env.__debugAdapter) env.__debugAdapter.active = active;
    }
  }


  _parkEntry(entry) {
    const isStepPause = entry.reason && entry.reason.type === "step";
    if (isStepPause) {
      this.step = null;
      this.paused.unshift(entry);                                        
    } else {
      this.paused.push(entry);
    }
    this._refreshHookActivation();
    if (this.paused.length === 1 || isStepPause) {
      this._enterPaused(entry);
    } else {

      const name = entry.frame.script ? entry.frame.script.name : entry.thread.name || "thread";
      entry.env.logger.info(
        `Breakpoint atingido em outra thread (${name}:${entry.line}) \u2014 pausa enfileirada.`,
        { source: "Debugger" },
      );
      bus.emit("debugger:stateChanged", { paused: true, pending: this.pendingCount() });
    }
  }


  _onWasmParked(env, thread, info) {
    const resumeSoon = () => {
      queueMicrotask(() => {
        if (!thread.dead) {
          try { env.scheduler.resume(thread); } catch (e) {                                   }
        }
      });
    };
    try {
      let reason = null;
      if (info.isStep) {
        reason = { type: "step" };
      } else {
        const bp = info.script ? bpStore.lookupRuntime(info.script, info.jsLine) : null;
        if (!bp) return resumeSoon();
        if (bp.condition) {
          info.stack = info.capture();


          const evalFrame = (info.stack || []).find((f) => f && f.what !== "C") || null;
          const res = info.evalInFrame(bp.condition, evalFrame);
          if (res.syntaxError) {
            if (!bp._condWarned) {
              bp._condWarned = true;
              env.logger.warn(
                `Condi\u00e7\u00e3o de breakpoint inv\u00e1lida em ${bp.path}:${bp.line} ("${bp.condition}"): ${res.error}. Tratando como breakpoint normal.`,
                { source: "Debugger" },
              );
            }
          } else if (res.error) {
            return resumeSoon();
          } else if (!truthy(res.value)) {
            return resumeSoon();
          }
        }
        if (bp.logMessage) {
          this._emitWasmLogpoint(bp, env, info);
          return resumeSoon();
        }
        reason = { type: "breakpoint", bp };
      }
      const frames = info.stack || info.capture();
      const shaped = this._shapeWasmStack(frames, env, thread);
      const top = shaped.length ? shaped[0] : null;
      const pauseLine = info.jsLine != null ? info.jsLine : info.line;
      this._parkEntry({
        env,
        thread,
        frame: top ? top.frame : { script: info.script, line: pauseLine },
        line: pauseLine,
        reason,
        wasm: true,
        wstack: shaped,
        weval: info.evalInFrame,
        wops: { beginStep: info.beginStep, cancelStep: info.cancelStep },
      });
    } catch (e) {
      logger.warn("Falha ao processar pausa da VM Luau: " + ((e && e.message) || e), { source: "Debugger" });
      resumeSoon();
    }
  }

  _shapeWasmStack(frames, env, thread) {
    const out = [];
    for (const f of frames || []) {
      if (f.what === "C") continue;
      if (!f.script) f.script = null;
      out.push({
        frame: f,
        name: f.what === "main" ? (f.script ? f.script.name : thread.name || "main") : f.name || "anonymous",
        script: f.script,
        scriptName: f.script ? f.script.name : "(sem script)",
        line: f.line || 0,
        context: env && env.context ? env.context : "Server",
        native: false,
      });
    }
    return out;
  }

  _emitWasmLogpoint(bp, env, info) {
    if (!info.stack) info.stack = info.capture();
    const frame = (info.stack || []).find((f) => f && f.what !== "C") || null;
    let msg = String(bp.logMessage || "");
    msg = msg.replace(/\{([^{}]{1,200})\}/g, (m, expr) => {
      const res = info.evalInFrame(expr, frame);
      if (res.error) return `{erro: ${String(res.error).slice(0, 80)}}`;
      try {
        const s = env.interp.tostring(res.value);
        return String(s).slice(0, 200);
      } catch (e) {
        return "?";
      }
    });

    msg = msg.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, 1000);
    const name = info.script ? info.script.name : "?";
    env.logger.info(`[Logpoint] ${name}:${bp.line} \u2014 ${msg}`, { source: "Debugger" });
  }

  _enterPaused(entry) {
    this.selectedFrameIndex = 0;

    this._internalEngineOp = true;
    try {
      if (engine.isRunning() && !engine.paused) engine.pause({ silent: true });
    } finally {
      this._internalEngineOp = false;
    }
    const scriptName = entry.frame.script ? entry.frame.script.name : entry.thread.name || "thread";
    const isStepPause = entry.reason && entry.reason.type === "step";
    if (entry.reason.type === "breakpoint") {
      entry.env.logger.info(`Breakpoint hit: ${scriptName}, line ${entry.line}`, { source: "Debugger" });
    }
    bus.emit("status:message", {


      text: isStepPause
        ? `Paused (step) - ${scriptName}:${entry.line}`
        : `Paused on breakpoint - ${scriptName}:${entry.line}`,
      transient: false,
    });
    if (entry.frame.script) {
      bus.emit("debugger:focusLine", { instance: entry.frame.script, line: entry.line, highlight: true });
    }
    this._evalAllWatches();
    bus.emit("debugger:paused", {
      scriptId: entry.frame.script ? entry.frame.script.id : null,
      scriptName,
      line: entry.line,
      context: entry.env.context,
      pending: this.pendingCount(),
    });
    bus.emit("debugger:stateChanged", { paused: true });
  }

  _exitPaused(keepStep) {
    if (!keepStep) this.step = null;
    this._refreshHookActivation();


    bus.emit("debugger:stateChanged", { paused: false, stepping: !!this.step });
    this._internalEngineOp = true;
    try {
      if (engine.isRunning() && engine.paused) engine.resume({ silent: true });
    } finally {
      this._internalEngineOp = false;
    }
    if (engine.isRunning()) {
      bus.emit("status:message", { text: "Playtest ativo \u2014 Shift+F5 para parar.", transient: false });
    }
  }

  _clearSession() {
    this.paused = [];
    this.step = null;
    this.selectedFrameIndex = 0;
    for (const env of this.envs) {
      if (env.interp && env.interp.isWasm && typeof env.interp.debugCancelStep === "function") {
        try { env.interp.debugCancelStep(); } catch (e) {                            }
      }
    }
    this.envs = [];
    for (const w of this.watches) w.result = null;
    this._refreshHookActivation();
    bus.emit("debugger:resumed", {});
    bus.emit("debugger:watchesChanged", {});
    bus.emit("debugger:stateChanged", { paused: false, cleared: true });
  }


  resume() {
    if (!this.paused.length) return;
    this.step = null;
    const toResume = this.paused.slice();
    this.paused = [];
    bus.emit("debugger:resumed", {});                                     
    for (const entry of toResume) {
      if (entry.wasm && entry.wops && entry.wops.cancelStep) {
        try { entry.wops.cancelStep(); } catch (e) {                   }
      }
      if (!entry.thread.dead) {
        try {
          entry.env.scheduler.resume(entry.thread);
        } catch (e) {                                          }
      }
    }
    if (!this.paused.length) {
      this._exitPaused(false);
    }


  }

  _doStep(mode) {
    const cur = this.current();
    if (!cur || cur.thread.dead) return;


    if (!cur.wasm) {
      this.resume();
      return;
    }
    const ok = cur.wops && typeof cur.wops.beginStep === "function" ? cur.wops.beginStep(mode) : false;
    if (!ok) {
      this.resume();
      return;
    }
    this.step = { mode, thread: cur.thread, wasm: true, line: cur.line };
    this._refreshHookActivation();
    this.paused.shift();
    bus.emit("debugger:resumed", {});
    try {
      cur.env.scheduler.resume(cur.thread);
    } catch (e) {                           }
    if (this.paused.length) {
      const top = this.paused[0];
      const reparked = top.thread === cur.thread;
      if (!reparked) {





        this.step = null;
        if (cur.wops && cur.wops.cancelStep) {
          try { cur.wops.cancelStep(); } catch (e) {                   }
        }
        this._enterPaused(top);
      }

    } else if (cur.thread.dead) {

      this.step = null;
      this._exitPaused(false);
    } else {


      this._exitPaused(true);
    }
  }

  stepOver() { this._doStep("over"); }
  stepInto() { this._doStep("into"); }
  stepOut() { this._doStep("out"); }


  evaluate(exprText, ctx) {
    const text = String(exprText == null ? "" : exprText).trim();
    if (!text) return { error: "express\u00e3o vazia", syntaxError: true };
    if (text.length > 500) return { error: "express\u00e3o muito longa", syntaxError: true };
    const env = ctx && ctx.env;
    const frame = ctx && ctx.frame;
    if (!env || !env.interp) return { error: "sem contexto de execu\u00e7\u00e3o" };
    const interp = env.interp;


    if (!interp.isWasm) {
      return { error: "engine legada n\u00e3o suportada (Parte 174: a VM Luau WASM \u00e9 a \u00fanica engine)" };
    }


    const cur = this.current();
    const evalFn = (cur && cur.wasm && cur.weval) || null;
    if (!evalFn) return { error: "n\u00e3o pausado" };
    const wframe = frame && (frame.locals || frame.upvalues) ? frame : null;
    const res = evalFn(text, wframe);
    return this._queueVarsWriteRefresh(res);
  }


  _queueVarsWriteRefresh(res) {
    if (res && Array.isArray(res.wrote) && res.wrote.length && !this._varsChangedQueued) {
      this._varsChangedQueued = true;
      queueMicrotask(() => {
        this._varsChangedQueued = false;
        if (this.isPaused()) {
          bus.emit("debugger:stateChanged", { paused: true, varsChanged: true });
        }
      });
    }
    return res;
  }


  evaluateInCurrent(exprText) {
    const sel = this.selectedFrame();
    const cur = this.current();
    if (!sel || !cur) return { error: "n\u00e3o pausado" };
    return this.evaluate(exprText, { frame: sel.frame, env: cur.env });
  }


  resolveName(name) {
    const sel = this.selectedFrame();
    if (!sel || !sel.frame) return { found: false };
    const curEntry = this.current();
    if (curEntry && curEntry.wasm) {
      const raw = sel.frame;
      for (const list of [raw.locals || [], raw.upvalues || []]) {
        for (const e of list) {
          if (e.name === name) return { found: true, value: e.value };
        }
      }
      if (curEntry.env && curEntry.env.interp) {
        const g = curEntry.env.interp.getGlobal(name);
        if (g !== undefined) return { found: true, value: g };
      }
      return { found: false };
    }

    return { found: false };
  }

  currentBridge() {
    const cur = this.current();
    return cur && cur.env ? cur.env.bridge : null;
  }

  currentInterp() {
    const cur = this.current();
    return cur && cur.env ? cur.env.interp : null;
  }


  _loadWatches() {
    const saved = readJSON("watch", null);
    if (Array.isArray(saved)) {
      for (const expr of saved.slice(0, MAX_WATCHES)) {
        if (typeof expr === "string" && expr.trim()) {
          this.watches.push({ id: this._watchId++, expr: expr.trim().slice(0, 300), result: null });
        }
      }
    }
  }

  _persistWatches() {
    writeJSON("watch", this.watches.map((w) => w.expr));
  }

  addWatch(expr) {
    const text = String(expr == null ? "" : expr).trim().slice(0, 300);
    if (!text) return null;
    if (this.watches.length >= MAX_WATCHES) {
      logger.warn(`Limite de ${MAX_WATCHES} express\u00f5es no Watch atingido.`, { source: "Debugger" });
      return null;
    }
    const w = { id: this._watchId++, expr: text, result: null };
    this.watches.push(w);
    this._persistWatches();
    if (this.isPaused()) this._evalWatch(w);
    bus.emit("debugger:watchesChanged", {});
    return w;
  }

  editWatch(id, expr) {
    const w = this.watches.find((x) => x.id === id);
    if (!w) return;
    w.expr = String(expr == null ? "" : expr).trim().slice(0, 300);
    w.result = null;
    this._persistWatches();
    if (this.isPaused() && w.expr) this._evalWatch(w);
    bus.emit("debugger:watchesChanged", {});
  }

  removeWatch(id) {
    const i = this.watches.findIndex((x) => x.id === id);
    if (i >= 0) {
      this.watches.splice(i, 1);
      this._persistWatches();
      bus.emit("debugger:watchesChanged", {});
    }
  }

  _evalWatch(w) {
    const res = this.evaluateInCurrent(w.expr);
    const bridge = this.currentBridge();
    w.result = {
      error: res.error || null,
      sideEffects: !!res.sideEffects,
      value: res.value,
      summary: res.error ? null : summarize(res.value, bridge),
      type: res.error ? null : typeOf(res.value, bridge),
    };
  }

  _evalAllWatches() {
    if (!this.isPaused()) return;
    for (const w of this.watches) {
      if (w.expr) this._evalWatch(w);
    }
    bus.emit("debugger:watchesChanged", {});
  }
}

export const debuggerController = new DebuggerController();


export function isDebugHoverPriority() {
  return debuggerController.isPaused();
}
