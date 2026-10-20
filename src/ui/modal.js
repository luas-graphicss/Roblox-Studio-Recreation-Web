import { createIcon } from "./icons.js";

const _stack = [];

export function isModalOpen() {
  return _stack.length > 0;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function makeButton(label, kind, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "rsw-btn rsw-btn--" + (kind || "default");
  btn.textContent = String(label == null ? "" : label);
  if (typeof onClick === "function") {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      onClick(e);
    });
  }
  return btn;
}

export function openModal(opts) {
  const o = opts || {};
  const title = o.title || "";
  const width = typeof o.width === "number" ? o.width : 520;
  const className = o.className || "";
  const closeOnBackdrop = o.closeOnBackdrop !== false;
  const showClose = o.showClose !== false;
  const onClose = typeof o.onClose === "function" ? o.onClose : null;


  const previouslyFocusedElement = document.activeElement;

  const overlay = el("div", "rsw-modal-overlay");
  const dialog = el("div", "rsw-modal " + className);
  dialog.style.maxWidth = width + "px";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  if (title) dialog.setAttribute("aria-label", o.ariaLabel || title);

  const header = el("div", "rsw-modal__header");
  const h = el("h2", "rsw-modal__title", title);
  header.appendChild(h);
  let closeBtn = null;
  if (showClose) {
    closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "rsw-modal__close";
    closeBtn.setAttribute("aria-label", "Close");                                   
    closeBtn.appendChild(createIcon("close", 14));
    header.appendChild(closeBtn);
  }

  const bodyEl = el("div", "rsw-modal__body");
  if (o.body instanceof Node) bodyEl.appendChild(o.body);

  const footEl = el("div", "rsw-modal__footer");
  if (o.footer instanceof Node) footEl.appendChild(o.footer);
  else if (Array.isArray(o.footer) && o.footer.some((n) => n instanceof Node)) {


    for (const n of o.footer) if (n instanceof Node) footEl.appendChild(n);
  } else footEl.hidden = true;

  dialog.append(header, bodyEl, footEl);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  let closed = false;
  const handle = { close, overlay, dialog, bodyEl, footEl, headerEl: header };

  function close(result) {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey, true);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    const i = _stack.indexOf(handle);
    if (i >= 0) _stack.splice(i, 1);
    restorePreviousFocus();
    if (onClose) {
      try {
        onClose(result || { reason: "programmatic" });
      } catch (_) {

      }
    }
  }


  function restorePreviousFocus() {
    const target = previouslyFocusedElement;
    if (!target || !target.isConnected) return;
    if (typeof target.focus !== "function") return;
    try {
      target.focus();
    } catch (_) {

    }
  }

  function focusables() {
    return Array.prototype.slice.call(
      dialog.querySelectorAll(
        "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])",
      ),
    ).filter((n) => n.offsetParent !== null || n === document.activeElement);
  }

  function onKey(e) {
    if (_stack[_stack.length - 1] !== handle) return;                      
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close({ reason: "escape" });
      return;
    }
    if (e.key === "Tab") {
      const list = focusables();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  if (closeBtn) closeBtn.addEventListener("click", () => close({ reason: "close" }));
  overlay.addEventListener("mousedown", (e) => {
    if (closeOnBackdrop && e.target === overlay) close({ reason: "backdrop" });
  });
  document.addEventListener("keydown", onKey, true);

  _stack.push(handle);




  const initialFocusables = focusables();
  const first = initialFocusables.find((n) => n !== closeBtn) || initialFocusables[0];
  if (first && typeof first.focus === "function") {
    try {
      first.focus();
    } catch (_) {

    }
  }

  return handle;
}


export function openConfirm(opts) {
  const o = opts || {};
  const title = o.title || "Confirm";                                   
  const message = o.message || "";
  const buttons = Array.isArray(o.buttons) && o.buttons.length
    ? o.buttons
    : [{ label: "OK", value: true, kind: "primary" }];
  return new Promise((resolve) => {
    let done = false;
    let h = null;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
      if (h) h.close({ reason: "button" });
    };
    const body = el("div", "rsw-confirm");
    const msg = el("p", "rsw-confirm__msg");
    msg.textContent = message;
    body.appendChild(msg);
    const foot = el("div", "rsw-modal__btnrow");
    for (const b of buttons) {
      foot.appendChild(makeButton(b.label, b.kind, () => finish(b.value)));
    }
    h = openModal({
      title,
      body,
      footer: foot,
      width: o.width || 440,
      closeOnBackdrop: o.closeOnBackdrop !== false,
      onClose: () => {
        if (!done) {
          done = true;
          resolve(null);
        }
      },
    });
  });
}


export function openPrompt(opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    let done = false;
    let h = null;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
      if (h) h.close({ reason: "button" });
    };
    const body = el("div", "rsw-form");
    if (o.label) {
      const lab = el("label", "rsw-field__label", o.label);
      body.appendChild(lab);
    }
    const input = document.createElement("input");
    input.type = "text";
    input.className = "rsw-input";
    input.value = o.value != null ? String(o.value) : "";
    input.placeholder = o.placeholder || "";
    input.setAttribute("spellcheck", "false");
    input.maxLength = typeof o.maxLength === "number" ? o.maxLength : 200;
    body.appendChild(input);
    const err = el("p", "rsw-field__error");
    err.hidden = true;
    body.appendChild(err);

    const submit = () => {
      let val = input.value;
      if (typeof o.sanitize === "function") val = o.sanitize(val);
      if (typeof o.validate === "function") {
        const msg = o.validate(val);
        if (msg) {
          err.textContent = msg;
          err.hidden = false;
          return;
        }
      }
      finish(val);
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });

    const foot = el("div", "rsw-modal__btnrow");
    foot.appendChild(makeButton(o.cancelLabel || "Cancel", "ghost", () => finish(null)));
    foot.appendChild(makeButton(o.okLabel || "OK", "primary", submit));

    h = openModal({
      title: o.title || "",
      body,
      footer: foot,
      width: o.width || 420,
      onClose: () => {
        if (!done) {
          done = true;
          resolve(null);
        }
      },
    });
  });
}


export function openInfo(opts) {
  const o = opts || {};
  const body = el("div", "rsw-info");
  if (o.content instanceof Node) body.appendChild(o.content);
  else {
    const p = el("p", "rsw-info__msg");
    p.textContent = o.content != null ? String(o.content) : "";
    body.appendChild(p);
  }
  const foot = el("div", "rsw-modal__btnrow");
  let h = null;
  foot.appendChild(makeButton(o.okLabel || "OK", "primary", () => h && h.close({ reason: "button" })));
  h = openModal({ title: o.title || "", body, footer: foot, width: o.width || 460 });
  return h;
}

export { el as _el };
