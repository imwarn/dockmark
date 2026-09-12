import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDeployConfig = path.join(repoRoot, ".wrangler", "deploy", "config.json");

const redirect = JSON.parse(await readFile(rootDeployConfig, "utf8"));
if (!redirect || typeof redirect.configPath !== "string" || !redirect.configPath) {
  throw new Error(`Invalid root deploy redirect at ${rootDeployConfig}.`);
}

const generatedPath = path.resolve(path.dirname(rootDeployConfig), redirect.configPath);
const generated = JSON.parse(await readFile(generatedPath, "utf8"));
const bindings = Array.isArray(generated.d1_databases) ? generated.d1_databases : [];
const binding = bindings.find((candidate) => candidate?.binding === "DB") ?? bindings[0];
if (!binding || typeof binding.database_name !== "string" || !binding.database_name) {
  throw new Error(`Generated Wrangler config has no named D1 binding: ${generatedPath}`);
}

const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const args = [
  "wrangler",
  "d1",
  "migrations",
  "apply",
  binding.database_name,
  "--remote",
  "--config",
  generatedPath,
];

console.log(`Applying D1 migrations to '${binding.database_name}' using the resolved generated config.`);

await new Promise((resolve, reject) => {
  const child = spawn(executable, args, { cwd: repoRoot, stdio: "inherit" });
  child.on("error", reject);
  child.on("exit", (code, signal) => {
    if (code === 0) resolve();
    else reject(new Error(`Wrangler migration command failed (${signal ?? `exit ${code}`}).`));
  });
});
