const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const OPAQUE_ORIGIN = "null";


export const TRUSTED_ANCESTOR_ORIGINS = Object.freeze([]);

export function readOriginHostname(origin) {
  try {
    return new URL(String(origin)).hostname;
  } catch (_) {
    return "";
  }
}

export function isLoopbackOrigin(origin) {
  return LOOPBACK_HOSTNAMES.has(readOriginHostname(origin));
}


export function isDevelopmentOrigin(origin) {
  return String(origin || "") === OPAQUE_ORIGIN || isLoopbackOrigin(origin);
}

export function isTrustedAncestorOrigin(ancestorOrigin, documentOrigin) {
  if (!ancestorOrigin) return false;
  if (ancestorOrigin === documentOrigin) return true;
  if (isDevelopmentOrigin(ancestorOrigin)) return true;
  return TRUSTED_ANCESTOR_ORIGINS.includes(ancestorOrigin);
}

export function readAncestorOrigins(targetWindow) {
  const targetLocation = targetWindow.location;
  const ancestorOrigins = targetLocation ? targetLocation.ancestorOrigins : null;
  if (ancestorOrigins && ancestorOrigins.length > 0) return Array.from(ancestorOrigins);


  const referrer = targetWindow.document ? targetWindow.document.referrer : "";
  if (!referrer) return [];
  try {
    return [new URL(referrer).origin];
  } catch (_) {
    return [];
  }
}

export function isFramed(targetWindow) {
  try {
    return targetWindow.top !== targetWindow.self;
  } catch (_) {

    return true;
  }
}

export function isTopLevelBrowsingContextAllowed(targetWindow) {
  if (!targetWindow) return true;
  if (!isFramed(targetWindow)) return true;
  const documentOrigin = targetWindow.location ? targetWindow.location.origin : "";
  if (isDevelopmentOrigin(documentOrigin)) return true;
  const ancestorOrigins = readAncestorOrigins(targetWindow);

  if (ancestorOrigins.length === 0) return false;
  return ancestorOrigins.every((ancestorOrigin) =>
    isTrustedAncestorOrigin(ancestorOrigin, documentOrigin),
  );
}

const BLOCKED_FRAME_TITLE = "This page cannot run inside a frame";
const BLOCKED_FRAME_DESCRIPTION =
  "The editor refuses to load embedded in another site, because a transparent overlay could turn your clicks into destructive actions. Open it directly to continue.";
const BLOCKED_FRAME_LINK_LABEL = "Open the editor in a new tab";


export function renderBlockedFrameNotice(targetDocument, appUrl) {
  const host = targetDocument.body || targetDocument.documentElement;
  if (!host) return null;
  const notice = targetDocument.createElement("section");
  notice.setAttribute("role", "alert");
  notice.style.cssText =
    "font-family:system-ui,sans-serif;padding:24px;max-width:640px;margin:48px auto;line-height:1.5";
  const title = targetDocument.createElement("h1");
  title.textContent = BLOCKED_FRAME_TITLE;
  const description = targetDocument.createElement("p");
  description.textContent = BLOCKED_FRAME_DESCRIPTION;
  notice.append(title, description);
  if (appUrl) {
    const link = targetDocument.createElement("a");
    link.href = appUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = BLOCKED_FRAME_LINK_LABEL;
    notice.append(link);
  }
  host.replaceChildren(notice);
  return notice;
}


export function enforceTopLevelBrowsingContext(targetWindow) {
  const windowRef = targetWindow || (typeof window === "undefined" ? null : window);
  if (!windowRef) return true;
  if (isTopLevelBrowsingContextAllowed(windowRef)) return true;
  if (windowRef.document) {
    renderBlockedFrameNotice(windowRef.document, windowRef.location ? windowRef.location.href : "");
  }
  return false;
}
