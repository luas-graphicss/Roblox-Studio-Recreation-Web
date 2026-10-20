import { bus } from "./eventBus.js";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const HARD_BUFFER_CAP = 50000;                                   

let currentLevel = LEVELS.info;
let started = false;
let seq = 0;
const buffer = [];

export function startLogger(level = "info") {
  currentLevel = LEVELS[level] ?? LEVELS.info;
  started = true;
  log("info", "Logger iniciado.");
}


const OPTION_KEYS = new Set(["source", "stack", "context"]);
function isOptions(x) {
  if (!x || typeof x !== "object" || Object.getPrototypeOf(x) !== Object.prototype) return false;
  const keys = Object.keys(x);
  return keys.length > 0 && keys.every((k) => OPTION_KEYS.has(k));
}

function formatArg(a) {
  if (typeof a === "string") return a;
  if (a instanceof Error) return a.message ? `${a.name}: ${a.message}` : String(a);
  if (a === null) return "null";
  if (a === undefined) return "undefined";
  if (typeof a === "object") {
    try {
      return JSON.stringify(a);
    } catch (_) {
      return String(a);
    }
  }
  return String(a);
}


function sanitizeStack(stack) {
  if (typeof stack !== "string" || !stack) return undefined;
  const lines = stack.split("\n").slice(0, 12);                       
  return lines
    .map((line) =>
      line.replace(/(?:[a-zA-Z]+:\/\/[^\s)]+|\/[^\s):]+)/g, (m) => {
        const seg = m.split(/[\\/]/).filter(Boolean).pop() || m;
        return seg;
      }),
    )
    .join("\n");
}

function captureStack(args) {
  for (const a of args) {
    if (a instanceof Error && a.stack) return sanitizeStack(a.stack);
  }
  const e = new Error();

  const raw = (e.stack || "").split("\n").slice(3).join("\n");
  return sanitizeStack(raw);
}

function pushEntry(entry) {
  buffer.push(entry);
  if (buffer.length > HARD_BUFFER_CAP) buffer.splice(0, buffer.length - HARD_BUFFER_CAP);
  bus.emit("log:added", entry);
}

function log(level, ...args) {

  let opts = null;
  if (args.length && isOptions(args[args.length - 1])) opts = args.pop();

  const message = args.map(formatArg).join(" ");
  const source = opts && typeof opts.source === "string" ? opts.source : undefined;

  const context = opts && typeof opts.context === "string" ? opts.context : undefined;
  let stack = opts && typeof opts.stack === "string" ? sanitizeStack(opts.stack) : undefined;
  if (level === "error" && !stack) stack = captureStack(args);


  const entry = {
    id: ++seq,
    level: LEVELS[level] ? level : "info",
    message,
    source,
    context,
    stack,
    time: Date.now(),
  };
  pushEntry(entry);


  const passConsole =
    level === "error" || (started && (LEVELS[level] ?? 99) >= currentLevel);
  if (passConsole) {
    const fn =
      level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    fn("[RSW]", ...args, ...(opts ? [opts] : []));
  }
}

export const logger = {
  debug: (...a) => log("debug", ...a),
  info: (...a) => log("info", ...a),
  warn: (...a) => log("warn", ...a),
  error: (...a) => log("error", ...a),

  clear() {
    buffer.length = 0;
    bus.emit("log:cleared", {});
  },

  getEntries() {
    return buffer.slice();
  },
};
