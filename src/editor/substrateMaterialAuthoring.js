import { commands } from "../core/commands.js";
import { selection } from "../core/selection.js";
import { store } from "../core/state.js";
import { getService } from "../datamodel/index.js";
import { parseSubstrateMaterial } from "../viewport/substrateAuthoringBridge.js";
import { createSubstrateSourceEdit } from "./substrateSourceEdits.js";

export function selectedSubstrateTargets() {
  return selection
    .get()
    .filter(
      (instance) =>
        !instance.isDestroyed() && instance.hasProperty("SubstrateMaterial"),
    );
}

export function readSubstrateTargetSource(instance) {
  const source = instance?.getProperty("SubstrateMaterial") || "";
  if (source) return source;
  const appearance = instance
    ?.getChildren()
    .find((child) => child.className === "SurfaceAppearance");
  return appearance?.getProperty("SubstrateMaterial") || "";
}

export function applySubstrateSource(
  source,
  targets = selectedSubstrateTargets(),
) {
  const parsed = parseSubstrateMaterial(source);
  if (parsed.error) return { ok: false, reason: parsed.error };
  const edit = createSubstrateSourceEdit(source, targets);
  if (!edit.ok || !edit.changed) {
    return { ok: edit.ok, changed: false, count: edit.count, reason: edit.reason };
  }
  const ok = commands.execute(edit.command);
  return {
    ok,
    changed: ok,
    count: edit.count,
    reason: ok ? null : "The material command was refused.",
  };
}

export function readSubstrateRenderingSetting() {
  const lighting = getService(store.getDataModel(), "Lighting");
  return {
    value: lighting?.getProperty("SubstrateEnabled") ?? null,
    technology: lighting?.getProperty("Technology") ?? null,
  };
}

export function setSubstrateRenderingSetting(value) {
  if (value !== null && value !== true && value !== false)
    return { ok: false, reason: "Use AUTO, ON or OFF." };
  const lighting = getService(store.getDataModel(), "Lighting");
  if (!lighting) return { ok: false, reason: "Lighting service unavailable." };
  const previous = lighting.getProperty("SubstrateEnabled");
  if (previous === value) return { ok: true, changed: false };
  const ok = commands.execute({
    name: "Set Substrate rendering",
    do() {
      lighting.setProperty("SubstrateEnabled", value);
      return true;
    },
    undo() {
      lighting.setProperty("SubstrateEnabled", previous);
    },
  });
  return { ok, changed: ok };
}
