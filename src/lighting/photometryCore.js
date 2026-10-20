export const SUN_ZENITH_LUX = 88000;                                          
export const SUN_HORIZON_LUX = 400;                                
export const SKY_ZENITH_LUX = 16000;                                 
export const SKY_HORIZON_LUX = 800;                                       
export const MOON_FULL_LUX = 0.32;                    
export const NIGHT_SKY_LUX = 0.3;                                      
export const TWILIGHT_END_DEG = -6;                                     
export const BRIGHTNESS_STOPS_MIN = -3;
export const BRIGHTNESS_STOPS_MAX = 2.5;

export const EV100_PRESETS = Object.freeze({ noon: 15, overcast: 12, interior: 7, night: -2 });


export const SUN_BASE = 1.1;
export const SKY_BASE = 0.85;
export const AMB_BASE = 0.8;

function num(v, dft) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dft;
}
function clampNum(v, lo, hi, dft) {
  const n = num(v, dft);
  return n < lo ? lo : n > hi ? hi : n;
}


export function ev100FromLux(lux) {
  return Math.log2(Math.max(num(lux, 0), 1e-6) / 2.5);
}
export function luxFromEv100(ev) {
  return 2.5 * Math.pow(2, clampNum(ev, -20, 30, 0));
}

export function ev100FromNits(nits) {
  return Math.log2(Math.max(num(nits, 0), 1e-6) * 8);
}
export function nitsFromEv100(ev) {
  return Math.pow(2, clampNum(ev, -20, 30, 0)) * 0.125;
}

export function exposureForEv100(ev) {
  return 1 / (1.2 * Math.pow(2, clampNum(ev, -20, 30, 0)));
}

function solidAngleSr(coneHalfDeg) {
  const half = clampNum(coneHalfDeg, 0.1, 180, 180);
  return half >= 180 ? 4 * Math.PI : 2 * Math.PI * (1 - Math.cos((half * Math.PI) / 180));
}
export function lumensToCandela(lm, coneHalfDeg) {
  return Math.max(num(lm, 0), 0) / Math.max(solidAngleSr(coneHalfDeg), 1e-6);
}
export function candelaToLumens(cd, coneHalfDeg) {
  return Math.max(num(cd, 0), 0) * solidAngleSr(coneHalfDeg);
}

export function nitsFromLuxOnDiffuse(lux, albedo) {
  return (Math.max(num(lux, 0), 0) * clampNum(albedo, 0, 1, 0.18)) / Math.PI;
}


export function sunIlluminanceLux(elevDeg) {
  const e = clampNum(elevDeg, -90, 90, 0);
  if (e <= TWILIGHT_END_DEG) return 0;
  if (e <= 0) return SUN_HORIZON_LUX * (1 - e / TWILIGHT_END_DEG);                   
  const s = Math.sin((e * Math.PI) / 180);
  return SUN_HORIZON_LUX + (SUN_ZENITH_LUX - SUN_HORIZON_LUX) * Math.pow(s, 0.72);
}
export function skyIlluminanceLux(elevDeg) {
  const e = clampNum(elevDeg, -90, 90, 0);
  if (e <= TWILIGHT_END_DEG) return 0;
  if (e <= 0) return SKY_HORIZON_LUX * (1 - e / TWILIGHT_END_DEG);              
  const s = Math.sin((e * Math.PI) / 180);
  return SKY_HORIZON_LUX + (SKY_ZENITH_LUX - SKY_HORIZON_LUX) * Math.sqrt(s);
}
export function moonIlluminanceLux(moonElevDeg) {
  const e = clampNum(moonElevDeg, -90, 90, -90);
  return MOON_FULL_LUX * Math.sin((Math.max(0, e) * Math.PI) / 180);
}

export function sunSkyMoonLux(sunElevDeg) {
  const e = clampNum(sunElevDeg, -90, 90, 0);
  return Object.freeze({
    sunLux: sunIlluminanceLux(e),
    skyLux: skyIlluminanceLux(e),
    moonLux: moonIlluminanceLux(-e),
    nightLux: NIGHT_SKY_LUX,
  });
}

export function sceneEv100(sunElevDeg) {
  const l = sunSkyMoonLux(sunElevDeg);
  return ev100FromLux(l.sunLux + l.skyLux + l.moonLux + l.nightLux);
}


export function brightnessStops(brightness) {
  const b = clampNum(brightness, 0, 10, 2);
  const stops = Math.log2(Math.max(b, 0.05) / 2);
  return clampNum(stops, BRIGHTNESS_STOPS_MIN, BRIGHTNESS_STOPS_MAX, 0);
}


export function resolveRenderStyle(raw) {
  return raw === "Realistic" ? "Realistic" : "Classic";
}


const ZENITH = sunSkyMoonLux(90);
const ZENITH_EXPOSURE = exposureForEv100(
  ev100FromLux(ZENITH.sunLux + ZENITH.skyLux + ZENITH.moonLux + ZENITH.nightLux),
);
export const CAL_SUN = 1 / (ZENITH.sunLux * ZENITH_EXPOSURE);
export const CAL_SKY = 1 / ((ZENITH.skyLux + NIGHT_SKY_LUX) * ZENITH_EXPOSURE);


export function photometryPlan(input) {
  const inp = input && typeof input === "object" ? input : {};
  const style = resolveRenderStyle(inp.style);
  const ec = clampNum(inp.exposureCompensation, -5, 5, 0);
  const gradeExposure = Math.pow(2, ec);                                          
  if (style !== "Realistic") {
    return Object.freeze({ style: "Classic", on: false, exposure: gradeExposure });
  }
  const elev = clampNum(inp.sunElevDeg, -90, 90, 0);
  const lux = sunSkyMoonLux(elev);
  const ev100 = ev100FromLux(lux.sunLux + lux.skyLux + lux.moonLux + lux.nightLux);
  const bStops = brightnessStops(inp.brightness);

  const evAdjusted = ev100 - bStops;
  const exp = exposureForEv100(evAdjusted);


  const sunVisible =
    inp.sunVisible === false ? false : lux.sunLux > 0;
  const sunSlotLux = sunVisible ? lux.sunLux : lux.moonLux;


  const skySlotLux = lux.skyLux + lux.nightLux + (sunVisible ? 0 : lux.sunLux);
  const sunNorm = sunSlotLux * exp * CAL_SUN;
  const skyNorm = skySlotLux * exp * CAL_SKY;
  return Object.freeze({
    style: "Realistic",
    on: true,
    sunElevDeg: elev,
    sunVisible,
    sunLux: lux.sunLux,
    skyLux: lux.skyLux,
    moonLux: lux.moonLux,
    nightLux: lux.nightLux,
    ev100,
    evAdjusted,
    brightnessStops: bStops,
    exposure: gradeExposure,
    sunIntensity: SUN_BASE * sunNorm,
    skyIntensity: SKY_BASE * skyNorm,
    ambIntensity: AMB_BASE * skyNorm,
  });
}


export const LIGHT_TEMP_MIN = 1000;
export const LIGHT_TEMP_MAX = 12000;


export const LIGHT_LUMENS_PER_BRIGHTNESS = 800;


export const LOCAL_LIGHT_LAMBERT_COMP = Math.PI;


export const LIGHT_PHOTOMETRY_PRESETS = Object.freeze({
  Candle: Object.freeze({ kelvin: 1900, lumens: 12 }),
  Tungsten: Object.freeze({ kelvin: 2700, lumens: 800 }),
  Halogen: Object.freeze({ kelvin: 3000, lumens: 1600 }),
  LED: Object.freeze({ kelvin: 4000, lumens: 800 }),
  Fluorescent: Object.freeze({ kelvin: 5000, lumens: 1100 }),
  Sodium: Object.freeze({ kelvin: 2200, lumens: 6000 }),
  Daylight: Object.freeze({ kelvin: 6500, lumens: 1600 }),
});
export function lightPresetFor(name) {
  return typeof name === "string" && LIGHT_PHOTOMETRY_PRESETS[name]
    ? LIGHT_PHOTOMETRY_PRESETS[name]
    : null;
}


export function kelvinToRgb(kelvin) {
  const K = Number.isFinite(kelvin)
    ? Math.min(Math.max(kelvin, LIGHT_TEMP_MIN), LIGHT_TEMP_MAX)
    : 6500;
  const K2 = K * K;
  const u =
    (0.860117757 + 1.54118254e-4 * K + 1.28641212e-7 * K2) /
    (1 + 8.42420235e-4 * K + 7.08145163e-7 * K2);
  const v =
    (0.317398726 + 4.22806245e-5 * K + 4.20481691e-8 * K2) /
    (1 - 2.89741816e-5 * K + 1.61456053e-7 * K2);
  const d = 2 * u - 8 * v + 4;
  const x = (3 * u) / d;
  const y = (2 * v) / d;
  const X = x / y;
  const Z = (1 - x - y) / y;
  let r = 3.2404542 * X - 1.5371385 - 0.4985314 * Z;
  let g = -0.969266 * X + 1.8760108 + 0.041556 * Z;
  let b = 0.0556434 * X - 0.2040259 + 1.0572252 * Z;
  r = Math.max(r, 0);
  g = Math.max(g, 0);
  b = Math.max(b, 0);
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const s = luma > 1e-9 ? 1 / luma : 1;
  return Object.freeze({ r: r * s, g: g * s, b: b * s });
}


export function lightLumens(brightness) {
  return clampNum(brightness, 0, 40, 1) * LIGHT_LUMENS_PER_BRIGHTNESS;
}


export function localLightCandela(input) {
  const inp = input && typeof input === "object" ? input : {};
  const lm = Math.max(num(inp.lumens, 0), 0);
  if (inp.kind === "PointLight") return lumensToCandela(lm, 180);
  const angle = clampNum(inp.angleDeg, 1, 179, 90);
  return lumensToCandela(lm, Math.max(angle / 2, 0.5));
}


export function localLightPhotometryPlan(input) {
  const inp = input && typeof input === "object" ? input : {};
  const style = resolveRenderStyle(inp.style);
  const flag = inp.flag === true ? true : inp.flag === false ? false : null;
  const on = flag === true ? true : flag === false ? false : style === "Realistic";
  const mode = flag === true ? "forced" : flag === false ? "vetoed" : on ? "auto-on" : "auto-off";
  if (!on) return Object.freeze({ on: false, mode, style, scale: 0 });
  const plan = photometryPlan({
    style: "Realistic",
    sunElevDeg: inp.sunElevDeg,
    brightness: inp.brightness,
    exposureCompensation: inp.exposureCompensation,
  });
  const scale = exposureForEv100(plan.evAdjusted) * CAL_SUN * LOCAL_LIGHT_LAMBERT_COMP;
  return Object.freeze({ on: true, mode, style, scale, evAdjusted: plan.evAdjusted });
}


export function localLightEngineParams(input) {
  const inp = input && typeof input === "object" ? input : {};
  const preset = lightPresetFor(inp.preset);
  const lumens = preset ? preset.lumens : lightLumens(num(inp.brightness, 1));
  const tK = num(inp.temperatureK, 0);
  const kelvin = preset
    ? preset.kelvin
    : tK > 0
      ? Math.min(Math.max(tK, LIGHT_TEMP_MIN), LIGHT_TEMP_MAX)
      : 0;
  return Object.freeze({
    lumens,
    kelvin,
    candela: localLightCandela({ kind: inp.kind, lumens, angleDeg: num(inp.angleDeg, 90) }),
    tint: kelvin > 0 ? kelvinToRgb(kelvin) : null,
  });
}
