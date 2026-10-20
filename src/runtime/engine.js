import { store } from "../core/state.js";
import { logger } from "../core/logger.js";
import { bus } from "../core/eventBus.js";
import { createRuntimeInterpreter } from "./lua/runtimeSelector.js";                                      
import { installStdlib } from "./lua/stdlib.js";
import { Scheduler, installTaskLib } from "./scheduler.js";
import { createBridge } from "./bridge.js";
import { createSnapshot, restoreSnapshot } from "./snapshot.js";
import { playtest } from "./playtest.js";

import { network } from "./network.js";
import { profiler } from "../core/profiler.js";

export const RuntimeEvents = Object.freeze({
  ModeChanged: "runtime:modeChanged",

  PausedChanged: "runtime:pausedChanged",
});


export const PlaytestState = Object.freeze({
  Edit: "Edit",
  Run: "Run",
  Play: "Play",
  Paused: "Paused",
});



const TEMPLATE_CONTAINERS = new Set(["StarterPlayer", "StarterGui", "StarterPack"]);

const STORAGE_CONTAINERS = new Set(["ServerStorage", "ReplicatedStorage"]);

const SERVER_ONLY_CONTAINERS = new Set(["ServerStorage", "ServerScriptService"]);




const ANCESTRY_NONE = 0;
const ANCESTRY_TEMPLATE_CONTAINER = 1;
const ANCESTRY_STORAGE_CONTAINER = 2;
const ANCESTRY_SERVER_ONLY_CONTAINER = 4;
const ANCESTRY_REPLICATED_FIRST = 8;

function ancestryFlagsOf(className) {
  let flags = ANCESTRY_NONE;
  if (TEMPLATE_CONTAINERS.has(className)) flags |= ANCESTRY_TEMPLATE_CONTAINER;
  if (STORAGE_CONTAINERS.has(className)) flags |= ANCESTRY_STORAGE_CONTAINER;
  if (SERVER_ONLY_CONTAINERS.has(className)) flags |= ANCESTRY_SERVER_ONLY_CONTAINER;
  if (className === "ReplicatedFirst") flags |= ANCESTRY_REPLICATED_FIRST;
  return flags;
}


function classifyScriptInstance(instance, ancestorFlags, mode, buckets) {
  const className = instance.className;
  const isScript = className === "Script";
  const isLocalScript = className === "LocalScript";
  if (!isScript && !isLocalScript) return;
  if (instance.hasProperty("Disabled") && instance.getProperty("Disabled") === true) return;
  if (ancestorFlags & ANCESTRY_TEMPLATE_CONTAINER) return;


  const runContext = isScript && instance.hasProperty("RunContext")
    ? String(instance.getProperty("RunContext") || "Legacy")
    : "Legacy";
  if (isScript && runContext === "Plugin") return;
  if (isScript && runContext === "Server") {
    buckets.server.push(instance);
    return;
  }
  if (isScript && runContext === "Client") {
    if (mode !== "play") return;

    if (ancestorFlags & ANCESTRY_SERVER_ONLY_CONTAINER) return;
    if (ancestorFlags & ANCESTRY_REPLICATED_FIRST) buckets.clientFirst.push(instance);
    else buckets.client.push(instance);
    return;
  }
  if (ancestorFlags & ANCESTRY_STORAGE_CONTAINER) return;


  const inReplicatedFirst = (ancestorFlags & ANCESTRY_REPLICATED_FIRST) !== 0;
  if (isScript) {
    if (!inReplicatedFirst) buckets.server.push(instance);
  } else if (mode === "play") {
    if (inReplicatedFirst) buckets.clientFirst.push(instance);
    else buckets.client.push(instance);
  }
}


function contextLogger(base, context) {
  const isPlainOpts = (x) =>
    !!x && typeof x === "object" && Object.getPrototypeOf(x) === Object.prototype;
  const wrap = (fn) => (...args) => {
    let opts = null;
    if (args.length && isPlainOpts(args[args.length - 1])) opts = args.pop();
    fn(...args, { ...(opts || {}), context });
  };
  return {
    debug: wrap(base.debug),
    info: wrap(base.info),
    warn: wrap(base.warn),
    error: wrap(base.error),
  };
}


export function describeRuntimeError(e) {
  if (e == null) return "erro desconhecido";
  if (
    typeof WebAssembly !== "undefined" &&
    typeof WebAssembly.Exception === "function" &&
    e instanceof WebAssembly.Exception
  ) {
    return "exce\u00e7\u00e3o interna da VM Luau (WebAssembly.Exception)";
  }
  const msg = e && e.message !== undefined && e.message !== null ? String(e.message) : "";
  return (msg && msg.trim()) || String(e);
}

export class Engine {
  constructor(deps = {}) {
    this._extraEnvs = [];
    this.logger = deps.logger || logger;
    this.bus = deps.bus || bus;
    this._getDataModel = deps.getDataModel || (() => store.getDataModel());
    this.mode = "edit";                           
    this.running = false;
    this.paused = false;            

    this.serverEnv = null;
    this.clientEnv = null;

    this.interp = null;
    this.scheduler = null;
    this.bridge = null;
    this.snapshot = null;

    this.physics = null;
    this._physicsToken = 0;
  }

  getDataModel() {
    return this._getDataModel();
  }

  getMode() {
    return this.mode;
  }


  getPhysics() {
    return this.physics;
  }

  isRunning() {
    return this.running;
  }


  isPaused() {
    return this.paused;
  }


  getPlaytestState() {
    if (!this.running) return PlaytestState.Edit;
    if (this.paused) return PlaytestState.Paused;
    return this.mode === "play" ? PlaytestState.Play : PlaytestState.Run;
  }

  play() {
    this._start("play");
  }


  playHere() {
    const pose = {};
    try { this.bus.emit("viewport:cameraPose", pose); } catch (_) {                }
    const p = pose.position;
    const ok = !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
    this._start("play", ok ? { spawnPose: { position: p, direction: pose.direction || null } } : undefined);
  }

  run() {
    this._start("run");
  }


  _makeEnv(context, dataModel, playtestApi) {
    const ctxLogger = contextLogger(this.logger, context === "client" ? "Client" : "Server");
    const interp = createRuntimeInterpreter({ logger: ctxLogger });
    const scheduler = new Scheduler({
      context,
      interp,
      logger: ctxLogger,

      getMode: context === "client" ? () => "play" : () => "run",
    });
    const bridge = createBridge({
      dataModel,
      scheduler,
      logger: ctxLogger,
      getMode: () => this.mode,
      getPhysics: () => this.physics,            

      context,
      playtest: playtestApi || {
        getLocalPlayer: () => playtest.getLocalPlayer(),
        getCharacter: () => playtest.getCharacter(),                         
        createLocalPlayer: () => playtest.createLocalPlayer(),
        loadCharacter: () => playtest.loadCharacter(),
      },
    });
    installStdlib(interp, { logger: ctxLogger });
    bridge.install(interp);
    installTaskLib(interp, scheduler);
    const env = { context, interp, scheduler, bridge, logger: ctxLogger };

    this.bus.emit("runtime:envCreated", { env });
    return env;
  }


  _runScripts(env, scripts) {
    if (!env) return;
    for (const scriptInst of scripts || []) {
      const name = scriptInst.name || scriptInst.className;
      const source = scriptInst.hasProperty("Source") ? scriptInst.getProperty("Source") : "";
      let ast;
      try {
        ast = env.interp.compile(String(source || ""));
      } catch (e) {
        env.logger.error(`${name}: ${describeRuntimeError(e)}`, { source: name });
        continue;
      }
      const gen = env.interp.run(ast, { script: scriptInst });
      env.scheduler.spawnGen(gen, { name });
    }
  }


  startExtraClient(playtestApi) {
    if (!this.running || this.mode !== "play") return null;
    if (this._extraEnvs.length >= 7) return null;
    const dataModel = this.getDataModel();
    if (!dataModel) return null;
    let env;
    try {
      env = this._makeEnv("client", dataModel, playtestApi);
    } catch (e) {
      this.logger.error("Falha ao criar cliente extra: " + describeRuntimeError(e), { source: "Studio" });
      return null;
    }
    env.scheduler.start();
    if (this.paused) env.scheduler.setPaused(true);
    this._extraEnvs.push(env);
    return env;
  }

  stopExtraClient(env) {
    const i = this._extraEnvs.indexOf(env);
    if (i >= 0) this._extraEnvs.splice(i, 1);
    try { env.scheduler.stop(); } catch (_) {            }
    try { env.bridge.dispose(); } catch (_) {            }
    this._disposeInterp(env);
  }


  _disposeInterp(env) {
    if (env && env.interp && typeof env.interp.dispose === "function") {
      try { env.interp.dispose(); } catch (_) {            }
    }
  }


  _teardownEnv(env) {
    if (!env) return;
    try { env.scheduler.stop(); } catch (_) {            }
    try { env.bridge.dispose(); } catch (_) {            }
    this._disposeInterp(env);
  }

  runScriptsIn(env, scripts) {
    this._runScripts(env, scripts);
  }


  _collectScripts(dataModel, mode) {
    const buckets = { server: [], client: [], clientFirst: [] };


    const pendingInstances = [dataModel];
    const pendingAncestorFlags = [ANCESTRY_NONE];
    while (pendingInstances.length > 0) {
      const instance = pendingInstances.pop();
      const ancestorFlags = pendingAncestorFlags.pop();
      classifyScriptInstance(instance, ancestorFlags, mode, buckets);
      const children = instance.getChildren ? instance.getChildren() : [];
      const childAncestorFlags = ancestorFlags | ancestryFlagsOf(instance.className);
      for (let i = children.length - 1; i >= 0; i--) {
        pendingInstances.push(children[i]);
        pendingAncestorFlags.push(childAncestorFlags);
      }
    }
    return { server: buckets.server, client: buckets.clientFirst.concat(buckets.client) };
  }


  _start(mode, startOpts) {
    if (this.running) {
      this.logger.warn("J\u00e1 h\u00e1 uma execu\u00e7\u00e3o em andamento. Clique em Stop primeiro.", { source: "Studio" });
      return;
    }
    const dataModel = this.getDataModel();
    if (!dataModel) {
      this.logger.error("DataModel indispon\u00edvel; n\u00e3o \u00e9 poss\u00edvel iniciar.", { source: "Studio" });
      return;
    }
    try {
      this._startInner(mode, startOpts, dataModel);
    } catch (e) {
      this.logger.error(
        "Falha ao iniciar o playtest: " + describeRuntimeError(e) + " \u2014 revertendo para o modo Edit.",
        { source: "Studio" },
      );
      try {
        this.stop({ silent: true });
      } catch (_) {            }
      if (this.running) this._forceReset();
    }
  }


  _forceReset() {
    this.serverEnv = null;
    this.clientEnv = null;
    this.interp = null;
    this.scheduler = null;
    this.bridge = null;
    this.snapshot = null;
    this.mode = "edit";
    this.running = false;
    this.paused = false;
    this._broadcast();
    this.bus.emit("status:message", { text: "Pronto", transient: false });
  }

  _startInner(mode, startOpts, dataModel) {


    playtest.ensureContainers(dataModel);


    this.snapshot = createSnapshot(dataModel);


    this.mode = mode;
    this.running = true;
    this.paused = false;
    this.serverEnv = this._makeEnv("server", dataModel);
    this.clientEnv = mode === "play" ? this._makeEnv("client", dataModel) : null;
    this.interp = this.serverEnv.interp;
    this.scheduler = this.serverEnv.scheduler;
    this.bridge = this.serverEnv.bridge;

    this.logger.info(
      "Engine de scripts: Luau VM oficial (WASM) — linguagem completa",
      { source: "Studio" },
    );

    this.logger.info(
      mode === "play" ? "\u25b6 Play iniciado (Server + Client)" : "\u25b6 Run iniciado (apenas Server)",
      { source: "Studio" },
    );
    this._broadcast();


    this.serverEnv.scheduler.start();
    if (this.clientEnv) this.clientEnv.scheduler.start();


    network.start({
      getEnv: (side) => (side === "client" ? this.clientEnv : this.serverEnv),
      isPaused: () => this.paused,
      logger: this.logger,
    });


    this.serverEnv.scheduler.onPhysics = (step) => {
      if (this.physics && !this.paused) {
        const t0 = performance.now();
        this.physics.step(step);
        profiler.report("physics", performance.now() - t0, "world.step");
      }
    };
    const physicsToken = ++this._physicsToken;
    import("../physics/physicsWorld.js")
      .then((mod) => mod.createPhysicsWorld({ dataModel, logger: this.logger }))
      .then((pw) => {
        if (!this.running || physicsToken !== this._physicsToken) {
          pw.dispose();
          return;
        }
        this.physics = pw;
        const stats = pw.getStats();
        this.logger.info(
          `F\u00edsica ativa: ${stats.bodies} corpo(s) r\u00edgido(s), ${stats.constraints} constraint(s).`,
          { source: "Studio" },
        );
      })
      .catch((e) => {
        if (this.running && physicsToken === this._physicsToken) {
          this.logger.warn(
            "N\u00e3o foi poss\u00edvel carregar a engine de f\u00edsica: " + (e && e.message),
            { source: "Studio" },
          );
        }
      });


    const { server, client } = this._collectScripts(dataModel, mode);
    this._runScripts(this.serverEnv, server);


    playtest.start({
      dataModel,
      mode,

      spawnPose: (startOpts && startOpts.spawnPose) || null,
      isPaused: () => this.paused,
      requestStop: () => this.stop(),
      runClientScripts: (insts) => this._runScripts(this.clientEnv, insts),
      logger: this.clientEnv ? this.clientEnv.logger : this.logger,


      inputManager: this.clientEnv && this.clientEnv.bridge.getInputManager
        ? this.clientEnv.bridge.getInputManager()
        : null,
    });


    if (this.clientEnv && mode === "play" && typeof document !== "undefined") {
      try {
        this.clientEnv.bridge.getInputManager().attach({
          canvas: document.querySelector(".rsw-viewport__canvas"),
        });
      } catch (e) {
        this.logger.warn("Input: falha ao anexar a captura de entrada: " + ((e && e.message) || e), { source: "Studio" });
      }
    }


    if (this.clientEnv) this._runScripts(this.clientEnv, client);

    if (server.length === 0 && client.length === 0) {
      this.logger.info("Nenhum script ativo para executar.", { source: "Studio" });
    }


    this.bus.emit("status:message", {
      text: "Playtest Active - Press Shift+F5 to Stop",
      transient: false,
    });
  }




  pause(opts) {
    if (!this.running || this.paused) return;
    this.paused = true;
    this._setSchedulersPaused(true);
    if (!(opts && opts.silent)) {
      this.logger.info("\u23f8 Playtest pausado.", { source: "Studio" });
    }
    this._broadcastPause();
  }

  resume(opts) {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this._setSchedulersPaused(false);
    if (!(opts && opts.silent)) {
      this.logger.info("\u25b6 Playtest retomado.", { source: "Studio" });
    }
    this._broadcastPause();
  }

  togglePause() {
    if (!this.running) return;
    if (this.paused) this.resume();
    else this.pause();
  }

  _setSchedulersPaused(v) {
    if (this.serverEnv) this.serverEnv.scheduler.setPaused(v);
    if (this.clientEnv) this.clientEnv.scheduler.setPaused(v);
    for (const env of this._extraEnvs) env.scheduler.setPaused(v);
  }

  _broadcastPause() {
    this.bus.emit(RuntimeEvents.PausedChanged, {
      paused: this.paused,
      mode: this.mode,
      running: this.running,
      playtestState: this.getPlaytestState(),
    });
    this.bus.emit("status:message", {
      text: this.paused
        ? "Playtest Paused - Press F9 to Resume"
        : "Playtest Active - Press Shift+F5 to Stop",
      transient: false,
    });
  }


  execCommand(text, ctxArg) {
    const raw = String(text || "");
    let ctx = ctxArg === "client" ? "client" : "server";
    let code = raw;
    const m = raw.match(/^\s*@(server|client)\b\s*/i);
    if (m) {
      ctx = m[1].toLowerCase();
      code = raw.slice(m[0].length);
    }
    if (!code.trim()) return;
    if (!this.running) {
      this.logger.warn(
        "Inicie Play (F5) ou Run (F8) para executar comandos no Command Bar.",
        { source: "Command" },
      );
      return;
    }
    const env = ctx === "client" ? this.clientEnv : this.serverEnv;
    if (!env) {
      this.logger.warn(
        "Contexto Client indispon\u00edvel (use o modo Play para ter um Client).",
        { source: "Command" },
      );
      return;
    }
    let ast;
    try {
      ast = env.interp.compile(code);
    } catch (e) {
      env.logger.error(`CommandBar: ${describeRuntimeError(e)}`, { source: "Command" });
      return;
    }
    const gen = env.interp.run(ast, { script: null });
    env.scheduler.spawnGen(gen, { name: "CommandBar" });
  }


  stop(opts) {
    if (!this.running) return;


    try {
      if (this.serverEnv && this.serverEnv.bridge && typeof this.serverEnv.bridge.runCloseCallbacks === "function") {
        this.serverEnv.bridge.runCloseCallbacks();
      }
    } catch (_) {            }


    try {
      if (this.clientEnv && this.clientEnv.bridge.getInputManager) {
        this.clientEnv.bridge.getInputManager().detach();
      }
    } catch (_) {            }

    try { playtest.stop(); } catch (_) {            }


    try { network.stop(); } catch (_) {            }


    if (this.serverEnv) this._teardownEnv(this.serverEnv);
    if (this.clientEnv) this._teardownEnv(this.clientEnv);

    for (const env of this._extraEnvs.splice(0)) this._teardownEnv(env);


    this._physicsToken++;
    if (this.physics) {
      try { this.physics.dispose(); } catch (_) {            }
      this.physics = null;
    }


    try {
      restoreSnapshot(this.snapshot);
    } catch (e) {
      this.logger.error("Falha ao restaurar a cena: " + describeRuntimeError(e), { source: "Studio" });
    }

    this.serverEnv = null;
    this.clientEnv = null;
    this.interp = null;
    this.scheduler = null;
    this.bridge = null;
    this.snapshot = null;
    this.mode = "edit";
    this.running = false;
    this.paused = false;

    if (!(opts && opts.silent)) {
      this.logger.info("\u25a0 Execu\u00e7\u00e3o encerrada \u2014 cena restaurada.", { source: "Studio" });
    }
    this._broadcast();
    this.bus.emit("status:message", { text: "Pronto", transient: false });
  }


  tickFrame(dt) {
    if (!this.running || this.paused) return;
    if (this.serverEnv) this.serverEnv.scheduler.tickFrame(dt);
    if (this.clientEnv) this.clientEnv.scheduler.tickFrame(dt);
    for (const env of this._extraEnvs) env.scheduler.tickFrame(dt);
  }

  _broadcast() {
    this.bus.emit(RuntimeEvents.ModeChanged, {
      mode: this.mode,
      running: this.running,
      paused: this.paused,
      playtestState: this.getPlaytestState(),
    });
  }
}

export const engine = new Engine();
