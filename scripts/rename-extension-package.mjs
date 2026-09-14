import { readdir, rename, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = path.join(repoRoot, "apps", "extension");
const outputDir = path.join(extensionRoot, ".output");
const packageJson = JSON.parse(await readFile(path.join(extensionRoot, "package.json"), "utf8"));
const version = packageJson.version;

if (typeof version !== "string" || !version) {
  throw new Error("Extension package.json does not contain a version.");
}

const targetName = `dockmark-chrome-v${version}.zip`;
const targetPath = path.join(outputDir, targetName);
const files = await readdir(outputDir);
const candidates = files.filter((name) => name.endsWith("-chrome.zip") && name !== targetName);

if (candidates.length !== 1) {
  throw new Error(`Expected exactly one WXT Chromium ZIP in ${outputDir}, found ${candidates.length}.`);
}

await rm(targetPath, { force: true });
await rename(path.join(outputDir, candidates[0]), targetPath);
console.log(`Chromium extension package: ${path.relative(repoRoot, targetPath)}`);
