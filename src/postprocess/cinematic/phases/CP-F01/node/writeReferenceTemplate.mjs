import { writeFile } from "node:fs/promises";
import { createReferenceManifest } from "../referenceManifest.js";

const path = process.argv[2];
if (!path) throw new Error("Provide a new output path for the unresolved reference template");
await writeFile(path, JSON.stringify(createReferenceManifest(), null, 2) + "\n", { flag: "wx" });
console.log(`Created unresolved UE5.9 reference template: ${path}`);
