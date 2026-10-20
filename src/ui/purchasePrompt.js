import { createIcon } from "./icons.js";


const ROBUX_ICON_NAME = "coin";
const ROBUX_ICON_SIZE = 14;

function fillWithRobuxLabel(targetNode, labelText) {
  targetNode.replaceChildren(
    createIcon(ROBUX_ICON_NAME, ROBUX_ICON_SIZE),
    document.createTextNode(labelText),
  );
  return targetNode;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function fmt(n) {
  return Math.max(0, Math.round(Number(n) || 0)).toLocaleString("en-US");
}

export function openPurchasePrompt(opts) {
  const o = opts || {};
  let settled = false;
  let autoTimer = 0;

  const overlay = el("div", "rsw-buy");
  const dialog = el("div", "rsw-buy__dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", String(o.name || "Purchase"));
  overlay.appendChild(dialog);

  const destroy = () => {
    if (autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = 0;
    }
    overlay.remove();
  };

  const decide = (buy) => {
    if (settled) return;
    settled = true;
    destroy();
    if (typeof o.onDecision === "function") o.onDecision(buy === true);
  };

  const header = el("div", "rsw-buy__header");
  header.appendChild(el("span", "rsw-buy__kind", String(o.kindLabel || "Purchase")));
  const closeBtn = el("button", "rsw-buy__close");
  closeBtn.appendChild(createIcon("close", 13));
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Fechar");
  closeBtn.addEventListener("click", () => decide(false));
  header.appendChild(closeBtn);
  dialog.appendChild(header);

  const body = el("div", "rsw-buy__body");
  dialog.appendChild(body);

  if (o.alreadyOwned === true) {
    const ownIcon = el("div", "rsw-buy__own-icon");
    ownIcon.appendChild(createIcon("check", 22));
    body.appendChild(ownIcon);
    body.appendChild(el("div", "rsw-buy__own", "You already own this!"));
    autoTimer = setTimeout(() => decide(false), 2000);
  } else {
    const row = el("div", "rsw-buy__itemrow");
    const iconWrap = el("div", "rsw-buy__icon");
    if (o.iconUrl) {
      const img = document.createElement("img");
      img.className = "rsw-buy__icon-img";
      img.alt = "";
      img.addEventListener("error", () => {
        img.remove();
        iconWrap.appendChild(el("span", "rsw-buy__icon-initials", String(o.iconInitials || "?")));
      });
      img.src = String(o.iconUrl);
      iconWrap.appendChild(img);
    } else {
      iconWrap.appendChild(el("span", "rsw-buy__icon-initials", String(o.iconInitials || "?")));
    }
    row.appendChild(iconWrap);
    const info = el("div", "rsw-buy__info");
    info.appendChild(el("div", "rsw-buy__name", String(o.name || "Item")));
    if (o.description) info.appendChild(el("div", "rsw-buy__desc", String(o.description)));
    row.appendChild(info);
    body.appendChild(row);

    const price = Math.max(0, Math.round(Number(o.price) || 0));
    const balance = Math.max(0, Math.round(Number(o.balance) || 0));

    const priceRow = el("div", "rsw-buy__pricerow");
    const priceEl = fillWithRobuxLabel(
      el("span", "rsw-buy__price"),
      " " + (price === 0 ? "Free" : fmt(price)),
    );
    priceRow.appendChild(priceEl);
    body.appendChild(priceRow);

    const balEl = fillWithRobuxLabel(
      el("div", "rsw-buy__balance"),
      " Your balance: " + fmt(balance),
    );
    body.appendChild(balEl);

    const insufficient = balance < price;
    if (insufficient) {
      const warnRow = el("div", "rsw-buy__warnrow");
      warnRow.appendChild(el("span", "rsw-buy__warn", "Insufficient Robux"));
      const more = el("button", "rsw-buy__link", "Get More Robux");
      more.type = "button";
      more.title = "Simulado \u2014 sem fun\u00e7\u00e3o nesta parte";
      warnRow.appendChild(more);
      body.appendChild(warnRow);
    }

    const foot = el("div", "rsw-buy__footer");
    const cancelBtn = el("button", "rsw-buy__btn rsw-buy__btn--cancel", "Cancel");
    cancelBtn.type = "button";
    cancelBtn.addEventListener("click", () => decide(false));
    const buyBtn = el("button", "rsw-buy__btn rsw-buy__btn--buy", "Buy");
    buyBtn.type = "button";
    buyBtn.disabled = insufficient;
    buyBtn.addEventListener("click", () => decide(true));
    foot.append(cancelBtn, buyBtn);
    dialog.appendChild(foot);
  }

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("is-open"));

  return {
    close(silent) {
      if (silent === true) {
        settled = true;
        destroy();
        return;
      }
      decide(false);
    },
  };
}
