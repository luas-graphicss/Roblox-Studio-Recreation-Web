import { bus } from "./eventBus.js";
import { store } from "./state.js";
import { Events } from "../datamodel/instance.js";

class SelectionManager {
  constructor() {
    this._items = [];                                     
    this._anchor = null;                                            
    this._wired = false;
  }


  wire() {
    if (this._wired) return;
    this._wired = true;
    bus.on(Events.Destroying, ({ instance }) => {


      const wasAnchor = this._anchor === instance;
      if (wasAnchor) this._anchor = null;
      if (!this._items.includes(instance)) return;
      this._items = this._items.filter((i) => i !== instance);
      if (wasAnchor) {
        this._anchor = this._items[this._items.length - 1] || null;
      }
      this._emit();
    });
  }

  get() {
    return this._items.slice();
  }
  ids() {
    return this._items.map((i) => i.id);
  }
  isSelected(inst) {
    return this._items.includes(inst);
  }
  getAnchor() {
    return this._anchor;
  }

  _valid(inst) {
    return (
      inst &&
      inst.__isInstance === true &&
      typeof inst.isDestroyed === "function" &&
      !inst.isDestroyed()
    );
  }

  clear() {
    if (this._items.length === 0) return;
    this._items = [];
    this._anchor = null;
    this._emit();
  }


  selectSingle(inst) {
    if (!this._valid(inst)) return;
    this._items = [inst];
    this._anchor = inst;
    this._emit();
  }


  toggle(inst) {
    if (!this._valid(inst)) return;
    this._items = this._items.includes(inst)
      ? this._items.filter((i) => i !== inst)
      : [...this._items, inst];
    this._anchor = inst;
    this._emit();
  }


  _clean(items) {
    const seen = new Set();
    const out = [];
    for (const i of items || []) {
      if (!this._valid(i) || seen.has(i)) continue;
      seen.add(i);
      out.push(i);
    }
    return out;
  }


  setRange(items) {
    this._items = this._clean(items);
    this._emit();
  }


  set(items) {
    this._items = this._clean(items);
    this._anchor = this._items[this._items.length - 1] || null;
    this._emit();
  }

  _emit() {
    const ids = this.ids();
    try {
      store.set("selection", ids);                                           
    } catch (_) {

    }
    bus.emit("selection:changed", { items: this.get(), ids });
  }
}

export const selection = new SelectionManager();
