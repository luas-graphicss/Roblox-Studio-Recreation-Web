export function createSubstrateTelemetry() {
  const state = { phases: {}, passes: {}, uniforms: {}, textureUnits: {}, closureBytes: {}, errors: [], refusedPatches: [], appliedPatches: [] };
  const api = { get: () => state, errors: () => state.errors, clearErrors() { state.errors.length = 0; } };
  for (const name of ['tier', 'topology', 'closures', 'renderer', 'threeRevision', 'contractVersion', 'measurement', 'appliedPatches']) api[name] = value => { state[name] = value; };
  for (const name of ['pass', 'uniform', 'textureUnit', 'closureBytes', 'anchor', 'frameStage']) api[name] = (key, value) => { const target = name === 'textureUnit' ? 'textureUnits' : name === 'uniform' ? 'uniforms' : name; (state[target] ??= {})[key] = value; };
  api.phase = (id, status, detail) => { state.phases[id] = { status, detail }; };
  api.error = (source, message) => { state.errors.push({ source, message: String(message) }); if (state.errors.length > 40) state.errors.shift(); };
  api.refusedPatch = refusal => { state.refusedPatches.push(refusal); if (state.refusedPatches.length > 40) state.refusedPatches.shift(); };
  api.totalTextureUnits = () => Object.values(state.textureUnits).reduce((sum, value) => sum + value, 0);
  api.totalClosureBytes = () => Object.values(state.closureBytes).reduce((sum, value) => sum + value, 0);
  return api;
}
