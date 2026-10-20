import { realpath, stat, open } from "node:fs/promises";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { isBundlePath } from "../referenceValidation.js";

export async function createBundleAssetReader(bundleRoot) {
  const root = await realpath(bundleRoot);
  return async (path, { expectedBytes, maxBytes }) => {
    if (!isBundlePath(path)) throw new Error("Unsafe bundle asset path");
    const actual = await realpath(resolve(root, path));
    const difference = relative(root, actual);
    if (!difference || difference === ".." || difference.startsWith(`..${sep}`) || isAbsolute(difference)) throw new Error("Asset escapes the selected bundle root");
    const metadata = await stat(actual);
    if (!metadata.isFile() || metadata.size !== expectedBytes || metadata.size > maxBytes) throw new Error("Asset size or file type is incompatible");
    const handle = await open(actual, "r");
    try {
      const bytes = new Uint8Array(expectedBytes);
      let offset = 0;
      while (offset < bytes.length) { const result = await handle.read(bytes, offset, bytes.length - offset, offset); if (!result.bytesRead) throw new Error("Asset changed while reading"); offset += result.bytesRead; }
      const extra = new Uint8Array(1);
      if ((await handle.read(extra, 0, 1, offset)).bytesRead) throw new Error("Asset grew while reading");
      return bytes;
    } finally { await handle.close(); }
  };
}
