import { settings } from "../config/settings.js";


const SHOW_DELAY = 500;      

let activeEl = null;                                              
let pendingTimer = 0;                               

function removeTooltip() {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = 0;
  }
  if (activeEl) {
    activeEl.remove();
    activeEl = null;
  }
}

function buildTooltip({ title, desc, shortcut }) {
  const el = document.createElement("div");
  el.className = "rsw-tooltip";
  el.setAttribute("role", "tooltip");

  if (title) {
    const strong = document.createElement("strong");
    strong.className = "rsw-tooltip__title";
    strong.textContent = String(title);
    el.appendChild(strong);
  }
  if (desc) {
    const d = document.createElement("span");
    d.className = "rsw-tooltip__desc";
    d.textContent = String(desc);
    el.appendChild(d);
  }
  if (shortcut) {
    const s = document.createElement("span");
    s.className = "rsw-tooltip__shortcut";
    s.textContent = String(shortcut);
    el.appendChild(s);
  }
  return el;
}


function positionTooltip(el, anchor) {
  const r = anchor.getBoundingClientRect();

  const tw = el.offsetWidth;
  const th = el.offsetHeight;
  const margin = 6;
  let left = r.left + r.width / 2 - tw / 2;
  let top = r.bottom + margin;


  if (top + th > window.innerHeight - 2) {
    top = r.top - th - margin;
  }

  left = Math.max(4, Math.min(left, window.innerWidth - tw - 4));
  top = Math.max(4, top);

  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

function showFor(anchor, info) {
  removeTooltip();
  if (settings.get("tooltipsEnabled") === false) return;


  if (!anchor || anchor.isConnected === false) return;
  const el = buildTooltip(info);
  document.body.appendChild(el);
  activeEl = el;
  positionTooltip(el, anchor);

  el.classList.add("rsw-tooltip--visible");
}


export function attachTooltip(target, info) {
  if (!target || !info) return () => {};

  const onEnter = () => {
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = window.setTimeout(() => {
      pendingTimer = 0;

      if (target.getAttribute("aria-disabled") === "true" || target.disabled) return;
      showFor(target, info);
    }, SHOW_DELAY);
  };
  const onLeave = () => removeTooltip();
  const onDown = () => removeTooltip();

  target.addEventListener("mouseenter", onEnter);
  target.addEventListener("mouseleave", onLeave);
  target.addEventListener("mousedown", onDown);
  target.addEventListener("focusout", onLeave);

  return () => {
    target.removeEventListener("mouseenter", onEnter);
    target.removeEventListener("mouseleave", onLeave);
    target.removeEventListener("mousedown", onDown);
    target.removeEventListener("focusout", onLeave);
    removeTooltip();
  };
}


if (typeof window !== "undefined") {
  window.addEventListener("scroll", removeTooltip, true);
  window.addEventListener("blur", removeTooltip);
  window.addEventListener("resize", removeTooltip);
}

export function hideTooltip() {
  removeTooltip();
}
