export function createDeferredAttachmentReadback(dependencies) {
  const settings = dependencies || {};
  const readAttachmentPixels =
    typeof settings.readAttachmentPixels === "function" ? settings.readAttachmentPixels : null;
  const attachmentNames = Array.isArray(settings.attachmentNames)
    ? settings.attachmentNames.slice()
    : [];

  const attachmentByName = Object.create(null);
  for (let index = 0; index !== attachmentNames.length; index += 1) {
    attachmentByName[attachmentNames[index]] = {
      name: attachmentNames[index],
      pixels: null,
      wasRequested: false,
      isForbidden: false,
    };
  }

  const frame = {
    requestedWidth: 0,
    requestedHeight: 0,
    width: 0,
    height: 0,


    gatheredWidth: 0,
    gatheredHeight: 0,
    gather: null,
    readCount: 0,
    canRead: false,
  };
  const missingAttachmentNames = [];


  function beginFrame(request) {
    const input = request || {};
    frame.requestedWidth = Math.max(0, Math.floor(Number(input.width) || 0));
    frame.requestedHeight = Math.max(0, Math.floor(Number(input.height) || 0));
    frame.width = 0;
    frame.height = 0;
    frame.gatheredWidth = 0;
    frame.gatheredHeight = 0;
    frame.gather = input.gather || null;
    frame.readCount = 0;
    frame.canRead =
      !!readAttachmentPixels && frame.requestedWidth >= 1 && frame.requestedHeight >= 1;
    missingAttachmentNames.length = 0;

    const forbidden = Array.isArray(input.skipAttachmentNames) ? input.skipAttachmentNames : [];
    for (let index = 0; index !== attachmentNames.length; index += 1) {
      const attachment = attachmentByName[attachmentNames[index]];
      attachment.pixels = null;
      attachment.wasRequested = false;
      attachment.isForbidden = forbidden.indexOf(attachment.name) !== -1;
    }
    return frame.canRead;
  }


  function pixelsFor(attachmentName) {
    const attachment = attachmentByName[attachmentName];
    if (!attachment) return null;
    if (attachment.wasRequested) return attachment.pixels;
    attachment.wasRequested = true;
    if (!frame.canRead || attachment.isForbidden) return null;

    const readback = readAttachmentPixels({
      attachmentName: attachment.name,
      x: 0,
      y: 0,
      width: frame.requestedWidth,
      height: frame.requestedHeight,


      gather: frame.gather,


      reusePixelBuffer: true,
    });
    const pixels = readback && readback.pixels ? readback.pixels : null;
    attachment.pixels = pixels;
    if (!pixels) {
      missingAttachmentNames.push(attachment.name);
      return null;
    }
    frame.readCount += 1;
    if (!(frame.width >= 1)) {
      frame.gatheredWidth = Math.floor(Number(readback.width) || 0);
      frame.gatheredHeight = Math.floor(Number(readback.height) || 0);


      frame.width = frame.gather
        ? frame.requestedWidth
        : Math.floor(Number(readback.width) || frame.requestedWidth);
      frame.height = frame.gather
        ? frame.requestedHeight
        : Math.floor(Number(readback.height) || frame.requestedHeight);
    }
    return pixels;
  }


  function describeFrame() {
    const deferredAttachmentNames = [];
    const forbiddenAttachmentNames = [];
    for (let index = 0; index !== attachmentNames.length; index += 1) {
      const attachment = attachmentByName[attachmentNames[index]];
      if (attachment.isForbidden) forbiddenAttachmentNames.push(attachment.name);
      else if (!attachment.wasRequested) deferredAttachmentNames.push(attachment.name);
    }
    return {
      canRead: frame.canRead,
      width: frame.width,
      height: frame.height,
      gathered: !!frame.gather,
      gatheredWidth: frame.gatheredWidth,
      gatheredHeight: frame.gatheredHeight,
      readCount: frame.readCount,


      missingAttachmentNames: frame.canRead ? missingAttachmentNames.slice() : attachmentNames.slice(),
      deferredAttachmentNames,
      forbiddenAttachmentNames,
      readsGBufferBackToTheCpu: true,
    };
  }

  return { beginFrame, pixelsFor, describeFrame };
}
