import { bus } from "../core/eventBus.js";

export const EMULATION_DEVICES = Object.freeze([
  Object.freeze({ id: "desktop", label: "Desktop", touchDefault: false, gamepad: false, sizes: Object.freeze([
    Object.freeze({ id: "1920x1080", label: "1920x1080", w: 1920, h: 1080 }),
  ]) }),
  Object.freeze({ id: "tablet", label: "Tablet", touchDefault: true, gamepad: false, sizes: Object.freeze([
    Object.freeze({ id: "ipad", label: "1024x768 (iPad)", w: 1024, h: 768 }),
    Object.freeze({ id: "ipad-retina", label: "2048x1536 (iPad Retina)", w: 2048, h: 1536 }),
  ]) }),
  Object.freeze({ id: "phone", label: "Phone", touchDefault: true, gamepad: false, sizes: Object.freeze([
    Object.freeze({ id: "iphone-se", label: "375x667 (iPhone SE)", w: 375, h: 667 }),
    Object.freeze({ id: "iphone-14", label: "390x844 (iPhone 14)", w: 390, h: 844 }),
    Object.freeze({ id: "android", label: "360x800 (Android)", w: 360, h: 800 }),
  ]) }),
  Object.freeze({ id: "console", label: "Console", touchDefault: false, gamepad: true, sizes: Object.freeze([
    Object.freeze({ id: "console-1080", label: "1920x1080 (Gamepad)", w: 1920, h: 1080 }),
  ]) }),
]);

const state = { device: "desktop", sizeId: "1920x1080", orientation: "landscape", touch: false };

function deviceById(id) {
  return EMULATION_DEVICES.find((d) => d.id === id) || null;
}

function emitChanged(reason) {
  bus.emit("emulation:changed", { device: state.device, sizeId: state.sizeId, orientation: state.orientation, touch: state.touch, reason });
}

export const emulation = {
  getState: () => ({ device: state.device, sizeId: state.sizeId, orientation: state.orientation, touch: state.touch }),
  getDevice: () => deviceById(state.device),

  setDevice(id) {
    const dev = deviceById(id);
    if (!dev || state.device === dev.id) return false;
    state.device = dev.id;
    state.sizeId = dev.sizes[0].id;
    state.touch = dev.touchDefault === true;
    emitChanged("device");
    return true;
  },

  setScreenSize(sizeId) {
    const dev = deviceById(state.device);
    const size = dev ? dev.sizes.find((s) => s.id === sizeId) : null;
    if (!size || state.sizeId === size.id) return false;
    state.sizeId = size.id;
    emitChanged("size");
    return true;
  },

  setOrientation(o) {
    const v = o === "portrait" ? "portrait" : "landscape";
    if (state.orientation === v) return false;
    state.orientation = v;
    emitChanged("orientation");
    bus.emit("emulation:orientationChanged", { orientation: v, resolution: this.getResolution() });
    return true;
  },

  setTouch(v) {
    const b = v === true;
    if (state.touch === b) return false;
    state.touch = b;
    emitChanged("touch");
    return true;
  },

  isTouchEnabled: () => state.touch === true,

  getResolution() {
    const dev = deviceById(state.device);
    const size = (dev && dev.sizes.find((s) => s.id === state.sizeId)) || { w: 1920, h: 1080 };
    const big = Math.max(size.w, size.h);
    const small = Math.min(size.w, size.h);
    return state.orientation === "portrait" ? { w: small, h: big } : { w: big, h: small };
  },

  isFrameWanted: () => state.device !== "desktop" || state.touch === true,
};
