export function captureMegaLightsDebugBeauty({
  document,
  renderer,
  packet,
  flags,
}) {
  if (!packet?.request?.camera || !packet?.report)
    throw new Error("An observed engine draw is required");
  const source = renderer.domElement;
  if (!(source?.width > 0) || !(source?.height > 0))
    throw new Error("The drawing buffer is empty");
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(320, source.width);
  canvas.height = Math.max(
    1,
    Math.min(320, Math.round((canvas.width * source.height) / source.width)),
  );
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas readback is unavailable");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const camera = packet.request.camera;
  return {
    width: canvas.width,
    height: canvas.height,
    pixels: new Uint8ClampedArray(
      context.getImageData(0, 0, canvas.width, canvas.height).data,
    ),
    frameIndex: packet.report.frameIndex ?? null,
    camera: camera.matrixWorld?.toArray() || null,
    projection: camera.projectionMatrix?.toArray() || null,
    baseline:
      flags.find((flag) => flag.id === "MegaLightsBaseline")?.on ?? null,
    tier: packet.request.tierName,
    pipelineRan: packet.report.ran,
    refusal: packet.report.refusal || packet.report.failure || null,
    sourceWidth: source.width,
    sourceHeight: source.height,
    time: new Date().toISOString(),
  };
}
