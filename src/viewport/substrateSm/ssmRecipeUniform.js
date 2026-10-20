import { SSM_RECIPE_FLOAT_COUNT, writeSubstrateSmRecipePayload, validateSubstrateSmRecipePayload } from '../../lighting/substrateSm/ssmRecipeLayout.js';
import { SSM_BASE_UNIFORM_VECTOR_COUNT } from './ssmShaderContract.js';

export function createSubstrateSmRecipeUniform() {
  const payload = new Float32Array(SSM_RECIPE_FLOAT_COUNT);
  const uniform = Object.freeze({ value: payload.subarray(0, SSM_BASE_UNIFORM_VECTOR_COUNT * 4) });
  let revision = 0;

  function update(next) {
    validateSubstrateSmRecipePayload(next);
    let changed = false;
    for (let index = 0; index < payload.length; index += 1) {
      if (payload[index] !== next[index]) { changed = true; break; }
    }
    if (changed) {
      payload.set(next);
      revision += 1;
    }
    return changed;
  }

  function write(parameters) { return update(writeSubstrateSmRecipePayload(parameters)); }
  function copy() { return payload.slice(); }
  function clear() { payload.fill(0); revision += 1; }
  function getRevision() { return revision; }
  return Object.freeze({ uniform, update, write, copy, clear, getRevision });
}
