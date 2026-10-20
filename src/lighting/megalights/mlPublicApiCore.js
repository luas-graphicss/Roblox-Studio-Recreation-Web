export const PUBLIC_API_VERSION = 1;

export const SETTING_KIND = Object.freeze({
  ignitionFlag: "ignitionFlag",
  tierConstant: "tierConstant",
  contractConstant: "contractConstant",
});


export const IGNITION_VALUES = Object.freeze([null, true, false]);

export const IGNITION_VALUE_LABELS = Object.freeze({
  auto: "AUTO (the tier decides)",
  forcedOn: "ON (forced on this machine)",
  forcedOff: "OFF (forced off this machine)",
});

export const WRITE_REFUSAL = Object.freeze({
  none: "none",
  unknownKey: "no setting with that key exists in this surface",
  readOnly: "this setting is a constant of the tier or of the contract, not a user setting",
  notTriState:
    "an ignition setting accepts exactly null (AUTO), true (forced on) or false (forced off): any other value would silently disable the feature on every machine",
});

function labelForIgnitionValue(value) {
  if (value === true) return IGNITION_VALUE_LABELS.forcedOn;
  if (value === false) return IGNITION_VALUE_LABELS.forcedOff;
  return IGNITION_VALUE_LABELS.auto;
}


export function cvarNameForFlagId(flagId) {
  const name = typeof flagId === "string" ? flagId : "";
  const withoutPrefix = name.indexOf("MegaLights") === 0 ? name.slice("MegaLights".length) : name;
  return "r.MegaLights." + (withoutPrefix || name);
}


export function isIgnitionValue(value) {
  return value === null || value === true || value === false;
}


export function meansAuto(value) {
  return value === null;
}


export function describeIgnitionSetting(flag) {
  const source = flag || {};
  const override = source.override === undefined ? null : source.override;
  return {
    key: source.id,
    kind: SETTING_KIND.ignitionFlag,
    cvar: cvarNameForFlagId(source.id),
    phase: source.phase || null,
    description: source.description || "",
    value: override,
    valueLabel: labelForIgnitionValue(override),
    isAuto: meansAuto(override),

    resolvedOn: source.on === true,
    resolvedMode: source.mode || null,
    allowedValues: IGNITION_VALUES,
    writable: true,
  };
}

function describeConstant(kind, key, value, description) {
  return {
    key,
    kind,
    cvar: null,
    phase: null,
    description,
    value,
    valueLabel: String(value),
    isAuto: false,
    resolvedOn: null,
    resolvedMode: null,
    allowedValues: null,
    writable: false,
  };
}







export function buildPublicApiSurface(request) {
  const input = request || {};
  const flags = Array.isArray(input.flags) ? input.flags : [];
  const tierDefaults = input.tierDefaults && typeof input.tierDefaults === "object" ? input.tierDefaults : {};
  const contractConstants =
    input.contractConstants && typeof input.contractConstants === "object" ? input.contractConstants : {};

  const settings = flags
    .filter((flag) => flag && typeof flag.id === "string")
    .map(describeIgnitionSetting);

  Object.keys(tierDefaults).forEach((key) => {
    settings.push(
      describeConstant(
        SETTING_KIND.tierConstant,
        key,
        tierDefaults[key],
        "decided by the GPU tier: change the tier, not this value",
      ),
    );
  });
  Object.keys(contractConstants).forEach((key) => {
    settings.push(
      describeConstant(
        SETTING_KIND.contractConstant,
        key,
        contractConstants[key],
        "frozen by the pipeline contract: every phase agreed on it",
      ),
    );
  });

  const writableSettings = settings.filter((setting) => setting.writable);
  return {
    version: PUBLIC_API_VERSION,
    tier: input.tierName || null,
    settings,
    counts: {
      total: settings.length,
      writable: writableSettings.length,
      readOnly: settings.length - writableSettings.length,
      auto: writableSettings.filter((setting) => setting.isAuto).length,
      forcedOn: writableSettings.filter((setting) => setting.value === true).length,
      forcedOff: writableSettings.filter((setting) => setting.value === false).length,
    },
  };
}


export function findSetting(surface, key) {
  const settings = surface && Array.isArray(surface.settings) ? surface.settings : [];
  return settings.filter((setting) => setting.key === key)[0] || null;
}


export function validateSettingWrite(request) {
  const input = request || {};
  const setting = findSetting(input.surface, input.key);
  if (!setting) {
    return { accepted: false, refusal: WRITE_REFUSAL.unknownKey, key: input.key, value: input.value };
  }
  if (!setting.writable) {
    return { accepted: false, refusal: WRITE_REFUSAL.readOnly, key: input.key, value: input.value };
  }
  if (!isIgnitionValue(input.value)) {
    return { accepted: false, refusal: WRITE_REFUSAL.notTriState, key: input.key, value: input.value };
  }
  return { accepted: true, refusal: WRITE_REFUSAL.none, key: input.key, value: input.value };
}


export function auditSettingRoundTrip(request) {
  const input = request || {};
  const surface = input.surface || { settings: [] };
  const readValue = typeof input.readValue === "function" ? input.readValue : () => undefined;
  const rows = (surface.settings || [])
    .filter((setting) => setting.writable)
    .map((setting) => {
      const readBack = readValue(setting.key);
      const autoStayedAuto = setting.isAuto ? meansAuto(readBack) : true;
      return {
        key: setting.key,
        written: setting.value,
        readBack,
        roundTrips: readBack === setting.value,
        autoStayedAuto,
      };
    });
  const brokenRows = rows.filter((row) => !row.roundTrips || !row.autoStayedAuto);
  return {
    rows,
    total: rows.length,
    roundTripCount: rows.length - brokenRows.length,
    brokenKeys: brokenRows.map((row) => row.key),
    everySettingRoundTrips: brokenRows.length === 0,
  };
}
