import { createMegaLightsDebugEvidenceView } from "./megaLightsDebugEvidenceView.js";
import { MEGALIGHTS_DEBUG_STYLES } from "./megaLightsDebugStyles.js";
import { MEGALIGHTS_DEBUG_MARKUP } from "./megaLightsDebugMarkup.js";
import {
  DEBUG_BUFFER_MODES,
  DEBUG_LIMITATIONS,
} from "./megaLightsDebugCatalog.js";

function statusElement(document, status) {
  const element = document.createElement("span");
  element.className = "mgl-status";
  element.dataset.status = status;
  element.textContent = status;
  return element;
}

function table(document, headers, rows) {
  const element = document.createElement("table");
  const head = element.createTHead().insertRow();
  for (const title of headers) {
    const cell = document.createElement("th");
    cell.textContent = title;
    head.append(cell);
  }
  const body = element.createTBody();
  for (const values of rows) {
    const row = body.insertRow();
    for (const value of values) {
      const cell = row.insertCell();
      if (value?.nodeType) cell.append(value);
      else cell.textContent = String(value ?? "—");
    }
  }
  return element;
}

export function createMegaLightsDebugPanel({
  document = globalThis.document,
  onAction,
  onInput,
  onPixel,
}) {
  const previousFocus = document.activeElement;
  const style = document.createElement("style");
  style.dataset.megalightsDebugStyle = "true";
  style.textContent = MEGALIGHTS_DEBUG_STYLES;
  const root = document.createElement("aside");
  root.className = "mgl-debug";
  root.setAttribute("aria-labelledby", "mgl-debug-title");
  root.dataset.megalightsDebug = "true";
  root.innerHTML = MEGALIGHTS_DEBUG_MARKUP;
  document.head.append(style);
  document.body.append(root);
  const fields = new Map(
    Array.from(root.querySelectorAll("[data-field]"), (element) => [
      element.dataset.field,
      element,
    ]),
  );
  const canvases = new Map(
    Array.from(root.querySelectorAll("[data-canvas]"), (element) => [
      element.dataset.canvas,
      element,
    ]),
  );
  const modeInput = root.querySelector('[data-input="mode"]');
  for (const mode of DEBUG_BUFFER_MODES) {
    const option = document.createElement("option");
    option.value = mode.id;
    option.textContent = mode.owner + " · " + mode.title;
    modeInput.append(option);
  }
  for (const text of DEBUG_LIMITATIONS) {
    const item = document.createElement("li");
    item.textContent = text;
    fields.get("limitations").append(item);
  }
  const evidenceView = createMegaLightsDebugEvidenceView({ root, document });
  let lastModel = null;
  let selectedPhase = "ML-F3";
  let flagSignature = "";
  let activeTab = "overview";

  const text = (name, value) => {
    const element = fields.get(name);
    if (element && element.textContent !== String(value))
      element.textContent = String(value);
  };
  const json = (name, value) => text(name, JSON.stringify(value, null, 2));
  const replace = (name, element) => fields.get(name).replaceChildren(element);

  function button(label, action, identifier) {
    const element = document.createElement("button");
    element.textContent = label;
    element.dataset.action = action;
    if (identifier) element.dataset.identifier = identifier;
    return element;
  }

  function showTab(name) {
    activeTab = name;
    for (const tab of root.querySelectorAll("[data-tab]")) {
      tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
      tab.tabIndex = tab.dataset.tab === name ? 0 : -1;
    }
    for (const panel of root.querySelectorAll("[data-view]"))
      panel.hidden = panel.dataset.view !== name;
    if (lastModel) render(lastModel);
  }

  function showPhase(identifier) {
    selectedPhase = identifier;
    const phase = lastModel?.phases.find((entry) => entry.id === identifier);
    if (phase) {
      text("phaseTitle", phase.id + " · " + phase.title);
      json("phaseDetail", phase);
    }
  }

  function renderFlags(flags) {
    const signature = flags
      .map((flag) => [flag.id, flag.mode, flag.debugOverride].join(":"))
      .join("|");
    if (signature === flagSignature) return;
    if (
      root.contains(document.activeElement) &&
      document.activeElement.matches("select[data-flag]")
    ) {
      for (const select of root.querySelectorAll("select[data-flag]")) {
        const flag = flags.find((entry) => entry.id === select.dataset.flag);
        if (flag)
          select.closest("td").previousElementSibling.textContent =
            (flag.on ? "ON · " : "OFF · ") + flag.mode;
      }
      return;
    }
    flagSignature = signature;
    replace(
      "flags",
      table(
        document,
        ["Flag / owner", "Effective", "Temporary override"],
        flags.map((flag) => {
          const select = document.createElement("select");
          select.dataset.flag = flag.id;
          select.setAttribute("aria-label", flag.id + " override");
          for (const [value, label] of [
            ["inherit", "Unchanged"],
            ["auto", "AUTO (tier)"],
            ["on", "Force ON"],
            ["off", "Force OFF"],
          ]) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            select.append(option);
          }
          select.value = flag.debugOverride ?? "inherit";
          const label = document.createElement("span");
          label.textContent = flag.id + " · " + flag.phase;
          label.title = flag.description;
          return [label, (flag.on ? "ON · " : "OFF · ") + flag.mode, select];
        }),
      ),
    );
  }

  function drawHistory(history) {
    const canvas = canvases.get("timings");
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    const values = history
      .map((frame) => frame.milliseconds)
      .filter((value) => Number.isFinite(value) && value > 0);
    if (!values.length) return;
    const maximum = Math.max(33, ...values);
    context.strokeStyle = "#30495a";
    for (const threshold of [16.7, 33.3]) {
      const y = canvas.height * (1 - threshold / maximum);
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvas.width, y);
      context.stroke();
    }
    context.strokeStyle = "#6ce0b6";
    context.lineWidth = 2;
    context.beginPath();
    values.forEach((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * canvas.width;
      const y =
        canvas.height - Math.min(1, value / maximum) * (canvas.height - 4);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
    text(
      "timing",
      values.at(-1).toFixed(2) +
        " ms last · " +
        values.length +
        " samples · max " +
        maximum.toFixed(1) +
        " ms",
    );
  }

  function render(model) {
    lastModel = model;
    text("gate", model.gate);
    text("frame", model.frameIndex ?? "—");
    text(
      "installed",
      model.phases.filter((phase) => phase.installation === "installed")
        .length + "/30",
    );
    text(
      "ready",
      model.buffers.filter((buffer) => buffer.available).length +
        "/" +
        model.buffers.length,
    );
    text("lights", model.lightCount ?? "—");
    text(
      "freshness",
      model.frozen
        ? "FROZEN INSPECTOR · capture " + model.capturedFrame
        : "LIVE · frame " +
            model.frameIndex +
            " · last capture " +
            (model.capturedFrame ?? "none"),
    );
    text(
      "cost",
      "≤4 captures/s · " +
        model.readbacks +
        " readbacks · " +
        model.captureCost.toFixed(2) +
        " ms last",
    );
    for (const control of root.querySelectorAll('[data-action="freeze"]'))
      control.textContent = model.frozen
        ? "Resume inspector"
        : "Freeze inspector";
    if (activeTab === "overview") {
      const flow = document.createDocumentFragment();
      for (const pass of model.passes) {
        const element = button("", "phase", pass.expectedOwner);
        element.dataset.status = pass.outputStatus;
        const label = document.createElement("b");
        label.textContent = pass.expectedOwner;
        const state = document.createElement("span");
        state.textContent = pass.outputStatus;
        element.title = pass.passName + " · " + pass.execution;
        element.append(label, state);
        flow.append(element);
      }
      fields.get("flow").replaceChildren(flow);
      evidenceView.renderStages(model.frameStages);
      drawHistory(model.history);
      json("runtime", model.runtime);
      text("evidence", model.evidence);
    }
    if (activeTab === "buffers")
      replace(
        "bufferList",
        table(
          document,
          ["Buffer", "Current frame", "Origin / refusal"],
          model.buffers.map((buffer) => [
            button(buffer.title, "mode", buffer.id),
            statusElement(document, buffer.available ? "ready" : "BLOCKED"),
            buffer.origin || buffer.reason,
          ]),
        ),
      );
    if (activeTab === "phases") {
      replace(
        "phases",
        table(
          document,
          ["Phase", "Import", "Install", "This-frame output", "Image proof"],
          model.phases.map((phase) => [
            button(phase.id, "phase", phase.id),
            phase.status,
            statusElement(document, phase.installation),
            statusElement(document, phase.outputStatus),
            evidenceView.phaseProof(phase),
          ]),
        ),
      );
      showPhase(selectedPhase);
    }
    if (activeTab === "controls") {
      renderFlags(model.flags);
      json("controlDetail", {
        overrides: model.overrides,
        budget: model.runtime.budget,
      });
    }
    const baseline = root.querySelector('[data-input="baseline"]');
    baseline.checked = model.baseline;
  }

  function drawCapture(name, capture) {
    const canvas = canvases.get(name);
    canvas.width = capture.width;
    canvas.height = capture.height;
    canvas
      .getContext("2d")
      .putImageData(
        new ImageData(
          new Uint8ClampedArray(capture.pixels),
          capture.width,
          capture.height,
        ),
        0,
        0,
      );
  }

  function buffer(capture) {
    const available = capture?.available === true;
    canvases.get("buffer").hidden = !available;
    fields.get("bufferEmpty").hidden = available;
    text("bufferStatus", available ? "CAPTURED" : "BLOCKED");
    fields.get("bufferStatus").dataset.status = available
      ? "observed"
      : "BLOCKED";
    const gradient = root.querySelector(".mgl-legend");
    gradient.hidden =
      !available ||
      ["rgb", "radiance", "velocity", "id", "visibility"].includes(
        capture?.encoding,
      );
    gradient.style.background =
      capture?.encoding === "alpha"
        ? "linear-gradient(90deg,#000,#fff)"
        : "linear-gradient(90deg,#0019e6,#7ede80,#ff1914)";
    if (!available) {
      text("bufferEmpty", capture?.reason || "No capture");
      text("bufferOrigin", "No data produced");
      text(
        "bufferLegend",
        "No current image. The refusal above is not a successful visual test.",
      );
      json("bufferRange", {});
      evidenceView.drawHistogram(null);
      text("pixel", "No current readable pixel; previous probes were cleared.");
      return;
    }
    drawCapture("buffer", capture);
    evidenceView.drawHistogram(capture.range);
    text(
      "bufferOrigin",
      capture.origin +
        " · " +
        capture.backend +
        " · frame " +
        capture.frameIndex,
    );
    text(
      "bufferLegend",
      capture.legend +
        " Source " +
        capture.sourceWidth +
        "×" +
        capture.sourceHeight +
        "; sampled " +
        capture.width +
        "×" +
        capture.height +
        ".",
    );
    json("bufferRange", {
      ...capture.range,
      producerFrame: capture.producerFrame,
      inputFrame: capture.inputFrame,
      level: capture.level,
      levelCount: capture.levelCount,
      encoding: capture.encoding,
      channels: capture.channels,
    });
  }

  function tests(results, progress = "") {
    evidenceView.setCpuResults(results);
    const fragment = document.createDocumentFragment();
    for (const result of results) {
      const row = document.createElement("div");
      row.className = "mgl-test";
      const body = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = result.id;
      const detail = document.createElement("small");
      detail.textContent = result.detail;
      body.append(title, detail);
      if (result.evidence) {
        const disclosure = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = "Evidence";
        const pre = document.createElement("pre");
        pre.textContent = JSON.stringify(result.evidence, null, 2);
        disclosure.append(summary, pre);
        body.append(disclosure);
      }
      row.append(statusElement(document, result.status), body);
      fragment.append(row);
    }
    fields.get("tests").replaceChildren(fragment);
    text(
      "testSummary",
      progress ||
        ["PASS", "FAIL", "BLOCKED"]
          .map(
            (status) =>
              results.filter((result) => result.status === status).length +
              " " +
              status,
          )
          .join(" · "),
    );
  }

  function click(event) {
    const tab = event.target.closest("[data-tab]");
    if (tab) {
      showTab(tab.dataset.tab);
      return;
    }
    const action = event.target.closest("[data-action]");
    if (!action) return;
    if (action.dataset.action === "collapse") {
      root.classList.toggle("is-collapsed");
      return;
    }
    if (action.dataset.action === "phase") {
      showTab("phases");
      showPhase(action.dataset.identifier);
      return;
    }
    if (action.dataset.action === "mode") {
      modeInput.value = action.dataset.identifier;
      showTab("buffers");
      onInput("mode", modeInput.value);
      return;
    }
    onAction(action.dataset.action);
  }

  function change(event) {
    const input = event.target;
    if (input.dataset.reference) {
      evidenceView.updateReferences();
      return;
    }
    if (input.dataset.flag) {
      onInput("flag", { id: input.dataset.flag, value: input.value });
      return;
    }
    if (input.dataset.input)
      onInput(
        input.dataset.input,
        input.type === "checkbox" ? input.checked : input.value,
      );
  }

  function keydown(event) {
    event.stopPropagation();
    const tab = event.target.closest("[data-tab]");
    if (tab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const tabs = Array.from(root.querySelectorAll("[data-tab]"));
      const current = tabs.indexOf(tab);
      const index =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
              tabs.length;
      showTab(tabs[index].dataset.tab);
      tabs[index].focus();
    }
    if (event.key === "Escape") onAction("close");
  }

  const probe = (event) => {
    const canvas = canvases.get("buffer");
    const rectangle = canvas.getBoundingClientRect();
    const scale = Math.min(
      rectangle.width / canvas.width,
      rectangle.height / canvas.height,
    );
    const imageWidth = canvas.width * scale;
    const imageHeight = canvas.height * scale;
    const left = rectangle.left + (rectangle.width - imageWidth) / 2;
    const top = rectangle.top + (rectangle.height - imageHeight) / 2;
    if (
      event.clientX < left ||
      event.clientX >= left + imageWidth ||
      event.clientY < top ||
      event.clientY >= top + imageHeight
    )
      return;
    if (lastModel)
      onPixel({
        u: Math.max(0, Math.min(0.999999, (event.clientX - left) / imageWidth)),
        v: Math.max(
          0,
          Math.min(0.999999, 1 - (event.clientY - top) / imageHeight),
        ),
      });
  };
  const stop = (event) => event.stopPropagation();
  root.addEventListener("click", click);
  root.addEventListener("change", change);
  root.addEventListener("keydown", keydown);
  for (const name of ["pointerdown", "pointerup", "keyup", "wheel"])
    root.addEventListener(name, stop);
  canvases.get("buffer").addEventListener("click", probe);
  showTab("overview");

  return {
    ...evidenceView,
    root,
    render,
    buffer,
    tests,
    drawCapture,
    showTab,
    json,
    text,
    canvas: (name) => canvases.get(name),
    isVisible: () =>
      !root.classList.contains("is-collapsed") &&
      document.visibilityState !== "hidden",
    dispose() {
      const hadFocus = root.contains(document.activeElement);
      root.remove();
      style.remove();
      if (previousFocus?.isConnected && hadFocus) previousFocus.focus();
    },
  };
}
