const SHOW_DELAY_MS = 1000;

export function showProgress(label) {
  let overlay = null;
  let barEl = null;
  let labelEl = null;
  let finished = false;
  let lastFrac = 0;
  let lastLabel = String(label || "Working…");

  const timer = setTimeout(() => {
    if (finished) return;
    overlay = document.createElement("div");
    overlay.className = "rsw-progress-overlay";
    const box = document.createElement("div");
    box.className = "rsw-progress-box";
    labelEl = document.createElement("div");
    labelEl.className = "rsw-progress-label";
    labelEl.textContent = lastLabel;
    const track = document.createElement("div");
    track.className = "rsw-progress-track";
    barEl = document.createElement("div");
    barEl.className = "rsw-progress-bar";
    barEl.style.width = Math.round(lastFrac * 100) + "%";
    track.appendChild(barEl);
    box.append(labelEl, track);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }, SHOW_DELAY_MS);

  return {
    update(frac, newLabel) {
      if (finished) return;
      if (Number.isFinite(frac)) lastFrac = Math.min(1, Math.max(0, frac));
      if (newLabel != null) lastLabel = String(newLabel);
      if (barEl) barEl.style.width = Math.round(lastFrac * 100) + "%";
      if (labelEl) labelEl.textContent = lastLabel;
    },
    done() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      overlay = null;
      barEl = null;
      labelEl = null;
    },
  };
}
