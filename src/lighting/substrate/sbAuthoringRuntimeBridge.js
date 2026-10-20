export function createAuthoringRuntimeBridge({session, runtime, redraw = () => {}}) {
  let selectionKey = null;
  function synchronize() {
    if (!runtime) return {ok:true, changed:false};
    const key = runtime.selectionKey();
    if (!key) return {ok:false,reason:'No scene material selected'};
    if (key === selectionKey) return {ok:true, changed:false};
    const tree = runtime.tree();
    if (!tree) return {ok:false, reason:'No scene material selected'};
    const result = session.loadTree(tree);
    if (result.ok) selectionKey = key;
    return {...result, changed:result.ok};
  }
  function forSelectedMaterial(operation) {
    return (...args) => {
      const synchronization = synchronize();
      if (!synchronization.ok) return synchronization;
      const result = operation(...args);
      selectionKey = runtime?.selectionKey() ?? null;
      return result;
    };
  }
  return {
    synchronize,
    forSelectedMaterial,
    target(id) {
      if (!runtime) return null;
      if (id === undefined) { synchronize(); return runtime.target(); }
      const result = runtime.target(id);
      if (result.ok) synchronize();
      return result;
    },
    replaceTree(tree) {
      const synchronization = synchronize();
      if (!synchronization.ok) return synchronization;
      const result = session.loadTree(tree);
      if (!result.ok) return result;
      runtime?.applyAuthoredTree(session.root());
      selectionKey = runtime?.selectionKey() ?? null;
      redraw();
      return result;
    },
    reset() {
      const result = runtime?.useSceneMaterial() ?? {ok:false,reason:'Material runtime unavailable'};
      synchronize(); redraw(); return result;
    },
  };
}
