import { resolveFilmicSettings, getFilmicOutput } from "./filmicSettings.js";

const MINIMUM_SCALE = 0.00001;
const MINIMUM_SLOPE = 0.0001;
const MIDDLE_GRAY = 0.18;

export function createFilmicCurveParameters(authored = {}) {
  const settings = resolveFilmicSettings(authored);
  const headroom = getFilmicOutput(settings).headroom;
  const slope = Math.max(settings.slope, MINIMUM_SLOPE);
  const toeScale = Math.max(1 + settings.blackClip - settings.toe, MINIMUM_SCALE);
  const shoulderScale = Math.max(headroom * (1 + settings.whiteClip - settings.shoulder), MINIMUM_SCALE);
  const toeHeight = 1 - settings.toe;
  const logMiddleGray = Math.log10(MIDDLE_GRAY);
  const toeRatio = (MIDDLE_GRAY + settings.blackClip) / toeScale - 1;
  const toeMatch = toeHeight <= MIDDLE_GRAY
    ? logMiddleGray + (toeHeight - MIDDLE_GRAY) / slope
    : logMiddleGray - Math.atanh(Math.max(-0.999999999, Math.min(0.999999999, toeRatio))) * toeScale / slope;
  const straightOffset = toeHeight / slope - toeMatch;
  const shoulderMatch = headroom * settings.shoulder / slope - straightOffset;
  return Object.freeze({ slope, toeScale, shoulderScale, toeMatch, shoulderMatch, straightOffset, blackClip: settings.blackClip, whiteLimit: headroom * (1 + settings.whiteClip), headroom });
}

export function evaluateFilmicCurveUnchecked(value, parameters) {
  if (value <= 0) return 0;
  const { slope, toeScale, shoulderScale, toeMatch, shoulderMatch, straightOffset, blackClip, whiteLimit, headroom } = parameters;
  const logValue = Math.log10(value);
  const straight = slope * (logValue + straightOffset);
  const toe = logValue < toeMatch ? -blackClip + toeScale * (1 + Math.tanh(slope * (logValue - toeMatch) / toeScale)) : straight;
  const shoulder = logValue > shoulderMatch ? whiteLimit - shoulderScale * (1 - Math.tanh(slope * (logValue - shoulderMatch) / shoulderScale)) : straight;
  const separation = shoulderMatch - toeMatch;
  let blend = Math.abs(separation) < 0.0000001 ? (logValue >= shoulderMatch ? 1 : 0) : Math.max(0, Math.min(1, (logValue - toeMatch) / separation));
  if (separation < 0) blend = 1 - blend;
  blend = blend * blend * (3 - 2 * blend);
  return Math.max(0, Math.min(headroom, toe + (shoulder - toe) * blend));
}

export function evaluateFilmicCurve(value, parameters = createFilmicCurveParameters()) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError("Filmic curve input must be finite");
  return evaluateFilmicCurveUnchecked(value, parameters);
}
