import { spawn } from "node:child_process";

const isWorkersBuild = process.env.WORKERS_CI === "1";
const branch = process.env.WORKERS_CI_BRANCH ?? "";
const executable = process.platform === "win32" ? "npm.cmd" : "npm";

function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["run", script], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} failed (${signal ?? `exit ${code}`}).`));
    });
  });
}

if (!isWorkersBuild) {
  console.log("Skipping Cloudflare Workers Build preparation outside WORKERS_CI.");
  process.exit(0);
}

console.log(`Preparing Cloudflare Workers Build${branch ? ` for branch '${branch}'` : ""}.`);
await run("prepare:cloudflare-deploy");
await run("resolve:cloudflare-d1");

if (branch === "main") {
  await run("db:migrate:remote:built");
} else {
  console.log("Skipping remote D1 migrations for non-production branch.");
}

console.log("Cloudflare Workers Build configuration is ready for Wrangler deploy/version upload.");
