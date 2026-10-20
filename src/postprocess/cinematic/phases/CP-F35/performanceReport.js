import { summarizeSamples } from "./performanceStatistics.js";

export const PROPOSED_BUDGETS = Object.freeze({
  high: Object.freeze({
    width: 1920,
    height: 1080,
    gpuP95Ms: 4,
    gpuP99Ms: 6,
    cpuP95Ms: 0.5,
    memoryBytes: 268435456,
  }),
  low: Object.freeze({
    width: 1280,
    height: 720,
    gpuP95Ms: 2.5,
    gpuP99Ms: null,
    cpuP95Ms: null,
    memoryBytes: 67108864,
  }),
});

export function buildPerformanceReport({
  cpuSamples = [],
  gpuSamples = [],
  warmupFrames = 0,
  environment = {},
  qualityTier = "high",
  memory = {},
  counters = {},
  timer = {},
} = {}) {
  if (!Number.isInteger(warmupFrames) || warmupFrames < 0)
    throw new TypeError("Warmup frame count must be a nonnegative integer");
  const budget = PROPOSED_BUDGETS[qualityTier];
  if (!budget) throw new TypeError("Performance tier must be high or low");
  const cpu = summarizeSamples(cpuSamples);
  const gpu = summarizeSamples(gpuSamples);
  const blockers = [];
  if (
    environment.headless !== false ||
    environment.visible !== true ||
    environment.softwareRenderer !== false
  )
    blockers.push("not-production-timing");
  if (!environment.targetHardwareId || environment.hardwareFrozen !== true)
    blockers.push("Target hardware and budget are not frozen");
  if (
    environment.width !== budget.width ||
    environment.height !== budget.height
  )
    blockers.push("Resolution differs from the target budget");
  if (warmupFrames < 120)
    blockers.push("Fewer than 120 separate warmup frames");
  if (cpu.sampleCount < 600)
    blockers.push("Fewer than 600 CPU submission samples");
  if (
    timer.source !== "EXT_disjoint_timer_query_webgl2" ||
    gpu.sampleCount < 600 ||
    timer.disjointSamples !== 0
  )
    blockers.push("Missing or disjoint GPU timer evidence");
  if (
    typeof memory.measuredPeakBytes !== "number" ||
    !Number.isFinite(memory.measuredPeakBytes) ||
    memory.measuredPeakBytes < 0 ||
    memory.completeAccounting !== true
  )
    blockers.push("Complete measured VRAM evidence is unavailable");
  const checks = {
    gpuP95: gpu.p95 === null ? null : gpu.p95 <= budget.gpuP95Ms,
    gpuP99:
      budget.gpuP99Ms === null || gpu.p99 === null
        ? null
        : gpu.p99 <= budget.gpuP99Ms,
    cpuP95:
      budget.cpuP95Ms === null || cpu.p95 === null
        ? null
        : cpu.p95 <= budget.cpuP95Ms,
    memory:
      typeof memory.measuredPeakBytes === "number"
        ? memory.measuredPeakBytes <= budget.memoryBytes
        : null,
  };
  return {
    scope: blockers.includes("not-production-timing")
      ? "not-production-timing"
      : "target-device",
    status: blockers.length
      ? "blocked"
      : Object.values(checks).some((value) => value === false)
        ? "failed"
        : "passed",
    productionTimingCertified:
      blockers.length === 0 &&
      !Object.values(checks).some((value) => value === false),
    qualityTier,
    budget,
    budgetSource: "docs/PLAN.md G5 proposals; unchanged",
    warmupFrames,
    cpu: {
      ...cpu,
      unit: "ms",
      scope: "CPU submission; excludes diagnostic readback",
    },
    gpu: { ...gpu, unit: "ms", scope: "GPU elapsed timer query only" },
    memory: { ...memory, measuredPeakBytes: memory.measuredPeakBytes ?? null },
    counters,
    environment,
    timer,
    checks,
    blockers,
  };
}
