export const SYNC_DEBOUNCE_MS = 500;

export function createSourceSync(opts) {
  const o = opts || {};
  const debounceMs = typeof o.debounceMs === "number" ? o.debounceMs : SYNC_DEBOUNCE_MS;
  const setSource = typeof o.setSource === "function" ? o.setSource : () => {};
  const getSource = typeof o.getSource === "function" ? o.getSource : () => "";
  const schedule = typeof o.schedule === "function" ? o.schedule : setTimeout;
  const clear = typeof o.clear === "function" ? o.clear : clearTimeout;

  let timer = null;
  let pending = null;
  let self = false;

  function flush() {
    timer = null;
    if (pending == null) return;
    const value = pending;
    pending = null;
    self = true;
    try {
      setSource(value);
    } finally {
      self = false;
    }
  }


  function onEditorChange(value) {
    pending = value;
    if (timer) clear(timer);
    timer = schedule(flush, debounceMs);
  }


  function cancel() {
    if (timer) clear(timer);
    timer = null;
    pending = null;
  }


  function shouldApplyExternal(newValue) {
    if (self) return false;
    return newValue !== getSource();
  }

  return {
    onEditorChange,
    flush,
    cancel,
    isSelf: () => self,
    hasPending: () => pending != null,
    shouldApplyExternal,
  };
}
