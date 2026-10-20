import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import * as DS from "../runtime/dataServices.js";
import * as cloudStore from "./cloudStore.js";
import { markUniverseLive } from "./cloudPublish.js";
import { generateSecureToken } from "./secureTokenGenerator.js";
import { createTokenDigest } from "./apiKeyDigest.js";

export const RATE_LIMIT_PER_MINUTE = 100;
const RATE_WINDOW_MS = 60000;
const SIM_LATENCY_MS = 60;
const TOKEN_PREFIX = "rbx_";
const TOKEN_LEN = 43;
const MAX_KEY_NAME = 80;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export const SCOPES = Object.freeze([
  "universe.datastore:read",
  "universe.datastore:write",
  "universe.messaging-service:publish",
  "universe.place:publish",
  "universe.asset:read",
  "universe.asset:write",
]);

export const SCOPE_LABELS = Object.freeze({
  "universe.datastore:read": "DataStore \u2014 Read",
  "universe.datastore:write": "DataStore \u2014 Write",
  "universe.messaging-service:publish": "MessagingService \u2014 Publish",
  "universe.place:publish": "Place \u2014 Publish",
  "universe.asset:read": "Assets \u2014 Read",
  "universe.asset:write": "Assets \u2014 Write",
});

const _rate = new Map();


function randomToken() {
  return generateSecureToken(TOKEN_PREFIX, TOKEN_LEN);
}

export function maskToken(token) {
  const t = String(token == null ? "" : token);
  if (t.length <= 12) return t;
  return t.slice(0, 12) + "\u2026";
}

export function sanitizeKeyName(raw) {
  let s = String(raw == null ? "" : raw);
  s = s.replace(/<[^>]*>/g, " ").replace(/[<>{}\\`$]/g, " ").replace(/\s+/g, " ").trim();

  return cloudStore.sliceName(s, MAX_KEY_NAME);
}

export function keyStatus(key) {
  if (!key) return "invalid";
  if (key.enabled === false) return "revoked";
  if (key.expiresAt) {
    const ts = Date.parse(key.expiresAt);


    if (!Number.isFinite(ts) || Date.now() > ts) return "expired";
  }
  return "active";
}


export const IP_WHITELIST_IS_ENFORCED = false;
export const IP_WHITELIST_PLACEHOLDER_VALUE = "0.0.0.0/0";
export const IP_WHITELIST_NOT_ENFORCED_HINT =
  "N\u00e3o aplicada: o simulador Open Cloud roda no navegador e n\u00e3o v\u00ea o IP de origem. Use scopes e expira\u00e7\u00e3o para limitar a chave.";
const MAX_IP_WHITELIST_LENGTH = 120;

export async function createApiKey(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const name = sanitizeKeyName(o.name);
  if (!name) throw new Error("Informe um nome v\u00e1lido para a API Key.");
  const universe = await cloudStore.getUniverse(o.universeId);
  if (!universe) throw new Error("Universe inexistente para a API Key.");

  const scopes = Array.isArray(o.scopes) ? [...new Set(o.scopes.filter((s) => SCOPES.includes(s)))] : [];
  if (!scopes.length) throw new Error("Selecione pelo menos um scope.");
  const days = Number(o.expirationDays);
  const expiresAt = Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null;
  const token = randomToken();
  const rec = {
    id: "key_" + Date.now().toString(36) + "_" + generateSecureToken("", 8),
    name,


    tokenDigest: await createTokenDigest(token),
    tokenPreview: maskToken(token),
    universeId: String(universe.id),
    scopes,

    ipWhitelist: IP_WHITELIST_IS_ENFORCED
      ? String(o.ipWhitelist || IP_WHITELIST_PLACEHOLDER_VALUE).slice(0, MAX_IP_WHITELIST_LENGTH)
      : IP_WHITELIST_PLACEHOLDER_VALUE,
    createdAt: new Date().toISOString(),
    expiresAt,
    enabled: true,
  };
  await cloudStore.putApiKey(rec);
  logger.info("Open Cloud: API Key \"" + name + "\" criada (" + scopes.length + " scope(s)).", { source: "Studio" });

  return { ...rec, token };
}

export async function revokeApiKey(id) {
  const key = await cloudStore.getApiKey(id);
  if (!key) return false;
  key.enabled = false;
  await cloudStore.putApiKey(key);
  return true;
}


const FAILED_AUTH_WINDOW_MS = 60000;
const MAX_FAILED_AUTH_PER_WINDOW = 20;
const _failedAuth = { windowStartedAt: 0, count: 0 };

function isFailedAuthBudgetExhausted() {
  const now = Date.now();
  if (now - _failedAuth.windowStartedAt > FAILED_AUTH_WINDOW_MS) {
    _failedAuth.windowStartedAt = now;
    _failedAuth.count = 0;
  }
  return _failedAuth.count >= MAX_FAILED_AUTH_PER_WINDOW;
}

function recordFailedAuth() {
  _failedAuth.count += 1;
  if (_failedAuth.count === MAX_FAILED_AUTH_PER_WINDOW) {
    logger.warn(
      "Open Cloud: " +
        MAX_FAILED_AUTH_PER_WINDOW +
        " falhas de autentica\u00e7\u00e3o em 1 minuto; novas tentativas ser\u00e3o recusadas com 429.",
      { source: "Studio" },
    );
  }
}

function consumeRate(keyId) {
  const now = Date.now();
  let slot = _rate.get(keyId);
  if (!slot || now - slot.start >= RATE_WINDOW_MS) {
    slot = { start: now, count: 0 };
    _rate.set(keyId, slot);
  }
  if (slot.count >= RATE_LIMIT_PER_MINUTE) return false;
  slot.count += 1;
  return true;
}

export function rateLimitRemainingFor(keyId) {
  const slot = _rate.get(keyId);
  if (!slot || Date.now() - slot.start >= RATE_WINDOW_MS) return RATE_LIMIT_PER_MINUTE;
  return Math.max(0, RATE_LIMIT_PER_MINUTE - slot.count);
}

export async function rateLimitRemaining(token) {
  const key = await cloudStore.findApiKeyByToken(token);
  if (!key) return 0;
  return rateLimitRemainingFor(key.id);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reply(status, statusMessage, bodyObj) {
  let body = "";
  try { body = JSON.stringify(bodyObj == null ? {} : bodyObj); } catch (_) { body = "{}"; }
  return {
    status,
    statusMessage: String(statusMessage || ""),
    headers: { "content-type": "application/json", "x-simulated": "true" },
    body,
  };
}

function errorReply(status, statusMessage, message) {
  return reply(status, statusMessage, { error: statusMessage, message: String(message || statusMessage) });
}

function parsePath(rawUrl) {
  let s = String(rawUrl == null ? "" : rawUrl).trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\/[^/]+\//i, "");
  s = s.replace(/^\/+/, "");
  const q = s.indexOf("?");
  if (q >= 0) s = s.slice(0, q);


  const h = s.indexOf("#");
  if (h >= 0) s = s.slice(0, h);
  s = s.replace(/^cloud\//i, "").replace(/^v[12]\//i, "");
  const segs = s.split("/").filter(Boolean).map((x) => {
    try { return decodeURIComponent(x); } catch (_) { return x; }
  });


  if (segs.length && segs[0] !== "universes") {
    const ui = segs.indexOf("universes");
    if (ui > 0 && ui <= 2) segs.splice(0, ui);
  }
  return segs.length ? segs : null;
}

function parseBody(body) {
  if (body == null || body === "") return null;
  if (typeof body === "object") return body;
  try { return JSON.parse(String(body)); } catch (_) { return { value: String(body) }; }
}


function bodyByteSize(body) {
  if (body == null) return 0;
  let s;
  if (typeof body === "string") {
    s = body;
  } else {
    try { s = JSON.stringify(body) || ""; } catch (_) { return Infinity; }
  }
  try { return new TextEncoder().encode(s).length; } catch (_) { return s.length; }
}

async function routeDataStores(key, segs, method, bodyObj) {


  const universeOptions = { universeId: key.universeId };
  const dsName = String(segs[3] || "");
  if (!dsName || dsName.length > DS.DS_LIMITS.maxNameLen) {
    return errorReply(400, "INVALID_ARGUMENT", "Nome de DataStore inv\u00e1lido.");
  }
  if (segs[4] !== "entries") return errorReply(404, "NOT_FOUND", "Rota de DataStore desconhecida.");
  const entryKey = String(segs[5] || "");
  const scope = String(segs[6] || "global");
  if (scope.length > DS.DS_LIMITS.maxScopeLen) {
    return errorReply(400, "INVALID_ARGUMENT", "Scope inv\u00e1lido (1.." + DS.DS_LIMITS.maxScopeLen + " caracteres).");
  }
  if (method === "GET") {
    if (!key.scopes.includes("universe.datastore:read")) {
      return errorReply(403, "PERMISSION_DENIED", "A API Key n\u00e3o possui o scope universe.datastore:read.");
    }
    if (!entryKey) {
      const keys = await DS.dsListKeys(dsName, scope, "", universeOptions);
      return reply(200, "OK", { keys });
    }
    const info = await DS.dsGetKeyInfo(dsName, scope, entryKey, universeOptions);
    if (!info) return errorReply(404, "NOT_FOUND", "Entry \"" + entryKey + "\" n\u00e3o encontrada.");
    const value = await DS.dsGet(dsName, scope, entryKey, universeOptions);
    return reply(200, "OK", { key: entryKey, value, version: info.version, updatedTime: info.updatedTime });
  }
  if (method === "POST" || method === "PATCH" || method === "PUT") {
    if (!key.scopes.includes("universe.datastore:write")) {
      return errorReply(403, "PERMISSION_DENIED", "A API Key n\u00e3o possui o scope universe.datastore:write.");
    }
    if (!entryKey || entryKey.length > DS.DS_LIMITS.maxKeyLen) {
      return errorReply(400, "INVALID_ARGUMENT", "Chave de entry inv\u00e1lida.");
    }
    if (bodyObj == null) {
      return errorReply(400, "INVALID_ARGUMENT", "Body JSON obrigat\u00f3rio (ex.: {\"value\": ...}).");
    }
    const value = bodyObj && Object.prototype.hasOwnProperty.call(bodyObj, "value") ? bodyObj.value : bodyObj;
    if (DS.valueByteSize(value) > DS.DS_LIMITS.maxValueBytes) {
      return errorReply(400, "INVALID_ARGUMENT", "Valor excede o limite de 4MB.");
    }
    const res = await DS.dsSet(dsName, scope, entryKey, value, [], universeOptions);
    return reply(200, "OK", { key: entryKey, version: res.version });
  }
  if (method === "DELETE") {
    if (!key.scopes.includes("universe.datastore:write")) {
      return errorReply(403, "PERMISSION_DENIED", "A API Key n\u00e3o possui o scope universe.datastore:write.");
    }
    if (!entryKey) return errorReply(400, "INVALID_ARGUMENT", "Informe a chave da entry a remover.");


    const info = await DS.dsGetKeyInfo(dsName, scope, entryKey, universeOptions);
    if (!info) return errorReply(404, "NOT_FOUND", "Entry \"" + entryKey + "\" n\u00e3o encontrada.");
    await DS.dsRemove(dsName, scope, entryKey, universeOptions);
    return reply(200, "OK", { key: entryKey, deleted: true });
  }
  return errorReply(405, "METHOD_NOT_ALLOWED", "M\u00e9todo " + method + " n\u00e3o suportado em data-stores.");
}

async function routeTopics(key, segs, method, bodyObj) {
  if (method !== "POST") {
    return errorReply(405, "METHOD_NOT_ALLOWED", "Use POST para publicar em t\u00f3picos.");
  }
  if (!key.scopes.includes("universe.messaging-service:publish")) {
    return errorReply(403, "PERMISSION_DENIED", "A API Key n\u00e3o possui o scope universe.messaging-service:publish.");
  }
  const topic = String(segs[3] || "");
  if (!topic || topic.length > DS.DS_LIMITS.topicMaxLen) {
    return errorReply(400, "INVALID_ARGUMENT", "T\u00f3pico inv\u00e1lido (1.." + DS.DS_LIMITS.topicMaxLen + " caracteres).");
  }
  if (bodyObj == null) {
    return errorReply(400, "INVALID_ARGUMENT", "Body JSON obrigat\u00f3rio (ex.: {\"message\": ...}).");
  }
  const data = bodyObj && Object.prototype.hasOwnProperty.call(bodyObj, "message") ? bodyObj.message : bodyObj;
  if (DS.valueByteSize(data) > DS.DS_LIMITS.msgMaxBytes) {
    return errorReply(400, "INVALID_ARGUMENT", "Mensagem excede " + DS.DS_LIMITS.msgMaxBytes + " bytes (1KB).");
  }
  bus.emit("cloud:openCloudMessage", { universeId: key.universeId, topic, data });
  return reply(200, "OK", { topic, published: true });
}

async function routePlaces(key, segs, method) {
  const placeId = String(segs[3] || "");
  const isPublish = segs[4] === "versions" || segs[4] === "publish";
  if (!isPublish) return errorReply(404, "NOT_FOUND", "Rota de place desconhecida.");
  if (method !== "POST") {
    return errorReply(405, "METHOD_NOT_ALLOWED", "Use POST para publicar vers\u00f5es.");
  }
  if (!key.scopes.includes("universe.place:publish")) {
    return errorReply(403, "PERMISSION_DENIED", "A API Key n\u00e3o possui o scope universe.place:publish.");
  }
  const place = await cloudStore.getPlace(placeId);
  if (!place || place.universeId !== key.universeId) {
    return errorReply(404, "NOT_FOUND", "Place " + placeId + " n\u00e3o encontrado neste universe.");
  }
  const text = await cloudStore.readPlaceText(place.id);
  if (!text) {
    return errorReply(400, "FAILED_PRECONDITION", "O place ainda n\u00e3o possui conte\u00fado salvo na nuvem (use Save to Cloud).");
  }


  if (!place.sourceKey) place.sourceKey = "cloudplace:" + place.id;
  const vh = await import("../collab/versionHistory.js");
  const meta = await vh.recordVersion({
    projectKey: place.sourceKey,
    text,
    thumbnail: place.thumbnail || null,
    comment: "Published via Open Cloud",
    force: true,
  });
  place.cloudVersion = (Number(place.cloudVersion) || 0) + 1;
  place.publishedAt = new Date().toISOString();
  if (meta) {
    place.activeVersionId = meta.id;
    place.activeVersionNum = meta.num;
  }
  await cloudStore.putPlace(place);


  await markUniverseLive(place.universeId, place.publishedAt);
  bus.emit("cloud:placeSaved", { placeId: place.id, published: true, via: "openCloud" });
  return reply(200, "OK", { placeId: place.id, versionNumber: place.cloudVersion, active: true });
}

async function routeAssets(key, segs, method) {
  if (method !== "GET") {
    return errorReply(405, "METHOD_NOT_ALLOWED", "Apenas GET \u00e9 suportado em assets neste simulador.");
  }
  if (!key.scopes.includes("universe.asset:read")) {
    return errorReply(403, "PERMISSION_DENIED", "A API Key n\u00e3o possui o scope universe.asset:read.");
  }
  const assetId = String(segs[3] || "");
  const all = await cloudStore.listAssets(key.universeId);
  if (!assetId) {
    return reply(200, "OK", {
      assets: all.map((a) => ({ assetId: a.assetId, name: a.name, kind: a.kind, status: a.status, isPublic: !!a.isPublic })),
    });
  }
  const hit = all.find((a) => a.assetId === assetId || a.id === assetId);
  if (!hit) return errorReply(404, "NOT_FOUND", "Asset " + assetId + " n\u00e3o encontrado neste universe.");
  return reply(200, "OK", { assetId: hit.assetId, name: hit.name, kind: hit.kind, status: hit.status, isPublic: !!hit.isPublic });
}

export async function requestAsync(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const token = String(o.token == null ? "" : o.token);
  const method = String(o.method == null ? "GET" : o.method).toUpperCase();
  await delay(SIM_LATENCY_MS);
  try {


    if (isFailedAuthBudgetExhausted()) {
      return errorReply(
        429,
        "RESOURCE_EXHAUSTED",
        "Muitas falhas de autentica\u00e7\u00e3o. Aguarde " +
          Math.round(FAILED_AUTH_WINDOW_MS / 1000) +
          "s antes de tentar novamente.",
      );
    }
    if (!token.startsWith(TOKEN_PREFIX)) {
      recordFailedAuth();
      return errorReply(401, "UNAUTHENTICATED", "API Key ausente ou em formato inv\u00e1lido (esperado rbx_...).");
    }
    const key = await cloudStore.findApiKeyByToken(token);
    if (!key) {
      recordFailedAuth();
      return errorReply(401, "UNAUTHENTICATED", "API Key desconhecida.");
    }
    const status = keyStatus(key);
    if (status === "revoked") {
      recordFailedAuth();
      return errorReply(401, "UNAUTHENTICATED", "API Key revogada.");
    }
    if (status === "expired") {
      recordFailedAuth();
      return errorReply(401, "UNAUTHENTICATED", "API Key expirada.");
    }
    if (!consumeRate(key.id)) {
      return errorReply(429, "RESOURCE_EXHAUSTED", "Rate limit de " + RATE_LIMIT_PER_MINUTE + " requests/minuto atingido. Tente novamente em instantes.");
    }
    if (bodyByteSize(o.body) > MAX_BODY_BYTES) {
      return errorReply(400, "INVALID_ARGUMENT", "Body excede o limite de 4MB.");
    }
    const segs = parsePath(o.url);
    if (!segs || segs[0] !== "universes" || !segs[1]) {
      return errorReply(404, "NOT_FOUND", "Rota inv\u00e1lida. Use universes/{universeId}/...");
    }
    const uid = String(segs[1]);
    if (uid !== String(key.universeId)) {
      return errorReply(403, "PERMISSION_DENIED", "Esta API Key pertence a outro Universe (isolamento de Universe).");
    }
    const bodyObj = parseBody(o.body);
    switch (segs[2]) {
      case "data-stores":
      case "standard-datastores":
        return await routeDataStores(key, segs, method, bodyObj);
      case "topics":
        return await routeTopics(key, segs, method, bodyObj);
      case "places":
        return await routePlaces(key, segs, method);
      case "assets":
        return await routeAssets(key, segs, method);
      default:
        return errorReply(404, "NOT_FOUND", "Recurso desconhecido: " + String(segs[2] || ""));
    }
  } catch (e) {
    logger.warn("Open Cloud: erro interno na requisi\u00e7\u00e3o: " + ((e && e.message) || e), { source: "Studio" });
    return errorReply(500, "INTERNAL", "Erro interno do simulador Open Cloud.");
  }
}
