import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDeployConfig = path.join(repoRoot, ".wrangler", "deploy", "config.json");
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value, label) {
  if (typeof value !== "string" || !UUID_RE.test(value) || value === ZERO_UUID) {
    throw new Error(`${label} is not a valid non-placeholder D1 UUID.`);
  }
  return value;
}

function databaseId(record) {
  if (!record || typeof record !== "object") return undefined;
  for (const key of ["uuid", "id", "database_id"]) {
    const value = record[key];
    if (typeof value === "string" && UUID_RE.test(value) && value !== ZERO_UUID) return value;
  }
  return undefined;
}

async function generatedWranglerPath() {
  const redirect = JSON.parse(await readFile(rootDeployConfig, "utf8"));
  if (!redirect || typeof redirect.configPath !== "string" || !redirect.configPath) {
    throw new Error(`Invalid root deploy redirect at ${rootDeployConfig}. Run prepare:cloudflare-deploy first.`);
  }
  return path.resolve(path.dirname(rootDeployConfig), redirect.configPath);
}

async function resolveFromAccount(databaseName) {
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  const { stdout } = await execFileAsync(executable, ["wrangler", "d1", "list", "--json"], {
    cwd: repoRoot,
    maxBuffer: 4 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout);
  const databases = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.result) ? parsed.result : [];
  const matches = databases.filter((database) => database?.name === databaseName);
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `No D1 database named ${databaseName} exists in the current Cloudflare account.`
        : `Multiple D1 databases named ${databaseName} exist. Set DOCKMARK_D1_DATABASE_ID to the intended UUID.`,
    );
  }
  return assertUuid(databaseId(matches[0]), `Resolved D1 database ${databaseName}`);
}

const generatedPath = await generatedWranglerPath();
const generated = JSON.parse(await readFile(generatedPath, "utf8"));
const bindings = Array.isArray(generated.d1_databases) ? generated.d1_databases : [];
const binding = bindings.find((candidate) => candidate?.binding === "DB") ?? bindings[0];
if (!binding || typeof binding.database_name !== "string" || !binding.database_name) {
  throw new Error(`Generated Wrangler config has no named D1 binding: ${generatedPath}`);
}

const databaseName = binding.database_name;
const override = process.env.DOCKMARK_D1_DATABASE_ID?.trim();
const id = override
  ? assertUuid(override, "DOCKMARK_D1_DATABASE_ID")
  : await resolveFromAccount(databaseName);

binding.database_id = id;
await writeFile(generatedPath, `${JSON.stringify(generated, null, 2)}\n`, "utf8");

console.log(`Resolved D1 binding DB to database '${databaseName}' for this deployment.`);
console.log(`Patched generated Wrangler config: ${path.relative(repoRoot, generatedPath)}`);
