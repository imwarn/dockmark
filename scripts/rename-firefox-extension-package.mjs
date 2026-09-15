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

const files = await readdir(outputDir);
const extensionTargetName = `dockmark-firefox-v${version}.zip`;
const extensionTargetPath = path.join(outputDir, extensionTargetName);
const extensionCandidates = files.filter(
  (name) => name.endsWith("-firefox.zip") && name !== extensionTargetName,
);

if (extensionCandidates.length !== 1) {
  throw new Error(`Expected exactly one WXT Firefox ZIP in ${outputDir}, found ${extensionCandidates.length}.`);
}

await rm(extensionTargetPath, { force: true });
await rename(path.join(outputDir, extensionCandidates[0]), extensionTargetPath);
console.log(`Firefox extension package: ${path.relative(repoRoot, extensionTargetPath)}`);

const refreshedFiles = await readdir(outputDir);
const sourcesTargetName = `dockmark-firefox-sources-v${version}.zip`;
const sourcesTargetPath = path.join(outputDir, sourcesTargetName);
const sourcesCandidates = refreshedFiles.filter(
  (name) => name.endsWith("-sources.zip") && name !== sourcesTargetName,
);

if (sourcesCandidates.length !== 1) {
  throw new Error(`Expected exactly one WXT Firefox sources ZIP in ${outputDir}, found ${sourcesCandidates.length}.`);
}

await rm(sourcesTargetPath, { force: true });
await rename(path.join(outputDir, sourcesCandidates[0]), sourcesTargetPath);
console.log(`Firefox sources package: ${path.relative(repoRoot, sourcesTargetPath)}`);
