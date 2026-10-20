export const HFOG_EXTINCTION_AT_REACH = 3.912;                            
export const HFOG_CLASSIC_ATMO_REACH = 6000;                                 
export const HFOG_DIRY_EPS = 1e-4;
export const HFOG_EXP_CLAMP = 60;


export const HFOG_SKY_AIRMASS_A = 0.025;
export const HFOG_SKY_AIRMASS_B = 11;
export const HFOG_SKY_HORIZON_AIRMASS = 1 / HFOG_SKY_AIRMASS_A;      


export const HFOG_SKY_MAX_OPACITY = 0.65;

function num(v, fb) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}
function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}
function clampExp(e) {
  return clamp(e, -HFOG_EXP_CLAMP, HFOG_EXP_CLAMP);
}


export function resolveRenderStyle(value) {
  return value === "Realistic" ? "Realistic" : "Classic";
}


export function mapAtmosphereToHeightFog(opts) {
  const o = opts || {};
  const hasAtmo = !!o.hasAtmosphere;
  const density = clamp(num(o.density, 0.395), 0, 1);
  const offset = clamp(num(o.offset, 0), 0, 1);
  const haze = clamp(num(o.haze, 0), 0, 10);
  const glare = clamp(num(o.glare, 0), 0, 1);
  const fogEnd = Math.max(num(o.fogEnd, 100000), 2);


  const reach = hasAtmo && density > 0.01
    ? Math.min(HFOG_CLASSIC_ATMO_REACH * (1.08 - density), fogEnd)
    : fogEnd;
  const sigma = (HFOG_EXTINCTION_AT_REACH / Math.max(reach, 1)) * (1 - 0.65 * offset);
  const falloff = 0.014 / (1 + 0.3 * haze);
  const sunK = 10 - 6 * glare;
  const sunAmp = 0.45 + (hasAtmo ? 0.45 * glare : 0);
  return { sigma, falloff, baseY: 0, sunK, sunAmp };
}


export function heightFogFactor(camY, dirY, dist, sigma, falloff, baseY) {
  const k = Math.max(num(falloff, 0.014), 1e-6);
  const s = Math.max(num(sigma, 0), 0);
  const d = Math.max(num(dist, 0), 0);
  const dy = num(dirY, 0);
  const base = s * Math.exp(clampExp(-k * (num(camY, 0) - num(baseY, 0))));
  let tau;
  if (Math.abs(dy) < HFOG_DIRY_EPS) {
    tau = base * d;
  } else {
    tau = (base * (1 - Math.exp(clampExp(-k * dy * d)))) / (k * dy);
  }
  return 1 - Math.exp(-clamp(tau, 0, HFOG_EXP_CLAMP));
}


export function skyAirmass(dirY) {
  const c = clamp(num(dirY, 0), 0, 1);
  return 1 / (c + HFOG_SKY_AIRMASS_A * Math.exp(clampExp(-HFOG_SKY_AIRMASS_B * c)));
}


export function heightFogSkyFactor(camY, dirY, sigma, falloff, baseY) {
  const k = Math.max(num(falloff, 0.014), 1e-6);
  const s = Math.max(num(sigma, 0), 0);
  const base = s * Math.exp(clampExp(-k * (num(camY, 0) - num(baseY, 0))));
  const tau = (base / k) * skyAirmass(dirY);
  const f = 1 - Math.exp(-clamp(tau, 0, HFOG_EXP_CLAMP));
  return clamp(f, 0, 1) * HFOG_SKY_MAX_OPACITY;
}


export function sunTintWeight(cosViewSun, sunK) {
  return Math.pow(Math.max(num(cosViewSun, 0), 0), Math.max(num(sunK, 10), 1));
}


export function buildHeightFogGlsl() {
  return [
    "float rswHFogFactor( float camY, float dirY, float dist, float sigma, float falloff, float baseY ) {",
    "  float k = max( falloff, 1e-6 );",
    "  float base = sigma * exp( clamp( -k * ( camY - baseY ), -60.0, 60.0 ) );",
    "  float tau;",
    "  if ( abs( dirY ) < 1e-4 ) {",
    "    tau = base * dist;",
    "  } else {",
    "    tau = base * ( 1.0 - exp( clamp( -k * dirY * dist, -60.0, 60.0 ) ) ) / ( k * dirY );",
    "  }",
    "  return 1.0 - exp( -clamp( tau, 0.0, 60.0 ) );",
    "}",
    "float rswHFogSkyAirmass( float dirY ) {",
    "  float c = clamp( dirY, 0.0, 1.0 );",
    "  return 1.0 / ( c + 0.025 * exp( -11.0 * c ) );",
    "}",
    "float rswHFogSkyFactor( float camY, float dirY, float sigma, float falloff, float baseY ) {",
    "  float k = max( falloff, 1e-6 );",
    "  float base = sigma * exp( clamp( -k * ( camY - baseY ), -60.0, 60.0 ) );",
    "  float tau = ( base / k ) * rswHFogSkyAirmass( dirY );",
    "  return ( 1.0 - exp( -clamp( tau, 0.0, 60.0 ) ) ) * 0.65;",
    "}",
    "float rswHFogSunW( float cosVS, float sunK ) {",
    "  return pow( max( cosVS, 0.0 ), max( sunK, 1.0 ) );",
    "}",
  ].join("\n");
}
