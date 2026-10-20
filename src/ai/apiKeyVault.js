let sessionApiKey = "";

export function getSessionApiKey() {
  return sessionApiKey;
}

export function hasSessionApiKey() {
  return sessionApiKey.length > 0;
}

export function setSessionApiKey(rawValue) {
  sessionApiKey = typeof rawValue === "string" ? rawValue.trim() : "";
  return sessionApiKey.length > 0;
}

export function clearSessionApiKey() {
  sessionApiKey = "";
}
