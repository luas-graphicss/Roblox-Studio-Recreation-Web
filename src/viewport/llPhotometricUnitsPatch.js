import {
  registerLocalLightFlag,
  isLocalLightFlagActive,
  resolveLocalLightFlag,
  setLocalLightFlagOverride,
} from "../lighting/llFeatureFlags.js";
import { isLocalLightBaselineFrozen } from "../lighting/llBaselineFreezeFlag.js";
import { isLocalLightTechnology } from "../lighting/llTechnologyGate.js";
import { llQa } from "../lighting/llTelemetry.js";
import {
  DEFAULT_INTENSITY_UNITS,
  INTENSITY_SOURCES,
  INTENSITY_UNITS,
  INTENSITY_UNITS_LIST,
  clampIntensityValue,
  isAbsoluteIntensityUnit,
  resolveIntensityUnits,
  resolveLocalLightIntensity,
} from "../lighting/llUnitsCore.js";
import {
  IES_BRIGHTNESS_REASONS,
  IES_BRIGHTNESS_SCALE_DEFAULT,
  resolveIesBrightness,
} from "../lighting/llIesBrightnessCore.js";

export const PHASE_ID = "LL-F3";
export const INTENSITY_UNITS_FLAG_ID = "LlIntensityUnits";


export const LL_INTENSITY_PROPERTIES = Object.freeze({
  INTENSITY: "Intensity",
  INTENSITY_UNITS: "IntensityUnits",
  USE_IES_BRIGHTNESS: "UseIESBrightness",
  IES_BRIGHTNESS_SCALE: "IESBrightnessScale",
});


export const DEFAULT_INTENSITY_VALUE = 0;


const LEGACY_INTENSITY_SOURCES = Object.freeze([
  INTENSITY_SOURCES.LEGACY_BRIGHTNESS,
  INTENSITY_SOURCES.LIGHT_PRESET,
]);

registerLocalLightFlag({
  id: INTENSITY_UNITS_FLAG_ID,
  phase: PHASE_ID,
  description:
    "IntensityUnits per light (unitless / lumens / candela / ev) plus UseIESBrightness, converted by the REAL aperture of the light",
  defaultsByTier: { fraco: false, medio: true, forte: true },
});


export function registerLocalLightPhotometricUnitsPhase(options) {
  const settings = options && typeof options === "object" ? options : {};
  const resolveIesProfile =
    typeof settings.resolveIesProfile === "function" ? settings.resolveIesProfile : null;


  llQa.setTextureUnits(PHASE_ID, 0);

  let absoluteLightCount = 0;
  let iesDrivenLightCount = 0;
  let legacyLightCount = 0;




  function isPhaseActive(context) {
    const frame = context && typeof context === "object" ? context : {};
    if (!isLocalLightTechnology(frame.technology)) return false;
    if (isLocalLightBaselineFrozen(frame.tier)) return false;
    return isLocalLightFlagActive(INTENSITY_UNITS_FLAG_ID, frame.tier);
  }

  function iesBrightnessFor(authored) {
    if (authored.useIesBrightness !== true) {
      return resolveIesBrightness({ useIesBrightness: false, scale: authored.iesBrightnessScale });
    }
    const profile = resolveIesProfile ? resolveIesProfile(authored.iesProfileRef) : null;
    return resolveIesBrightness({
      useIesBrightness: true,
      profile,
      scale: authored.iesBrightnessScale,
    });
  }

  const phase = {
    phaseId: PHASE_ID,
    flagId: INTENSITY_UNITS_FLAG_ID,
    properties: LL_INTENSITY_PROPERTIES,
    unitsList: INTENSITY_UNITS_LIST,
    iesResolverWired: resolveIesProfile !== null,

    setFlag(value) {
      return setLocalLightFlagOverride(INTENSITY_UNITS_FLAG_ID, value);
    },

    isActive(context) {
      return isPhaseActive(context);
    },


    resolveCandela(light, context) {
      const authored = light && typeof light === "object" ? light : {};
      const legacyCandela = Number(authored.legacyCandela) || 0;
      if (!isPhaseActive(context)) {
        legacyLightCount++;
        return {
          candela: legacyCandela,
          units: DEFAULT_INTENSITY_UNITS,
          source: INTENSITY_SOURCES.LEGACY_BRIGHTNESS,
          iesEnabled: false,
          iesReason: IES_BRIGHTNESS_REASONS.PROPERTY_OFF,
          changed: false,
        };
      }

      const iesBrightness = iesBrightnessFor(authored);
      const decision = resolveLocalLightIntensity({
        kind: authored.kind,
        angleDeg: authored.angleDeg,
        brightness: authored.brightness,
        presetLumens: authored.presetLumens,
        intensity: authored.intensity,
        intensityUnits: authored.intensityUnits,
        iesBrightness,
      });


      const legacyBranch = LEGACY_INTENSITY_SOURCES.indexOf(decision.source) !== -1;
      if (legacyBranch) legacyLightCount++;
      else if (decision.source === INTENSITY_SOURCES.IES_BRIGHTNESS) iesDrivenLightCount++;
      else absoluteLightCount++;

      return {
        candela: legacyBranch ? legacyCandela : decision.candela,
        units: decision.units,
        source: decision.source,
        iesEnabled: iesBrightness.enabled === true,
        iesReason: iesBrightness.reason,
        changed: !legacyBranch,
      };
    },


    sanitizeUnits(rawUnits) {
      return resolveIntensityUnits(rawUnits);
    },

    sanitizeIntensity(rawValue, rawUnits) {
      const units = resolveIntensityUnits(rawUnits);
      return isAbsoluteIntensityUnit(units) ? clampIntensityValue(rawValue, units) : 0;
    },

    resetCounters() {
      absoluteLightCount = 0;
      iesDrivenLightCount = 0;
      legacyLightCount = 0;
      return { absoluteLights: 0, iesDrivenLights: 0, legacyLights: 0 };
    },


    status(context) {
      const frame = context && typeof context === "object" ? context : {};
      const flagDecision = resolveLocalLightFlag(INTENSITY_UNITS_FLAG_ID, { tier: frame.tier });
      const baselineFrozen = isLocalLightBaselineFrozen(frame.tier);
      const technologyAllowed = isLocalLightTechnology(frame.technology);
      const status = {
        phase: PHASE_ID,
        flag: INTENSITY_UNITS_FLAG_ID,
        tier: frame.tier || null,
        technologyAllowed,
        flagOn: flagDecision.active,
        flagToken: flagDecision.token,
        flagSource: flagDecision.source,
        baselineFrozen,
        active: isPhaseActive(frame),
        units: INTENSITY_UNITS_LIST,
        defaultUnits: DEFAULT_INTENSITY_UNITS,
        iesResolverWired: resolveIesProfile !== null,
        absoluteLights: absoluteLightCount,
        iesDrivenLights: iesDrivenLightCount,
        legacyLights: legacyLightCount,
        glsl: "none",
        textureUnits: 0,
        pending: !technologyAllowed
          ? "Technology outside ShadowMap / Future keeps the legacy candela byte for byte"
          : resolveIesProfile === null
            ? "UseIESBrightness is inert: no IES profile resolver was injected"
            : "LM-63 candela multiplier is not exposed by parseIesText (IL-F26): LL-F3 assumes multiplier 1",
      };
      llQa.setPhase(PHASE_ID, {
        flagOn: flagDecision.active,
        technologyAllowed,
        baselineFrozen,
        absoluteLights: absoluteLightCount,
        iesDrivenLights: iesDrivenLightCount,
        legacyLights: legacyLightCount,
        iesResolverWired: resolveIesProfile !== null,
      });
      return status;
    },
  };

  llQa.setPhase(PHASE_ID, {
    registered: true,
    flag: INTENSITY_UNITS_FLAG_ID,
    glsl: "none",
    textureUnits: 0,
    units: INTENSITY_UNITS_LIST,
    properties: [
      LL_INTENSITY_PROPERTIES.INTENSITY,
      LL_INTENSITY_PROPERTIES.INTENSITY_UNITS,
      LL_INTENSITY_PROPERTIES.USE_IES_BRIGHTNESS,
      LL_INTENSITY_PROPERTIES.IES_BRIGHTNESS_SCALE,
    ],
  });

  return phase;
}

export { INTENSITY_UNITS };
