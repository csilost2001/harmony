/**
 * scripts/kill-ports.mjs
 *
 * 5173 / 5179 を占有しているプロセスを強制終了する。
 * `npm run kill` (両方)、または `npm run restart:backend` / `npm run restart:frontend`
 * (片方のみ、#1400) の前置ステップとして使用。
 *
 * 使い方:
 *   node scripts/kill-ports.mjs              # 5173 と 5179 両方
 *   node scripts/kill-ports.mjs --port 5179  # 5179 のみ (backend 再起動用)
 *   node scripts/kill-ports.mjs --port 5173  # 5173 のみ (frontend 再起動用)
 */

import { execSync } from "node:child_process";

const DEFAULT_PORTS = [5173, 5179];

function parsePorts() {
  const argv = process.argv.slice(2);
  const idx = argv.findIndex((a) => a === "--port");
  if (idx === -1) return DEFAULT_PORTS;
  const value = argv[idx + 1];
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(`\x1b[31m[kill-ports]\x1b[0m 無効な --port 値: ${value}`);
    process.exit(1);
  }
  return [port];
}

const PORTS = parsePorts();
let killed = false;

for (const port of PORTS) {
  try {
    const pids = execSync(`lsof -ti:${port}`, { encoding: "utf8" }).trim();
    if (pids) {
      const pidList = pids.split("\n").filter(Boolean);
      execSync(`kill -9 ${pidList.join(" ")}`);
      console.log(`\x1b[33m[kill-ports]\x1b[0m Port ${port} のプロセスを終了しました (PID: ${pidList.join(", ")})`);
      killed = true;
    }
  } catch {
    // lsof が 0 件のときも非ゼロ終了するため握り潰す
  }
}

if (!killed) {
  console.log(`\x1b[32m[kill-ports]\x1b[0m ${PORTS.join(" / ")} は使用中ではありません`);
}
