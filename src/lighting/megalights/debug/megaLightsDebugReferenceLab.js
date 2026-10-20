import {
  samplingWeightFor,
  SCATTERING_MODEL,
} from "../mlHairTranslucencyCore.js";
import {
  radiusFromRelativeVariance,
  sparseTapOffsets,
  rotationRadiansFor,
} from "../mlSpatialFilterKernelCore.js";
import { resolveDisocclusionPolicy } from "../mlDisocclusionPolicyCore.js";
import { depthWeightOf, normalWeightOf } from "../mlSpatialFilterWeightCore.js";
import { budgetDecisionFor } from "../mlTierBudgetCore.js";

export function evaluateMegaLightsDebugReferences({
  asymmetry = 0.6,
  variance = 0.5,
  history = 0,
  frame = 0,
} = {}) {
  const weights = Array.from({ length: 65 }, (_, index) => {
    const cosineAngle = index / 32 - 1;
    return {
      cosineAngle,
      ...samplingWeightFor({
        model: SCATTERING_MODEL.hairStrand,
        cosineAngle,
        asymmetry,
      }),
    };
  });
  const radius = radiusFromRelativeVariance({
    relativeVariance: variance,
    varianceIsTrusted: true,
  });
  return {
    backend:
      "Actual engine CPU reference functions, synthetic controlled inputs; not GPU shading",
    weights,
    kernel: {
      radius,
      taps: sparseTapOffsets({
        radiusInPixels: radius,
        rotationRadians: rotationRadiansFor(5, 7, frame),
      }),
    },
    disocclusion: Array.from({ length: 9 }, (_, framesOfHistory) =>
      resolveDisocclusionPolicy({ framesOfHistory }),
    ),
    selectedHistory: resolveDisocclusionPolicy({ framesOfHistory: history }),
    edgeWeights: Array.from({ length: 33 }, (_, index) => ({
      disagreement: index / 32,
      depth: depthWeightOf(5, 5 + index / 32, radius).value,
      normal: normalWeightOf(
        { x: 0, y: 0, z: 1 },
        { x: Math.sin(index / 32), y: 0, z: Math.cos(index / 32) },
      ).value,
    })),
    tierAdvice: ["fraco", "medio", "forte"].map((tierName) => ({
      tierName,
      decisions: [8, 17, 34, 70].map((measuredMilliseconds) =>
        budgetDecisionFor({
          tierName,
          measuredMilliseconds,
          measurementIsValid: true,
          framesSinceChange: 120,
        }),
      ),
    })),
  };
}

export function drawMegaLightsDebugReferences(canvas, evidence) {
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  context.fillStyle = "#0c151f";
  context.fillRect(0, 0, width, height);
  context.font = "12px system-ui";
  const plot = (series, key, color, x, y, plotWidth, plotHeight, maximum) => {
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.beginPath();
    series.forEach((row, index) => {
      const px = x + (index / Math.max(1, series.length - 1)) * plotWidth;
      const py = y + plotHeight - Math.min(1, row[key] / maximum) * plotHeight;
      if (index === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    });
    context.stroke();
  };
  const half = width / 2;
  context.fillStyle = "#dfeaf2";
  context.fillText("F25 · phase / BRDF / maximum", 16, 22);
  context.fillText("F21 · variance-driven taps", half + 16, 22);
  const maxWeight = Math.max(...evidence.weights.map((row) => row.weight));
  plot(
    evidence.weights,
    "phaseValue",
    "#83baf3",
    20,
    40,
    half - 45,
    100,
    maxWeight,
  );
  plot(
    evidence.weights,
    "brdfValue",
    "#eead76",
    20,
    40,
    half - 45,
    100,
    maxWeight,
  );
  plot(
    evidence.weights,
    "weight",
    "#6ce0b6",
    20,
    40,
    half - 45,
    100,
    maxWeight,
  );
  context.fillStyle = "#9dadbc";
  context.fillText("cos θ −1 → +1 · max " + maxWeight.toFixed(2), 20, 161);
  const centreX = half + half / 2;
  for (const tap of [{ offsetX: 0, offsetY: 0 }, ...evidence.kernel.taps]) {
    context.fillStyle = tap.offsetX || tap.offsetY ? "#6ce0b6" : "#eead76";
    context.beginPath();
    context.arc(
      centreX + tap.offsetX * 5,
      94 - tap.offsetY * 5,
      4,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
  context.fillStyle = "#9dadbc";
  context.fillText(
    evidence.kernel.taps.length +
      " taps · radius " +
      evidence.kernel.radius.toFixed(1) +
      " px",
    half + 16,
    161,
  );
  context.fillStyle = "#dfeaf2";
  context.fillText("F22 · disocclusion → convergence", 16, 194);
  context.fillText("F21 · edge-stopping weights", half + 16, 194);
  plot(
    evidence.disocclusion,
    "handlingStrength",
    "#6ce0b6",
    20,
    210,
    half - 45,
    72,
    1,
  );
  plot(
    evidence.edgeWeights,
    "depth",
    "#83baf3",
    half + 20,
    210,
    half - 45,
    72,
    1,
  );
  plot(
    evidence.edgeWeights,
    "normal",
    "#eead76",
    half + 20,
    210,
    half - 45,
    72,
    1,
  );
  context.fillStyle = "#9dadbc";
  context.fillText("0 → 8 history frames; off at 4", 20, height - 13);
  context.fillText("Blue: depth · amber: normal", half + 20, height - 13);
}
