import { freeze } from "./qualityContract.js";

export function qualityOptions(profile, effective, negotiation, renderSize, outputSize) {
  const available = (id) => negotiation.installedPhases.includes(id);
  const option = (id, value, consumer, cost, qualityEffect, reason) => ({ id, value, consumer, cost,
    qualityEffect, reason, status: consumer === "host" || available(consumer) ? "configured" : "consumer-not-installed" });
  return freeze([
    option("resolution", renderSize, "host", "Shading and render-sized targets scale with pixel count", "Lower internal resolution loses native detail",
      renderSize.width === outputSize.width && renderSize.height === outputSize.height ? "Native extent; profile or missing/disabled reconstruction requires it" : `Explicit pre-prepare host sizing with ${negotiation.upscaling}`),
    option("bloomBands", effective.get("CP-F14").bands.length, "CP-F14", "Four draws and four FP16 targets per active pyramid band", "Fewer bands reduce the spatial extent of glare", profile.reason),
    option("bloomEnabled", effective.get("CP-F14").enabled, "CP-F14", "Disabled standard bloom still has its real copy/range passes", "Optional glare can be removed; scene output remains distinct", "Profile ceiling preserves authored false and zero intensity"),
    option("convolutionKernel", effective.get("CP-F15").enabled, "CP-F15", "Kernel work is capped by maxSampleOperations and maxTargetBytes", "Standard bloom is not an equivalent convolution fallback", "Cinematic only; authored kernel is retained, never silently replaced"),
    option("dofRadius", effective.get("CP-F19").maxRadiusPixels, "CP-F19", "Gather work grows with disk area and sample visits", "Radius ceiling can suppress large bokeh", "Profile work cap; authored smaller radii and disabled effects are preserved"),
    option("dofHistory", { enabled: effective.get("CP-F20").enabled, samples: effective.get("CP-F20").maximumSamples, workingScale: effective.get("CP-F20").workingScale }, "CP-F20", "History is persistent; reduced working extent bounds its storage", "Lower sample ceiling trades convergence for cost", "Requires explicit motion/depth host inputs and an installed consumer"),
    option("temporalHistory", { enabled: effective.get("CP-F21").enabled, filter: effective.get("CP-F21").historyFilter, weight: effective.get("CP-F21").historyWeight }, "CP-F21", "Persistent color/depth history and reconstruction taps", "Lower history weight reduces accumulation; bilinear reduces sharpness", "Missing inputs disable temporal reconstruction, never fake velocity"),
    option("motionTaps", { enabled: effective.get("CP-F22").enabled, samples: effective.get("CP-F22").sampleCount }, "CP-F22", "Per-pixel sampling bounded by sampleCount", "Fewer taps can increase blur sampling noise", "Per-view author overrides are merged before the quality ceiling"),
    option("automaticTiming", negotiation.timerQuery, "host", "Only qualified GPU query samples may change quality", "Hysteresis prioritizes stability over immediate quality recovery", "CPU submission, idle frame dt, hidden and headless timing are never accepted"),
    option("memory", profile.budgetBytes, "host", "Declared format/layer/sample/mip bytes plus external CPU and GPU reservations", "Insufficient capacity fails before allocation, not by silently changing HDR", "Global and per-view hard caps include old/new replacement peaks")
  ]);
}
