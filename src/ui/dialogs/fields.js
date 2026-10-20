export function _el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}


let _fieldIdSeq = 0;

export function field(label, control, opts) {
  const o = opts || {};
  const wrap = _el("div", "rsw-field" + (o.inline ? " rsw-field--inline" : ""));
  if (label) {
    const lab = _el("label", "rsw-field__label", label);


    if (control && !control.id && /^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName || "")) {
      control.id = "rsw-field-" + (++_fieldIdSeq);
    }
    if (control && control.id) lab.htmlFor = control.id;
    wrap.appendChild(lab);
  }
  if (control instanceof Node) wrap.appendChild(control);
  if (o.hint) wrap.appendChild(_el("p", "rsw-field__hint", o.hint));
  return wrap;
}

export function sectionTitle(text) {
  return _el("h3", "rsw-section-title", text);
}

export function textInput(value, onChange, opts) {
  const o = opts || {};
  const input = document.createElement("input");
  input.type = "text";
  input.className = "rsw-input";
  input.value = value != null ? String(value) : "";
  input.placeholder = o.placeholder || "";
  input.setAttribute("spellcheck", "false");
  input.maxLength = typeof o.maxLength === "number" ? o.maxLength : 200;
  if (typeof onChange === "function") {
    input.addEventListener("input", () => onChange(input.value));
  }
  return input;
}

export function textArea(value, onChange, opts) {
  const o = opts || {};
  const ta = document.createElement("textarea");
  ta.className = "rsw-textarea";
  ta.value = value != null ? String(value) : "";
  ta.rows = typeof o.rows === "number" ? o.rows : 3;
  ta.placeholder = o.placeholder || "";
  ta.setAttribute("spellcheck", "false");
  ta.maxLength = typeof o.maxLength === "number" ? o.maxLength : 1000;
  if (typeof onChange === "function") {
    ta.addEventListener("input", () => onChange(ta.value));
  }
  return ta;
}

export function numberInput(value, onChange, opts) {
  const o = opts || {};
  const input = document.createElement("input");
  input.type = "number";
  input.className = "rsw-input rsw-input--number";
  if (typeof o.min === "number") input.min = String(o.min);
  if (typeof o.max === "number") input.max = String(o.max);
  if (typeof o.step === "number") input.step = String(o.step);
  const clamp = (n) => {
    let v = n;
    if (typeof o.min === "number" && v < o.min) v = o.min;
    if (typeof o.max === "number" && v > o.max) v = o.max;
    return v;
  };


  const initNum = value != null ? Number(value) : NaN;
  input.value = Number.isFinite(initNum) ? String(clamp(initNum)) : value != null ? String(value) : "";


  let lastValid = input.value;
  if (typeof onChange === "function") {
    input.addEventListener("change", () => {
      const raw = Number(input.value);
      if (input.value.trim() === "" || !Number.isFinite(raw)) {
        input.value = lastValid;
        return;
      }
      const v = clamp(raw);
      input.value = String(v);
      lastValid = input.value;
      onChange(v);
    });
  }
  return input;
}

export function selectInput(value, options, onChange) {
  const sel = document.createElement("select");
  sel.className = "rsw-select";
  for (const opt of options || []) {
    const isObj = opt && typeof opt === "object";
    const val = isObj ? opt.value : opt;
    const label = isObj ? opt.label : opt;
    const o = document.createElement("option");
    o.value = String(val);
    o.textContent = String(label);
    if (String(val) === String(value)) o.selected = true;
    sel.appendChild(o);
  }
  if (typeof onChange === "function") {
    sel.addEventListener("change", () => onChange(sel.value));
  }
  return sel;
}

export function checkboxField(label, checked, onChange) {
  const wrap = _el("label", "rsw-check");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "rsw-check__box";
  input.checked = !!checked;
  if (typeof onChange === "function") {
    input.addEventListener("change", () => onChange(input.checked));
  }
  wrap.appendChild(input);
  wrap.appendChild(_el("span", "rsw-check__label", label));
  return wrap;
}


function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function colorToHex(c) {
  const to255 = (v) => {
    const x = Math.round(clamp01(typeof v === "number" ? v : 0) * 255);
    return x.toString(16).padStart(2, "0");
  };
  const r = c && typeof c === "object" ? c.r : 0;
  const g = c && typeof c === "object" ? c.g : 0;
  const b = c && typeof c === "object" ? c.b : 0;
  return "#" + to255(r) + to255(g) + to255(b);
}

export function hexToColor(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || "").trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  const int = parseInt(m[1], 16);
  return {
    r: ((int >> 16) & 255) / 255,
    g: ((int >> 8) & 255) / 255,
    b: (int & 255) / 255,
  };
}

export function colorInput(value, onChange) {
  const input = document.createElement("input");
  input.type = "color";
  input.className = "rsw-color";
  input.value = colorToHex(value);
  if (typeof onChange === "function") {
    input.addEventListener("input", () => onChange(hexToColor(input.value)));
  }
  return input;
}


export function slider(value, onChange, opts) {
  const o = opts || {};
  const min = typeof o.min === "number" ? o.min : 0;
  const max = typeof o.max === "number" ? o.max : 100;
  const step = typeof o.step === "number" ? o.step : 1;
  const clamp = (n) => Math.min(max, Math.max(min, n));


  const start = clamp(Number.isFinite(Number(value)) ? Number(value) : min);
  const wrap = _el("div", "rsw-slider");
  const range = document.createElement("input");
  range.type = "range";
  range.className = "rsw-slider__range";
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = String(start);
  const numEl = document.createElement("input");
  numEl.type = "number";
  numEl.className = "rsw-input rsw-input--number rsw-slider__num";
  numEl.min = String(min);
  numEl.max = String(max);
  numEl.step = String(step);
  numEl.value = String(start);
  const emit = (v, immediate) => {
    if (typeof onChange === "function") onChange(v, immediate);
  };
  range.addEventListener("input", () => {
    const v = clamp(Number(range.value));
    numEl.value = String(v);
    emit(v, false);
  });
  numEl.addEventListener("change", () => {
    const raw = Number(numEl.value);


    if (numEl.value.trim() === "" || !Number.isFinite(raw)) {
      numEl.value = range.value;
      return;
    }
    const v = clamp(raw);
    numEl.value = String(v);
    range.value = String(v);
    emit(v, true);
  });
  wrap.append(range, numEl);
  wrap.setValue = (v) => {
    const c = clamp(Number(v));
    range.value = String(c);
    numEl.value = String(c);
  };
  return wrap;
}


export function charCounter(initialLen, max) {
  const c = _el("div", "rsw-charcount");
  const update = (len) => {
    c.textContent = len + " / " + max;
    c.classList.toggle("rsw-charcount--over", len > max);
  };
  update(Number.isFinite(Number(initialLen)) ? Number(initialLen) : 0);
  c.update = update;
  return c;
}

export function radioGroup(value, options, onChange, name) {
  const group = _el("div", "rsw-radio-group");
  group.setAttribute("role", "radiogroup");
  const gname = name || "radio-" + Math.random().toString(36).slice(2, 8);
  for (const opt of options || []) {
    const isObj = opt && typeof opt === "object";
    const val = isObj ? opt.value : opt;
    const label = isObj ? opt.label : opt;
    const lab = _el("label", "rsw-radio");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = gname;
    input.className = "rsw-radio__input";
    input.value = String(val);
    if (String(val) === String(value)) input.checked = true;
    if (typeof onChange === "function") {
      input.addEventListener("change", () => {
        if (input.checked) onChange(input.value);
      });
    }
    lab.appendChild(input);
    lab.appendChild(_el("span", "rsw-radio__label", label));
    group.appendChild(lab);
  }
  return group;
}
