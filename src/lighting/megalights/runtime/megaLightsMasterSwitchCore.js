export const MASTER_SWITCH_STATE = Object.freeze({
  on: "on",
  off: "off",
  auto: "auto",
});


export const MASTER_SWITCH_READING = Object.freeze({
  on: "on",
  off: "off",
  auto: "auto",
  mixed: "mixed",
});

export const MASTER_ENABLE_FLAG_ID = "MegaLightsEnabled";
export const MASTER_BASELINE_FLAG_ID = "MegaLightsBaseline";


export const MASTER_SWITCH_LABELS = Object.freeze({
  on: "MEGALIGHTS: ON",
  off: "MEGALIGHTS: OFF",
  auto: "MEGALIGHTS: AUTO",
  mixed: "MEGALIGHTS: MIXED",
});


export const MASTER_SWITCH_DESCRIPTIONS = Object.freeze({
  on:
    "every MegaLights flag is FORCED ON and the baseline veto is lowered: the whole graph runs and, where a phase injects GLSL, the shared lighting program is recompiled with it",
  off:
    "the baseline veto is RAISED and every MegaLights flag is vetoed: no pass executes, no patch is injected and the frame is the legacy three.js lighting, byte for byte",
  auto:
    "every flag is back to AUTO: the GPU tier decides, which is the resting state of the bench (weak tier starts with MegaLights off)",
  mixed:
    "single flags were edited by hand, so the system is neither fully on nor fully off: one click on the button below decides it",
});

function uniqueFlagIds(flagIds) {
  if (!Array.isArray(flagIds)) return [];
  const collected = [];
  flagIds.forEach((value) => {
    const flagId = typeof value === "string" ? value.trim() : "";
    if (flagId && collected.indexOf(flagId) === -1) collected.push(flagId);
  });
  return collected;
}


export function isMasterFlagId(flagId) {
  return flagId === MASTER_ENABLE_FLAG_ID || flagId === MASTER_BASELINE_FLAG_ID;
}


export function masterOverridesFor(requestedState, flagIds) {
  const registeredFlagIds = uniqueFlagIds(flagIds);
  const overrides = {};

  if (requestedState === MASTER_SWITCH_STATE.auto) {
    registeredFlagIds.forEach((flagId) => {
      overrides[flagId] = null;
    });
    overrides[MASTER_ENABLE_FLAG_ID] = null;
    overrides[MASTER_BASELINE_FLAG_ID] = null;
    return overrides;
  }

  const wantsSystemOn = requestedState === MASTER_SWITCH_STATE.on;
  registeredFlagIds.forEach((flagId) => {
    if (isMasterFlagId(flagId)) return;
    overrides[flagId] = wantsSystemOn;
  });
  overrides[MASTER_ENABLE_FLAG_ID] = wantsSystemOn;



  overrides[MASTER_BASELINE_FLAG_ID] = !wantsSystemOn;
  return overrides;
}







export function readMasterStateFrom(flags) {
  const list = Array.isArray(flags) ? flags : [];
  if (list.length === 0) return MASTER_SWITCH_READING.mixed;

  const overrideByFlagId = {};
  const registeredFlagIds = [];
  list.forEach((flag) => {
    const flagId = flag && typeof flag.id === "string" ? flag.id : "";
    if (!flagId) return;
    registeredFlagIds.push(flagId);
    overrideByFlagId[flagId] = flag.override === undefined ? null : flag.override;
  });
  if (registeredFlagIds.length === 0) return MASTER_SWITCH_READING.mixed;



  const orderedCandidates = [
    MASTER_SWITCH_STATE.off,
    MASTER_SWITCH_STATE.on,
    MASTER_SWITCH_STATE.auto,
  ];
  for (const candidate of orderedCandidates) {
    const expected = masterOverridesFor(candidate, registeredFlagIds);
    const everyFlagAgrees = Object.keys(expected).every((flagId) => {

      if (!Object.prototype.hasOwnProperty.call(overrideByFlagId, flagId)) return true;
      return overrideByFlagId[flagId] === expected[flagId];
    });
    if (everyFlagAgrees) return candidate;
  }
  return MASTER_SWITCH_READING.mixed;
}


export function nextToggleState(reading) {
  return reading === MASTER_SWITCH_READING.off
    ? MASTER_SWITCH_STATE.on
    : MASTER_SWITCH_STATE.off;
}


export function describeMasterState(reading) {
  const key = MASTER_SWITCH_READING[reading] ? reading : MASTER_SWITCH_READING.mixed;
  return {
    reading: key,
    label: MASTER_SWITCH_LABELS[key],
    description: MASTER_SWITCH_DESCRIPTIONS[key],
  };
}


export function summarizeMasterOverrides(overrides) {
  const map = overrides && typeof overrides === "object" ? overrides : {};
  const flagIds = Object.keys(map);
  return {
    total: flagIds.length,
    forcedOn: flagIds.filter((flagId) => map[flagId] === true).length,
    vetoed: flagIds.filter((flagId) => map[flagId] === false).length,
    handedToTier: flagIds.filter((flagId) => map[flagId] === null).length,
  };
}
