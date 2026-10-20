import { createIcon } from "./icons.js";

const DURATION_MS = 4000;
const EXIT_MS = 280;
const POOL_MAX = 12;

let host = null;
const pool = [];
const active = new Set();

function ensureHost() {
  if (host && host.isConnected) return host;
  host = document.createElement("div");
  host.className = "rsw-toasts";
  host.setAttribute("role", "status");
  host.setAttribute("aria-live", "polite");
  document.body.appendChild(host);
  return host;
}

function buildNode() {
  const node = document.createElement("div");
  node.className = "rsw-toast";
  const icon = document.createElement("div");
  icon.className = "rsw-toast__icon";
  const img = document.createElement("img");
  img.className = "rsw-toast__icon-img";
  img.alt = "";
  const initials = document.createElement("span");
  initials.className = "rsw-toast__icon-text";
  icon.append(img, initials);
  img.addEventListener("error", () => {
    img.style.display = "none";
    initials.replaceChildren(createIcon("starFill", 16));
    initials.style.display = "";
  });
  const text = document.createElement("div");
  text.className = "rsw-toast__text";
  const title = document.createElement("div");
  title.className = "rsw-toast__title";
  const subtitle = document.createElement("div");
  subtitle.className = "rsw-toast__subtitle";
  text.append(title, subtitle);
  node.append(icon, text);
  node._img = img;
  node._initials = initials;
  node._title = title;
  node._subtitle = subtitle;
  node._timer = 0;
  node._exitTimer = 0;
  return node;
}

function release(node) {
  if (node._timer) { clearTimeout(node._timer); node._timer = 0; }
  if (node._exitTimer) { clearTimeout(node._exitTimer); node._exitTimer = 0; }
  node.classList.remove("is-in", "is-out", "rsw-toast--error");
  node.remove();
  active.delete(node);
  if (pool.length < POOL_MAX) pool.push(node);
}

function dismiss(node) {
  if (!active.has(node)) return;
  if (node._timer) { clearTimeout(node._timer); node._timer = 0; }
  node.classList.remove("is-in");
  node.classList.add("is-out");
  node._exitTimer = setTimeout(() => release(node), EXIT_MS);
}

export function showGameNotification(opts) {
  if (typeof document === "undefined") return null;
  const o = opts || {};
  ensureHost();
  const node = pool.pop() || buildNode();
  if (o.iconUrl) {
    node._img.src = o.iconUrl;
    node._img.style.display = "";
    node._initials.style.display = "none";
  } else {
    node._img.removeAttribute("src");
    node._img.style.display = "none";
    if (o.iconText) node._initials.textContent = String(o.iconText);
    else node._initials.replaceChildren(createIcon("starFill", 16));
    node._initials.style.display = "";
  }
  node._title.textContent = String(o.title || "");
  node._subtitle.textContent = String(o.subtitle || "");
  node._subtitle.style.display = o.subtitle ? "" : "none";
  node.classList.toggle("rsw-toast--error", o.kind === "error");
  host.appendChild(node);
  active.add(node);
  requestAnimationFrame(() => node.classList.add("is-in"));
  node._timer = setTimeout(() => dismiss(node), DURATION_MS);
  return node;
}

export function clearGameNotifications() {
  for (const node of [...active]) release(node);
}
