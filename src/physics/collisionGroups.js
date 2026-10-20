import { bus } from "../core/eventBus.js";
import { readJSON, writeJSON } from "../utils/storage.js";

export const MAX_GROUPS = 32;
export const DEFAULT_GROUP = "Default";
const STORE_KEY = "physics.collisionGroups";
const NAME_MAX = 40;

export const CollisionGroupEvents = Object.freeze({
  Changed: "physics:collisionGroupsChanged",
});


let groups = [DEFAULT_GROUP];
let nonCollidable = new Set();
let loaded = false;

function sanitizeName(name) {
  const s = String(name == null ? "" : name).trim().slice(0, NAME_MAX);
  return s;
}

function pairKey(a, b) {
  return a < b ? a + "||" + b : b + "||" + a;
}

function persist() {
  writeJSON(STORE_KEY, { groups, nonCollidable: [...nonCollidable] });
}

function load() {
  if (loaded) return;
  loaded = true;
  const data = readJSON(STORE_KEY, null);
  if (data && Array.isArray(data.groups)) {
    const seen = new Set();
    const list = [];
    for (const g of data.groups) {
      const name = sanitizeName(g);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      list.push(name);
      if (list.length >= MAX_GROUPS) break;
    }
    if (!list.includes(DEFAULT_GROUP)) list.unshift(DEFAULT_GROUP);
    groups = list.slice(0, MAX_GROUPS);
    nonCollidable = new Set(
      Array.isArray(data.nonCollidable) ? data.nonCollidable.filter((k) => typeof k === "string") : [],
    );
  }
}

function emitChanged() {
  bus.emit(CollisionGroupEvents.Changed, { groups: getGroups() });
}

export function getGroups() {
  load();
  return groups.slice();
}

export function isRegistered(name) {
  load();
  return groups.includes(sanitizeName(name));
}


export function registerGroup(name) {
  load();
  const n = sanitizeName(name);
  if (!n) return { ok: false, error: "Nome de grupo inv\u00e1lido." };
  if (groups.includes(n)) return { ok: true };
  if (groups.length >= MAX_GROUPS) {
    return { ok: false, error: `Limite de ${MAX_GROUPS} collision groups atingido.` };
  }
  groups.push(n);
  persist();
  emitChanged();
  return { ok: true };
}


export function unregisterGroup(name) {
  load();
  const n = sanitizeName(name);
  if (n === DEFAULT_GROUP) return { ok: false, error: "O grupo Default n\u00e3o pode ser removido." };
  const idx = groups.indexOf(n);
  if (idx === -1) return { ok: false, error: "Grupo n\u00e3o registrado." };
  groups.splice(idx, 1);
  for (const key of [...nonCollidable]) {
    const [a, b] = key.split("||");
    if (a === n || b === n) nonCollidable.delete(key);
  }
  persist();
  emitChanged();
  return { ok: true };
}

export function setCollidable(groupA, groupB, collidable) {
  load();
  const a = sanitizeName(groupA);
  const b = sanitizeName(groupB);
  if (!groups.includes(a) || !groups.includes(b)) {
    return { ok: false, error: "Grupo n\u00e3o registrado." };
  }
  const key = pairKey(a, b);
  if (collidable) nonCollidable.delete(key);
  else nonCollidable.add(key);
  persist();
  emitChanged();
  return { ok: true };
}

export function areCollidable(groupA, groupB) {
  load();
  const a = groups.includes(sanitizeName(groupA)) ? sanitizeName(groupA) : DEFAULT_GROUP;
  const b = groups.includes(sanitizeName(groupB)) ? sanitizeName(groupB) : DEFAULT_GROUP;
  return !nonCollidable.has(pairKey(a, b));
}


export function groupOfPart(part) {
  load();
  const g = part && part.hasProperty && part.hasProperty("CollisionGroup")
    ? sanitizeName(part.getProperty("CollisionGroup"))
    : DEFAULT_GROUP;
  return groups.includes(g) ? g : DEFAULT_GROUP;
}


export function groupBit(name) {
  load();
  const idx = groups.indexOf(sanitizeName(name));
  return idx >= 0 ? (1 << idx) : 1;
}


export function groupMask(name) {
  load();
  const n = groups.includes(sanitizeName(name)) ? sanitizeName(name) : DEFAULT_GROUP;
  let mask = 0;
  for (let i = 0; i < groups.length; i++) {
    if (areCollidable(n, groups[i])) mask |= (1 << i);
  }
  return mask;
}
