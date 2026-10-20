export const THUMBNAIL_HOST_CLASS = "rsw-thumb-host";
export const THUMBNAIL_FAILED_CLASS = "is-failed";


export function markThumbnailFailureOnError(image, hostElement) {
  if (!image || !hostElement) return;
  hostElement.classList.add(THUMBNAIL_HOST_CLASS);
  image.addEventListener("error", () => {
    hostElement.classList.add(THUMBNAIL_FAILED_CLASS);
  });
  image.addEventListener("load", () => {
    hostElement.classList.remove(THUMBNAIL_FAILED_CLASS);
  });
}
