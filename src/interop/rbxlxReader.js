import { createInstance, registerDynamicClass } from "../datamodel/index.js";
import {
  RBX_LIMITS,
  findEntryByRbxName,
  tokenToEnum,
  matrixToEulerDeg,
  rbxClassToInternal,
  isPlaceService,
} from "./rbxTypeMaps.js";
import { base64ToBytes, decodeAttributesBlob, decodeTagsBlob, MAX_SMOOTH_GRID_B64 } from "./rbxBlobs.js";
import { decodeCsgPayload } from "./rbxCsgPayload.js";


import { SOLID_LIMITS, decodeCsgMeshData, decodeCsgPhysicsData, hullsToTriangleSoup } from "./rbxSolidMesh.js";


import { extractCloudAssetIdFromRaw } from "./rbxCsgCloud.js";


import {
  RBX_UNKNOWN_LIMITS,
  isUnknownPropName,
  unknownPropFromXml,
  attachOpaqueProp,
  captureXmlPropElement,
  captureUnknownClass,
  attachUnknownClass,
  captureBagRef,
  decodeBagNodeToDynamicProp,
} from "./rbxUnknown.js";

const KEPT_BINARY_PROPS = new Set([
  "AssetId", "ChildData", "MeshData", "PhysicalConfigData",

  "PhysicsData", "MeshData2", "AeroMeshData",
]);
const MAX_KEPT_BINARY_PROPS = 8;


export const MAX_KEPT_BINARY_B64 = Math.ceil(SOLID_LIMITS.maxBlobBytes / 3) * 4 + 4;


const CSG_IMPORT_CLASSES = new Set(["UnionOperation", "NegateOperation", "IntersectOperation", "PartOperation"]);


export const IMPORT_SOLID_BUDGET = { maxSolids: 4000, maxTriangles: 4000000 };

const BINARY_SIGNATURE = "<roblox!";

export function looksBinaryRbx(text) {
  if (typeof text !== "string") return false;
  return text.slice(0, 32).indexOf(BINARY_SIGNATURE) !== -1;
}

function num(raw) {
  const n = parseFloat(String(raw).trim());
  return Number.isFinite(n) ? n : 0;
}

function childNum(el, tag) {
  for (const ch of el.children) {
    if (ch.tagName === tag) return num(ch.textContent);
  }
  return 0;
}

function capString(s, warnings, label) {
  const str = String(s == null ? "" : s);
  if (str.length > RBX_LIMITS.maxStringLen) {
    warnings.push(`String truncada ao importar ${label}.`);
    return str.slice(0, RBX_LIMITS.maxStringLen);
  }
  return str;
}

function readVector3(el) {
  return { x: childNum(el, "X"), y: childNum(el, "Y"), z: childNum(el, "Z") };
}

function readColor3(el) {
  const clamp01 = (n) => Math.min(1, Math.max(0, n));
  return { r: clamp01(childNum(el, "R")), g: clamp01(childNum(el, "G")), b: clamp01(childNum(el, "B")) };
}

function uint32ToColor3(raw) {
  const n = Math.max(0, Math.round(num(raw))) >>> 0;
  return { r: ((n >> 16) & 0xff) / 255, g: ((n >> 8) & 0xff) / 255, b: (n & 0xff) / 255 };
}

function readCFrame(el) {
  const vals = {};
  for (const ch of el.children) vals[ch.tagName] = num(ch.textContent);
  const get = (t, def) => (Number.isFinite(vals[t]) ? vals[t] : def);
  const position = { x: get("X", 0), y: get("Y", 0), z: get("Z", 0) };
  const m = [
    get("R00", 1), get("R01", 0), get("R02", 0),
    get("R10", 0), get("R11", 1), get("R12", 0),
    get("R20", 0), get("R21", 0), get("R22", 1),
  ];
  return { position, rotation: matrixToEulerDeg(m) };
}

function decodeEntryValue(entry, el, warnings, label) {
  switch (entry.kind) {
    case "string":
    case "protectedString":
      return { value: capString(el.textContent, warnings, label) };
    case "bool":
      return { value: String(el.textContent).trim() === "true" };
    case "float":
    case "double":
      return { value: num(el.textContent) };
    case "int":
    case "int64":
      return { value: Math.round(num(el.textContent)) };
    case "token":
      return { value: tokenToEnum(entry.tokenId, Math.round(num(el.textContent))) };
    case "color3":
      return { value: el.tagName === "Color3uint8" ? uint32ToColor3(el.textContent) : readColor3(el) };
    case "color3uint8":
      return { value: el.tagName === "Color3" ? readColor3(el) : uint32ToColor3(el.textContent) };
    case "vector3":
      return { value: readVector3(el) };
    case "ref":
      return { pendingRef: String(el.textContent).trim() };
    default:
      return null;
  }
}

function applyEntry(inst, entry, el, warnings) {
  const label = `${inst.className}.${entry.internal}`;
  const decoded = decodeEntryValue(entry, el, warnings, label);
  if (!decoded) return null;
  if (decoded.pendingRef != null) return decoded;
  if (!inst.setProperty(entry.internal, decoded.value)) {
    warnings.push(`Valor incompatível ignorado: ${label}`);
  }
  return null;
}

function applyGenericProperty(inst, el, propName, warnings) {
  if (!inst.hasProperty(propName)) return false;
  let value;
  switch (el.tagName) {
    case "string":
    case "ProtectedString":
      value = capString(el.textContent, warnings, `${inst.className}.${propName}`);
      break;
    case "bool":
      value = String(el.textContent).trim() === "true";
      break;
    case "float":
    case "double":
    case "int":
    case "int64":
      value = num(el.textContent);
      break;
    case "Vector3":
      value = readVector3(el);
      break;
    case "Color3":
      value = readColor3(el);
      break;
    case "Color3uint8":
      value = uint32ToColor3(el.textContent);
      break;
    default:
      return false;
  }
  return inst.setProperty(propName, value);
}

function applyBinaryString(inst, propName, rawText, ctx, converted) {
  const b64 = String(rawText == null ? "" : rawText).replace(/\s+/g, "");
  if (!b64) return;


  const b64Cap = KEPT_BINARY_PROPS.has(propName) ? MAX_KEPT_BINARY_B64 : RBX_LIMITS.maxStringLen;
  if (b64.length > b64Cap) {
    ctx.warnings.push(`BinaryString "${propName}" excede o limite; ignorada.`);
    return;
  }



  if (isUnknownPropName(propName)) {
    const rec = unknownPropFromXml(propName, b64);
    if (!rec || !attachOpaqueProp(inst, rec)) ctx.skippedProps += 1;
    return;
  }
  if (propName === "AttributesSerialize") {
    const bytes = base64ToBytes(b64);
    if (!bytes) {
      ctx.warnings.push(`AttributesSerialize com base64 inválido em "${inst.name}".`);
      return;
    }
    const res = decodeAttributesBlob(bytes, ctx.warnings);
    for (const attr of res.attributes) {
      if (
        attr.name === "RSW_Csg" && attr.type === "string" &&
        (inst.className === "UnionOperation" || inst.className === "NegateOperation")
      ) {
        ctx.csgPending.push({ inst, payload: attr.value });
        continue;
      }
      const applied = typeof inst.setAttribute === "function"
        ? inst.setAttribute(attr.name, attr.type, attr.value)
        : null;
      if (!applied || !applied.ok) ctx.badAttributes += 1;
    }
    return;
  }
  if (propName === "Tags") {
    const bytes = base64ToBytes(b64);
    if (bytes && typeof inst.addTag === "function") {
      for (const tag of decodeTagsBlob(bytes)) inst.addTag(tag);
    }
    return;
  }
  if (!converted && KEPT_BINARY_PROPS.has(propName)) {
    if (!(inst._rbxRawBinaryProps instanceof Map)) inst._rbxRawBinaryProps = new Map();
    if (inst._rbxRawBinaryProps.size < MAX_KEPT_BINARY_PROPS) inst._rbxRawBinaryProps.set(propName, b64);
    return;
  }
  ctx.skippedProps += 1;
}

function resolveCsgTrees(ctx) {
  for (const item of ctx.csgPending) {
    const res = decodeCsgPayload(item.payload, ctx.warnings);
    if (!res.ok) continue;
    if (item.inst.className === "UnionOperation") item.inst._sourceParts = res.roots;
    else if (res.roots[0]) item.inst._original = res.roots[0];
  }
}


function resolveImportedSolids(ctx) {
  let meshOk = 0;
  let hullsOk = 0;
  let none = 0;
  let cloudPending = 0;                                                      
  let skippedBudget = 0;
  let solids = 0;
  let triTotal = 0;
  for (const inst of ctx.byReferent.values()) {
    if (!inst || !CSG_IMPORT_CLASSES.has(inst.className)) continue;
    const raw = inst._rbxRawBinaryProps;
    if (!(raw instanceof Map)) continue;
    const meshB64 = raw.get("MeshData") || raw.get("MeshData2") || null;
    const physB64 = raw.get("PhysicsData") || raw.get("PhysicalConfigData") || null;
    if (!meshB64 && !physB64) continue;
    if (solids >= IMPORT_SOLID_BUDGET.maxSolids || triTotal >= IMPORT_SOLID_BUDGET.maxTriangles) {
      skippedBudget += 1;
      continue;
    }
    solids += 1;
    try {


      const localWarnings = [];
      let meshRes = null;
      let physRes = null;


      if (physB64) {
        const bytes = base64ToBytes(physB64, SOLID_LIMITS.maxBlobBytes);
        if (bytes) physRes = decodeCsgPhysicsData(bytes, localWarnings);
      }
      if (meshB64) {
        const bytes = base64ToBytes(meshB64, SOLID_LIMITS.maxBlobBytes);
        const physHint =
          physRes && physRes.ok
            ? {
                volume: Number.isFinite(physRes.volume) ? physRes.volume : null,
                cog: physRes.cog || null,
                hulls: Array.isArray(physRes.hulls) && physRes.hulls.length > 0 ? physRes.hulls : null,
              }
            : null;
        if (bytes) meshRes = decodeCsgMeshData(bytes, localWarnings, physHint);
      }
      const hulls =
        physRes && physRes.ok && physRes.kind === "hulls" && Array.isArray(physRes.hulls) && physRes.hulls.length > 0
          ? physRes.hulls
          : null;
      const boxOnly = !!(physRes && physRes.ok && physRes.kind === "box");
      const size = inst.hasProperty("Size") ? inst.getProperty("Size") : null;
      const baseSize = {
        x: size && Number.isFinite(size.x) ? size.x : 1,
        y: size && Number.isFinite(size.y) ? size.y : 1,
        z: size && Number.isFinite(size.z) ? size.z : 1,
      };
      let solid = null;
      if (meshRes && meshRes.ok && Array.isArray(meshRes.positions) && meshRes.positions.length >= 9) {
        solid = {
          source: "meshData",
          positions: meshRes.positions,
          colors: Array.isArray(meshRes.colors) && meshRes.colors.length > 0 ? meshRes.colors : null,
          baseSize,
          hulls,
          boxOnly,
          triCount: Math.floor(meshRes.positions.length / 9),
        };
        meshOk += 1;
      } else if (hulls) {
        const soup = hullsToTriangleSoup(hulls);
        if (Array.isArray(soup) && soup.length >= 9) {
          solid = {
            source: "hulls",
            positions: soup,
            colors: null,
            baseSize,
            hulls,
            boxOnly: false,
            triCount: Math.floor(soup.length / 9),
          };
          hullsOk += 1;
        }
      }
      if (!solid) {
        none += 1;


        const cloudy =
          (meshRes && meshRes.format === "CSGK") || (physRes && physRes.format === "CSGK");
        const hasRecipeNow =
          (Array.isArray(inst._sourceParts) && inst._sourceParts.length > 0) || inst._original != null;
        if (cloudy && !hasRecipeNow && !inst._csgMesh) {
          const cloudId = extractCloudAssetIdFromRaw(raw);
          if (cloudId) {
            inst._cloudCsgPending = { assetId: cloudId, baseSize };
            cloudPending += 1;
          }
        }
        continue;
      }
      triTotal += solid.triCount;
      inst._importedSolid = solid;
      const hasRecipe =
        (Array.isArray(inst._sourceParts) && inst._sourceParts.length > 0) || inst._original != null;
      if (!hasRecipe && !inst._csgMesh) {
        inst._csgMesh = { positions: solid.positions, baseSize: solid.baseSize };
      }
    } catch (_) {
      none += 1;
    }
  }
  if (meshOk + hullsOk + none > 0) {
    ctx.warnings.push(
      `Import: ${meshOk} união(ões) com malha real, ${hullsOk} com hulls do PhysicsData, ${none} sem geometria decodificável.`,
    );
  }
  if (skippedBudget > 0) {
    ctx.warnings.push(
      `Import: limite de segurança de sólidos CSG atingido; ${skippedBudget} união(ões) mantida(s) sem decodificar (blobs preservados).`,
    );
  }
  if (cloudPending > 0) {
    ctx.warnings.push(
      `Import: ${cloudPending} união(ões) com geometria somente na nuvem (CSGK/AssetId) — o download da malha real do CDN será tentado em segundo plano (Parte 176).`,
    );
  }
}


function readTerrainItem(itemEl, warnings) {
  const propsEl = findPropertiesEl(itemEl);
  if (!propsEl) {
    warnings.push("Terrain sem propriedades legíveis; voxels não importados.");
    return null;
  }
  let smoothGrid = null;
  let materialColors = null;
  let physicsGrid = null;
  let smoothVoxelsUpgraded = null;
  let smoothGridOversized = false;
  for (const propEl of propsEl.children) {
    const name = String(propEl.getAttribute("name") || "");
    if (propEl.tagName === "bool" && name === "SmoothVoxelsUpgraded") {
      smoothVoxelsUpgraded = String(propEl.textContent || "").trim() === "true";
      continue;
    }
    if (propEl.tagName !== "BinaryString") continue;
    const b64 = String(propEl.textContent || "").replace(/\s+/g, "");
    if (!b64) continue;
    if (b64.length > MAX_SMOOTH_GRID_B64) {
      if (name === "SmoothGrid") smoothGridOversized = true;
      continue;
    }
    if (name === "SmoothGrid") smoothGrid = b64;
    else if (name === "MaterialColors") materialColors = b64;
    else if (name === "PhysicsGrid") physicsGrid = b64;
  }
  if (!smoothGrid) {
    warnings.push(smoothGridOversized
      ? "SmoothGrid excede o orçamento de import; voxels não importados."
      : "Terrain sem SmoothGrid legível; voxels não importados.");
    return null;
  }
  return { smoothGrid, materialColors, physicsGrid, smoothVoxelsUpgraded };
}

function findPropertiesEl(itemEl) {
  for (const ch of itemEl.children) {
    if (ch.tagName === "Properties") return ch;
  }
  return null;
}

function buildItem(itemEl, ctx, depth) {
  if (depth > RBX_LIMITS.maxDepth) {
    ctx.warnings.push("Item além da profundidade máxima ignorado.");
    return null;
  }
  ctx.total += 1;
  if (ctx.total > RBX_LIMITS.maxInstances) {
    throw new Error(`Arquivo excede o limite de ${RBX_LIMITS.maxInstances} instâncias.`);
  }
  const rbxClass = String(itemEl.getAttribute("class") || "");
  let conv = rbxClassToInternal(rbxClass);
  let converted = false;

  let dynamic = false;
  if (!conv) {
    const dynDef = registerDynamicClass(rbxClass);
    if (dynDef) {
      conv = { className: rbxClass, presets: null };
      dynamic = true;
      ctx.dynamicClasses.add(rbxClass);
    } else {
      ctx.unknownClasses.add(rbxClass || "?");
      conv = { className: "Folder", presets: null };
      converted = true;
    }
  }
  let inst = createInstance(conv.className, {});
  if (!inst && !converted && !dynamic) {
    conv = { className: "Folder", presets: null };
    converted = true;
    dynamic = false;
    ctx.unknownClasses.add(rbxClass);
    inst = createInstance("Folder", {});
  } else if (!inst && dynamic) {

    conv = { className: "Folder", presets: null };
    dynamic = false;
    converted = true;
    ctx.unknownClasses.add(rbxClass);
    inst = createInstance("Folder", {});
  }
  if (!inst) {
    ctx.warnings.push("Item ignorado: não foi possível criar a instância.");
    return null;
  }
  if (conv.presets) {
    for (const key of Object.keys(conv.presets)) inst.setProperty(key, conv.presets[key]);
  }

  let referent = String(itemEl.getAttribute("referent") || "");
  if (!referent || ctx.byReferent.has(referent)) {
    ctx.dupSeq += 1;
    referent = "__dup" + ctx.dupSeq;
  }
  ctx.byReferent.set(referent, inst);

  const propsEl = findPropertiesEl(itemEl);
  if (propsEl) {
    let propCount = 0;
    let pendingCFrame = null;


    const unknownBag = (converted || dynamic) ? [] : null;
    for (const propEl of propsEl.children) {
      propCount += 1;
      if (propCount > RBX_LIMITS.maxPropsPerItem) {
        ctx.warnings.push(`Item "${inst.name}" tem propriedades demais; excedente ignorado.`);
        break;
      }
      const propName = String(propEl.getAttribute("name") || "");
      if (!propName) continue;
      if (propName === "Name" && propEl.tagName === "string") {
        inst.setProperty("Name", capString(propEl.textContent, ctx.warnings, "Name"));
        continue;
      }

      if (!converted && !dynamic && (propEl.tagName === "CoordinateFrame" || propEl.tagName === "CFrame") && propName === "CFrame") {
        pendingCFrame = readCFrame(propEl);
        continue;
      }
      if (propEl.tagName === "Ref") {
        const target = String(propEl.textContent).trim();
        const live = !!target && target !== "null" && target !== "nil";
        if (converted || dynamic) {

          const rec = captureBagRef(propName);
          if (rec && unknownBag.length < RBX_UNKNOWN_LIMITS.maxBagProps) {
            unknownBag.push(rec);
            if (live) ctx.pendingBagRefs.push({ rec, referent: target });
          } else {
            ctx.skippedProps += 1;
          }
          continue;
        }
        if (live) {
          ctx.pendingRefs.push({ inst, prop: propName, referent: target });
        }
        continue;
      }
      if (propEl.tagName === "BinaryString") {


        const special = propName === "AttributesSerialize" || propName === "Tags" || isUnknownPropName(propName);
        if ((converted || dynamic) && !special) {
          const captured = captureXmlPropElement(propEl);
          if (captured) unknownBag.push(captured);
          else ctx.skippedProps += 1;
          continue;
        }
        applyBinaryString(inst, propName, propEl.textContent, ctx, converted);
        continue;
      }


      if (dynamic) {
        const captured = captureXmlPropElement(propEl);
        if (captured) {
          const dp = decodeBagNodeToDynamicProp(captured);
          if (dp) {
            if (!inst.hasProperty(dp.name)) {
              if (inst.defineDynamicProperty(dp)) continue;
            } else if (inst.setProperty(dp.name, dp.value)) {
              continue;
            }
          }
          unknownBag.push(captured);
        } else {
          ctx.skippedProps += 1;
        }
        continue;
      }
      if (converted) {
        const captured = captureXmlPropElement(propEl);
        if (captured) unknownBag.push(captured);
        else ctx.skippedProps += 1;
        continue;
      }
      const entry = findEntryByRbxName(inst.className, propName);
      if (entry) {
        const res = applyEntry(inst, entry, propEl, ctx.warnings);
        if (res && res.pendingRef && res.pendingRef !== "null" && res.pendingRef !== "nil") {
          ctx.pendingRefs.push({ inst, prop: entry.internal, referent: res.pendingRef });
        }
        continue;
      }
      if (!applyGenericProperty(inst, propEl, propName, ctx.warnings)) {
        ctx.skippedProps += 1;
      }
    }
    if (pendingCFrame && inst.hasProperty("Position")) {
      inst.setProperty("Position", pendingCFrame.position);
      if (inst.hasProperty("Rotation")) {
        const r = pendingCFrame.rotation;
        inst.setProperty("Rotation", { x: r.x, y: r.y, z: r.z });
      }
    }
    if (converted || dynamic) {

      attachUnknownClass(inst, captureUnknownClass(rbxClass, unknownBag));
    }
  } else if (converted || dynamic) {

    attachUnknownClass(inst, captureUnknownClass(rbxClass, []));
  }

  for (const childEl of itemEl.children) {
    if (childEl.tagName !== "Item") continue;
    const child = buildItem(childEl, ctx, depth + 1);
    if (child) child.setParent(inst);
  }
  return inst;
}

function resolveRefs(ctx) {
  for (const ref of ctx.pendingRefs) {
    const target = ctx.byReferent.get(ref.referent);
    if (!target) {
      ctx.warnings.push(`Referência quebrada deixada vazia: ${ref.inst.className}.${ref.prop}`);
      continue;
    }
    if (!ref.inst.hasProperty(ref.prop) || !ref.inst.setProperty(ref.prop, target)) {
      ctx.warnings.push(`Referência incompatível ignorada: ${ref.inst.className}.${ref.prop}`);
    }
  }
}



function resolveBagRefs(ctx) {
  for (const pr of ctx.pendingBagRefs) {
    const target = ctx.byReferent.get(pr.referent);
    if (target) pr.rec.refTarget = target;
    else ctx.warnings.push(`Referência preservada quebrada deixada nula: ${pr.rec.attrs.name}`);
  }
}

export function parseRbxXml(text) {
  if (typeof text !== "string" || !text.trim()) {
    return { ok: false, error: "Arquivo vazio ou ilegível." };
  }
  if (text.length > RBX_LIMITS.maxFileBytes) {
    return { ok: false, error: "O arquivo excede o limite de 50MB." };
  }
  if (looksBinaryRbx(text)) {
    return {
      ok: false,
      error: "Formato binário (.rbxl/.rbxm) não suportado. No Roblox Studio, use \"Save As\" e escolha .rbxlx ou .rbxmx (XML).",
    };
  }
  let doc;
  try {
    doc = new DOMParser().parseFromString(text, "text/xml");
  } catch (e) {
    return { ok: false, error: "Falha ao parsear o XML: " + (e && e.message) };
  }
  if (!doc || doc.getElementsByTagName("parsererror").length > 0) {
    return { ok: false, error: "O arquivo não é um XML válido do Roblox." };
  }
  const root = doc.documentElement;
  if (!root || root.tagName !== "roblox") {
    return { ok: false, error: "Arquivo não reconhecido: raiz <roblox> ausente." };
  }

  const ctx = {
    warnings: [],
    byReferent: new Map(),
    pendingRefs: [],
    pendingBagRefs: [],
    csgPending: [],
    unknownClasses: new Set(),
    dynamicClasses: new Set(),                                             
    total: 0,
    dupSeq: 0,
    skippedProps: 0,
    badAttributes: 0,
  };

  const services = [];
  const roots = [];
  let terrain = null;
  try {
    for (const itemEl of root.children) {
      if (itemEl.tagName !== "Item") continue;
      const cls = String(itemEl.getAttribute("class") || "");
      if (isPlaceService(cls)) {
        const svcChildren = [];
        const svcProps = [];
        const propsEl = findPropertiesEl(itemEl);
        if (propsEl) {
          for (const propEl of propsEl.children) {
            const propName = String(propEl.getAttribute("name") || "");
            if (propName && propName !== "Name") svcProps.push({ el: propEl, name: propName });
          }
        }
        for (const childEl of itemEl.children) {
          if (childEl.tagName !== "Item") continue;
          const childCls = String(childEl.getAttribute("class") || "");
          if (cls === "Workspace" && childCls === "Camera") continue;
          if (cls === "Workspace" && childCls === "Terrain") {
            terrain = readTerrainItem(childEl, ctx.warnings) || terrain;
            continue;
          }
          const child = buildItem(childEl, ctx, 2);
          if (child) svcChildren.push(child);
        }
        services.push({ className: cls, children: svcChildren, props: svcProps });
      } else {
        const inst = buildItem(itemEl, ctx, 1);
        if (inst) roots.push(inst);
      }
    }
  } catch (e) {
    for (const svc of services) {
      for (const c of svc.children) { try { c.destroy(); } catch (_) {               } }
    }
    for (const r of roots) { try { r.destroy(); } catch (_) {               } }
    return { ok: false, error: (e && e.message) || "Erro desconhecido ao importar." };
  }

  resolveRefs(ctx);
  resolveBagRefs(ctx);
  resolveCsgTrees(ctx);
  resolveImportedSolids(ctx);

  if (ctx.badAttributes > 0) {
    ctx.warnings.push(`${ctx.badAttributes} atributo(s) inválido(s) ignorado(s) no import.`);
  }
  if (ctx.unknownClasses.size) {
    ctx.warnings.push(
      "Classes não suportadas viram Folder no editor, com ClassName e propriedades preservados para reexportação (filhos preservados): " +
        [...ctx.unknownClasses].slice(0, 12).join(", ") + (ctx.unknownClasses.size > 12 ? "…" : ""),
    );
  }

  if (ctx.dynamicClasses.size) {
    ctx.warnings.push(
      "Classes não nativas importadas como instâncias dinâmicas funcionais (ClassName e propriedades preservados na reexportação): " +
        [...ctx.dynamicClasses].slice(0, 12).join(", ") + (ctx.dynamicClasses.size > 12 ? "…" : ""),
    );
  }
  if (ctx.skippedProps > 0) {
    ctx.warnings.push(`${ctx.skippedProps} propriedade(s) sem equivalente interno foram ignoradas.`);
  }

  const kind = services.length > 0 ? "place" : "model";
  if (kind === "place" && roots.length) {
    let ws = services.find((s) => s.className === "Workspace");
    if (!ws) {
      ws = { className: "Workspace", children: [], props: [] };
      services.push(ws);
    }
    ws.children.push(...roots);
    roots.length = 0;
  }
  if (kind === "model" && !roots.length) {
    return { ok: false, error: "O arquivo não contém objetos válidos.", warnings: ctx.warnings };
  }
  return { ok: true, kind, roots, services, terrain, warnings: ctx.warnings, count: ctx.total };
}

export function decodeServiceProps(className, props, warnings) {
  const out = [];
  const w = Array.isArray(warnings) ? warnings : [];
  for (const item of Array.isArray(props) ? props : []) {
    if (!item || !item.el || !item.name) continue;
    const entry = findEntryByRbxName(className, item.name);
    if (!entry || entry.kind === "ref") continue;
    const decoded = decodeEntryValue(entry, item.el, w, `${className}.${entry.internal}`);
    if (decoded && decoded.pendingRef == null) out.push({ prop: entry.internal, value: decoded.value });
  }
  return out;
}


export function collectServiceOpaqueProps(props) {
  const out = [];
  for (const item of Array.isArray(props) ? props : []) {
    if (!item || !item.el || !item.name || !isUnknownPropName(item.name)) continue;
    if (String(item.el.tagName || "") !== "BinaryString") continue;
    let raw = "";
    try { raw = String(item.el.textContent == null ? "" : item.el.textContent); } catch (_) { raw = ""; }
    const rec = unknownPropFromXml(item.name, raw.replace(/\s+/g, ""));
    if (rec && out.length < RBX_UNKNOWN_LIMITS.maxRecordsPerInstance) out.push(rec);
  }
  return out;
}
