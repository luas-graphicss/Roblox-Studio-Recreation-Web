import { profiler, PROFILER_CATEGORIES, MAX_PROFILER_FRAMES } from "../core/profiler.js";
import { getSunShadowPageSample } from "../viewport/shadowPages.js";
import { logger } from "../core/logger.js";

const VISIBLE = 120;
const SCALE_MS = 40;

let win = null;
let canvas = null;
let ctx = null;
let tooltip = null;
let offFrame = null;
let pausedFlag = false;
let pausedFrames = null;
let granular = false;
let showLabels = true;
let scrollOff = 0;
let hoverIdx = -1;
let pauseBtn = null;
let granBtn = null;
let labelsBtn = null;
let drawRaf = 0;

function scheduleDraw() {
  if (!win || drawRaf) return;
  if (typeof document !== "undefined" && document.hidden) return;
  drawRaf = requestAnimationFrame(() => {
    drawRaf = 0;
    if (win) draw();
  });
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function currentFrames() {
  return pausedFlag && pausedFrames ? pausedFrames : profiler.getFrames();
}

function fmtMs(v) {
  return (Math.round(v * 100) / 100).toFixed(2) + "ms";
}

function draw() {
  if (!ctx || !canvas) return;
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || 640;
  const cssH = canvas.clientHeight || 190;
  const W = Math.round(cssW * dpr);
  const H = Math.round(cssH * dpr);
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = "#141416";
  ctx.fillRect(0, 0, cssW, cssH);

  const left = 44;
  const right = 8;
  const top = 8;
  const bottom = 16;
  const plotW = cssW - left - right;
  const plotH = cssH - top - bottom;
  const yFor = (ms) => top + plotH - (Math.min(ms, SCALE_MS) / SCALE_MS) * plotH;

  ctx.strokeStyle = "#2c2c30";
  ctx.lineWidth = 1;
  ctx.strokeRect(left, top, plotW, plotH);

  ctx.font = "10px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const ref of [{ ms: 16.67, label: "16.7ms", sub: "60fps" }, { ms: 33.33, label: "33.3ms", sub: "30fps" }]) {
    const y = yFor(ref.ms);
    ctx.strokeStyle = ref.ms > 20 ? "#7a3a3a" : "#3a5a3a";
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + plotW, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#9b9ba1";
    ctx.fillText(ref.label, left - 4, y - 5);
    ctx.fillText(ref.sub, left - 4, y + 6);
  }
  ctx.fillStyle = "#9b9ba1";
  ctx.fillText("0ms", left - 4, top + plotH);

  const list = currentFrames();
  const total = list.length;
  const maxOff = Math.max(0, total - VISIBLE);
  if (scrollOff > maxOff) scrollOff = maxOff;
  const start = Math.max(0, total - VISIBLE - scrollOff);
  const slice = list.slice(start, start + VISIBLE);
  const colW = plotW / VISIBLE;

  for (let i = 0; i < slice.length; i++) {
    const f = slice[i];
    const x = left + i * colW;
    let yBase = top + plotH;
    for (const cat of PROFILER_CATEGORIES) {
      const ms = f.cats[cat.id] || 0;
      if (ms <= 0) continue;
      const h = Math.max(0.5, (Math.min(ms, SCALE_MS) / SCALE_MS) * plotH);
      const y = Math.max(top, yBase - h);
      ctx.fillStyle = cat.color;
      ctx.globalAlpha = i === hoverIdx ? 1 : 0.88;
      ctx.fillRect(x, y, Math.max(1, colW - 0.6), yBase - y);
      if (granular && f.subs && f.subs[cat.id]) {
        const subs = Object.values(f.subs[cat.id]);
        if (subs.length > 1) {
          let acc = 0;
          ctx.fillStyle = "rgba(0,0,0,0.35)";
          for (let sI = 0; sI < subs.length - 1; sI++) {
            acc += subs[sI];
            const sy = yBase - (acc / ms) * (yBase - y);
            ctx.fillRect(x, sy, Math.max(1, colW - 0.6), 1);
          }
        }
      }
      yBase = y;
    }
    ctx.globalAlpha = 1;
    if (f.total > SCALE_MS) {
      ctx.fillStyle = "#ff5555";
      ctx.fillRect(x, top, Math.max(1, colW - 0.6), 2);
    }
  }

  if (hoverIdx >= 0 && hoverIdx < slice.length) {
    const x = left + hoverIdx * colW;
    ctx.strokeStyle = "#4c8bf5";
    ctx.strokeRect(x - 0.5, top, colW + 1, plotH);
  }

  if (showLabels) {
    const last = slice.length ? slice[slice.length - 1] : null;
    if (last) {
      ctx.textAlign = "left";
      let ly = top + 6;
      for (const cat of PROFILER_CATEGORIES) {
        const ms = last.cats[cat.id] || 0;
        if (ms < 0.05) continue;
        ctx.fillStyle = cat.color;
        ctx.fillRect(left + 6, ly - 3, 6, 6);
        ctx.fillStyle = "#e7e7e8";
        ctx.fillText(cat.label + " " + fmtMs(ms), left + 16, ly);
        ly += 12;
      }


      try {
        const vsmSample = getSunShadowPageSample();
        if (vsmSample && vsmSample.active) {
          ctx.fillStyle = "#aaaaaa";
          const vsmPending = vsmSample.pagesPending || 0;
          const vsmLast = vsmSample.lastPagesRendered || 0;
          const vsmCsm = vsmSample.csm ? " CSM" : "";
          const vsmMs = vsmSample.lastRenderMs > 0 ? " (" + fmtMs(vsmSample.lastRenderMs) + ")" : "";
          ctx.fillText(
            "VSM¹² páginas" + vsmCsm + ": " + vsmLast + "/frame pend:" + vsmPending + vsmMs,
            left + 16, ly,
          );
          ly += 12;
        }
      } catch (_e) {                                                             }


      try {
        const lqa = typeof window !== "undefined" ? window.__rswLightingQa : null;
        const led = lqa && typeof lqa.get === "function" ? lqa.get().ledger : null;
        if (led && led.frames > 0) {
          const top = (led.passes || [])
            .filter((p) => p && p.emaMs >= 0.05 && p.id !== "ledger")
            .sort((a, b) => b.emaMs - a.emaMs)
            .slice(0, 3)
            .map((p) => p.id + (p.estimated ? "~" : "") + " " + fmtMs(p.emaMs))
            .join(" | ");
          if (top) {
            ctx.fillStyle = "#aaaaaa";
            ctx.fillText("Ledger F1 (" + (led.mode === "gpu-timer" ? "GPU" : "CPU~") + "): " + top, left + 16, ly);
            ly += 12;
          }
        }
      } catch (_e2) {                                                    }
    }
  }

  ctx.textAlign = "center";
  ctx.fillStyle = "#67676e";
  const info = pausedFlag
    ? "PAUSADO - scroll navega (" + (start + 1) + "-" + (start + slice.length) + " de " + total + ")"
    : total + " frames (max " + MAX_PROFILER_FRAMES + ")";
  ctx.fillText(info, left + plotW / 2, cssH - 7);
}

function frameAt(clientX) {
  if (!canvas) return { idx: -1, frame: null };
  const rect = canvas.getBoundingClientRect();
  const left = 44;
  const plotW = (canvas.clientWidth || 640) - left - 8;
  const x = clientX - rect.left - left;
  if (x < 0 || x > plotW) return { idx: -1, frame: null };
  const list = currentFrames();
  const start = Math.max(0, list.length - VISIBLE - scrollOff);
  const slice = list.slice(start, start + VISIBLE);
  const idx = Math.floor((x / plotW) * VISIBLE);
  return { idx, frame: idx >= 0 && idx < slice.length ? slice[idx] : null };
}

function showTooltip(e) {
  const { idx, frame } = frameAt(e.clientX);
  hoverIdx = idx;
  if (!frame || !tooltip) {
    if (tooltip) tooltip.style.display = "none";
    draw();
    return;
  }
  const lines = ["Frame #" + frame.n, "Total: " + fmtMs(frame.total)];
  for (const cat of PROFILER_CATEGORIES) {
    const ms = frame.cats[cat.id] || 0;
    if (ms < 0.01) continue;
    lines.push(cat.label + ": " + fmtMs(ms));
    if (granular && frame.subs && frame.subs[cat.id]) {
      for (const [sub, sms] of Object.entries(frame.subs[cat.id])) {
        lines.push("   " + sub + ": " + fmtMs(sms));
      }
    }
  }
  tooltip.textContent = lines.join("\n");
  tooltip.style.display = "block";
  const winRect = win.getBoundingClientRect();
  let tx = e.clientX - winRect.left + 14;
  const ty = e.clientY - winRect.top + 10;
  if (tx + 170 > winRect.width) tx -= 190;
  tooltip.style.left = tx + "px";
  tooltip.style.top = ty + "px";
  draw();
}

function setPaused(v) {
  pausedFlag = v === true;


  pausedFrames = pausedFlag ? profiler.getFrames().slice() : null;
  scrollOff = 0;
  if (pauseBtn) {
    pauseBtn.textContent = pausedFlag ? "Resume" : "Pause";
    pauseBtn.classList.toggle("rsw-mp__btn--on", pausedFlag);
  }
  draw();
}

function dumpJson() {
  const list = currentFrames();
  const data = {
    tool: "MicroProfiler",
    exportedAt: new Date().toISOString(),
    scaleMs: SCALE_MS,
    frameCount: list.length,
    categories: PROFILER_CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
    frames: list.map((f) => ({
      n: f.n,
      totalMs: Math.round(f.total * 1000) / 1000,
      categories: Object.fromEntries(Object.entries(f.cats).map(([k, v]) => [k, Math.round(v * 1000) / 1000])),
      subs: f.subs || {},
    })),
  };
  try {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "microprofiler-dump.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    logger.info("MicroProfiler: dump exportado (" + list.length + " frames).", { source: "Studio" });
  } catch (e) {
    logger.warn("MicroProfiler: falha ao exportar dump: " + ((e && e.message) || e), { source: "Studio" });
  }
}

function toolButton(label, title, onClick) {
  const b = el("button", "rsw-mp__btn", label);
  b.type = "button";
  b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

export function isMicroProfilerVisible() {
  return !!win;
}

export function openMicroProfiler() {
  if (win) return;
  pausedFlag = false;
  pausedFrames = null;
  scrollOff = 0;
  hoverIdx = -1;

  win = el("div", "rsw-mp");
  win.tabIndex = 0;
  win.setAttribute("role", "dialog");
  win.setAttribute("aria-label", "MicroProfiler");

  const header = el("div", "rsw-mp__header");
  const title = el("span", "rsw-mp__title", "MicroProfiler");
  const closeBtn = el("button", "rsw-mp__close", "\u00d7");
  closeBtn.type = "button";
  closeBtn.title = "Fechar (Ctrl+F6)";
  closeBtn.setAttribute("aria-label", "Fechar MicroProfiler");
  closeBtn.addEventListener("click", () => closeMicroProfiler());
  header.append(title, closeBtn);

  const bar = el("div", "rsw-mp__bar");
  pauseBtn = toolButton("Pause", "Congela o grafico para inspecao (Espaco)", () => setPaused(!pausedFlag));
  const dumpBtn = toolButton("Dump", "Exporta os ultimos frames como JSON", () => dumpJson());
  granBtn = toolButton("Granularity", "Alterna subdivisoes internas das categorias", () => {
    granular = !granular;
    granBtn.classList.toggle("rsw-mp__btn--on", granular);
    draw();
  });
  labelsBtn = toolButton("Labels", "Mostra/oculta labels das categorias", () => {
    showLabels = !showLabels;
    labelsBtn.classList.toggle("rsw-mp__btn--on", showLabels);
    draw();
  });
  labelsBtn.classList.toggle("rsw-mp__btn--on", showLabels);
  bar.append(pauseBtn, dumpBtn, granBtn, labelsBtn);

  canvas = el("canvas", "rsw-mp__canvas");
  ctx = canvas.getContext("2d");

  tooltip = el("div", "rsw-mp__tooltip");
  tooltip.style.display = "none";

  const legend = el("div", "rsw-mp__legend");
  for (const cat of PROFILER_CATEGORIES) {
    const item = el("span", "rsw-mp__legenditem");
    const dot = el("span", "rsw-mp__dot");
    dot.style.background = cat.color;
    item.append(dot, document.createTextNode(cat.label));
    legend.appendChild(item);
  }

  win.append(header, bar, canvas, legend, tooltip);
  document.body.appendChild(win);

  let dragging = null;
  header.addEventListener("mousedown", (e) => {
    if (e.target === closeBtn) return;
    const rect = win.getBoundingClientRect();
    dragging = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    e.preventDefault();
  });
  const onMove = (e) => {
    if (!dragging) return;


    const maxL = Math.max(0, (globalThis.innerWidth || 1024) - 120);
    const maxT = Math.max(0, (globalThis.innerHeight || 768) - 48);
    win.style.left = Math.max(0, Math.min(maxL, e.clientX - dragging.dx)) + "px";
    win.style.top = Math.max(0, Math.min(maxT, e.clientY - dragging.dy)) + "px";
    win.style.right = "auto";
  };
  const onUp = () => { dragging = null; };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
  win._cleanupDrag = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };

  canvas.addEventListener("mousemove", showTooltip);
  canvas.addEventListener("mouseleave", () => {
    hoverIdx = -1;
    if (tooltip) tooltip.style.display = "none";
    draw();
  });
  canvas.addEventListener("wheel", (e) => {
    if (!pausedFlag) return;
    e.preventDefault();
    const delta = e.deltaY > 0 || e.deltaX > 0 ? -8 : 8;
    const maxOff = Math.max(0, currentFrames().length - VISIBLE);
    scrollOff = Math.max(0, Math.min(maxOff, scrollOff + delta));
    draw();
  }, { passive: false });
  win.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      e.stopPropagation();
      setPaused(!pausedFlag);
    }
  });

  profiler.retain();
  offFrame = profiler.onFrame(() => {
    if (!pausedFlag && win) scheduleDraw();
  });
  requestAnimationFrame(() => draw());
  win.focus({ preventScroll: true });
}

export function closeMicroProfiler() {
  if (!win) return;
  if (offFrame) { offFrame(); offFrame = null; }
  if (drawRaf) { cancelAnimationFrame(drawRaf); drawRaf = 0; }
  profiler.release();
  if (win._cleanupDrag) win._cleanupDrag();
  win.remove();
  win = null;
  canvas = null;
  ctx = null;
  tooltip = null;
  pauseBtn = null;
  granBtn = null;
  labelsBtn = null;
  pausedFlag = false;
  pausedFrames = null;
}

export function toggleMicroProfiler() {
  if (win) closeMicroProfiler();
  else openMicroProfiler();
}
