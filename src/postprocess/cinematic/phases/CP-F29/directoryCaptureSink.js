async function hashBytes(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createDirectoryCaptureSink(root, sequenceId) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(sequenceId) || typeof root?.getDirectoryHandle !== "function") throw new TypeError("Capture sink requires a writable directory and safe sequence identifier");
  let directory = null;
  let settled = false;
  const frames = new Set();
  async function open() {
    if (directory) return directory;
    try { await root.getDirectoryHandle(sequenceId); }
    catch (error) {
      if (error.name !== "NotFoundError") throw error;
      directory = await root.getDirectoryHandle(sequenceId, { create: true });
      return directory;
    }
    throw new Error("Capture sequence directory already exists; existing files will not be overwritten");
  }
  async function write(name, content) {
    const target = await open();
    const handle = await target.getFileHandle(name, { create: true });
    const stream = await handle.createWritable();
    try { await stream.write(content); await stream.close(); }
    catch (error) { await stream.abort?.(); throw error; }
  }
  return Object.freeze({
    async writeFrame({ encoded, metadata, signal }) {
      if (settled || frames.has(metadata.outputFrameId) || metadata.sequenceId !== sequenceId) throw new Error("Duplicate frame or incorrect sequence sink");
      if (signal?.aborted) throw new DOMException("Capture cancelled", "AbortError");
      if (!["exr", "png", "rgba32f"].includes(encoded.extension)) throw new Error("Invalid capture file extension");
      const stem = `${sequenceId}-${String(metadata.outputFrameId).padStart(8, "0")}`;
      const sha256 = await hashBytes(encoded.bytes);
      await write(`${stem}.${encoded.extension}`, encoded.bytes);
      await write(`${stem}.json`, JSON.stringify({ ...metadata, fileOrigin: encoded.orientation, encoder: encoded.encoder, sha256 }, null, 2));
      frames.add(metadata.outputFrameId);
      return { outputFrameId: metadata.outputFrameId, path: `${stem}.${encoded.extension}`, sha256, bytes: encoded.bytes.byteLength };
    },
    async finish(manifest) { if (settled) throw new Error("Capture sink is closed"); await write("manifest.json", JSON.stringify(manifest, null, 2)); settled = true; },
    async abort({ error, completedFrames }) { if (settled) return; if (directory) await write("aborted.json", JSON.stringify({ status: "aborted", error, completedFrames }, null, 2)); settled = true; }
  });
}
