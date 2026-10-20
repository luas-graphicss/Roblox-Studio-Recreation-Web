import { encodeCaptureFrame } from "./encodeCaptureFrame.js";

self.addEventListener("message", (event) => {
  const { id, input } = event.data;
  try {
    const encoded = encodeCaptureFrame(input);
    self.postMessage({ id, encoded }, [encoded.bytes.buffer]);
  } catch (error) { self.postMessage({ id, error: error.message }); }
});
