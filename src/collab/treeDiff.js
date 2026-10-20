const VALUE_MAX = 120;


const MAX_DEPTH = 128;

function nodeName(node) {
  if (node && typeof node.n === "string" && node.n) return node.n;
  return node && node.c ? String(node.c) : "Instance";
}

function normProps(node) {
  const out = {};
  const p = node && node.p && typeof node.p === "object" ? node.p : {};
  for (const key of Object.keys(p)) out[key] = p[key];
  if (node && Array.isArray(node.a) && node.a.length) {
    for (const e of node.a) {
      if (e && typeof e.n === "string") out["@attr:" + e.n] = e.v;
    }
  }
  if (node && Array.isArray(node.t) && node.t.length) {
    out["@tags"] = node.t.slice().sort();
  }
  return out;
}

export function indexPlaceObject(fileObj) {
  const map = new Map();
  const tree = fileObj && Array.isArray(fileObj.tree) ? fileObj.tree : [];
  const walk = (node, parentKey, parentPath, ordinals, depth) => {
    if (!node || typeof node !== "object" || depth > MAX_DEPTH) return;
    const name = nodeName(node);
    const cls = String(node.c || "Instance");
    const base = name + "(" + cls + ")";
    const seen = ordinals.get(base) || 0;
    ordinals.set(base, seen + 1);
    const key = parentKey + "/" + base + (seen ? "#" + seen : "");
    const path = parentPath + "/" + name;
    map.set(key, {
      key,
      path,
      className: cls,
      name,
      props: normProps(node),
    });
    const kids = Array.isArray(node.ch) ? node.ch : [];
    const childOrdinals = new Map();
    for (const ch of kids) walk(ch, key, path, childOrdinals, depth + 1);
  };
  for (const svc of tree) {
    if (!svc || typeof svc !== "object") continue;
    const sName = String(svc.s || "Service");
    const sKey = sName;
    const ordinals = new Map();
    for (const ch of Array.isArray(svc.ch) ? svc.ch : []) {
      walk(ch, sKey, sName, ordinals, 0);
    }
  }
  return map;
}

export function formatDiffValue(v) {
  if (v === undefined) return "(padr\u00e3o)";
  if (v === null) return "null";
  if (typeof v === "string") {
    const s = v.length > VALUE_MAX ? v.slice(0, VALUE_MAX) + "\u2026" : v;
    return s.replace(/\s+/g, " ");
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > VALUE_MAX ? s.slice(0, VALUE_MAX) + "\u2026" : s;
  } catch (_) {
    return "[valor]";
  }
}

function sameValue(a, b) {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (_) {
    return false;
  }
}

export function diffPlaceObjects(aObj, bObj) {
  const aMap = indexPlaceObject(aObj);
  const bMap = indexPlaceObject(bObj);
  const added = [];
  const removed = [];
  const modified = [];
  const unchanged = [];
  for (const [key, bNode] of bMap) {
    const aNode = aMap.get(key);
    if (!aNode) {
      added.push({ key, path: bNode.path, className: bNode.className });
      continue;
    }
    const changes = [];
    const names = new Set([...Object.keys(aNode.props), ...Object.keys(bNode.props)]);
    for (const prop of names) {
      const from = aNode.props[prop];
      const to = bNode.props[prop];
      if (!sameValue(from, to)) changes.push({ prop, from, to });
    }
    if (changes.length) {
      changes.sort((x, y) => (x.prop < y.prop ? -1 : 1));
      modified.push({ key, path: bNode.path, className: bNode.className, changes });
    } else {
      unchanged.push({ key, path: bNode.path, className: bNode.className });
    }
  }
  for (const [key, aNode] of aMap) {
    if (!bMap.has(key)) {
      removed.push({ key, path: aNode.path, className: aNode.className });
    }
  }
  const byPath = (x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0);
  added.sort(byPath);
  removed.sort(byPath);
  modified.sort(byPath);
  unchanged.sort(byPath);
  return { added, removed, modified, unchanged };
}

export function diffSummary(diff) {
  const d = diff || { added: [], removed: [], modified: [] };
  return (
    "+" + d.added.length + " adicionados, \u2212" + d.removed.length +
    " removidos, \u0394" + d.modified.length + " modificados"
  );
}
