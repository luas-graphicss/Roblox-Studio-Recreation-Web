import { PropTypes, valuesEqual } from "../datamodel/types.js";

import { deepCloneJsonValue } from "../core/deepCloneJsonValue.js";
import { isClass, getClassDef, createInstance, registerDynamicClass, isDynamicClass } from "../datamodel/index.js";
import { CHUNK, IMPORT_BULK_MAX_CHUNKS } from "../terrain/terrainData.js";


import {
  RBX_UNKNOWN_LIMITS,
  readOpaqueProps,
  attachOpaqueProp,
  unknownPropName,
  unknownPropFromXml,
  readUnknownClass,
  attachUnknownClass,
  captureUnknownClass,
  bagNodeToJson,
  bagNodeFromJson,

  decodeBagNodeToDynamicProp,
  dynamicPropToBagNode,
} from "../interop/rbxUnknown.js";

export const FORMAT_PLACE = "rsw-place";
export const FORMAT_MODEL = "rsw-model";
export const FORMAT_VERSION = 1;
export const EDITOR_VERSION = "RobloxStudioWeb/1.1.0";
export const PLACE_EXT = ".rswp";
export const MODEL_EXT = ".rswm";

export const LIMITS = Object.freeze({
  maxDepth: 1000,
  maxInstances: 500000,
  maxFileBytes: 200 * 1024 * 1024,         
  maxThumbBytes: 64 * 1024,        
  maxStringLen: 4 * 1024 * 1024,                                           
});


export function hashString(s) {
  let h = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);


    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return "h" + h.toString(36) + "_" + (str.length).toString(36);
}


export function isValidDataUri(s) {
  if (typeof s !== "string") return false;
  if (s.length > LIMITS.maxFileBytes) return false;
  return /^data:[a-z0-9.+-]+\/[a-z0-9.+-]+(;[a-z0-9.+-]+=[a-z0-9.+-]*)*(;base64)?,/i.test(s);
}

function isFiniteNum(n) {
  return typeof n === "number" && Number.isFinite(n);
}


function cloneForSave(type, value, warnings, label) {
  if (value == null) return null;
  if (typeof value === "string") {
    if (value.length > LIMITS.maxStringLen) {
      warnings.push(`String truncada em ${label} (limite ${LIMITS.maxStringLen} chars).`);
      return value.slice(0, LIMITS.maxStringLen);
    }
    return value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "boolean") return value;
  try {
    return deepCloneJsonValue(value);
  } catch (_) {
    warnings.push(`Valor não serializável ignorado em ${label}.`);
    return null;
  }
}


function defaultNameOf(inst) {
  const def = getClassDef(inst.className);
  return (def && def.defaultName) || inst.className;
}


function nodeShell(inst, idOf, warnings, cache) {
  const node = { i: idOf.get(inst), c: inst.className };
  let entry = cache ? cache.get(inst) : null;
  if (!entry) {
    const descs = inst.listProperties().filter((d) => !d.readOnly && d.name !== "Name");
    descs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    let p = null;
    let refs = null;
    for (const d of descs) {
      if (d.type === PropTypes.Instance) {
        if (!d.value) continue;                           
        if (!refs) refs = [];
        refs.push({ name: d.name, target: d.value });
        continue;
      }
      if (valuesEqual(d.type, d.value, d.default)) continue;
      if (!p) p = {};
      p[d.name] = cloneForSave(d.type, d.value, warnings, `${inst.name}.${d.name}`);
    }
    entry = {
      n: inst.name !== defaultNameOf(inst) ? inst.name : undefined,
      p,
      refs,
    };
    if (cache && inst.className !== "UnionOperation") cache.set(inst, entry);
  }
  if (entry.n !== undefined) node.n = entry.n;
  if (entry.p) node.p = entry.p;
  if (entry.refs) {
    let r = null;
    for (const ref of entry.refs) {
      const tid = idOf.get(ref.target);
      if (tid) {
        if (!r) r = {};
        r[ref.name] = tid;
      } else {
        warnings.push(`Referência para fora do arquivo removida: ${inst.name}.${ref.name}`);
      }
    }
    if (r) node.r = r;
  }

  const attrs = inst.getAttributesList ? inst.getAttributesList() : [];
  if (attrs.length) {
    node.a = attrs.map((e) => ({ n: e.name, t: e.type, v: e.value }));
  }
  const tags = inst.getTags ? inst.getTags() : [];
  if (tags.length) node.t = tags.slice(0, 50);





  const opaque = readOpaqueProps(inst);
  if (opaque.length) {
    node.u = opaque.map((rec) => [unknownPropName(rec), rec.b64]);
  }


  const dynProps = typeof inst.listDynamicProperties === "function" ? inst.listDynamicProperties() : [];
  const ucls = readUnknownClass(inst);
  if (ucls || dynProps.length > 0) {
    const bag = [];


    for (const dp of dynProps) {
      const live = dynamicPropToBagNode(dp);
      if (!live) continue;
      const clone = bagNodeToJson(live, () => null);
      if (clone) bag.push(clone);
    }
    for (const propNode of (ucls ? ucls.props : [])) {
      const clone = bagNodeToJson(propNode, (target) => {
        const tid = idOf.get(target);
        if (!tid) warnings.push(`Ref opaca para fora do arquivo vira null: ${inst.name} (${ucls.className})`);
        return tid || null;
      });
      if (clone) bag.push(clone);
    }
    node.uc = { c: ucls.className, p: bag };
  }
  if (inst.className === "UnionOperation" && Array.isArray(inst._sourceParts) && inst._sourceParts.length) {
    const srcLive = inst._sourceParts.filter(
      (s) => s && s.__isInstance === true && !(typeof s.isDestroyed === "function" && s.isDestroyed()),
    );
    if (srcLive.length) {
      try {
        const sub = serializeInstances(srcLive);
        if (sub && Array.isArray(sub.nodes) && sub.nodes.length) node.csg = sub.nodes;


        if (sub && Array.isArray(sub.warnings)) {
          for (const w of sub.warnings) warnings.push(`CSG "${inst.name}": ${w}`);
        }
      } catch (err) {
        warnings.push(`CSG Tree da Union "${inst.name}" não pôde ser serializada (${err.message}).`);
      }
    }
  }
  return node;
}


function assignIds(roots, skip) {
  const idOf = new Map();
  let counter = 0;
  const visit = (inst, depth) => {
    if (depth > LIMITS.maxDepth) {
      throw new Error(`Hierarquia excede a profundidade máxima de ${LIMITS.maxDepth}.`);
    }
    if (!inst || (inst.isDestroyed && inst.isDestroyed())) return;
    if (skip && skip(inst)) return;
    counter += 1;
    if (counter > LIMITS.maxInstances) {
      throw new Error(`Projeto excede o limite de ${LIMITS.maxInstances} instâncias.`);
    }
    idOf.set(inst, "n" + counter);
    for (const ch of inst.getChildren()) visit(ch, depth + 1);
  };
  for (const root of roots) visit(root, 1);
  return idOf;
}


export function serializeInstances(roots, opts = {}) {
  const skip = typeof opts.skip === "function" ? opts.skip : null;
  const cache = opts.cache || null;
  const warnings = [];
  const idOf = assignIds(roots, skip);
  let count = 0;
  const build = (inst) => {
    if (!idOf.has(inst)) return null;
    const node = nodeShell(inst, idOf, warnings, cache);
    count += 1;
    const ch = [];
    for (const c of inst.getChildren()) {
      const cn = build(c);
      if (cn) ch.push(cn);
    }
    if (ch.length) node.ch = ch;
    return node;
  };
  const nodes = [];
  for (const root of roots) {
    const n = build(root);
    if (n) nodes.push(n);
  }
  return { nodes, warnings, count, idOf };
}


export async function serializeInstancesAsync(roots, opts = {}, onProgress) {
  const skip = typeof opts.skip === "function" ? opts.skip : null;
  const cache = opts.cache || null;
  const warnings = [];
  const idOf = assignIds(roots, skip);
  const total = Math.max(1, idOf.size);
  const SLICE = 2000;                        
  let processed = 0;
  const nodes = [];


  const stack = [];
  for (let i = roots.length - 1; i >= 0; i--) {
    stack.push({ inst: roots[i], out: nodes });
  }
  while (stack.length) {
    const { inst, out } = stack.pop();
    if (!idOf.has(inst)) continue;


    if (inst.isDestroyed && inst.isDestroyed()) continue;
    const node = nodeShell(inst, idOf, warnings, cache);
    out.push(node);
    const children = inst.getChildren().filter((c) => idOf.has(c));
    if (children.length) {
      node.ch = [];
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ inst: children[i], out: node.ch });
      }
    }
    processed += 1;
    if (processed % SLICE === 0) {
      if (typeof onProgress === "function") onProgress(processed / total);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  if (typeof onProgress === "function") onProgress(1);
  return { nodes, warnings, count: processed, idOf };
}


export function deserializeInstances(nodes, opts = {}) {
  const warnings = [];
  const byId = new Map();
  const pendingRefs = [];                                

  const pendingBagRefs = [];
  let total = 0;
  let dupSeq = 0;

  const build = (node, depth) => {
    if (depth > LIMITS.maxDepth) {
      warnings.push("Nó além da profundidade máxima ignorado.");
      return null;
    }
    if (!node || typeof node !== "object" || Array.isArray(node)) return null;
    total += 1;
    if (total > LIMITS.maxInstances) {
      throw new Error(`Arquivo excede o limite de ${LIMITS.maxInstances} instâncias.`);
    }
    let cls = typeof node.c === "string" ? node.c : "";
    let converted = false;


    if (!isClass(cls)) {
      const dynDef = registerDynamicClass(cls);
      if (!dynDef) {
        warnings.push(`Classe desconhecida "${cls || "?"}" convertida em Folder (filhos preservados).`);
        cls = "Folder";
        converted = true;
      }

    }
    const name = typeof node.n === "string" ? node.n : undefined;
    let inst = null;
    try {
      inst = createInstance(cls, name != null ? { name } : {});
    } catch (_) {
      inst = null;
    }
    if (!inst && !converted) {

      warnings.push(`Classe "${cls}" não instanciável; convertida em Folder.`);
      try {
        inst = createInstance("Folder", name != null ? { name } : {});
        converted = true;
      } catch (_) {
        inst = null;
      }
    }
    if (!inst) {
      warnings.push("Nó ignorado: não foi possível criar a instância.");
      return null;
    }


    let id = typeof node.i === "string" && node.i ? node.i : null;
    if (!id || byId.has(id)) {
      if (id) warnings.push(`Id duplicado "${id}" regenerado.`);
      dupSeq += 1;
      id = "__dup" + dupSeq;
    }
    byId.set(id, inst);


    if (node.p && typeof node.p === "object" && !Array.isArray(node.p)) {
      if (converted) {
        const keys = Object.keys(node.p);
        if (keys.length) warnings.push(`Propriedades de classe desconhecida ignoradas (${keys.length}).`);
      } else {


        const roNames = new Set(
          inst.listProperties().filter((d) => d.readOnly).map((d) => d.name),
        );
        for (const key of Object.keys(node.p)) {
          let value = node.p[key];
          if (!inst.hasProperty(key)) {
            warnings.push(`Propriedade desconhecida ignorada: ${inst.className}.${key}`);
            continue;
          }
          if (roNames.has(key)) continue;
          if (typeof value === "string" && value.length > LIMITS.maxStringLen) {
            warnings.push(`String truncada ao carregar ${inst.className}.${key}.`);
            value = value.slice(0, LIMITS.maxStringLen);
          }
          const ok = inst.setProperty(key, value);
          if (!ok) {

            warnings.push(`Valor incompatível ignorado: ${inst.className}.${key}`);
          }
        }
      }
    }


    if (Array.isArray(node.a) && !converted && inst.setAttribute) {
      for (const a of node.a) {
        if (!a || typeof a !== "object") continue;
        const res = inst.setAttribute(String(a.n), String(a.t), a.v);
        if (!res || !res.ok) {
          warnings.push(`Atributo inv\u00e1lido ignorado: ${inst.className}.${a && a.n}`);
        }
      }
    }

    if (Array.isArray(node.t) && !converted && inst.addTag) {
      for (const tg of node.t) {
        if (typeof tg === "string") inst.addTag(tg);
      }
    }


    if (Array.isArray(node.u)) {
      if (converted) {
        warnings.push(`Cargas opacas ignoradas em nó convertido (${node.u.length}).`);
      } else {
        for (const pair of node.u) {
          const magic = Array.isArray(pair) && typeof pair[0] === "string" ? pair[0] : null;
          const b64 = Array.isArray(pair) && typeof pair[1] === "string" ? pair[1] : "";
          const rec = magic ? unknownPropFromXml(magic, b64) : null;
          if (!rec || !attachOpaqueProp(inst, rec)) {
            warnings.push(`Carga opaca inválida ou acima do limite ignorada: ${inst.className}.${String(magic).slice(0, 48)}`);
          }
        }
      }
    }
    if (node.uc && typeof node.uc === "object" && !Array.isArray(node.uc)) {
      if (converted) {
        warnings.push("Bag de classe desconhecida ignorado em nó convertido.");
      } else {
        const rawProps = Array.isArray(node.uc.p) ? node.uc.p : [];
        const props = [];                                                 
        let dropped = 0;
        for (const raw of rawProps) {
          const clean = bagNodeFromJson(raw);
          if (!clean) { dropped += 1; continue; }
          if (props.length >= RBX_UNKNOWN_LIMITS.maxBagProps) { dropped += 1; break; }


          if (isDynamicClass(inst.className)) {
            const dp = decodeBagNodeToDynamicProp(clean);
            if (dp) {
              if (!inst.hasProperty(dp.name)) {
                if (inst.defineDynamicProperty(dp)) continue;
              } else {
                inst.setProperty(dp.name, dp.value);
                continue;
              }
            }
          }
          props.push(clean);
        }
        if (dropped) warnings.push(`Propriedade(s) de bag opaco ignorada(s) por formato/limite (${dropped}).`);
        const collectRefs = (bagNode) => {
          if (!bagNode) return;
          if (typeof bagNode.refId === "string") pendingBagRefs.push(bagNode);
          if (Array.isArray(bagNode.children)) {
            for (const chNode of bagNode.children) collectRefs(chNode);
          }
        };
        for (const p of props) collectRefs(p);

        if (props.length > 0) {
          attachUnknownClass(inst, captureUnknownClass(
            typeof node.uc.c === "string" ? node.uc.c : inst.className,
            props
          ));
        }
      }
    }


    if (node.r && typeof node.r === "object" && !Array.isArray(node.r) && !converted) {
      for (const key of Object.keys(node.r)) {
        pendingRefs.push({ inst, prop: key, refId: String(node.r[key]), label: inst.className + "." + key });
      }
    }


    if (!converted && inst.className === "UnionOperation" && Array.isArray(node.csg) && node.csg.length) {
      try {
        const sub = deserializeInstances(node.csg);
        if (sub && Array.isArray(sub.roots)) {
          const restored = sub.roots.filter((r) => r);
          if (restored.length) inst._sourceParts = restored;
        }
      } catch (err) {
        warnings.push(`CSG Tree de "${inst.className}" não pôde ser reconstruída (${err.message}).`);
      }
    }


    if (Array.isArray(node.ch)) {
      for (const childNode of node.ch) {
        const child = build(childNode, depth + 1);
        if (child) child.setParent(inst);
      }
    }
    return inst;
  };

  const instances = [];
  const roots = [];                                                      
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const inst = build(node, 1);
    roots.push(inst || null);
    if (inst) instances.push(inst);
  }


  for (const ref of pendingRefs) {
    const target = byId.get(ref.refId);
    if (!target) {
      warnings.push(`Referência quebrada deixada vazia: ${ref.label}`);
      continue;
    }
    if (!ref.inst.hasProperty(ref.prop)) {
      warnings.push(`Referência para propriedade desconhecida ignorada: ${ref.label}`);
      continue;
    }
    const ok = ref.inst.setProperty(ref.prop, target);
    if (!ok) warnings.push(`Referência incompatível ignorada: ${ref.label}`);
  }


  for (const bagNode of pendingBagRefs) {
    const target = byId.get(bagNode.refId);
    if (target) bagNode.refTarget = target;
    else warnings.push(`Ref opaca quebrada deixada nula: ${bagNode.attrs && bagNode.attrs.name}`);
    delete bagNode.refId;
  }

  return { instances, roots, warnings, byId, total };
}


export function rleEncode(u8) {
  const out = [];
  const n = u8.length;
  let i = 0;
  while (i < n) {
    const v = u8[i];
    let run = 1;
    while (i + run < n && u8[i + run] === v && run < 0xffff) run += 1;
    out.push(run, v);
    i += run;
  }
  return out;
}

export function rleDecode(arr, length) {
  const out = new Uint8Array(length);
  if (!Array.isArray(arr)) return out;
  let pos = 0;
  for (let k = 0; k + 1 < arr.length; k += 2) {
    let run = arr[k] | 0;
    const v = arr[k + 1] & 0xff;
    if (run < 0) run = 0;
    if (pos + run > length) run = length - pos;                               
    if (run > 0) out.fill(v, pos, pos + run);
    pos += run;
    if (pos >= length) break;
  }
  return out;
}

const CHUNK_KEY_RE = /^-?\d+\|-?\d+\|-?\d+$/;
const CHUNK_VOLUME = CHUNK * CHUNK * CHUNK;


export function encodeTerrain(data) {
  if (!data) return null;


  if (typeof data.isEmpty !== "function") {
    const list = Array.isArray(data.chunks) ? data.chunks : [];
    const out = [];
    for (const c of list) {
      if (!Array.isArray(c) || c.length < 4) continue;
      const [key, mat, occ, count] = c;
      if (!count || count <= 0 || typeof key !== "string") continue;
      out.push([key, rleEncode(mat), rleEncode(occ)]);
    }
    if (!out.length) return null;
    out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return { v: 1, chunkSize: CHUNK, chunks: out };
  }
  if (data.isEmpty()) return null;
  const entries = [];
  if (typeof data.getChunkEntries === "function") {


    for (const c of data.getChunkEntries()) {
      if (!c || !c.count || c.count <= 0) continue;
      entries.push([c.key, rleEncode(c.mat), rleEncode(c.occ)]);
    }
  } else {
    const snap = data.exportAll();
    for (const [key, mat, occ, count] of snap.chunks) {
      if (!count || count <= 0) continue;
      entries.push([key, rleEncode(mat), rleEncode(occ)]);
    }
  }
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { v: 1, chunkSize: CHUNK, chunks: entries };
}


export function decodeTerrainInto(data, encoded, warnings) {
  const warn = (m) => { if (Array.isArray(warnings)) warnings.push(m); };
  if (!encoded) {
    data.clear();
    return;
  }
  if (typeof encoded !== "object" || !Array.isArray(encoded.chunks)) {
    warn("Seção de terreno inválida ignorada.");
    data.clear();
    return;
  }
  if (encoded.chunkSize != null && encoded.chunkSize !== CHUNK) {
    warn(`Tamanho de chunk incompatível (${encoded.chunkSize}); terreno ignorado.`);
    data.clear();
    return;
  }


  const decoded = [];                                 
  const seenKeys = new Set();
  for (const entry of encoded.chunks) {
    if (!Array.isArray(entry) || entry.length < 3) { warn("Chunk malformado ignorado."); continue; }
    const [key, matRle, occRle] = entry;
    if (typeof key !== "string" || !CHUNK_KEY_RE.test(key)) { warn("Chave de chunk inválida ignorada."); continue; }
    if (seenKeys.has(key)) { warn(`Chunk duplicado ignorado: ${key}`); continue; }
    seenKeys.add(key);
    const occ = rleDecode(occRle, CHUNK_VOLUME);
    const mat = rleDecode(matRle, CHUNK_VOLUME);
    const [cx, cy, cz] = key.split("|").map((s) => parseInt(s, 10));
    decoded.push({ key, cx, cy, cz, mat, occ });
  }


  if (typeof data.importChunksBulk === "function") {
    data.clear();
    const MAX = Number.isFinite(IMPORT_BULK_MAX_CHUNKS) && IMPORT_BULK_MAX_CHUNKS > 0 ? IMPORT_BULK_MAX_CHUNKS : 65536;
    for (let i = 0; i < decoded.length; i += MAX) {
      data.importChunksBulk(decoded.slice(i, i + MAX));
    }
    return;
  }


  const chunks = [];
  let min = null;
  let max = null;
  for (const d of decoded) {
    let count = 0;
    for (let idx = 0; idx < CHUNK_VOLUME; idx++) {
      if (d.occ[idx] === 0) continue;
      count += 1;
      const lx = idx % CHUNK;
      const ly = ((idx / CHUNK) | 0) % CHUNK;
      const lz = (idx / (CHUNK * CHUNK)) | 0;
      const x = d.cx * CHUNK + lx;
      const y = d.cy * CHUNK + ly;
      const z = d.cz * CHUNK + lz;
      if (!min) { min = [x, y, z]; max = [x, y, z]; }
      else {
        if (x < min[0]) min[0] = x; if (y < min[1]) min[1] = y; if (z < min[2]) min[2] = z;
        if (x > max[0]) max[0] = x; if (y > max[1]) max[1] = y; if (z > max[2]) max[2] = z;
      }
    }
    if (count > 0) chunks.push([d.key, d.mat, d.occ, count]);
  }
  data.importAll({ chunks, min, max });
}


export function serializeAssets(records, warnings) {
  const warn = (m) => { if (Array.isArray(warnings)) warnings.push(m); };
  const data = {};
  const out = [];
  for (const rec of Array.isArray(records) ? records : []) {
    if (!rec || typeof rec !== "object" || rec.builtin) continue;
    let copy;
    try {
      copy = deepCloneJsonValue({ ...rec, dataUri: undefined });
    } catch (_) {
      warn(`Asset não serializável ignorado: ${rec && rec.name}`);
      continue;
    }
    if (typeof rec.dataUri === "string" && rec.dataUri) {
      if (!isValidDataUri(rec.dataUri)) {
        warn(`Asset com data URI inválida ignorado: ${rec.name}`);
        continue;
      }


      const base = hashString(rec.dataUri);
      let h = base;
      let probe = 0;
      while (Object.prototype.hasOwnProperty.call(data, h) && data[h] !== rec.dataUri) {
        probe += 1;
        h = base + "_c" + probe;
      }
      data[h] = rec.dataUri;
      copy.dataRef = h;
    }
    out.push(copy);
  }
  return { records: out, data };
}


export function deserializeAssets(pack, warnings) {
  const warn = (m) => { if (Array.isArray(warnings)) warnings.push(m); };
  if (!pack || typeof pack !== "object") return [];
  const data = pack.data && typeof pack.data === "object" ? pack.data : {};
  const out = [];
  for (const rec of Array.isArray(pack.records) ? pack.records : []) {
    if (!rec || typeof rec !== "object") continue;
    const copy = { ...rec };
    if (copy.dataRef != null) {
      const uri = data[copy.dataRef];
      if (!isValidDataUri(uri)) {
        warn(`Asset "${rec.name}" ignorado: conteúdo ausente ou inválido.`);
        continue;
      }
      copy.dataUri = uri;
      delete copy.dataRef;
    } else {
      copy.dataUri = null;
    }
    delete copy.builtin;                                         
    out.push(copy);
  }
  return out;
}


export function validateFileObject(obj, expectedFormat) {
  const warnings = [];
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, error: "Arquivo inválido: não é um objeto JSON.", warnings };
  }
  const fmt = obj.format;
  if (fmt !== FORMAT_PLACE && fmt !== FORMAT_MODEL) {
    return { ok: false, error: "Arquivo não reconhecido: campo \"format\" ausente ou inválido.", warnings };
  }
  if (expectedFormat && fmt !== expectedFormat) {
    const want = expectedFormat === FORMAT_PLACE ? "place (.rswp)" : "model (.rswm)";
    return { ok: false, error: `Tipo de arquivo incorreto: esperado um arquivo de ${want}.`, warnings };
  }
  if (!isFiniteNum(obj.formatVersion)) {
    return { ok: false, error: "Arquivo inválido: \"formatVersion\" ausente.", warnings };
  }
  if (obj.formatVersion > FORMAT_VERSION) {
    warnings.push(`Arquivo salvo por uma versão mais nova (v${obj.formatVersion}); tentando carregar mesmo assim.`);
  }
  if (!Array.isArray(obj.tree)) {
    return { ok: false, error: "Arquivo inválido: árvore de instâncias ausente.", warnings };
  }
  if (obj.thumbnail != null) {
    if (typeof obj.thumbnail !== "string" || obj.thumbnail.length > LIMITS.maxThumbBytes * 1.4 || !isValidDataUri(obj.thumbnail)) {
      warnings.push("Thumbnail inválida ou grande demais; descartada.");
      obj.thumbnail = null;
    }
  }
  return { ok: true, warnings };
}





export function serializeBreakpoints(list) {
  const out = [];
  for (const bp of Array.isArray(list) ? list : []) {
    if (!bp || typeof bp.path !== "string" || !isFiniteNum(bp.line)) continue;
    out.push({
      path: bp.path,
      line: bp.line,
      enabled: bp.enabled !== false,
      condition: typeof bp.condition === "string" ? bp.condition : "",
      logMessage: typeof bp.logMessage === "string" ? bp.logMessage : "",
    });
  }
  return out;
}
