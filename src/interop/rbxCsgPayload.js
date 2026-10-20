import { serializeInstances, deserializeInstances } from "../persistence/serializer.js";
import { bytesToBase64, base64ToBytes, MAX_BLOB_BYTES } from "./rbxBlobs.js";

const TE = new TextEncoder();
const TD = new TextDecoder("utf-8", { fatal: false });
const PAYLOAD_VERSION = 1;

function liveSources(inst) {
  if (inst.className === "UnionOperation") {
    const parts = Array.isArray(inst._sourceParts) ? inst._sourceParts : [];
    return { kind: "union", sources: parts.filter((p) => p && (!p.isDestroyed || !p.isDestroyed())) };
  }
  if (inst.className === "NegateOperation") {
    const orig = inst._original;
    const alive = orig && (!orig.isDestroyed || !orig.isDestroyed()) ? [orig] : [];
    return { kind: "negate", sources: alive };
  }
  return { kind: null, sources: [] };
}

export function encodeCsgPayload(inst, warnings) {
  const warn = (m) => {
    if (Array.isArray(warnings)) warnings.push(m);
  };
  if (!inst) return null;
  const { kind, sources } = liveSources(inst);
  if (!kind || !sources.length) return null;
  try {
    const ser = serializeInstances(sources);
    const json = JSON.stringify({ v: PAYLOAD_VERSION, kind, nodes: ser.nodes });


    const jsonBytes = TE.encode(json);
    if (jsonBytes.length > MAX_BLOB_BYTES) {
      warn(`Árvore CSG de "${inst.name}" excede 4MB e foi omitida no export.`);
      return null;
    }
    return bytesToBase64(jsonBytes);
  } catch (e) {
    warn(`Árvore CSG de "${inst.name}" não pôde ser serializada (${(e && e.message) || "erro"}).`);
    return null;
  }
}

export function decodeCsgPayload(b64, warnings) {
  const warn = (m) => {
    if (Array.isArray(warnings)) warnings.push(m);
  };
  const bytes = base64ToBytes(b64);
  if (!bytes || !bytes.length) {
    warn("Payload CSG (RSW_Csg) com base64 inválido; ignorado.");
    return { ok: false, kind: null, roots: [] };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(TD.decode(bytes));
  } catch (_) {
    warn("Payload CSG (RSW_Csg) com JSON inválido; ignorado.");
    return { ok: false, kind: null, roots: [] };
  }
  if (!parsed || parsed.v !== PAYLOAD_VERSION || !Array.isArray(parsed.nodes) ||
      (parsed.kind !== "union" && parsed.kind !== "negate")) {
    warn("Payload CSG (RSW_Csg) com estrutura inválida; ignorado.");
    return { ok: false, kind: null, roots: [] };
  }
  try {
    const res = deserializeInstances(parsed.nodes);
    if (Array.isArray(res.warnings)) {
      for (const w of res.warnings) warn(`CSG: ${w}`);
    }
    const roots = (res.roots || []).filter((r) => r);
    if (!roots.length) {
      warn("Payload CSG (RSW_Csg) sem instâncias válidas; ignorado.");
      return { ok: false, kind: parsed.kind, roots: [] };
    }
    return { ok: true, kind: parsed.kind, roots };
  } catch (e) {
    warn(`Payload CSG (RSW_Csg) não pôde ser reconstruído (${(e && e.message) || "erro"}).`);
    return { ok: false, kind: parsed.kind, roots: [] };
  }
}
