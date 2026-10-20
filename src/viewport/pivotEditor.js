import { bus } from "../core/eventBus.js";

let _active = false;

export function isPivotEditing() {
  return _active === true;
}

export function enterPivotEdit() {
  if (_active) return false;
  _active = true;
  bus.emit("pivot:modeChanged", { active: true });
  return true;
}

export function exitPivotEdit() {
  if (!_active) return false;
  _active = false;
  bus.emit("pivot:modeChanged", { active: false });
  return true;
}

export function togglePivotEdit() {
  return _active ? exitPivotEdit() : enterPivotEdit();
}


export function wirePivotEditShortcuts(target) {
  const node = target || (typeof document !== "undefined" ? document : null);
  if (!node || typeof node.addEventListener !== "function") return () => {};
  const onKey = (e) => {
    if (!_active) return;
    if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      exitPivotEdit();
    }
  };
  node.addEventListener("keydown", onKey);
  return () => node.removeEventListener("keydown", onKey);
}
