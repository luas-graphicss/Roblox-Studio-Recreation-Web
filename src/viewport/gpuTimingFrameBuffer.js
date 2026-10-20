export function createGpuTimingFrameBuffer({ publish }) {
  const availableFrames = [];
  let currentFrame = null;

  function finish(frame) {
    if (!frame || !frame.closed || frame.pending !== 0) return;
    if (frame.valid && frame.passes.size > 0) publish(frame.passes, frame.flags);
    frame.passes.clear();
    frame.flags.clear();
    availableFrames.push(frame);
  }

  function beginFrame() {
    if (currentFrame) {
      currentFrame.valid = false;
      currentFrame.closed = true;
      finish(currentFrame);
    }
    currentFrame = availableFrames.pop() || { passes: new Map(), flags: new Set() };
    Object.assign(currentFrame, { pending: 0, closed: false, valid: true });
  }

  function endFrame() {
    if (!currentFrame) return;
    currentFrame.closed = true;
    finish(currentFrame);
    currentFrame = null;
  }

  function captureQuery() {
    if (!currentFrame) beginFrame();
    currentFrame.pending += 1;
    return currentFrame;
  }

  function resolveQuery(frame, passId, milliseconds) {
    if (!frame || frame.pending <= 0) return;
    if (frame.valid) {
      const duration = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
      const entry = frame.passes.get(passId);
      if (entry) entry.ms += duration;
      else frame.passes.set(passId, { ms: duration, kind: 'gpu', estimated: false });
    }
    frame.pending -= 1;
    finish(frame);
  }

  function discardQuery(frame) {
    if (!frame || frame.pending <= 0) return;
    frame.valid = false;
    frame.pending -= 1;
    finish(frame);
  }

  return {
    beginFrame, endFrame, captureQuery, resolveQuery, discardQuery,
    setFlag: name => { currentFrame?.flags.add(name); },
  };
}
