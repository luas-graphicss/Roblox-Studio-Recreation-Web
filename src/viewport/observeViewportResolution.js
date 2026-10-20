export function observeViewportResolution(host, onResize, environment = globalThis) {
  let disposed = false;
  let resolutionQuery = null;
  let removeResolutionListener = null;
  let observer = null;

  function armResolutionQuery() {
    if (removeResolutionListener) removeResolutionListener();
    removeResolutionListener = null;
    resolutionQuery = null;
    if (disposed || typeof environment.matchMedia !== "function") return;
    const ratio = environment.devicePixelRatio || 1;
    resolutionQuery = environment.matchMedia(`(resolution: ${ratio}dppx)`);
    const currentQuery = resolutionQuery;
    if (typeof currentQuery.addEventListener === "function") {
      currentQuery.addEventListener("change", handleResolutionChange);
      removeResolutionListener = () => currentQuery.removeEventListener("change", handleResolutionChange);
    } else if (typeof currentQuery.addListener === "function") {
      currentQuery.addListener(handleResolutionChange);
      removeResolutionListener = () => currentQuery.removeListener(handleResolutionChange);
    }
  }

  function handleResolutionChange() {
    if (disposed) return;
    armResolutionQuery();
    onResize();
  }

  function handleResize() {
    if (!disposed) onResize();
  }

  if (typeof environment.ResizeObserver === "function") {
    observer = new environment.ResizeObserver(handleResize);
    observer.observe(host);
  }
  if (typeof environment.addEventListener === "function") {
    environment.addEventListener("resize", handleResize);
  }
  armResolutionQuery();

  return function stopObservingResolution() {
    if (disposed) return;
    disposed = true;
    if (observer) observer.disconnect();
    if (removeResolutionListener) removeResolutionListener();
    if (typeof environment.removeEventListener === "function") {
      environment.removeEventListener("resize", handleResize);
    }
    observer = null;
    resolutionQuery = null;
    removeResolutionListener = null;
  };
}
