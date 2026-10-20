export function createMegaLightsDebugOverlay({
  THREE,
  renderer,
  document = globalThis.document,
}) {
  let canvas = null;
  const point = new THREE.Vector3();
  function setEnabled(enabled) {
    if (!enabled) {
      canvas?.remove();
      canvas = null;
      return;
    }
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.dataset.megaLightsOverlay = "true";
    canvas.setAttribute(
      "aria-label",
      "MegaLights local-light projection overlay",
    );
    Object.assign(canvas.style, {
      position: "fixed",
      pointerEvents: "none",
      zIndex: "17999",
    });
    document.body.append(canvas);
  }
  function draw(frame) {
    if (!canvas || !frame?.camera) return;
    const rectangle = renderer.domElement.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rectangle.width));
    canvas.height = Math.max(1, Math.floor(rectangle.height));
    canvas.style.left = rectangle.left + "px";
    canvas.style.top = rectangle.top + "px";
    const context = canvas.getContext("2d");
    context.font = "11px system-ui";
    const lights = frame.lightSceneData;
    if (!lights?.ready) {
      context.fillStyle = "#ffd27f";
      context.fillText("MegaLights light data unavailable", 16, 24);
      return;
    }
    const limit = Math.min(lights.lightCount, 256);
    for (let index = 0; index < limit; index += 1) {
      const light = lights.readLightAt(index);
      if (!light?.positionView) continue;
      point
        .fromArray(light.positionView)
        .applyMatrix4(frame.camera.matrixWorld)
        .project(frame.camera);
      if (
        point.z < -1 ||
        point.z > 1 ||
        Math.abs(point.x) > 1 ||
        Math.abs(point.y) > 1
      )
        continue;
      const x = ((point.x + 1) * canvas.width) / 2;
      const y = ((1 - point.y) * canvas.height) / 2;
      context.strokeStyle = "#81edc0";
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(x, y, 7, 0, Math.PI * 2);
      context.stroke();
      context.fillStyle = "#e0fff1";
      context.fillText("L" + index, x + 10, y + 3);
    }
    context.fillStyle = "#b8dfd0";
    context.fillText(
      "Projected packed lights · " +
        limit +
        "/" +
        lights.lightCount +
        " · markers do not prove illumination",
      12,
      canvas.height - 14,
    );
  }
  return {
    setEnabled,
    draw,
    dispose() {
      setEnabled(false);
    },
  };
}
