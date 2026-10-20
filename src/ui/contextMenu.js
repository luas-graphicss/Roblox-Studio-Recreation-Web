import { createIcon } from "./icons.js";


import { createListenerScope } from "../core/listenerScope.js";

const OPEN_DELAY = 160;                                            
const EDGE = 4;                                           

let activeMenu = null;                                                        

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

export function closeContextMenu() {
  if (activeMenu) {
    activeMenu.destroy();
    activeMenu = null;
  }
}

export function openContextMenu(opts) {
  closeContextMenu();                                    
  const items = (opts && opts.items) || [];
  if (!items.length) return null;
  const ox = (opts && opts.x) || 0;
  const oy = (opts && opts.y) || 0;

  const layers = [];                                           
  const listeners = createListenerScope("contextMenu");
  let disposed = false;

  function removeDeeperThan(depth) {
    while (layers.length > depth + 1) {
      const lyr = layers.pop();
      if (lyr.el.parentNode) lyr.el.parentNode.removeChild(lyr.el);
    }
  }

  function placeLayer(menu, px, py, parentRect) {
    const vw = globalThis.innerWidth || 1024;
    const vh = globalThis.innerHeight || 768;
    const rect = menu.getBoundingClientRect();
    let left = px;
    let top = py;
    if (left + rect.width > vw - EDGE) {

      if (parentRect) left = parentRect.left - rect.width + 2;
      else left = vw - rect.width - EDGE;
    }
    if (left < EDGE) left = EDGE;
    if (top + rect.height > vh - EDGE) top = vh - rect.height - EDGE;
    if (top < EDGE) top = EDGE;
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;

    requestAnimationFrame(() => {
      if (!disposed) menu.classList.add("is-open");
    });
  }

  function buildLayer(itemList, depth) {
    const menu = el("div", "rsw-ctx");
    menu.setAttribute("role", "menu");
    let submenuTimer = 0;
    let openSubItem = null;

    const openSubmenu = (item, row) => {
      removeDeeperThan(depth);
      openSubItem = item;
      const sub = buildLayer(item.submenu, depth + 1);
      const r = row.getBoundingClientRect();
      placeLayer(sub, r.right - 2, r.top - EDGE, r);
    };

    for (const item of itemList) {
      if (!item || item.type === "separator") {
        menu.appendChild(el("div", "rsw-ctx__sep"));
        continue;
      }
      const hasSub = !!(item.submenu && item.submenu.length);
      const row = el("div", "rsw-ctx__item");
      if (item.disabled) row.classList.add("is-disabled");
      if (hasSub) row.classList.add("has-submenu");

      const iconWrap = el("span", "rsw-ctx__icon");
      if (item.icon) iconWrap.appendChild(createIcon(item.icon, 14));
      const labelEl = el("span", "rsw-ctx__label");
      labelEl.textContent = item.label || "";                     
      const accel = el("span", "rsw-ctx__accel");
      if (item.shortcut) accel.textContent = item.shortcut;                 
      row.append(iconWrap, labelEl, accel);
      if (hasSub) row.appendChild(el("span", "rsw-ctx__arrow"));


      row.addEventListener("mouseenter", () => {
        if (submenuTimer) {
          clearTimeout(submenuTimer);
          submenuTimer = 0;
        }
        if (openSubItem && openSubItem !== item) {
          removeDeeperThan(depth);
          openSubItem = null;
        }
        if (item.disabled || !hasSub) return;
        submenuTimer = setTimeout(() => {
          submenuTimer = 0;
          if (!disposed) openSubmenu(item, row);
        }, OPEN_DELAY);
      });

      if (item.disabled) {
        row.addEventListener("click", (e) => e.stopPropagation());
      } else if (hasSub) {
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          if (submenuTimer) {
            clearTimeout(submenuTimer);
            submenuTimer = 0;
          }
          openSubmenu(item, row);
        });
      } else {
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          const fn = item.onSelect;
          closeContextMenu();
          if (typeof fn === "function") {
            try {
              fn();
            } catch (err) {
              console.error("[RSW] Erro em ação de menu:", err);
            }
          }
        });
      }

      menu.appendChild(row);
    }

    document.body.appendChild(menu);
    layers.push({ el: menu, depth });
    return menu;
  }

  const root = buildLayer(items, 0);
  placeLayer(root, ox, oy, null);


  function onDocPointer(e) {
    for (const lyr of layers) if (lyr.el.contains(e.target)) return;
    closeContextMenu();
  }
  function onKey(e) {
    if (e.key === "Escape") closeContextMenu();
  }
  function onBlur() {
    closeContextMenu();
  }
  function onScrollResize() {
    closeContextMenu();
  }


  function onWheelOutside(e) {
    for (const lyr of layers) {
      if (lyr.el.contains(e.target)) return;
    }
    closeContextMenu();
  }



  const deferredPointerTimer = setTimeout(() => {
    if (disposed) return;
    listeners.add(document, "pointerdown", onDocPointer, true);
  }, 0);
  listeners.add(document, "keydown", onKey, true);
  listeners.add(globalThis, "blur", onBlur);
  listeners.add(globalThis, "resize", onScrollResize);
  listeners.add(globalThis, "wheel", onWheelOutside, { passive: true, capture: true });

  const controller = {
    destroy() {
      disposed = true;

      clearTimeout(deferredPointerTimer);
      listeners.disposeAll();
      for (const lyr of layers) {
        if (lyr.el.parentNode) lyr.el.parentNode.removeChild(lyr.el);
      }
      layers.length = 0;
    },
  };
  activeMenu = controller;
  return controller;
}
