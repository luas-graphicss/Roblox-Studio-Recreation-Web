import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { verifyReferenceBundle } from "../referenceSession.js";
import { createBundleAssetReader } from "./readBundleAsset.mjs";

const [manifestPath, attestationPath, trustPath] = process.argv.slice(2);
if (!manifestPath) throw new Error("Usage: node src/phases/CP-F01/node/verifyReferencePackage.mjs manifest.json [attestation.json] [trusted-reviewers.json]");
const loadJson = async (path, fallback) => path ? JSON.parse(await readFile(resolve(path), "utf8")) : fallback;
const manifest = await loadJson(manifestPath);
const attestation = await loadJson(attestationPath, null);
const trustedReviewers = await loadJson(trustPath, []);
const readAsset = await createBundleAssetReader(dirname(resolve(manifestPath)));
const { report } = await verifyReferenceBundle({ manifest, attestation, trustedReviewers, readAsset });
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.referenceReady ? 0 : 2;
