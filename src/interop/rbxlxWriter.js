import { getService } from "../datamodel/index.js";
import {
  RBX_LIMITS,
  getEntriesFor,
  enumToToken,
  eulerDegToMatrix,
  classIsA,
  isPlaceService,
  PLACE_SERVICES,
} from "./rbxTypeMaps.js";
import { encodeAttributesBlob, encodeTagsBlob, bytesToBase64, MAX_BLOB_BYTES } from "./rbxBlobs.js";
import { encodeCsgPayload } from "./rbxCsgPayload.js";


import { readOpaqueProps, opaqueToXml, readUnknownClass, bagPropToXml, isBagRef, dynamicPropToBagNode } from "./rbxUnknown.js";


const MAX_KEPT_BINARY_B64 = Math.ceil(MAX_BLOB_BYTES / 3) * 4 + 4;

function xmlEscape(s) {
  return String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cdata(s) {
  const clean = String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  return "<![CDATA[" + clean.replace(/\]\]>/g, "]]]]><![CDATA[>") + "]]>";
}

function fin(n) {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function fmtNum(n) {
  const v = fin(n);
  if (Number.isInteger(v)) return String(v);
  const s = v.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
}

function fmtInt(n) {
  return String(Math.round(fin(n)));
}

function color3ToUint32(c) {
  const to255 = (x) => Math.max(0, Math.min(255, Math.round(fin(x) * 255)));
  return ((0xff << 24) | (to255(c && c.r) << 16) | (to255(c && c.g) << 8) | to255(c && c.b)) >>> 0;
}

function vec3Xml(name, v) {
  return (
    `<Vector3 name="${xmlEscape(name)}">` +
    `<X>${fmtNum(v && v.x)}</X><Y>${fmtNum(v && v.y)}</Y><Z>${fmtNum(v && v.z)}</Z>` +
    "</Vector3>"
  );
}

function color3Xml(name, c) {
  return (
    `<Color3 name="${xmlEscape(name)}">` +
    `<R>${fmtNum(c && c.r)}</R><G>${fmtNum(c && c.g)}</G><B>${fmtNum(c && c.b)}</B>` +
    "</Color3>"
  );
}

function cframeXml(name, pos, rotDeg) {
  const m = eulerDegToMatrix(fin(rotDeg && rotDeg.x), fin(rotDeg && rotDeg.y), fin(rotDeg && rotDeg.z));
  const tags = ["X", "Y", "Z", "R00", "R01", "R02", "R10", "R11", "R12", "R20", "R21", "R22"];
  const vals = [fin(pos && pos.x), fin(pos && pos.y), fin(pos && pos.z), ...m];
  let inner = "";
  for (let i = 0; i < 12; i++) inner += `<${tags[i]}>${fmtNum(vals[i])}</${tags[i]}>`;
  return `<CoordinateFrame name="${xmlEscape(name)}">${inner}</CoordinateFrame>`;
}

function entryXml(entry, value, referents, warnings, label) {


  if (entry.nullable && (value === null || value === undefined)) return "";
  switch (entry.kind) {
    case "string": {
      let s = typeof value === "string" ? value : "";
      if (s.length > RBX_LIMITS.maxStringLen) {
        warnings.push(`String truncada em ${label}.`);
        s = s.slice(0, RBX_LIMITS.maxStringLen);
      }
      return `<string name="${xmlEscape(entry.rbx)}">${xmlEscape(s)}</string>`;
    }
    case "protectedString": {
      let s = typeof value === "string" ? value : "";
      if (s.length > RBX_LIMITS.maxStringLen) {
        warnings.push(`Source truncado em ${label}.`);
        s = s.slice(0, RBX_LIMITS.maxStringLen);
      }
      return `<ProtectedString name="${xmlEscape(entry.rbx)}">${cdata(s)}</ProtectedString>`;
    }
    case "bool":
      return `<bool name="${xmlEscape(entry.rbx)}">${value === true ? "true" : "false"}</bool>`;
    case "float":
      return `<float name="${xmlEscape(entry.rbx)}">${fmtNum(value)}</float>`;
    case "double":
      return `<double name="${xmlEscape(entry.rbx)}">${fmtNum(value)}</double>`;
    case "int":
      return `<int name="${xmlEscape(entry.rbx)}">${fmtInt(value)}</int>`;
    case "int64":
      return `<int64 name="${xmlEscape(entry.rbx)}">${fmtInt(value)}</int64>`;
    case "token": {
      const tok = enumToToken(entry.tokenId, value);
      return tok == null ? "" : `<token name="${xmlEscape(entry.rbx)}">${tok}</token>`;
    }
    case "color3":
      return value ? color3Xml(entry.rbx, value) : "";
    case "color3uint8":
      return value ? `<Color3uint8 name="${xmlEscape(entry.rbx)}">${color3ToUint32(value)}</Color3uint8>` : "";
    case "vector3":
      return value ? vec3Xml(entry.rbx, value) : "";
    case "ref": {
      const id = value && referents.get(value);
      return `<Ref name="${xmlEscape(entry.rbx)}">${id ? xmlEscape(id) : "null"}</Ref>`;
    }
    default:
      return "";
  }
}

function isSkippedWorkspaceChild(inst) {
  return inst.className === "Camera" || inst.className === "Terrain";
}

function shouldSkip(inst) {
  if (!inst || (inst.isDestroyed && inst.isDestroyed())) return true;
  if (inst.hasProperty && inst.hasProperty("Archivable") && inst.getProperty("Archivable") === false) return true;
  return false;
}

function assignReferents(roots, opts) {
  const referents = new Map();
  let counter = 0;
  const visit = (inst, depth, atServiceRoot) => {
    if (depth > RBX_LIMITS.maxDepth) throw new Error(`Hierarquia excede ${RBX_LIMITS.maxDepth} níveis.`);
    if (shouldSkip(inst)) return;
    counter += 1;
    if (counter > RBX_LIMITS.maxInstances) throw new Error(`Export excede ${RBX_LIMITS.maxInstances} instâncias.`);
    referents.set(inst, "RBX" + counter);
    for (const ch of inst.getChildren()) {
      if (atServiceRoot && opts.skipWorkspaceInternals && inst.className === "Workspace" && isSkippedWorkspaceChild(ch)) continue;
      visit(ch, depth + 1, false);
    }
  };
  for (const root of roots) visit(root, 1, true);
  return referents;
}

function collectRefEntries(inst, referents, warnings) {
  const out = [];
  const descs = inst.listProperties();
  for (const d of descs) {
    if (d.type !== "Instance" || d.readOnly || !d.value) continue;
    const mapped = getEntriesFor(inst.className).some((en) => en.internal === d.name);
    if (mapped) continue;
    const id = referents.get(d.value);
    if (id) out.push(`<Ref name="${xmlEscape(d.name)}">${xmlEscape(id)}</Ref>`);
    else warnings.push(`Referência para fora do export removida: ${inst.name}.${d.name}`);
  }
  return out;
}

function binaryPropXml(inst, cls, warnings) {
  const out = [];
  const attrs = typeof inst.getAttributesList === "function" ? inst.getAttributesList() : [];
  const list = attrs.slice();
  if (cls === "UnionOperation" || cls === "NegateOperation") {
    const payload = encodeCsgPayload(inst, warnings);
    if (payload) list.push({ name: "RSW_Csg", type: "string", value: payload });
  }
  const attrBlob = encodeAttributesBlob(list, warnings);
  if (attrBlob) {
    out.push(`<BinaryString name="AttributesSerialize">${bytesToBase64(attrBlob)}</BinaryString>`);
  }
  const tagBlob = typeof inst.getTags === "function" ? encodeTagsBlob(inst.getTags()) : null;
  if (tagBlob) {
    out.push(`<BinaryString name="Tags">${bytesToBase64(tagBlob)}</BinaryString>`);
  }
  const raw = inst._rbxRawBinaryProps;
  if (raw instanceof Map) {
    for (const [name, b64] of raw) {
      if (name === "AttributesSerialize" || name === "Tags") continue;
      if (typeof b64 !== "string" || b64.length > MAX_KEPT_BINARY_B64) continue;


      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
        warnings.push(`Blob binário "${name}" de "${inst.name}" com base64 inválido — omitido no export.`);
        continue;
      }
      out.push(`<BinaryString name="${xmlEscape(name)}">${b64}</BinaryString>`);
    }
  }


  for (const rec of readOpaqueProps(inst)) {
    out.push(opaqueToXml(rec));
  }
  return out;
}

function writeTerrainItem(terrain, out, pad, stats) {
  out.push(`${pad}<Item class="Terrain" referent="RBXTERRAIN">`);
  out.push(`${pad}  <Properties>`);
  out.push(`${pad}    <string name="Name">Terrain</string>`);
  out.push(`${pad}    <BinaryString name="SmoothGrid">${cdata(terrain.smoothGrid)}</BinaryString>`);
  out.push(`${pad}    <BinaryString name="MaterialColors">${cdata(terrain.materialColors)}</BinaryString>`);
  out.push(`${pad}  </Properties>`);
  out.push(`${pad}</Item>`);
  stats.count += 1;
}


function bagRefXml(node, referents, warnings, ownerName) {
  const name = node.attrs && typeof node.attrs.name === "string" ? node.attrs.name : "";
  if (!name) return "";
  const t = node.refTarget;
  const alive = !!t && (typeof t.isDestroyed !== "function" || !t.isDestroyed());
  if (alive && referents.has(t)) {
    return `<Ref name="${xmlEscape(name)}">${referents.get(t)}</Ref>`;
  }
  if (t) warnings.push(`Referência preservada para fora do export deixada nula: ${ownerName}.${name}`);
  return `<Ref name="${xmlEscape(name)}">null</Ref>`;
}

function writeItem(inst, referents, warnings, stats, out, indent, opts) {
  if (!referents.has(inst)) return;


  const unknownRec = readUnknownClass(inst);
  const cls = inst.className;
  if (cls === "UnionOperation" || cls === "NegateOperation") {
    if (!stats.csgWarned) {
      stats.csgWarned = true;
      warnings.push("Operações CSG levam a árvore de partes no atributo RSW_Csg (round-trip fiel neste editor); MeshData original importado é preservado.");
    }
  }
  const pad = "  ".repeat(Math.min(indent, 40));
  out.push(`${pad}<Item class="${xmlEscape(unknownRec ? unknownRec.className : cls)}" referent="${referents.get(inst)}">`);
  out.push(`${pad}  <Properties>`);
  out.push(`${pad}    <string name="Name">${xmlEscape(inst.name)}</string>`);
  let propCount = 1;
  for (const xml of binaryPropXml(inst, cls, warnings)) {
    if (propCount >= RBX_LIMITS.maxPropsPerItem) break;
    out.push(`${pad}    ${xml}`);
    propCount += 1;
  }


  if (typeof inst.listDynamicProperties === "function") {
    const dynProps = inst.listDynamicProperties();
    for (const dp of dynProps) {
      if (propCount >= RBX_LIMITS.maxPropsPerItem) break;
      const bagNode = dynamicPropToBagNode(dp);
      const xml = bagNode ? bagPropToXml(bagNode) : "";
      if (xml) {
        out.push(`${pad}    ${xml}`);
        propCount += 1;
      }
    }
  }
  if (unknownRec) {


    for (const bagProp of unknownRec.props) {
      if (propCount >= RBX_LIMITS.maxPropsPerItem) break;
      const xml = isBagRef(bagProp)
        ? bagRefXml(bagProp, referents, warnings, inst.name)
        : bagPropToXml(bagProp);
      if (xml) {
        out.push(`${pad}    ${xml}`);
        propCount += 1;
      }
    }
  }
  if (!unknownRec && inst.hasProperty("Position") && inst.hasProperty("Rotation") && classIsA(cls, "BasePart")) {
    out.push(`${pad}    ${cframeXml("CFrame", inst.getProperty("Position"), inst.getProperty("Rotation"))}`);
    propCount += 1;
  }
  for (const entry of unknownRec ? [] : getEntriesFor(cls)) {
    if (propCount >= RBX_LIMITS.maxPropsPerItem) break;
    if (!inst.hasProperty(entry.internal)) continue;
    const xml = entryXml(entry, inst.getProperty(entry.internal), referents, warnings, `${inst.name}.${entry.internal}`);
    if (xml) {
      out.push(`${pad}    ${xml}`);
      propCount += 1;
    }
  }
  for (const refXml of unknownRec ? [] : collectRefEntries(inst, referents, warnings)) {
    if (propCount >= RBX_LIMITS.maxPropsPerItem) break;
    out.push(`${pad}    ${refXml}`);
    propCount += 1;
  }
  out.push(`${pad}  </Properties>`);
  stats.count += 1;
  for (const ch of inst.getChildren()) {
    if (opts.skipWorkspaceInternals && cls === "Workspace" && indent === 1 && isSkippedWorkspaceChild(ch)) continue;
    writeItem(ch, referents, warnings, stats, out, indent + 1, opts);
  }
  if (opts.skipWorkspaceInternals && cls === "Workspace" && indent === 1 && opts.terrain) {
    writeTerrainItem(opts.terrain, out, pad + "  ", stats);
  }
  out.push(`${pad}</Item>`);
}

const XML_HEADER =
  '<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" ' +
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
  'xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">';

function buildDocument(roots, opts) {
  const warnings = [];
  const stats = { count: 0, csgWarned: false };
  const referents = assignReferents(roots, opts);
  const out = [XML_HEADER, '  <Meta name="ExplicitAutoJoints">true</Meta>'];
  for (const root of roots) {
    writeItem(root, referents, warnings, stats, out, 1, opts);
  }
  out.push("</roblox>");
  return { xml: out.join("\n"), count: stats.count, warnings };
}

export function buildModelXml(roots) {
  const live = (Array.isArray(roots) ? roots : []).filter((r) => !shouldSkip(r));
  if (!live.length) throw new Error("Nada para exportar.");
  return buildDocument(live, { skipWorkspaceInternals: false });
}

export function buildPlaceXml(dataModel, opts = {}) {
  if (!dataModel) throw new Error("DataModel indisponível.");
  const roots = [];
  for (const name of PLACE_SERVICES) {
    const svc = getService(dataModel, name);
    if (svc && isPlaceService(svc.className)) roots.push(svc);
  }
  if (!roots.length) throw new Error("Nenhum serviço exportável encontrado.");
  const res = buildDocument(roots, { skipWorkspaceInternals: true, terrain: opts.terrain || null });
  if (opts.terrain) {
    res.warnings.push("Terrain exportado como SmoothGrid/MaterialColors no layout REAL do Roblox (v1, chunk 2^5) — legível pelo Roblox Studio.");
  }
  return res;
}
