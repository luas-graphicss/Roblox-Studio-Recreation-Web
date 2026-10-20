export function megaLightsDebugIsEnabled(lighting) {
  return (
    lighting?.getProperty("Technology") === "Future" &&
    lighting?.getProperty("MegaLightsDebug") === true
  );
}

export function createMegaLightsDebugBridge(configuration) {
  let session = null;
  let loading = null;
  let revision = 0;
  let disposed = false;
  let lighting = null;
  let errorMessage = "";

  function deactivate() {
    revision += 1;
    session?.dispose();
    session = null;
    lighting = null;
  }

  function synchronize() {
    const nextLighting = configuration.readLighting();
    if (disposed || !megaLightsDebugIsEnabled(nextLighting)) {
      if (session || lighting) deactivate();
      return;
    }
    if (lighting && lighting !== nextLighting) deactivate();
    if (session || loading) return;
    lighting = nextLighting;
    const expectedRevision = ++revision;
    loading = import("../lighting/megalights/debug/megaLightsDebugSession.js")
      .then(({ createMegaLightsDebugSession }) => {
        if (
          disposed ||
          revision !== expectedRevision ||
          configuration.readLighting() !== nextLighting ||
          !megaLightsDebugIsEnabled(nextLighting)
        )
          return;
        session = createMegaLightsDebugSession({
          ...configuration,
          onClose() {
            if (configuration.readLighting() === nextLighting)
              nextLighting.setProperty("MegaLightsDebug", false);
            deactivate();
            configuration.requestRender?.();
          },
        });
        errorMessage = "";
        configuration.requestRender?.();
      })
      .catch((error) => {
        errorMessage = String(error?.message || error);
        console.error("MegaLights diagnostics could not start:", errorMessage);
      })
      .finally(() => {
        loading = null;
        if (
          !disposed &&
          revision !== expectedRevision &&
          megaLightsDebugIsEnabled(configuration.readLighting())
        )
          synchronize();
      });
  }

  return {
    synchronize,
    beforeFrame(request) {
      if (
        session &&
        (!megaLightsDebugIsEnabled(configuration.readLighting()) ||
          lighting !== configuration.readLighting())
      )
        deactivate();
      session?.beforeFrame(request);
    },
    afterRender(milliseconds) {
      session?.afterRender(milliseconds);
    },
    snapshot: () => ({
      active: !!session,
      loading: !!loading,
      error: errorMessage,
    }),
    dispose() {
      disposed = true;
      deactivate();
    },
  };
}
