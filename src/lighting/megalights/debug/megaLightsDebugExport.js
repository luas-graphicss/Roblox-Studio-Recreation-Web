export function createMegaLightsDebugExporter(document = globalThis.document) {
  const objectUrls = new Set();
  let disposed = false;
  function download(blob, filename) {
    if (disposed) return;
    if (objectUrls.size >= 8) {
      const oldest = objectUrls.values().next().value;
      URL.revokeObjectURL(oldest);
      objectUrls.delete(oldest);
    }
    const url = URL.createObjectURL(blob);
    objectUrls.add(url);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }
  return {
    json(report) {
      download(
        new Blob([JSON.stringify(report, null, 2)], {
          type: "application/json",
        }),
        "megalights-diagnostics.json",
      );
    },
    png(canvas, filename = "megalights-buffer.png") {
      canvas.toBlob((blob) => {
        if (blob) download(blob, filename);
      }, "image/png");
    },
    dispose() {
      disposed = true;
      for (const url of objectUrls) URL.revokeObjectURL(url);
      objectUrls.clear();
    },
  };
}
