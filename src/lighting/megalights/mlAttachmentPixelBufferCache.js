export function createAttachmentPixelBufferCache() {
  const bufferByAttachmentName = new Map();

  return {


    bufferFor(attachmentName, floatCount) {
      const requestedLength = Math.max(0, Math.floor(Number(floatCount) || 0));
      const cachedBuffer = bufferByAttachmentName.get(attachmentName);


      if (cachedBuffer && cachedBuffer.length === requestedLength) return cachedBuffer;
      const buffer = new Float32Array(requestedLength);
      bufferByAttachmentName.set(attachmentName, buffer);
      return buffer;
    },


    release() {
      bufferByAttachmentName.clear();
    },

    describe() {
      let totalFloatCount = 0;
      bufferByAttachmentName.forEach((buffer) => {
        totalFloatCount += buffer.length;
      });
      return { attachmentCount: bufferByAttachmentName.size, totalFloatCount };
    },
  };
}
