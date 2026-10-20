let __seq = 0;
function nextTabId() {
  __seq += 1;
  return `etab_${__seq.toString(36)}`;
}

export class TabManager {
  constructor() {
    this.tabs = [];                                                   
    this.activeId = null;
  }

  get count() {
    return this.tabs.length;
  }

  list() {
    return this.tabs.slice();
  }

  indexOf(id) {
    return this.tabs.findIndex((t) => t.id === id);
  }

  byId(id) {
    return this.tabs.find((t) => t.id === id) || null;
  }

  byInstanceId(instanceId) {
    return this.tabs.find((t) => t.instanceId === instanceId) || null;
  }

  get activeTab() {
    return this.byId(this.activeId);
  }


  open(instance) {
    if (!instance || !instance.id) return { tab: null, created: false };
    const existing = this.byInstanceId(instance.id);
    if (existing) {
      this.activeId = existing.id;
      return { tab: existing, created: false };
    }
    const tab = {
      id: nextTabId(),
      instanceId: instance.id,
      getInstance: () => instance,
      title: instance.name,
      dirty: false,
    };
    this.tabs.push(tab);
    this.activeId = tab.id;
    return { tab, created: true };
  }

  activate(id) {
    if (!this.byId(id)) return null;
    this.activeId = id;
    return this.activeTab;
  }


  close(id) {
    const idx = this.indexOf(id);
    if (idx < 0) return { closed: null, newActive: null, wasActive: false, empty: this.tabs.length === 0 };
    const closed = this.tabs[idx];
    const wasActive = this.activeId === id;

    closed.getInstance = null;
    this.tabs.splice(idx, 1);
    if (wasActive) {

      const neighbor = this.tabs[idx] || this.tabs[idx - 1] || null;
      this.activeId = neighbor ? neighbor.id : null;
    }
    return {
      closed,
      newActive: this.activeTab,
      wasActive,
      empty: this.tabs.length === 0,
    };
  }

  closeByInstanceId(instanceId) {
    const t = this.byInstanceId(instanceId);
    if (!t) return { closed: null, newActive: this.activeTab, wasActive: false, empty: this.tabs.length === 0 };
    return this.close(t.id);
  }


  next() {
    if (this.tabs.length === 0) return null;
    const idx = this.indexOf(this.activeId);
    const nidx = idx < 0 ? 0 : (idx + 1) % this.tabs.length;
    this.activeId = this.tabs[nidx].id;
    return this.activeTab;
  }

  prev() {
    if (this.tabs.length === 0) return null;
    const idx = this.indexOf(this.activeId);
    const pidx = idx < 0 ? 0 : (idx - 1 + this.tabs.length) % this.tabs.length;
    this.activeId = this.tabs[pidx].id;
    return this.activeTab;
  }


  move(fromIndex, toIndex) {
    const n = this.tabs.length;
    if (fromIndex < 0 || fromIndex >= n) return false;
    let to = toIndex;
    if (to < 0) to = 0;
    if (to >= n) to = n - 1;
    if (to === fromIndex) return false;
    const [item] = this.tabs.splice(fromIndex, 1);
    this.tabs.splice(to, 0, item);
    return true;
  }

  setDirty(id, dirty) {
    const t = this.byId(id);
    if (!t) return false;
    const next = !!dirty;
    if (t.dirty === next) return false;
    t.dirty = next;
    return true;
  }

  setDirtyByInstanceId(instanceId, dirty) {
    const t = this.byInstanceId(instanceId);
    if (!t) return false;
    return this.setDirty(t.id, dirty);
  }


  updateTitleByInstanceId(instanceId, title) {
    const t = this.byInstanceId(instanceId);
    if (!t) return false;
    const safe = typeof title === "string" ? title : String(title == null ? "" : title);
    if (t.title === safe) return false;
    t.title = safe;
    return true;
  }
}
