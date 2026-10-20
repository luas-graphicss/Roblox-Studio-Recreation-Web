export class EventBus {
  constructor() {
    this._listeners = new Map();                          
  }

  on(event, handler) {
    if (typeof event !== "string" || typeof handler !== "function") {
      return () => {};
    }
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  once(event, handler) {
    if (typeof event !== "string" || typeof handler !== "function") {
      return () => {};
    }
    const wrapper = (payload) => {
      this.off(event, wrapper);
      handler(payload);
    };
    return this.on(event, wrapper);
  }

  off(event, handler) {
    const set = this._listeners.get(event);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) this._listeners.delete(event);
  }

  emit(event, payload) {
    const set = this._listeners.get(event);
    if (!set || set.size === 0) return;

    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[RSW] Erro em ouvinte de "${event}":`, err);
      }
    }
  }

  clear() {
    this._listeners.clear();
  }

  listenerCount(event) {
    const set = this._listeners.get(event);
    return set ? set.size : 0;
  }

  eventNames() {
    return [...this._listeners.keys()];
  }

  totalListeners() {
    let n = 0;
    for (const set of this._listeners.values()) n += set.size;
    return n;
  }


  leakReport(threshold = 25) {
    const out = [];
    for (const [event, set] of this._listeners) {
      if (set.size >= threshold) out.push({ event, count: set.size });
    }
    return out.sort((a, b) => b.count - a.count);
  }
}


export const bus = new EventBus();
