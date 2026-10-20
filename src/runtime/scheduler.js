import { LuaTable, nativeFn, LuaError } from "./lua/interpreter.js";
import { scriptPerf } from "../devconsole/scriptPerf.js";            

import { registerFrameCallback } from "../core/frameDriver.js";

function now() {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}


let _genCounter = 0;
const _schedulers = new Set();
const MAX_TRACKED_SCHEDULERS = 6;

function _registerScheduler(s) {
  s._gen = ++_genCounter;
  if (_schedulers.size >= MAX_TRACKED_SCHEDULERS) {
    for (const old of _schedulers) {
      if (!old.running) _schedulers.delete(old);
      if (_schedulers.size < MAX_TRACKED_SCHEDULERS) break;
    }

    if (_schedulers.size >= MAX_TRACKED_SCHEDULERS) {
      const first = _schedulers.values().next().value;
      if (first) _schedulers.delete(first);
    }
  }
  _schedulers.add(s);
}


const aggregatedJobStatsByName = new Map();
const aggregatedJobStatsList = [];
let jobStatsPassId = 0;

function takeAggregateForPass(name) {
  let aggregate = aggregatedJobStatsByName.get(name);
  if (!aggregate) {
    aggregate = { name, ema: 0, max: 0, last: 0, runs: 0, errors: 0, passId: 0 };
    aggregatedJobStatsByName.set(name, aggregate);
  }
  if (aggregate.passId !== jobStatsPassId) {
    aggregate.passId = jobStatsPassId;
    aggregate.ema = 0;
    aggregate.max = 0;
    aggregate.last = 0;
    aggregate.runs = 0;
    aggregate.errors = 0;
    aggregatedJobStatsList.push(aggregate);
  }
  return aggregate;
}

export function getSchedulerJobStats() {
  let hasRunningScheduler = false;
  let highestGeneration = 0;
  for (const scheduler of _schedulers) {
    if (scheduler.running) hasRunningScheduler = true;
    const generation = scheduler._gen || 0;
    if (generation > highestGeneration) highestGeneration = generation;
  }

  jobStatsPassId++;
  aggregatedJobStatsList.length = 0;

  for (const scheduler of _schedulers) {


    const isEligible = hasRunningScheduler
      ? scheduler.running
      : (scheduler._gen || 0) >= highestGeneration - 1;
    if (!isEligible) continue;
    for (const jobStat of scheduler.jobStats.values()) {
      const aggregate = takeAggregateForPass(jobStat.name);
      aggregate.ema += jobStat.ema;                                        
      aggregate.last += jobStat.last;
      aggregate.max = Math.max(aggregate.max, jobStat.max);
      aggregate.runs += jobStat.runs;
      aggregate.errors += jobStat.errors;
    }
  }
  return aggregatedJobStatsList;
}


let _liveConnections = 0;

export function getLiveConnectionCount() {
  return _liveConnections;
}

export class Signal {
  constructor(scheduler, name) {
    this.__ud = "Signal";
    this.scheduler = scheduler;
    this.name = name || "Signal";
    this.handlers = new Set();
    this._fireSeq = 0;
    this._lastArgs = [];


    this._spawnLabel = "signal:" + this.name;
    this._handlersSnapshot = [];
  }
  connect(fn) {
    const handler = { fn };


    if (typeof this.connGen === "function") handler.gen = this.connGen();
    this.handlers.add(handler);
    _liveConnections++;
    const self = this;
    const conn = new LuaTable();
    conn.__ud = "RBXScriptConnection";
    conn.rawset("Connected", true);
    conn.rawset("Disconnect", nativeFn(() => {
      if (self.handlers.has(handler)) _liveConnections--;
      self.handlers.delete(handler);
      conn.rawset("Connected", false);
      return [];
    }, "Disconnect"));
    conn.rawset("disconnect", conn.rawget("Disconnect"));
    handler.conn = conn;
    return conn;
  }
  fire(args) {
    this._fireSeq++;
    this._lastArgs = args || [];
    if (this.handlers.size === 0) return;


    if (typeof this.connGen === "function") {
      const g = this.connGen();
      for (const h of [...this.handlers]) {
        if ((h.gen || 0) !== g) {
          this.handlers.delete(h);
          _liveConnections--;
          if (h.conn) h.conn.rawset("Connected", false);
        }
      }
      if (this.handlers.size === 0) return;
    }
    const handlersSnapshot = this._handlersSnapshot;
    let handlerCount = 0;
    for (const handler of this.handlers) handlersSnapshot[handlerCount++] = handler;


    const handlerArgs = args ? args.slice() : [];
    for (let i = 0; i < handlerCount; i++) {
      const handler = handlersSnapshot[i];
      handlersSnapshot[i] = null;                                        

      if (!this.handlers.has(handler)) continue;
      this.scheduler.spawnFn(handler.fn, handlerArgs, this._spawnLabel);
    }
  }
  disconnectAll() {
    _liveConnections -= this.handlers.size;
    this.handlers.clear();
  }
}

export class Scheduler {
  constructor(options = {}) {
    this.interp = options.interp;
    this.logger = options.logger || null;
    this.getMode = options.getMode || (() => "run");

    this.perfContext = options.context === "client" ? "Client" : "Server";
    this._perfDepth = 0;
    this.onError = options.onError || null;


    this.onPhysics = options.onPhysics || null;
    this.onTweens = options.onTweens || null;                                                  
    this.onInput = options.onInput || null;                                                                  

    this.threads = [];
    this.waiting = [];
    this.readyQueue = [];
    this.deferQueue = [];
    this.clock = 0;
    this.running = false;


    this._unregisterFrameCallback = null;
    this._lastTs = 0;
    this.paused = false;                                                   


    this.sliceBudget = options.sliceBudget || 2000;
    this.maxThrottlesPerResume = options.maxThrottlesPerResume || 8;
    this.maxThrottleCount = options.maxThrottleCount || 150;
    this.maxBusyMs = options.maxBusyMs || 4000;

    if (this.interp) this.interp.sliceBudget = this.sliceBudget;


    this.heartbeat = new Signal(this, "Heartbeat");
    this.stepped = new Signal(this, "Stepped");
    this.renderStepped = new Signal(this, "RenderStepped");


    this.jobStats = new Map();
    this._currentJob = null;
    _registerScheduler(this);
  }


  _statFor(name) {
    let s = this.jobStats.get(name);
    if (!s) {
      s = { name, ema: 0, max: 0, last: 0, runs: 0, errors: 0 };
      this.jobStats.set(name, s);
    }
    return s;
  }


  _recordJob(name, fn) {
    const t0 = now();
    this._currentJob = name;
    try {
      fn();
    } finally {
      this._currentJob = null;
      const dtMs = Math.max(0, now() - t0);
      const s = this._statFor(name);
      s.runs++;
      s.last = dtMs;
      if (dtMs > s.max) s.max = dtMs;
      s.ema = s.runs === 1 ? dtMs : s.ema * 0.9 + dtMs * 0.1;
    }
  }

  _jobError(name) {
    this._statFor(name || "Wait Resume").errors++;
  }


  spawnGen(gen, opts = {}) {
    const thread = {
      gen,
      dead: false,
      name: opts.name || "thread",
      perfName: opts.perfName || opts.name || "thread",
      throttleCount: 0,
      busySince: 0,
      resumeAt: 0,
      injected: opts.injected,
      onComplete: opts.onComplete || null,
    };
    this.threads.push(thread);
    this.resume(thread);
    return thread;
  }


  spawnFn(fn, args, name) {
    if (!fn) return null;
    const gen = this.interp.call(fn, args || [], 0);
    const perfName = fn.script && fn.script.name ? String(fn.script.name) : null;
    return this.spawnGen(gen, { name: name || "thread", perfName });
  }


  resume(thread) {
    if (!scriptPerf.isActive()) return this._resumeInner(thread);
    const t0 = now();
    this._perfDepth++;
    try {
      return this._resumeInner(thread);
    } finally {
      this._perfDepth--;
      if (this._perfDepth === 0) {
        scriptPerf.report(this.perfContext, thread.perfName || thread.name, now() - t0);
      }
    }
  }

  _resumeInner(thread) {
    if (thread.dead) return;
    if (!thread.busySince) thread.busySince = now();
    let input = thread.injected;
    thread.injected = undefined;
    let perResume = 0;


    const prevThread = this.interp ? this.interp.currentThread : null;
    if (this.interp) this.interp.currentThread = thread;
    try {
      for (;;) {
        const res = thread.gen.next(input);
        input = undefined;
        if (res.done) {
          thread.dead = true;
          if (thread.onComplete) thread.onComplete(res.value);
          return;
        }
        const cmd = res.value;
        if (!cmd) continue;
        if (cmd.kind === "throttle") {
          thread.throttleCount++;
          if (
            thread.throttleCount > this.maxThrottleCount ||
            now() - thread.busySince > this.maxBusyMs
          ) {
            throw new LuaError(
              "Script excedeu o tempo de execu\u00e7\u00e3o (poss\u00edvel loop infinito) e foi interrompido",
            );
          }
          perResume++;
          if (perResume >= this.maxThrottlesPerResume) {
            this.readyQueue.push(thread);
            return;
          }
          continue;
        }
        if (cmd.kind === "wait") {
          thread.resumeAt = this.clock + Math.max(cmd.seconds || 0, 0);
          thread.waitStart = this.clock;                                                                    
          thread.busySince = 0;
          thread.throttleCount = 0;
          this.waiting.push(thread);
          return;
        }
        if (cmd.kind === "defer") {
          thread.busySince = 0;
          thread.throttleCount = 0;
          this.deferQueue.push(thread);
          return;
        }


        if (cmd.kind === "debugPause") {
          thread.busySince = 0;
          thread.throttleCount = 0;
          if (typeof cmd.onPause === "function") {
            try {
              cmd.onPause(thread);
            } catch (e) {

            }
          }
          return;
        }

      }
    } catch (e) {
      thread.dead = true;
      this.handleError(e, thread);
      return;
    } finally {


      if (this.interp) this.interp.currentThread = prevThread;
    }
  }

  handleError(e, thread) {

    this._jobError(this._currentJob);
    const msg = e instanceof LuaError ? e.message : (e && e.message) || String(e);
    if (this.logger) {
      this.logger.error(`${thread.name}: ${msg}`, {
        source: thread.name,
        stack: (e && e.traceback) || (e && e.stack) || "",
      });
    }
    if (this.onError) this.onError(e, thread);
  }


  _waitingHasDue() {
    for (const t of this.waiting) {
      if (t.dead || t.resumeAt <= this.clock) return true;
    }
    return false;
  }

  drainReady() {
    if (this.readyQueue.length === 0) return;                                        
    const q = this.readyQueue;
    this.readyQueue = [];
    for (const t of q) this.resume(t);
  }


  tickFrame(dt) {
    const step = typeof dt === "number" && dt >= 0 ? dt : 0.016;
    this.clock += step;


    this._recordJob("Stepped", () => this.stepped.fire([this.clock, step]));


    this._recordJob("Wait Resume", () => {

      if (this.waiting.length && this._waitingHasDue()) {
        const due = [];
        const remain = [];
        for (const t of this.waiting) {
          if (t.dead) continue;
          if (t.resumeAt <= this.clock) due.push(t);
          else remain.push(t);
        }
        this.waiting = remain;
        for (const t of due) {


          t.injected = [typeof t.waitStart === "number" ? Math.max(this.clock - t.waitStart, 0) : step];
          this.resume(t);
        }
      }


      if (this.deferQueue.length) {
        const d = this.deferQueue;
        this.deferQueue = [];
        for (const t of d) this.resume(t);
      }


      this.drainReady();
    });


    if (this.onInput) {
      this._recordJob("Input Processing", () => {
        try {
          this.onInput(step);
        } catch (e) {
          this._jobError("Input Processing");
          if (this.logger) {
            this.logger.warn("Input: erro no passo de entrada: " + ((e && e.message) || e), { source: "Studio" });
          }
        }
      });
    }

    if (this.onPhysics) {
      this._recordJob("Physics Simulation", () => {
        try {
          this.onPhysics(step);
        } catch (e) {
          this._jobError("Physics Simulation");
          if (this.logger) this.logger.warn("F\u00edsica: erro no passo: " + (e && e.message), { source: "Studio" });
        }
      });
    }



    if (this.onTweens) {
      this._recordJob("Tweens", () => {
        try {
          this.onTweens(step);
        } catch (e) {
          this._jobError("Tweens");
          if (this.logger) this.logger.warn("Tweens: erro no passo: " + (e && e.message), { source: "Studio" });
        }
      });
    }


    this._recordJob("Heartbeat", () => this.heartbeat.fire([step]));


    if (this.getMode() === "play") {
      this._recordJob("RenderStepped", () => this.renderStepped.fire([step]));
    }


    if (this.threads.length > 256 && this.threads.some((t) => t.dead)) {
      this.threads = this.threads.filter((t) => !t.dead);
    }
  }


  setPaused(v) {
    this.paused = !!v;
    if (!this.paused) this._lastTs = now();
  }


  _runSimulationFrame(frameTimestampMs) {
    if (!this.running) return;
    const timestampMs = typeof frameTimestampMs === "number" ? frameTimestampMs : now();

    if (this.paused) {
      this._lastTs = timestampMs;
      return;
    }
    const deltaSeconds = Math.min((timestampMs - this._lastTs) / 1000, 0.1);
    this._lastTs = timestampMs;
    try {
      this.tickFrame(deltaSeconds);
    } catch (e) {
      if (this.logger) {
        this.logger.error(
          "Erro no loop do scheduler: " + ((e && e.message) || String(e)),
          { stack: (e && e.stack) || "" },
        );
      }
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._lastTs = now();
    this._unregisterFrameCallback = registerFrameCallback(
      "simulation",
      (frameTimestampMs) => this._runSimulationFrame(frameTimestampMs),
      "scheduler:" + this.perfContext,
    );
  }

  stop() {
    this.running = false;
    if (typeof this._unregisterFrameCallback === "function") this._unregisterFrameCallback();
    this._unregisterFrameCallback = null;

    for (const t of this.threads) t.dead = true;
    this.threads = [];
    this.waiting = [];
    this.readyQueue = [];
    this.deferQueue = [];
    this.heartbeat.disconnectAll();
    this.stepped.disconnectAll();
    this.renderStepped.disconnectAll();
  }
}


export function installTaskLib(interp, scheduler) {
  const task = new LuaTable();

  const waitFn = nativeFn(function* (args) {
    const seconds = interp.tonumber(args[0]) || 0;
    const dt = yield { kind: "wait", seconds };
    return [Array.isArray(dt) ? dt[0] : seconds];
  }, "task.wait", true);

  const spawnFn = nativeFn((args) => {
    const fn = args[0];
    scheduler.spawnFn(fn, args.slice(1), "task.spawn");
    return [];
  }, "task.spawn");

  const deferFn = nativeFn((args) => {
    const fn = args[0];
    const rest = args.slice(1);

    const gen = (function* () {
      yield { kind: "defer" };
      yield* interp.call(fn, rest, 0);
    })();
    scheduler.spawnGen(gen, { name: "task.defer", perfName: fn && fn.script && fn.script.name ? String(fn.script.name) : "task.defer" });
    return [];
  }, "task.defer");

  const delayFn = nativeFn((args) => {
    const seconds = interp.tonumber(args[0]) || 0;
    const fn = args[1];
    const rest = args.slice(2);
    const gen = (function* () {
      yield { kind: "wait", seconds };
      yield* interp.call(fn, rest, 0);
    })();
    scheduler.spawnGen(gen, { name: "task.delay", perfName: fn && fn.script && fn.script.name ? String(fn.script.name) : "task.delay" });
    return [];
  }, "task.delay");

  task.rawset("wait", waitFn);
  task.rawset("spawn", spawnFn);
  task.rawset("defer", deferFn);
  task.rawset("delay", delayFn);
  task.rawset("cancel", nativeFn(() => [], "task.cancel"));
  interp.setGlobal("task", task);


  interp.setGlobal("wait", waitFn);
  interp.setGlobal("spawn", spawnFn);
  interp.setGlobal("delay", delayFn);


  interp.setGlobal("time", nativeFn(() => [scheduler.clock], "time"));
}
