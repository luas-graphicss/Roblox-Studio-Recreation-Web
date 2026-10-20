export const FRAME_PHASES = Object.freeze([
  "input",
  "simulation",
  "animation",
  "render",
  "overlay",
]);

const callbacksByPhase = new Map(FRAME_PHASES.map((phase) => [phase, []]));
const failureCountByCallbackName = new Map();

let frameRequestId = 0;
let frameCount = 0;
let lastFrameTimestamp = 0;
let skippedHiddenFrames = 0;
let registrationCount = 0;

function nowMs() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

function isDocumentHidden() {
  return typeof document !== "undefined" && document.hidden === true;
}

function countRegisteredCallbacks() {
  let total = 0;
  for (const phase of FRAME_PHASES) total += callbacksByPhase.get(phase).length;
  return total;
}

function scheduleNextFrame() {
  if (frameRequestId) return;
  if (countRegisteredCallbacks() === 0) return;
  if (typeof requestAnimationFrame !== "function") return;
  frameRequestId = requestAnimationFrame(runFrame);
}

function stopLoopWhenIdle() {
  if (countRegisteredCallbacks() > 0) return;
  if (frameRequestId && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(frameRequestId);
  }
  frameRequestId = 0;
}

function reportCallbackFailure(entry, error) {
  const failureCount = (failureCountByCallbackName.get(entry.name) || 0) + 1;
  failureCountByCallbackName.set(entry.name, failureCount);


  if (failureCount === 1) {
    console.error("[RSW] frame callback failed and was kept: " + entry.name, error);
  }
}

function runPhase(phase, frameTimestamp) {
  const callbacks = callbacksByPhase.get(phase);
  if (callbacks.length === 0) return;


  const scheduledEntries = callbacks.slice();
  for (const entry of scheduledEntries) {
    if (entry.unregistered) continue;
    try {
      entry.callback(frameTimestamp);
    } catch (error) {
      reportCallbackFailure(entry, error);
    }
  }
}

function runFrame(timestamp) {
  frameRequestId = 0;


  if (isDocumentHidden()) {
    skippedHiddenFrames += 1;
    scheduleNextFrame();
    return;
  }
  const frameTimestamp = typeof timestamp === "number" ? timestamp : nowMs();
  frameCount += 1;
  lastFrameTimestamp = frameTimestamp;
  for (const phase of FRAME_PHASES) runPhase(phase, frameTimestamp);
  scheduleNextFrame();
}


export function registerFrameCallback(phase, callback, callbackName) {
  if (!callbacksByPhase.has(phase)) {
    throw new Error(
      "frameDriver: unknown phase \"" + phase + "\"; expected one of " + FRAME_PHASES.join(", "),
    );
  }
  if (typeof callback !== "function") {
    throw new Error("frameDriver: callback for phase \"" + phase + "\" must be a function");
  }
  registrationCount += 1;
  const entry = {
    phase,
    callback,
    name: typeof callbackName === "string" && callbackName ? callbackName : phase + "#" + registrationCount,
    unregistered: false,
  };
  callbacksByPhase.get(phase).push(entry);
  scheduleNextFrame();
  return function unregisterFrameCallback() {
    if (entry.unregistered) return false;
    entry.unregistered = true;
    const callbacks = callbacksByPhase.get(phase);
    const index = callbacks.indexOf(entry);
    if (index >= 0) callbacks.splice(index, 1);
    stopLoopWhenIdle();
    return true;
  };
}


export function getFrameDriverState() {
  const callbackCountByPhase = {};
  for (const phase of FRAME_PHASES) {
    callbackCountByPhase[phase] = callbacksByPhase.get(phase).length;
  }
  return {
    running: frameRequestId !== 0,
    hidden: isDocumentHidden(),
    callbackCount: countRegisteredCallbacks(),
    callbackCountByPhase,
    frameCount,
    lastFrameTimestamp,
    skippedHiddenFrames,
    failureCountByCallbackName: Object.fromEntries(failureCountByCallbackName),
  };
}


export function resetFrameDriverForTests() {
  if (frameRequestId && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(frameRequestId);
  }
  frameRequestId = 0;
  frameCount = 0;
  lastFrameTimestamp = 0;
  skippedHiddenFrames = 0;
  registrationCount = 0;
  failureCountByCallbackName.clear();
  for (const phase of FRAME_PHASES) callbacksByPhase.get(phase).length = 0;
}

if (typeof window !== "undefined") {
  window.__rswFrameDriverQa = {
    phases: FRAME_PHASES,
    getState: getFrameDriverState,
  };
}
