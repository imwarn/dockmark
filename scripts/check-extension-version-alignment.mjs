import { readFile } from "node:fs/promises";

const extensionPackage = JSON.parse(await readFile("apps/extension/package.json", "utf8"));
const wxtConfig = await readFile("apps/extension/wxt.config.ts", "utf8");
const distribution = await readFile("apps/web/src/extension-distribution.ts", "utf8");

function requiredMatch(source, pattern, label) {
  const match = source.match(pattern);
  if (!match?.[1]) throw new Error(`Could not resolve ${label}.`);
  return match[1];
}

const versions = {
  package: extensionPackage.version,
  manifest: requiredMatch(wxtConfig, /\bversion:\s*["']([^"']+)["']/, "WXT manifest version"),
  web: requiredMatch(distribution, /EXTENSION_RELEASE_VERSION\s*=\s*["']([^"']+)["']/, "Web extension release version"),
};

const expected = versions.package;
const mismatches = Object.entries(versions).filter(([, version]) => version !== expected);
if (mismatches.length) {
  console.error("Extension release versions are out of sync:");
  for (const [source, version] of Object.entries(versions)) {
    console.error(`- ${source}: ${version}`);
  }
  process.exit(1);
}

console.log(`✓ Extension release versions aligned at ${expected}`);
