import { computeMove, computeScale, computeRotate } from "./transform.js";
import { commands } from "../core/commands.js";
import { logger } from "../core/logger.js";

const PROP_BY_MODE = Object.freeze({
  move: "Position",
  scale: "Size",
  rotate: "Rotation",
});

function readVec3(instance, prop) {
  const v = instance.getProperty(prop);
  if (!v || typeof v !== "object") return null;
  return { x: Number(v.x), y: Number(v.y), z: Number(v.z) };
}

function valid(instance) {
  return !!instance && typeof instance.getProperty === "function" &&
    typeof instance.setProperty === "function" &&
    (typeof instance.isDestroyed !== "function" || !instance.isDestroyed());
}

export function createTransformSession({ mode, instances, steps, commandManager, prop: propOverride } = {}) {


  const prop = (typeof propOverride === "string" && propOverride) ? propOverride : PROP_BY_MODE[mode];
  const mgr = commandManager || commands;
  const step = steps && typeof steps === "object" ? steps : { move: 0, rotate: 0, scale: 0 };


  const entries = [];
  if (prop && Array.isArray(instances)) {
    for (const inst of instances) {
      if (!valid(inst)) continue;
      const before = readVec3(inst, prop);
      if (!before) continue;
      entries.push({ inst, before, after: { ...before } });
    }
  }

  let active = entries.length > 0;

  function stepFor() {
    if (mode === "move") return Number(step.move) || 0;
    if (mode === "scale") return Number(step.scale) || 0;
    if (mode === "rotate") return Number(step.rotate) || 0;
    return 0;
  }

  function compute(before, input) {
    const s = stepFor();
    const ignore = !!input.ignoreSnap;
    if (mode === "move") return computeMove(before, input.delta || { x: 0, y: 0, z: 0 }, s, ignore);
    if (mode === "scale") return computeScale(before, input.delta || { x: 0, y: 0, z: 0 }, s, ignore);
    if (mode === "rotate") return computeRotate(before, input.axis | 0, Number(input.deg) || 0, s, ignore);
    return null;
  }


  function update(input) {
    if (!active || !input) return false;
    for (const e of entries) {
      if (!valid(e.inst)) {
        cancel();
        return false;
      }
      const after = compute(e.before, input);
      if (!after) continue;                                        
      e.after = after;
      e.inst.setProperty(prop, after);
    }
    return true;
  }


  function commit() {
    if (!active) return false;
    active = false;
    const changed = entries.filter((e) => {
      return e.after && (
        e.after.x !== e.before.x || e.after.y !== e.before.y || e.after.z !== e.before.z
      );
    });
    if (changed.length === 0) return false;

    const snapshot = changed.map((e) => ({
      inst: e.inst,
      before: { ...e.before },
      after: { ...e.after },
    }));

    const apply = (state) => {
      for (const s of snapshot) {
        if (!valid(s.inst)) continue;
        s.inst.setProperty(prop, { ...s[state] });
      }
    };

    const cmd = {
      name: "transform:" + mode,
      do() { apply("after"); },
      undo() { apply("before"); },
    };
    return mgr.execute(cmd);
  }


  function cancel() {
    if (!active) return false;
    active = false;
    for (const e of entries) {
      if (!valid(e.inst)) continue;
      e.inst.setProperty(prop, { ...e.before });
    }
    return true;
  }

  if (!active) {
    logger.warn("createTransformSession: nenhuma instância válida para " + mode + ".");
  }

  return {
    update,
    commit,
    cancel,
    isActive: () => active,
    count: entries.length,
    _entries: entries,
  };
}
