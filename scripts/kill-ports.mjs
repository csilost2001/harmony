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
import { readlinkSync } from "node:fs";
import path from "node:path";

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
const selfPids = new Set([process.pid, process.ppid].filter(Boolean));
const repoRoot = process.cwd();

function execText(command) {
  try {
    return execSync(command, { encoding: "utf8" });
  } catch {
    return "";
  }
}

function readProcessTable() {
  return execText("ps -eo pid=,ppid=,command=")
    .split("\n")
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (!match) return null;
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        command: match[3],
      };
    })
    .filter(Boolean);
}

function cwdIsUnderRepo(pid) {
  try {
    const cwd = readlinkSync(`/proc/${pid}/cwd`);
    const relative = path.relative(repoRoot, cwd);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  } catch {
    return false;
  }
}

function descendantsOf(seedPids, processes) {
  const all = new Set(seedPids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const proc of processes) {
      if (!all.has(proc.pid) && all.has(proc.ppid)) {
        all.add(proc.pid);
        changed = true;
      }
    }
  }
  return all;
}

function collectBackendProcessPids() {
  const processes = readProcessTable();
  const seedPids = new Set();

  for (const proc of processes) {
    if (selfPids.has(proc.pid)) continue;
    if (!cwdIsUnderRepo(proc.pid)) continue;
    if (proc.command.includes("tsx watch src/index.ts") || proc.command.includes("codex app-server")) {
      seedPids.add(proc.pid);
    }
  }

  return [...descendantsOf(seedPids, processes)].filter((pid) => !selfPids.has(pid));
}

function collectPortPids(port) {
  return execText(`lsof -ti:${port}`)
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((pid) => Number(pid))
    .filter((pid) => Number.isInteger(pid) && !selfPids.has(pid));
}

function killPids(pidList, label) {
  const unique = [...new Set(pidList)].filter(Boolean);
  if (unique.length === 0) return false;

  try {
    execSync(`kill ${unique.join(" ")}`, { stdio: "ignore" });
  } catch {
    // すでに終了済みの PID が混ざることがあるため次の確認で吸収する
  }

  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);

  const remaining = unique.filter((pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  });

  if (remaining.length > 0) {
    try {
      execSync(`kill -9 ${remaining.join(" ")}`, { stdio: "ignore" });
    } catch {
      // best effort
    }
  }

  console.log(`\x1b[33m[kill-ports]\x1b[0m ${label} を終了しました (PID: ${unique.join(", ")})`);
  return true;
}

let killed = false;

for (const port of PORTS) {
  const portPids = collectPortPids(port);
  if (killPids(portPids, `Port ${port} のプロセス`)) {
    killed = true;
  }
}

// backend が TypeScript error 等で listen 前に壊れている場合、5179 は空でも
// tsx watch / codex app-server だけが残ることがある。restart:backend が確実に
// 復旧できるよう、backend kill 時は関連プロセスも掃除する。
if (PORTS.includes(5179)) {
  const backendPids = collectBackendProcessPids();
  if (killPids(backendPids, "backend 関連プロセス")) {
    killed = true;
  }
}

if (!killed) {
  console.log(`\x1b[32m[kill-ports]\x1b[0m ${PORTS.join(" / ")} は使用中ではありません`);
}
