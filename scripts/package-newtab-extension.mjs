import { cp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = path.join(repoRoot, "apps", "extension");
const outputRoot = path.join(extensionRoot, ".output");
const sourceDir = path.join(outputRoot, "chrome-mv3");
const variantDir = path.join(outputRoot, "chrome-mv3-newtab");
const packageJson = JSON.parse(await readFile(path.join(extensionRoot, "package.json"), "utf8"));
const version = packageJson.version;

if (typeof version !== "string" || !version) {
  throw new Error("Extension package.json does not contain a version.");
}

await rm(variantDir, { recursive: true, force: true });
await cp(sourceDir, variantDir, { recursive: true });

const manifestPath = path.join(variantDir, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.name = "Dockmark New Tab";
manifest.description = "Dockmark browser bridge with an opt-in new tab override that opens your configured Dockmark site.";
manifest.chrome_url_overrides = { newtab: "newtab.html" };
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

for (const required of ["newtab.html", "newtab.js"]) {
  await readFile(path.join(variantDir, required));
}

const targetName = `dockmark-newtab-chrome-v${version}.zip`;
const targetPath = path.join(outputRoot, targetName);
const temporaryName = `${targetName}.tmp`;
const temporaryPath = path.join(outputRoot, temporaryName);
await rm(targetPath, { force: true });
await rm(temporaryPath, { force: true });

const result = spawnSync("zip", ["-qr", temporaryPath, "."], {
  cwd: variantDir,
  encoding: "utf8",
});
if (result.status !== 0) {
  throw new Error(`Could not package Dockmark New Tab variant: ${result.stderr || result.stdout || "zip failed"}`);
}
await rename(temporaryPath, targetPath);
console.log(`Dockmark New Tab package: ${path.relative(repoRoot, targetPath)}`);
