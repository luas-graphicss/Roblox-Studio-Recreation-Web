export const STATIC_PREVIEW_ONLY_ATTRIBUTE = "data-static-preview-only";

const STATIC_PREVIEW_ONLY_SCRIPT = new RegExp(
  "[ \\t]*<script\\b[^>]*\\b" +
    STATIC_PREVIEW_ONLY_ATTRIBUTE +
    "\\b[^>]*>[\\s\\S]*?</script>[ \\t]*\\r?\\n?",
  "gi",
);


export function removeStaticPreviewOnlyScripts(html) {
  if (typeof html !== "string") return "";
  return html.replace(STATIC_PREVIEW_ONLY_SCRIPT, "");
}

export function createCdnImportMapPlugin() {
  return {
    name: "rsw-remove-cdn-import-map",
    apply: "build",
    transformIndexHtml: {


      order: "post",
      handler: (html) => removeStaticPreviewOnlyScripts(html),
    },
  };
}
