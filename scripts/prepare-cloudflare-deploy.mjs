import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = path.join(repoRoot, "apps", "web");
const webDeployConfig = path.join(webRoot, ".wrangler", "deploy", "config.json");
const rootDeployDir = path.join(repoRoot, ".wrangler", "deploy");
const rootDeployConfig = path.join(rootDeployDir, "config.json");
const rootUserConfig = path.join(repoRoot, "wrangler.jsonc");

await access(rootUserConfig);

const redirect = JSON.parse(await readFile(webDeployConfig, "utf8"));
if (!redirect || typeof redirect.configPath !== "string" || !redirect.configPath) {
  throw new Error(`Invalid Vite Wrangler redirect at ${webDeployConfig}`);
}

const generatedConfig = path.resolve(path.dirname(webDeployConfig), redirect.configPath);
await access(generatedConfig);

await mkdir(rootDeployDir, { recursive: true });
const rootRelativeConfigPath = path
  .relative(rootDeployDir, generatedConfig)
  .split(path.sep)
  .join("/");

await writeFile(
  rootDeployConfig,
  `${JSON.stringify({ configPath: rootRelativeConfigPath }, null, 2)}\n`,
  "utf8",
);

console.log(`Prepared root Wrangler deploy redirect: ${path.relative(repoRoot, rootDeployConfig)}`);
console.log(`Generated config: ${path.relative(repoRoot, generatedConfig)}`);
