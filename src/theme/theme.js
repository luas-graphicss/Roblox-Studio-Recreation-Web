import { bus } from "../core/eventBus.js";
import { settings } from "../config/settings.js";
import { SUPPORTED_THEMES } from "../config/defaults.js";


const FALLBACK_THEME = "dark";
console.assert(
  SUPPORTED_THEMES.includes(FALLBACK_THEME),
  "[RSW] theme: fallback fora de SUPPORTED_THEMES",
);

const ANIM_CLASS = "rsw-theme-anim";


const ANIM_FALLBACK_MS = 200;


const ANIM_MARGIN_MS = 60;

let applyTimer = 0;

function prefersReducedMotion() {
  try {
    return (
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return false;
  }
}


function themeAnimMs(root) {
  try {
    const raw = getComputedStyle(root).getPropertyValue("--rsw-dur-theme").trim();
    const ms = raw.endsWith("ms")
      ? parseFloat(raw)
      : raw.endsWith("s")
        ? parseFloat(raw) * 1000
        : NaN;
    return Number.isFinite(ms) && ms >= 0 ? ms : ANIM_FALLBACK_MS;
  } catch {
    return ANIM_FALLBACK_MS;
  }
}

function apply(theme, { animate = true } = {}) {
  const safe = SUPPORTED_THEMES.includes(theme) ? theme : FALLBACK_THEME;
  const root = document.documentElement;


  const changed = root.getAttribute("data-theme") !== safe;
  if (changed && animate && !prefersReducedMotion()) {
    root.classList.add(ANIM_CLASS);
    clearTimeout(applyTimer);
    applyTimer = setTimeout(
      () => root.classList.remove(ANIM_CLASS),
      themeAnimMs(root) + ANIM_MARGIN_MS,
    );
  } else if (!animate || prefersReducedMotion()) {


    clearTimeout(applyTimer);
    root.classList.remove(ANIM_CLASS);
  }
  root.setAttribute("data-theme", safe);

  root.style.colorScheme = safe;
  return safe;
}

class ThemeManager {
  constructor() {


    let initial = FALLBACK_THEME;
    try {
      const domTheme = document.documentElement.getAttribute("data-theme");
      if (SUPPORTED_THEMES.includes(domTheme)) initial = domTheme;
    } catch {

    }
    this._current = initial;
    this._unsubscribe = null;
  }

  init() {


    this._current = apply(settings.get("theme"), { animate: false });

    if (this._unsubscribe) this._unsubscribe();

    this._unsubscribe = bus.on("settings:changed", (p) => {
      if (!p || p.key !== "theme") return;
      if (p.value === this._current) return;
      this._current = apply(p.value);
      bus.emit("theme:changed", this._current);
    });
    return this._current;
  }

  get() {
    return this._current;
  }

  set(theme) {
    if (!SUPPORTED_THEMES.includes(theme)) return this._current;


    settings.set("theme", theme);


    const applied = apply(theme);


    if (this._current !== applied) {
      this._current = applied;
      bus.emit("theme:changed", this._current);
    }
    return this._current;
  }

  toggle() {
    return this.set(this._current === "dark" ? "light" : "dark");
  }
}

export const theme = new ThemeManager();
