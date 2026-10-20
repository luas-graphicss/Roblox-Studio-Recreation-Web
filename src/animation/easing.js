export const EASING_STYLES = Object.freeze([
  "Linear",
  "Constant",
  "Sine",
  "Quad",
  "Cubic",
  "Quart",
  "Quint",
  "Back",
  "Bounce",
  "Elastic",
]);

export const EASING_DIRECTIONS = Object.freeze(["In", "Out", "InOut"]);

const C1 = 1.70158;                            
const C3 = C1 + 1;

function clamp01(t) {
  if (!Number.isFinite(t)) return 0;
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}


const IN_FUNCS = {

  Linear: (t) => t,

  Constant: (t) => (t >= 1 ? 1 : 0),
  Sine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  Quad: (t) => t * t,
  Cubic: (t) => t * t * t,
  Quart: (t) => t * t * t * t,
  Quint: (t) => t * t * t * t * t,
  Back: (t) => C3 * t * t * t - C1 * t * t,
  Bounce: (t) => 1 - bounceOut(1 - t),
  Elastic: (t) => elasticIn(t),
};

function bounceOut(t) {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) {
    t -= 1.5 / d1;
    return n1 * t * t + 0.75;
  }
  if (t < 2.5 / d1) {
    t -= 2.25 / d1;
    return n1 * t * t + 0.9375;
  }
  t -= 2.625 / d1;
  return n1 * t * t + 0.984375;
}

function elasticIn(t) {
  if (t === 0) return 0;
  if (t === 1) return 1;
  const c4 = (2 * Math.PI) / 3;
  return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4);
}


function toOut(fnIn, t) {
  return 1 - fnIn(1 - t);
}

function toInOut(fnIn, t) {
  if (t < 0.5) return fnIn(t * 2) / 2;
  return 1 - fnIn((1 - t) * 2) / 2;
}


function constant(direction, t) {
  switch (direction) {
    case "Out":
      return t > 0 ? 1 : 0;
    case "InOut":
      return t >= 0.5 ? 1 : 0;
    default:
      return t >= 1 ? 1 : 0;
  }
}


export function ease(style, direction, alpha) {
  const t = clamp01(alpha);
  const st = EASING_STYLES.indexOf(style) !== -1 ? style : "Linear";
  const dir = EASING_DIRECTIONS.indexOf(direction) !== -1 ? direction : "In";

  if (st === "Linear") return t;                         
  if (st === "Constant") return constant(dir, t);

  const fnIn = IN_FUNCS[st] || IN_FUNCS.Linear;
  switch (dir) {
    case "Out":
      return toOut(fnIn, t);
    case "InOut":
      return toInOut(fnIn, t);
    default:
      return fnIn(t);
  }
}


export function sanitizeEasing(style, direction) {
  return {
    style: EASING_STYLES.indexOf(style) !== -1 ? style : "Linear",
    direction: EASING_DIRECTIONS.indexOf(direction) !== -1 ? direction : "Out",
  };
}
