export const MIN_WINDOW_WIDTH = 1024;
export const MIN_WINDOW_HEIGHT = 600;


export const DEGENERATE_SIZE_THRESHOLD = 200;

function isMeasurementDegenerate(width, height) {
  return (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < DEGENERATE_SIZE_THRESHOLD ||
    height < DEGENERATE_SIZE_THRESHOLD
  );
}

export function isWindowLargeEnough(width, height) {
  return width >= MIN_WINDOW_WIDTH && height >= MIN_WINDOW_HEIGHT;
}


export function isDismissalValidForSize(dismissedSize, width, height) {
  if (!dismissedSize) return false;
  const { width: dismissedWidth, height: dismissedHeight } = dismissedSize;
  if (!Number.isFinite(dismissedWidth) || !Number.isFinite(dismissedHeight)) {
    return false;
  }
  return width >= dismissedWidth && height >= dismissedHeight;
}


export function shouldBlockEditor({
  width,
  height,
  isEmbedded = false,
  dismissedSize = null,
}) {


  if (isEmbedded) return false;
  if (isMeasurementDegenerate(width, height)) return false;

  if (isDismissalValidForSize(dismissedSize, width, height)) return false;
  return !isWindowLargeEnough(width, height);
}
