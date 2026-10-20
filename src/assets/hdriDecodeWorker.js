import { decodeHdriJob } from "./hdriDecodeJob.js";

self.onmessage = async (event) => {
  const request = event.data || {};
  try {
    const decoded = await decodeHdriJob(new Uint8Array(request.buffer), request.kind, request.maxSize, request.intensity);
    self.postMessage(
      { id: request.id, ok: true, width: decoded.width, height: decoded.height, half: decoded.half.buffer, stats: decoded.stats },
      [decoded.half.buffer],
    );
  } catch (error) {
    self.postMessage({ id: request.id, ok: false, error: String((error && error.message) || error) });
  }
};
