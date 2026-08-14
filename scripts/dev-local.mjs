import { spawn, spawnSync } from "node:child_process";

function keychainSecret() {
  if (process.platform !== "darwin") return "";
  const result = spawnSync("security", [
    "find-generic-password",
    "-w",
    "-a",
    "kanshan-table",
    "-s",
    "kanshan-table.deepseek",
  ], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

const lan = process.argv.includes("--lan");
const secret = process.env.DEEPSEEK_API_KEY || keychainSecret();
const child = spawn("next", ["dev", "--hostname", lan ? "0.0.0.0" : "127.0.0.1"], {
  stdio: "inherit",
  env: { ...process.env, ...(secret ? { DEEPSEEK_API_KEY: secret } : {}) },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code) => process.exit(code ?? 0));
