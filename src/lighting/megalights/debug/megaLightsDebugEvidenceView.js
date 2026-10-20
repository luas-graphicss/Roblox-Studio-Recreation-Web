import {
  evaluateMegaLightsDebugReferences,
  drawMegaLightsDebugReferences,
} from "./megaLightsDebugReferenceLab.js";

export function createMegaLightsDebugEvidenceView({ root, document }) {
  const find = (selector) => root.querySelector(selector);
  let latestReferences = null;
  let cpuResults = [];

  function updateReferences() {
    latestReferences = evaluateMegaLightsDebugReferences(
      Object.fromEntries(
        Array.from(root.querySelectorAll("[data-reference]"), (input) => [
          input.dataset.reference,
          Number(input.value),
        ]),
      ),
    );
    drawMegaLightsDebugReferences(
      find('[data-canvas="references"]'),
      latestReferences,
    );
    find('[data-field="referenceDetail"]').textContent = JSON.stringify(
      {
        backend: latestReferences.backend,
        selectedHistory: latestReferences.selectedHistory,
        kernel: latestReferences.kernel,
        tierAdvice: latestReferences.tierAdvice,
      },
      null,
      2,
    );
  }

  function addEvidenceImage(title, image, caption, source) {
    const item = document.createElement("article");
    item.className = "mgl-evidence-image";
    const label = document.createElement(source ? "button" : "strong");
    label.textContent = title;
    if (source) {
      label.dataset.action = "mode";
      label.dataset.identifier = source;
    }
    item.append(label);
    if (image.available !== false && image.pixels) {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.setAttribute("aria-label", title + " captured evidence");
      canvas
        .getContext("2d")
        .putImageData(
          new ImageData(
            new Uint8ClampedArray(image.pixels),
            image.width,
            image.height,
          ),
          0,
          0,
        );
      item.append(canvas);
    } else {
      const status = document.createElement("span");
      status.className = "mgl-status";
      status.dataset.status = "BLOCKED";
      status.textContent = "BLOCKED · no image";
      item.append(status);
    }
    const description = document.createElement("small");
    description.textContent = caption || image.reason || "Captured output";
    item.append(description);
    find('[data-field="evidenceGallery"]').append(item);
  }

  function verification(progress) {
    root.dataset.verificationState = progress.state;
    find('[data-field="verificationProgress"]').textContent =
      progress.current + " · " + progress.completed + " recorded checks";
    for (const control of root.querySelectorAll(
      "[data-input], [data-flag], [data-action]",
    )) {
      if (
        [
          "close",
          "collapse",
          "export",
          "cancelTests",
          "restore",
          "phase",
          "mode",
        ].includes(control.dataset.action)
      )
        continue;
      control.disabled = progress.state === "running";
    }
  }

  function phaseProof(phase) {
    const checks = cpuResults
      .flatMap((result) => result.evidence?.results || [])
      .filter((check) =>
        new RegExp("ML-F" + phase.id.split("F")[1] + "(?![0-9])").test(
          check.suite,
        ),
      );
    if (!checks.length) return "CPU not run · image not certified";
    return (
      checks.filter((check) => check.pass).length +
      "/" +
      checks.length +
      " CPU · image not certified"
    );
  }

  function renderStages(stages = []) {
    const target = find('[data-field="stageFlow"]');
    target.replaceChildren();
    for (const stage of stages) {
      const button = document.createElement("button");
      button.dataset.action = "phase";
      button.dataset.identifier = stage.owner;
      button.dataset.status = stage.disabledByError
        ? "FAIL"
        : stage.execution === "invoked this frame"
          ? "observed"
          : "BLOCKED";
      button.textContent = stage.owner + " · " + stage.stageName;
      button.title =
        stage.execution +
        (stage.lastError ? " · " + stage.lastError : "") +
        "; invocation is not correctness";
      target.append(button);
    }
  }

  function drawHistogram(range) {
    const canvas = find('[data-canvas="bufferHistogram"]');
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    const bins = range?.histogram || [];
    const maximum = Math.max(1, ...bins);
    context.fillStyle = "#79c4ff";
    bins.forEach((count, index) => {
      const height = (count / maximum) * (canvas.height - 4);
      context.fillRect(
        (index / bins.length) * canvas.width,
        canvas.height - height,
        canvas.width / bins.length - 1,
        height,
      );
    });
  }

  updateReferences();
  return {
    addEvidenceImage,
    clearGallery: () =>
      find('[data-field="evidenceGallery"]').replaceChildren(),
    verification,
    updateReferences,
    referenceEvidence: () => latestReferences,
    drawHistogram,
    renderStages,
    phaseProof,
    setCpuResults(results) {
      cpuResults = results.filter((entry) => entry.evidence?.results);
    },
  };
}
