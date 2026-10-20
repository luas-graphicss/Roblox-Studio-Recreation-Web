const VISIBILITY_CHANGE_EVENT = "visibilitychange";

function isDocumentVisible() {
  return typeof document === "undefined" || document.hidden !== true;
}


export function startVisibilityAwareInterval(callback, intervalMs, options) {
  const runWhenBecomingVisible = !options || options.runWhenBecomingVisible !== false;
  let timerId = null;
  let stopped = false;

  function startTimer() {
    if (stopped || timerId !== null) return;

    if (typeof setInterval !== "function") return;
    timerId = setInterval(callback, intervalMs);
  }

  function stopTimer() {
    if (timerId === null) return;
    clearInterval(timerId);
    timerId = null;
  }

  function syncWithDocumentVisibility() {
    if (stopped) return;
    if (!isDocumentVisible()) {
      stopTimer();
      return;
    }
    startTimer();
    if (runWhenBecomingVisible) {
      try {
        callback();
      } catch (_error) {

      }
    }
  }

  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener(VISIBILITY_CHANGE_EVENT, syncWithDocumentVisibility);
  }
  if (isDocumentVisible()) startTimer();

  return function stopVisibilityAwareInterval() {
    if (stopped) return;
    stopped = true;
    stopTimer();
    if (typeof document !== "undefined" && document.removeEventListener) {
      document.removeEventListener(VISIBILITY_CHANGE_EVENT, syncWithDocumentVisibility);
    }
  };
}
