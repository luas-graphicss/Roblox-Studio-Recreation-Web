const PREFIX = "rsw.";


const memory = new Map();

let warnedUnavailable = false;

function warn(...args) {
  try {
    console.warn("[utils/storage]", ...args);
  } catch {

  }
}

function warnUnavailableOnce(err) {
  if (warnedUnavailable) return;
  warnedUnavailable = true;
  warn("localStorage falhou/indisponível; usando espelho de sessão em memória.", err);
}


function fullKey(key) {
  if (typeof key !== "string") {
    warn("chave não-string recebida:", key, "(coerção para String)");
    key = String(key);
  }
  return PREFIX + key;
}

export function read(key) {
  const k = fullKey(key);


  if (memory.has(k)) return memory.get(k);
  try {
    return localStorage.getItem(k);
  } catch (err) {
    warnUnavailableOnce(err);
    return null;
  }
}

export function write(key, value) {
  const k = fullKey(key);
  if (typeof value !== "string") {
    if (typeof value === "number" || typeof value === "boolean") {

      value = String(value);
    } else {

      warn("write ignorado para", k, "- valor não-string; use writeJSON/remove.");
      return false;
    }
  }
  try {
    localStorage.setItem(k, value);
    memory.delete(k);                                                          
    return true;
  } catch (err) {
    warnUnavailableOnce(err);
    memory.set(k, value);                                                  
    return false;
  }
}

export function remove(key) {
  const k = fullKey(key);
  memory.delete(k);
  try {
    localStorage.removeItem(k);
    return true;
  } catch (err) {
    warnUnavailableOnce(err);
    return false;
  }
}

export function readJSON(key) {
  const raw = read(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    warn("JSON corrompido em", fullKey(key), "- entrada removida; o padrão será restaurado.");
    remove(key);
    return null;
  }
}

export function writeJSON(key, value) {
  let raw;
  try {
    raw = JSON.stringify(value);
  } catch (err) {
    warn("writeJSON não serializou", fullKey(key), err);
    return false;
  }
  if (typeof raw !== "string") {
    warn("writeJSON ignorado para", fullKey(key), "- valor não-serializável (undefined/função/símbolo).");
    return false;
  }
  return write(key, raw);
}
