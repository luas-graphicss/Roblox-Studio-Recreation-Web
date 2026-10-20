export const DS_REQUEST_KINDS = Object.freeze([
  "Get", "Set", "Update", "Increment", "Remove", "GetSorted", "List",
]);
export const MAX_DS_ERRORS = 8;
const MAX_ERROR_LEN = 200;

function freshRequests() {
  const o = {};
  for (const k of DS_REQUEST_KINDS) o[k] = 0;
  return o;
}

const state = {
  requests: freshRequests(),
  throttled: 0,
  pending: 0,
  failures: 0,
  lastErrors: [],
  respCount: 0,
  respTotalMs: 0,
};

export function dsStatsReset() {
  state.requests = freshRequests();
  state.throttled = 0;
  state.pending = 0;
  state.failures = 0;
  state.lastErrors = [];
  state.respCount = 0;
  state.respTotalMs = 0;
}

export function dsStatsRecordRequest(kind) {


  if (!DS_REQUEST_KINDS.includes(kind)) return;
  state.requests[kind]++;
}

export function dsStatsRecordThrottle() {
  state.throttled++;
}

export function dsStatsQueueEnter() {
  state.pending++;
}

export function dsStatsQueueLeave() {
  state.pending = Math.max(0, state.pending - 1);
}

export function dsStatsRecordFailure(message) {
  state.failures++;
  const msg = String(message == null ? "erro" : message).slice(0, MAX_ERROR_LEN);
  state.lastErrors.push({ message: msg, time: Date.now() });
  if (state.lastErrors.length > MAX_DS_ERRORS) {
    state.lastErrors.splice(0, state.lastErrors.length - MAX_DS_ERRORS);
  }
}

export function dsStatsRecordResponse(ms) {
  const v = Number(ms);
  if (!Number.isFinite(v) || v < 0) return;
  state.respCount++;
  state.respTotalMs += Math.min(v, 120000);
}

export function getDsStats() {
  return {
    requests: { ...state.requests },
    throttled: state.throttled,
    pending: state.pending,
    failures: state.failures,
    lastErrors: state.lastErrors.map((e) => ({ ...e })),
    avgResponseMs: state.respCount > 0 ? state.respTotalMs / state.respCount : 0,
  };
}
