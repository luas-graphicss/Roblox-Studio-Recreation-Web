export async function readBoundedImageBlob(response, { maximumBytes, signal }) {
  const reader = response.body?.getReader?.();
  if (!reader) throw new TypeError("Dirt image response requires a readable byte stream");
  const chunks = [];
  let receivedBytes = 0;
  let completed = false;
  const cancelRead = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener("abort", cancelRead, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new TypeError("Dirt image stream must provide byte chunks");
      receivedBytes += value.byteLength;
      if (receivedBytes > maximumBytes) throw new RangeError("Dirt mask download exceeds its byte budget");
      chunks.push(value);
    }
    if (receivedBytes === 0) throw new RangeError("Dirt mask download is empty");
    completed = true;
    return new Blob(chunks, { type: response.headers.get("content-type") ?? "" });
  } finally {
    signal?.removeEventListener("abort", cancelRead);
    if (!completed) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
