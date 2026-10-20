import { read, write, remove } from "../utils/storage.js";

const DEBUG_FLAG_STORAGE_KEY = "debugSurfaceEnabled";

export function isDebugSurfaceEnabled() {
  return read(DEBUG_FLAG_STORAGE_KEY) === "true";
}

export function enableDebugSurface() {
  return write(DEBUG_FLAG_STORAGE_KEY, "true");
}

export function disableDebugSurface() {
  return remove(DEBUG_FLAG_STORAGE_KEY);
}


export function exposeDebugHandle(handleName, handleValue) {
  if (typeof window === "undefined") return false;
  if (!isDebugSurfaceEnabled()) return false;
  if (window[handleName]) return false;
  window[handleName] = handleValue;
  return true;
}
