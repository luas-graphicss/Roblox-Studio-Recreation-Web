import { bus } from "../core/eventBus.js";
import { stopAudioPreview, setAudioPreviewVolume } from "../audio/audioEngine.js";
import { createIcon } from "./icons.js";

let bar = null;
let nameEl = null;

function ensureBar() {
  if (bar) return bar;
  bar = document.createElement("div");
  bar.className = "rsw-audiopreviewbar";
  bar.style.cssText =
    "position:fixed;right:16px;bottom:16px;z-index:9999;display:none;" +
    "align-items:center;gap:8px;background:#1f232b;color:#dfe3ea;" +
    "border:1px solid #343a46;border-radius:8px;padding:6px 10px;" +
    "font:12px system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.4);";
  const icon = document.createElement("span");
  icon.style.display = "inline-flex";
  icon.appendChild(createIcon("sound", 14));
  nameEl = document.createElement("span");
  nameEl.style.cssText =
    "max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
  const vol = document.createElement("input");
  vol.type = "range";
  vol.min = "0";
  vol.max = "1";
  vol.step = "0.01";
  vol.value = "0.35";
  vol.style.width = "90px";
  vol.title = "Volume do preview";
  vol.addEventListener("input", () => setAudioPreviewVolume(Number(vol.value)));
  const stop = document.createElement("button");
  stop.type = "button";
  stop.textContent = "Stop";
  stop.style.cssText =
    "background:#2c313c;color:#dfe3ea;border:1px solid #3c4250;" +
    "border-radius:4px;cursor:pointer;padding:2px 8px;";
  stop.addEventListener("click", () => stopAudioPreview());
  bar.append(icon, nameEl, vol, stop);
  document.body.appendChild(bar);
  return bar;
}

bus.on("audio:previewChanged", (p) => {
  const el = ensureBar();
  if (p && p.playing) {
    nameEl.textContent = String(p.name || p.id || "Preview");
    el.style.display = "flex";
  } else {
    el.style.display = "none";
  }
});
