export const EMOTE_LIST = Object.freeze([
  { id: "wave", icon: "wave", labelKey: "emoteWave" },
  { id: "point", icon: "point", labelKey: "emotePoint" },
  { id: "dance1", icon: "dance1", labelKey: "emoteDance1" },
  { id: "dance2", icon: "dance2", labelKey: "emoteDance2" },
  { id: "dance3", icon: "dance3", labelKey: "emoteDance3" },
  { id: "laugh", icon: "laugh", labelKey: "emoteLaugh" },
  { id: "cheer", icon: "cheer", labelKey: "emoteCheer" },
  { id: "salute", icon: "salute", labelKey: "emoteSalute" },
]);


const EMOTE_SVG_NS = "http://www.w3.org/2000/svg";
const EMOTE_PATHS = {
  wave: [
    "M5.6 13.4 C4.3 12.4 3.4 10.6 3.4 8.6 V5.6 A1 1 0 0 1 5.4 5.6 V8",
    "M5.4 8 V3.6 A1 1 0 0 1 7.4 3.6 V7.5",
    "M7.4 7.5 V3 A1 1 0 0 1 9.4 3 V8",
    "M9.4 8 V4.6 A1 1 0 0 1 11.4 4.6 V9 C11.4 11.6 10 13.4 7.9 13.4 Z",
    "M13 2.6 A6.5 6.5 0 0 1 14.1 4.9",
  ],
  point: ["M2.5 8 H11", "M8 4.5 L11.5 8 L8 11.5", "M13.5 5.5 V10.5"],
  dance1: [
    "M6.2 12 V4.5 L12 3.2 V10.5",
    "M6.2 12 A1.6 1.6 0 1 1 3 12 A1.6 1.6 0 0 1 6.2 12",
    "M12 10.5 A1.6 1.6 0 1 1 8.8 10.5 A1.6 1.6 0 0 1 12 10.5",
  ],
  dance2: [
    "M8.5 11.5 V3.5 L11.5 4.5",
    "M8.5 11.5 A1.8 1.8 0 1 1 4.9 11.5 A1.8 1.8 0 0 1 8.5 11.5",
    "M12 8.6 L13.4 10 M13.4 8.6 L12 10",
  ],
  dance3: [
    "M7 12.5 V5 L10 5.8",
    "M7 12.5 A1.7 1.7 0 1 1 3.6 12.5 A1.7 1.7 0 0 1 7 12.5",
    "M12 2.4 L12.5 3.9 L14 4.4 L12.5 4.9 L12 6.4 L11.5 4.9 L10 4.4 L11.5 3.9 Z",
  ],
  laugh: [
    "M8 14 A6 6 0 1 1 8 2 A6 6 0 0 1 8 14",
    "M5.4 6.6 H6 M10 6.6 H10.6",
    "M5 9 A3.4 3.4 0 0 0 11 9",
  ],
  cheer: [
    "M8 6.4 A1.6 1.6 0 1 0 8 3.2 A1.6 1.6 0 0 0 8 6.4",
    "M8 7 V11",
    "M8 11 L5.8 14 M8 11 L10.2 14",
    "M8 8 L4.6 5.2 M8 8 L11.4 5.2",
    "M3.6 3 L4.6 5.2 M12.4 3 L11.4 5.2",
  ],
  salute: [
    "M8 6.8 A1.7 1.7 0 1 0 8 3.4 A1.7 1.7 0 0 0 8 6.8",
    "M8 7.4 V11.2",
    "M8 11.2 L6 14 M8 11.2 L10 14",
    "M8 8.4 L5 10",
    "M8.2 8 L11 6 L12.6 4.2",
  ],
};

function createEmoteIcon(name, size) {
  const svg = document.createElementNS(EMOTE_SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const d of EMOTE_PATHS[name] || ["M5 5 H11 V11 H5 Z"]) {
    const p = document.createElementNS(EMOTE_SVG_NS, "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
  }
  return svg;
}

export function isValidEmote(name) {
  const n = String(name || "").toLowerCase();
  return EMOTE_LIST.some((e) => e.id === n);
}

export function createEmotesMenu({ root, t, onSelect }) {
  const host = document.createElement("div");
  host.className = "rsw-cg__emotes";
  host.hidden = true;

  const wheel = document.createElement("div");
  wheel.className = "rsw-cg__wheel";

  const center = document.createElement("div");
  center.className = "rsw-cg__wheel-center";
  center.textContent = t("emotes");
  wheel.appendChild(center);

  const RADIUS = 116;
  EMOTE_LIST.forEach((emote, i) => {
    const ang = (i / EMOTE_LIST.length) * Math.PI * 2 - Math.PI / 2;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rsw-cg__emote";


    btn.style.left = `calc(50% + ${Math.round(Math.cos(ang) * RADIUS)}px)`;
    btn.style.top = `calc(50% + ${Math.round(Math.sin(ang) * RADIUS)}px)`;
    const icon = document.createElement("span");
    icon.className = "rsw-cg__emote-icon";
    icon.appendChild(createEmoteIcon(emote.icon, 22));
    const label = document.createElement("span");
    label.textContent = t(emote.labelKey);
    btn.append(icon, label);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      close();
      if (typeof onSelect === "function") onSelect(emote.id);
    });
    wheel.appendChild(btn);
  });

  host.appendChild(wheel);
  host.addEventListener("mousedown", (e) => {
    if (e.target === host) close();
  });
  root.appendChild(host);

  function open() { host.hidden = false; }
  function close() { host.hidden = true; }

  return {
    open,
    close,
    toggle() { host.hidden ? open() : close(); },
    isOpen: () => !host.hidden,
    destroy() {
      if (host.parentNode) host.parentNode.removeChild(host);
    },
  };
}
