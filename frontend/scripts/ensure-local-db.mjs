import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const frontend = fileURLToPath(new URL("../", import.meta.url));
const wrangler = fileURLToPath(new URL("../../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const envLoader = fileURLToPath(new URL("./sites-env.mjs", import.meta.url));
const config = fileURLToPath(new URL("../dist/server/wrangler.json", import.meta.url));

if (!existsSync(config)) {
  const build = spawnSync(process.execPath, [fileURLToPath(new URL("./run-framework.mjs", import.meta.url)), "build"], { cwd: frontend, stdio: "inherit" });
  if (build.error || build.status !== 0) throw build.error ?? new Error("本地构建失败，无法初始化模拟数据库。");
}

const base = ["--import", envLoader, wrangler, "d1", "execute", "DB", "--local", "--config", config, "--persist-to", ".wrangler/state", "--json"];
function execute(args) {
  const result = spawnSync(process.execPath, [...base, ...args], { cwd: frontend, encoding: "utf8" });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr || "本地数据库初始化失败。");
  return JSON.parse(result.stdout);
}

for (const [table, file] of [
  ["nova_records", "0000_many_joshua_kane.sql"],
  ["nova_rate_limits", "0001_rate_limits.sql"],
]) {
  const rows = execute(["--command", `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`]);
  if (rows[0]?.results?.length) continue;
  execute(["--file", fileURLToPath(new URL(`../../backend/drizzle/${file}`, import.meta.url))]);
  process.stdout.write(`已初始化本地模拟数据库：${table}\n`);
}
