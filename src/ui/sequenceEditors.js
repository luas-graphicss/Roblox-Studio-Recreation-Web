const MAX_KEYPOINTS = 20;

function clamp(v, a, b) {
  const n = Number(v);
  if (!Number.isFinite(n)) return a;
  return Math.min(b, Math.max(a, n));
}

function cssColor(c) {
  if (!c) return "rgb(255,255,255)";
  const r = Math.round(clamp(c.r, 0, 1) * 255);
  const g = Math.round(clamp(c.g, 0, 1) * 255);
  const b = Math.round(clamp(c.b, 0, 1) * 255);
  return `rgb(${r},${g},${b})`;
}

function colorToHex(c) {
  const h = (x) => Math.round(clamp(x, 0, 1) * 255).toString(16).padStart(2, "0");
  return `#${h(c ? c.r : 1)}${h(c ? c.g : 1)}${h(c ? c.b : 1)}`;
}

function hexToColor(str) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(str || "").trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 };
}


export function evalNumberSequence(seq, t) {
  const kps = seq && Array.isArray(seq.keypoints) ? seq.keypoints : null;
  if (!kps || kps.length === 0) return 0;
  if (kps.length === 1) return kps[0].value;
  const x = clamp(t, 0, 1);
  if (x <= kps[0].time) return kps[0].value;
  for (let i = 0; i < kps.length - 1; i++) {
    const a = kps[i];
    const b = kps[i + 1];
    if (x <= b.time) {
      const span = Math.max(1e-6, b.time - a.time);
      const f = (x - a.time) / span;
      return a.value + (b.value - a.value) * f;
    }
  }
  return kps[kps.length - 1].value;
}


export function evalColorSequence(seq, t) {
  const kps = seq && Array.isArray(seq.keypoints) ? seq.keypoints : null;
  if (!kps || kps.length === 0) return { r: 1, g: 1, b: 1 };
  if (kps.length === 1) return kps[0].color;
  const x = clamp(t, 0, 1);
  if (x <= kps[0].time) return kps[0].color;
  for (let i = 0; i < kps.length - 1; i++) {
    const a = kps[i];
    const b = kps[i + 1];
    if (x <= b.time) {
      const span = Math.max(1e-6, b.time - a.time);
      const f = (x - a.time) / span;
      return {
        r: a.color.r + (b.color.r - a.color.r) * f,
        g: a.color.g + (b.color.g - a.color.g) * f,
        b: a.color.b + (b.color.b - a.color.b) * f,
      };
    }
  }
  return kps[kps.length - 1].color;
}


export function drawNumberSequencePreview(canvas, seq) {
  const ctx = canvas && canvas.getContext ? canvas.getContext("2d") : null;
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(127,127,127,0.12)";
  ctx.fillRect(0, 0, w, h);
  const kps = seq && Array.isArray(seq.keypoints) && seq.keypoints.length >= 2 ? seq.keypoints : null;
  if (!kps) return;
  let lo = Infinity;
  let hi = -Infinity;
  for (const k of kps) {
    lo = Math.min(lo, k.value - (k.envelope || 0));
    hi = Math.max(hi, k.value + (k.envelope || 0));
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;
  if (hi - lo < 1e-6) { hi += 0.5; lo -= 0.5; }
  const px = (t) => 2 + t * (w - 4);
  const py = (v) => h - 3 - ((v - lo) / (hi - lo)) * (h - 6);
  ctx.strokeStyle = "#3b9eff";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let i = 0; i < kps.length; i++) {
    const x = px(kps[i].time);
    const y = py(kps[i].value);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = "#3b9eff";
  for (const k of kps) ctx.fillRect(px(k.time) - 1.5, py(k.value) - 1.5, 3, 3);
}

export function drawColorSequencePreview(canvas, seq) {
  const ctx = canvas && canvas.getContext ? canvas.getContext("2d") : null;
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const kps = seq && Array.isArray(seq.keypoints) && seq.keypoints.length >= 2 ? seq.keypoints : null;
  if (!kps) { ctx.fillStyle = "rgba(127,127,127,0.12)"; ctx.fillRect(0, 0, w, h); return; }
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  for (const k of kps) grad.addColorStop(clamp(k.time, 0, 1), cssColor(k.color));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
}





let activePopup = null;

function closeActivePopup() {
  if (activePopup) {
    const p = activePopup;
    activePopup = null;
    p.close();
  }
}

function createPopup(anchor, title, width) {

  closeActivePopup();
  const root = document.createElement("div");
  root.className = "rsw-seqeditor";
  root.style.cssText = [
    "position:fixed",
    "z-index:10000",
    `width:${width}px`,
    "background:#26262b",
    "color:#ddd",
    "border:1px solid #3c3c44",
    "border-radius:6px",
    "box-shadow:0 8px 28px rgba(0,0,0,0.5)",
    "font-size:11px",
    "user-select:none",
    "padding:8px",
  ].join(";");
  const head = document.createElement("div");
  head.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;";
  const lbl = document.createElement("span");
  lbl.textContent = title || "";
  lbl.style.cssText = "font-weight:600;color:#eee;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
  const btns = document.createElement("div");
  btns.style.cssText = "display:flex;gap:6px;flex:none;";
  function makeBtn(text) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.style.cssText = "background:#333339;color:#ddd;border:1px solid #45454d;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;";
    return b;
  }
  const resetBtn = makeBtn("Reset");
  const closeBtn = makeBtn("Fechar");
  btns.append(resetBtn, closeBtn);
  head.append(lbl, btns);
  root.appendChild(head);
  const body = document.createElement("div");
  root.appendChild(body);
  document.body.appendChild(root);


  try {
    const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 80, bottom: 80, top: 60 };
    const rw = width + 16;
    let left = clamp(r.left, 8, Math.max(8, window.innerWidth - rw - 8));
    let top = r.bottom + 6;
    const estH = 260;
    if (top + estH > window.innerHeight - 8) top = Math.max(8, r.top - estH - 6);
    root.style.left = `${Math.round(left)}px`;
    root.style.top = `${Math.round(top)}px`;
  } catch (_e) {
    root.style.left = "120px";
    root.style.top = "120px";
  }

  let onCloseCb = null;
  function outside(e) {
    const t = e && e.target;
    if (t && root.contains(t)) return;
    api.close();
  }
  function onKey(e) {
    if (e.key === "Escape") api.close();
  }
  setTimeout(() => {
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);

  const api = {
    root,
    body,
    resetBtn,
    closeBtn,
    setOnClose(cb) { onCloseCb = cb; },
    close() {
      if (!root.parentNode) return;
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", onKey, true);
      root.remove();
      if (activePopup === api) activePopup = null;
      if (typeof onCloseCb === "function") { try { onCloseCb(); } catch (_e) {            } }
    },
  };
  closeBtn.addEventListener("click", () => api.close());
  activePopup = api;
  return api;
}


export function openNumberSequenceEditor(opts) {
  const popup = createPopup(opts.anchor, `${opts.title || "NumberSequence"} (NumberSequence)`, 332);
  popup.setOnClose(opts.onClose || null);


  let kps = readKps();
  let selected = 0;

  function readKps() {
    const v = typeof opts.getValue === "function" ? opts.getValue() : null;
    const src = v && Array.isArray(v.keypoints) ? v.keypoints : [];
    const out = src.map((k) => ({
      time: clamp(k.time, 0, 1),
      value: Number.isFinite(k.value) ? k.value : 0,
      envelope: Math.max(0, Number.isFinite(k.envelope) ? k.envelope : 0),
    }));
    if (out.length < 2) return [{ time: 0, value: 1, envelope: 0 }, { time: 1, value: 1, envelope: 0 }];
    out.sort((a, b) => a.time - b.time);
    out[0].time = 0;
    out[out.length - 1].time = 1;
    return out;
  }

  function commit() {
    try {
      if (typeof opts.setValue === "function") opts.setValue({ keypoints: kps.map((k) => ({ ...k })) });
    } catch (_e) {            }
  }

  const W = 316;
  const H = 170;
  const PADL = 34;
  const PADR = 8;
  const PADT = 10;
  const PADB = 18;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  canvas.style.cssText = "display:block;background:#1d1d21;border:1px solid #3c3c44;border-radius:4px;cursor:crosshair;touch-action:none;";
  popup.body.appendChild(canvas);


  const fieldsRow = document.createElement("div");
  fieldsRow.style.cssText = "display:flex;gap:6px;margin-top:6px;align-items:center;";
  const fields = {};
  for (const [key, label] of [["time", "Time"], ["value", "Value"], ["envelope", "Envelope"]]) {
    const lab = document.createElement("span");
    lab.textContent = label;
    lab.style.cssText = "color:#9a9aa2;flex:none;";
    const inp = document.createElement("input");
    inp.type = "text";
    inp.style.cssText = "width:56px;background:#1d1d21;color:#ddd;border:1px solid #3c3c44;border-radius:3px;padding:2px 4px;font-size:11px;";
    inp.addEventListener("change", () => {
      const kp = kps[selected];
      if (!kp) return;
      const n = parseFloat(inp.value);
      if (!Number.isFinite(n)) { syncFields(); return; }
      if (key === "time") {

        if (selected !== 0 && selected !== kps.length - 1) kp.time = clamp(n, 0, 1);
      } else if (key === "value") {
        kp.value = n;
      } else {
        kp.envelope = Math.max(0, n);
      }
      kps.sort((a, b) => a.time - b.time);


      const si = kps.indexOf(kp);
      if (si >= 0) selected = si;
      commit();
      draw();
      syncFields();
    });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } });
    fields[key] = inp;
    fieldsRow.append(lab, inp);
  }
  popup.body.appendChild(fieldsRow);
  const hint = document.createElement("div");
  hint.textContent = "Clique: adicionar · Arrastar: mover · Botão direito: excluir";
  hint.style.cssText = "color:#77777f;margin-top:4px;";
  popup.body.appendChild(hint);

  function range() {
    let lo = Infinity;
    let hi = -Infinity;
    for (const k of kps) {
      lo = Math.min(lo, k.value - k.envelope);
      hi = Math.max(hi, k.value + k.envelope);
    }
    lo = Math.min(0, lo);
    hi = Math.max(1, hi);
    const pad = (hi - lo) * 0.1 + 1e-3;
    return { lo: lo - pad, hi: hi + pad };
  }

  function px(t) { return PADL + clamp(t, 0, 1) * (W - PADL - PADR); }
  function py(v, r) { return H - PADB - ((v - r.lo) / (r.hi - r.lo)) * (H - PADT - PADB); }
  function xToT(x) { return clamp((x - PADL) / (W - PADL - PADR), 0, 1); }
  function yToV(y, r) { return r.lo + ((H - PADB - y) / (H - PADT - PADB)) * (r.hi - r.lo); }

  function draw() {
    const ctx = canvas.getContext("2d");
    const r = range();
    ctx.clearRect(0, 0, W, H);

    ctx.strokeStyle = "#2c2c32";
    ctx.fillStyle = "#77777f";
    ctx.font = "9px sans-serif";
    ctx.lineWidth = 1;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const x = Math.round(px(t)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, PADT); ctx.lineTo(x, H - PADB); ctx.stroke();
      ctx.fillText(String(t), x - 6, H - 6);
    }
    for (const f of [0, 0.5, 1]) {
      const v = r.lo + (r.hi - r.lo) * f;
      const y = Math.round(py(v, r)) + 0.5;
      ctx.beginPath(); ctx.moveTo(PADL, y); ctx.lineTo(W - PADR, y); ctx.stroke();
      ctx.fillText(v.toFixed(Math.abs(v) >= 10 ? 0 : 1), 4, y + 3);
    }

    ctx.fillStyle = "rgba(59,158,255,0.18)";
    ctx.beginPath();
    for (let i = 0; i < kps.length; i++) {
      const x = px(kps[i].time);
      const y = py(kps[i].value + kps[i].envelope, r);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (let i = kps.length - 1; i >= 0; i--) {
      ctx.lineTo(px(kps[i].time), py(kps[i].value - kps[i].envelope, r));
    }
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "#3b9eff";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < kps.length; i++) {
      const x = px(kps[i].time);
      const y = py(kps[i].value, r);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    for (let i = 0; i < kps.length; i++) {
      const x = px(kps[i].time);
      const y = py(kps[i].value, r);
      ctx.fillStyle = i === selected ? "#ffd24a" : "#3b9eff";
      ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
      ctx.strokeStyle = "#1d1d21";
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 3.5, y - 3.5, 7, 7);
    }
  }

  function syncFields() {
    const kp = kps[selected];
    if (!kp) return;
    fields.time.value = kp.time.toFixed(3);
    fields.value.value = String(Math.round(kp.value * 1000) / 1000);
    fields.envelope.value = String(Math.round(kp.envelope * 1000) / 1000);
    const endpoint = selected === 0 || selected === kps.length - 1;
    fields.time.disabled = endpoint;
  }

  function hitTest(mx, my) {
    const r = range();
    let best = -1;
    let bestD = 9 * 9;
    for (let i = 0; i < kps.length; i++) {
      const dx = px(kps[i].time) - mx;
      const dy = py(kps[i].value, r) - my;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  let dragging = -1;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button === 2) return;                          
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let idx = hitTest(mx, my);
    if (idx < 0) {

      if (mx < PADL || mx > W - PADR || my < PADT || my > H - PADB) return;

      if (kps.length >= MAX_KEYPOINTS) return;
      const r = range();
      const kp = { time: xToT(mx), value: yToV(my, r), envelope: 0 };
      kps.push(kp);
      kps.sort((a, b) => a.time - b.time);
      idx = kps.indexOf(kp);
      commit();
    }
    selected = idx;
    dragging = idx;
    try { canvas.setPointerCapture(e.pointerId); } catch (_e) {            }
    draw();
    syncFields();
    e.preventDefault();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (dragging < 0) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const r = range();
    const kp = kps[dragging];
    if (!kp) return;

    if (dragging !== 0 && dragging !== kps.length - 1) {
      const lo = kps[dragging - 1] ? kps[dragging - 1].time + 0.001 : 0;
      const hi = kps[dragging + 1] ? kps[dragging + 1].time - 0.001 : 1;
      kp.time = clamp(xToT(mx), lo, Math.max(lo, hi));
    }
    kp.value = Math.round(yToV(my, r) * 1000) / 1000;
    commit();
    draw();
    syncFields();
  });
  const endDrag = () => { dragging = -1; };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const idx = hitTest(e.clientX - rect.left, e.clientY - rect.top);

    if (idx > 0 && idx < kps.length - 1) {
      kps.splice(idx, 1);
      if (selected >= kps.length) selected = kps.length - 1;
      commit();
      draw();
      syncFields();
    }
  });

  popup.resetBtn.addEventListener("click", () => {


    const zeroish = /transparency|squash/i.test(String(opts.title || ""));
    const v = zeroish ? 0 : 1;
    kps = [{ time: 0, value: v, envelope: 0 }, { time: 1, value: v, envelope: 0 }];
    selected = 0;
    commit();
    draw();
    syncFields();
  });

  draw();
  syncFields();
  return popup;
}


export function openColorSequenceEditor(opts) {
  const popup = createPopup(opts.anchor, `${opts.title || "ColorSequence"} (ColorSequence)`, 332);
  popup.setOnClose(opts.onClose || null);

  let kps = readKps();
  let selected = 0;

  function readKps() {
    const v = typeof opts.getValue === "function" ? opts.getValue() : null;
    const src = v && Array.isArray(v.keypoints) ? v.keypoints : [];
    const out = src
      .filter((k) => k && k.color)
      .map((k) => ({ time: clamp(k.time, 0, 1), color: { r: clamp(k.color.r, 0, 1), g: clamp(k.color.g, 0, 1), b: clamp(k.color.b, 0, 1) } }));
    if (out.length < 2) return [{ time: 0, color: { r: 1, g: 1, b: 1 } }, { time: 1, color: { r: 1, g: 1, b: 1 } }];
    out.sort((a, b) => a.time - b.time);
    out[0].time = 0;
    out[out.length - 1].time = 1;
    return out;
  }

  function commit() {
    try {
      if (typeof opts.setValue === "function") {
        opts.setValue({ keypoints: kps.map((k) => ({ time: k.time, color: { ...k.color } })) });
      }
    } catch (_e) {            }
  }

  const W = 316;
  const GRAD_H = 34;
  const LANE_H = 22;
  const H = GRAD_H + LANE_H;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  canvas.style.cssText = "display:block;background:#1d1d21;border:1px solid #3c3c44;border-radius:4px;cursor:pointer;touch-action:none;";
  popup.body.appendChild(canvas);
  const hint = document.createElement("div");
  hint.textContent = "Clique na barra: adicionar · Clique no marcador: cor · Arrastar: mover · Botão direito: excluir";
  hint.style.cssText = "color:#77777f;margin-top:4px;";
  popup.body.appendChild(hint);


  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.style.cssText = "position:absolute;width:0;height:0;opacity:0;pointer-events:none;";
  popup.body.appendChild(colorInput);
  colorInput.addEventListener("input", () => {
    const kp = kps[selected];
    const c = hexToColor(colorInput.value);
    if (kp && c) {
      kp.color = c;
      commit();
      draw();
    }
  });

  function px(t) { return 4 + clamp(t, 0, 1) * (W - 8); }
  function xToT(x) { return clamp((x - 4) / (W - 8), 0, 1); }

  function draw() {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = "#26262b";
    ctx.fillRect(0, 0, W, GRAD_H);
    const grad = ctx.createLinearGradient(4, 0, W - 4, 0);
    for (const k of kps) grad.addColorStop(k.time, cssColor(k.color));
    ctx.fillStyle = grad;
    ctx.fillRect(4, 2, W - 8, GRAD_H - 4);
    ctx.strokeStyle = "#3c3c44";
    ctx.strokeRect(4.5, 2.5, W - 9, GRAD_H - 5);

    for (let i = 0; i < kps.length; i++) {
      const x = px(kps[i].time);
      ctx.beginPath();
      ctx.moveTo(x, GRAD_H + 2);
      ctx.lineTo(x - 6, GRAD_H + 14);
      ctx.lineTo(x + 6, GRAD_H + 14);
      ctx.closePath();
      ctx.fillStyle = cssColor(kps[i].color);
      ctx.fill();
      ctx.strokeStyle = i === selected ? "#ffd24a" : "#0c0c0e";
      ctx.lineWidth = i === selected ? 2 : 1;
      ctx.stroke();
    }
  }

  function hitTest(mx) {
    let best = -1;
    let bestD = 8;
    for (let i = 0; i < kps.length; i++) {
      const d = Math.abs(px(kps[i].time) - mx);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  let dragging = -1;
  let moved = false;
  let justAdded = false;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button === 2) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    let idx = hitTest(mx);
    justAdded = false;
    if (idx < 0) {

      if (kps.length >= MAX_KEYPOINTS) return;
      const t = xToT(mx);
      const kp = { time: t, color: evalColorSequence({ keypoints: kps }, t) };
      kps.push(kp);
      kps.sort((a, b) => a.time - b.time);
      idx = kps.indexOf(kp);
      justAdded = true;
      commit();
    }
    selected = idx;
    dragging = idx;
    moved = false;
    try { canvas.setPointerCapture(e.pointerId); } catch (_e) {            }
    draw();
    e.preventDefault();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (dragging < 0) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const kp = kps[dragging];
    if (!kp) return;

    if (dragging !== 0 && dragging !== kps.length - 1) {
      const lo = kps[dragging - 1] ? kps[dragging - 1].time + 0.001 : 0;
      const hi = kps[dragging + 1] ? kps[dragging + 1].time - 0.001 : 1;
      const nt = clamp(xToT(mx), lo, Math.max(lo, hi));
      if (Math.abs(nt - kp.time) > 0.0005) moved = true;
      kp.time = nt;
      commit();
      draw();
    }
  });
  canvas.addEventListener("pointerup", () => {
    if (dragging >= 0 && !moved && !justAdded) {


      const kp = kps[selected];
      if (kp) {
        colorInput.value = colorToHex(kp.color);
        try { colorInput.click(); } catch (_e) {            }
      }
    }
    dragging = -1;
    justAdded = false;
  });
  canvas.addEventListener("pointercancel", () => { dragging = -1; });
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const idx = hitTest(e.clientX - rect.left);
    if (idx > 0 && idx < kps.length - 1) {
      kps.splice(idx, 1);
      if (selected >= kps.length) selected = kps.length - 1;
      commit();
      draw();
    }
  });

  popup.resetBtn.addEventListener("click", () => {

    kps = [{ time: 0, color: { r: 1, g: 1, b: 1 } }, { time: 1, color: { r: 1, g: 1, b: 1 } }];
    selected = 0;
    commit();
    draw();
  });

  draw();
  return popup;
}
