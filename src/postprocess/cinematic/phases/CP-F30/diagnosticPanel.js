import { compareSnapshots } from "./compareSnapshots.js";
import { probePixel } from "./pixelProbe.js";
import { renderDiagnosticImage } from "./diagnosticVisualization.js";
import { createEvidenceBundle, verifyEvidenceBundle } from "./diagnosticEvidence.js";
import { renderHistogramImage } from "./renderHistogramImage.js";
import { buildDiagnosticGraph } from "./diagnosticGraph.js";

export function mountDiagnosticsPanel(root, host) {
  const query = (selector) => root.querySelector(selector);
  const signal = new AbortController();
  const listen = (element, event, listener) => element.addEventListener(event, listener, { signal: signal.signal });
  const display = query("[data-diagnostic-image]");
  const context = display.getContext("2d");
  const bufferSelect = query("[data-buffer]");
  const modeSelect = query("[data-mode]");
  const status = query("[data-status]");
  const summary = query("[data-summary]");
  const metric = query("[data-metric]");
  const probeOutput = query("[data-probe]");
  let baseline = null;
  let candidate = null;
  let comparison = { status: "blocked", reasons: ["Capture two buffers to compare"], metrics: null };
  let graph = null;
  let disposed = false;
  let lastBundle = null;
  let pixelX = 0;
  let pixelY = 0;

  function showStatus(result) {
    status.dataset.state = result.status;
    status.textContent = result.status === "pass" ? "MATCH · ENGINEERING ONLY" : result.status === "fail" ? "FAIL · PIXEL DIFFERENCE" : "BLOCKED · NO APPROVAL";
    summary.textContent = result.reasons.join(" · ") || "Captured pixels match within the selected tolerance. This is not reference certification.";
    metric.textContent = result.metrics ? result.metrics.maxAbsoluteError.toPrecision(5) : "—";
    query("[data-changed]").textContent = result.metrics ? `${result.metrics.changedPixels.toLocaleString()} / ${result.metrics.totalPixels.toLocaleString()}` : "Not measured";
    query("[data-export]").disabled = !candidate;
  }

  function updateProbe() {
    if (!candidate) { probeOutput.textContent = "Capture a valid buffer to inspect a pixel."; return; }
    pixelX = Math.min(candidate.metadata.width - 1, Math.max(0, pixelX));
    pixelY = Math.min(candidate.metadata.height - 1, Math.max(0, pixelY));
    const probe = probePixel(candidate, pixelX, pixelY);
    probeOutput.textContent = `(${pixelX}, ${pixelY}) top-left\n${probe.values.map((value) => value.toFixed(5)).join(" / ")}\n${probe.unit}`;
  }

  function showImage() {
    if (!candidate) { context.clearRect(0, 0, display.width, display.height); updateProbe(); return; }
    const mode = modeSelect.value;
    const image = candidate.metadata.kind === "histogram" && mode === "buffer" ? renderHistogramImage(candidate) : renderDiagnosticImage(candidate, { reference: baseline, mode, wipe: Number(query("[data-wipe]").value) / 100, differenceScale: 4 });
    display.width = image.width;
    display.height = image.height;
    context.putImageData(new ImageData(image.bytes, image.width, image.height), 0, 0);
    query("[data-domain]").textContent = `${candidate.metadata.domain} · ${candidate.metadata.unit}`;
    query("[data-size]").textContent = `${candidate.metadata.width} × ${candidate.metadata.height} samples`;
    query("[data-frame]").textContent = `FRAME ${String(candidate.metadata.frame.frameId).padStart(4, "0")} / GEN ${candidate.metadata.frame.generation}`;
    query("[data-view-caption]").textContent = image.label;
    query("[data-wipe-label]").hidden = mode !== "wipe";
    updateProbe();
  }

  function showGraph() {
    const passes = host.pipeline.graph.describe().map((pass) => pass.id === "CP-F30.inspectBuffers" ? { ...pass, transformsColor: false } : pass);
    const resources = host.resources() ?? {};
    graph = buildDiagnosticGraph(passes, { inputs: Object.keys(resources), resources, execution: host.result()?.execution ?? [], colorWrites: host.colorWrites ?? {} });
    const region = query("[data-lifetimes]");
    region.replaceChildren();
    for (const lifetime of graph.lifetimes) {
      const row = document.createElement("div");
      row.className = "lifetime-row";
      const name = document.createElement("span");
      name.textContent = lifetime.resource;
      const bar = document.createElement("span");
      bar.className = "lifetime-track";
      const fill = document.createElement("span");
      fill.className = "lifetime-fill";
      fill.style.width = `${Math.max(8, (lifetime.lastUse - lifetime.firstUse + 1) / Math.max(1, passes.length) * 100)}%`;
      fill.title = `Scheduled use ${lifetime.firstUse}–${lifetime.lastUse}`;
      bar.append(fill);
      const size = document.createElement("span");
      size.textContent = lifetime.estimatedBytes === null ? "Value" : `${(lifetime.estimatedBytes / 1024).toFixed(1)} KiB`;
      row.append(name, bar, size);
      region.append(row);
    }
    query("[data-pass-summary]").textContent = `${passes.length} registered pass · ${graph.edges.length} read dependencies · ${graph.nodes[0]?.status ?? "unmeasured"}`;
  }

  function capturePair() {
    candidate = null;
    baseline = null;
    try {
      host.setFault("none");
      baseline = host.capture(bufferSelect.value);
      host.setFault(query("[data-fault]").value);
      candidate = host.capture(bufferSelect.value);
      comparison = compareSnapshots(baseline, candidate, { maxAbsoluteError: Number(query("[data-tolerance]").value), errors: host.adapter.errors() });
      showImage();
    } catch (error) {
      candidate = null;
      comparison = { status: "blocked", reasons: [error.message], metrics: null };
      context.clearRect(0, 0, display.width, display.height);
      updateProbe();
    }
    showStatus(comparison);
    showGraph();
    return comparison;
  }

  for (const binding of host.session.bindings) {
    const option = document.createElement("option");
    option.value = binding.id;
    option.textContent = binding.label;
    bufferSelect.append(option);
  }
  listen(bufferSelect, "change", capturePair);
  listen(query("[data-fault]"), "change", capturePair);
  listen(query("[data-tolerance]"), "change", capturePair);
  listen(modeSelect, "change", showImage);
  listen(query("[data-wipe]"), "input", showImage);
  listen(query("[data-capture]"), "click", capturePair);
  listen(query("[data-step]"), "click", () => { host.step(); capturePair(); });
  listen(query("[data-reset]"), "click", () => { host.reset(); query("[data-fault]").value = "none"; capturePair(); });
  listen(query("[data-empty]"), "change", (event) => { host.setEmpty(event.target.checked); capturePair(); });
  listen(display, "click", (event) => {
    const box = display.getBoundingClientRect();
    pixelX = Math.min(candidate?.metadata.width - 1 || 0, Math.floor((event.clientX - box.left) / box.width * (candidate?.metadata.width ?? 1)));
    pixelY = Math.min(candidate?.metadata.height - 1 || 0, Math.floor((event.clientY - box.top) / box.height * (candidate?.metadata.height ?? 1)));
    updateProbe();
  });
  listen(display, "keydown", (event) => {
    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!moves[event.key]) return;
    event.preventDefault(); pixelX += moves[event.key][0]; pixelY += moves[event.key][1]; updateProbe();
  });
  listen(query("[data-export]"), "click", async () => {
    try {
      const bundle = await createEvidenceBundle({ snapshots: [baseline, candidate], graph, comparison, environment: { backend: "WebGL2", browser: navigator.userAgent, capabilities: host.adapter.capabilities, fixtureProvenance: "synthetic", timing: "not-production-timing" } });
      if (disposed) return;
      const verification = await verifyEvidenceBundle(bundle);
      if (verification.status !== "pass") throw new Error(verification.problems.join("; "));
      lastBundle = bundle;
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "CP-F30-evidence.json";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      query("[data-export-status]").textContent = `Verified SHA-256 bundle · ${bundle.manifest.entries.length} files · raw pixels, no UI`;
    } catch (error) { query("[data-export-status]").textContent = `Export blocked: ${error.message}`; }
  });
  capturePair();
  return Object.freeze({ capturePair, snapshot: () => ({ comparison, graph, candidate, baseline, lastBundle }), dispose() { if (disposed) return; disposed = true; signal.abort(); baseline = null; candidate = null; } });
}
