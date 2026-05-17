/**
 * Port を占有している古い backend プロセスを強制終了するユーティリティ (#846)。
 * #1144 Phase-2: wsBridge.ts から責務分離。
 *
 * WSL2 / Linux / macOS / Windows 全対応。
 */
import { execSync } from "child_process";
import { platform } from "node:os";

/** ポートを占有している古い backend プロセスを強制終了 (#846: WSL2/Linux/macOS 対応) */
export function killStaleProcessOnPort(port: number): boolean {
  return platform() === "win32"
    ? killStaleProcessOnPortWin32(port)
    : killStaleProcessOnPortPosix(port);
}

/** Windows 経路: netstat + taskkill */
function killStaleProcessOnPortWin32(port: number): boolean {
  try {
    const output = execSync(`netstat -ano -p tcp`, { encoding: "utf8", windowsHide: true });
    const lines = output.split(/\r?\n/);
    const ownPid = process.pid;
    const pids = new Set<number>();

    for (const line of lines) {
      if (!/LISTENING/.test(line)) continue;
      // 127.0.0.1 / 0.0.0.0 / [::] いずれの bind でも検出 (#302 対応で HTTP サーバは 0.0.0.0 bind)
      const match = line.match(/(?:127\.0\.0\.1|0\.0\.0\.0|\[::\]|\[::1\]):(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
      if (!match) continue;
      if (parseInt(match[1], 10) !== port) continue;
      const pid = parseInt(match[2], 10);
      if (pid !== ownPid) pids.add(pid);
    }

    if (pids.size === 0) return false;

    for (const pid of pids) {
      console.error(`[WsBridge] Killing stale process PID=${pid} on port ${port}`);
      try {
        execSync(`taskkill /F /PID ${pid}`, { windowsHide: true, stdio: "ignore" });
      } catch (e) {
        console.error(`[WsBridge] Failed to kill PID=${pid}:`, e);
      }
    }
    return true;
  } catch (e) {
    console.error("[WsBridge] killStaleProcessOnPort error:", e);
    return false;
  }
}

/** POSIX 経路 (Linux / macOS / WSL2): lsof + kill -9 */
function killStaleProcessOnPortPosix(port: number): boolean {
  // -sTCP:LISTEN は重要: これが無いと当該 port に接続中のクライアント PID も返り、
  // 無関係なプロセス (例: HTTP MCP client) を巻き添えで kill してしまう。
  let output: string;
  try {
    output = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (e) {
    // execSync は shell 経由のため lsof 未導入は shell exit status 127、
    // 該当プロセス無しは lsof 自身が exit 1。前者のみ warn で可視化する。
    const status = (e as { status?: number }).status;
    if (status === 127) {
      console.warn(`[WsBridge] lsof not found; stale process kill on port ${port} skipped`);
    }
    return false;
  }

  const ownPid = process.pid;
  const pids = new Set<number>();
  for (const token of output.split(/\s+/)) {
    const pid = parseInt(token, 10);
    if (Number.isFinite(pid) && pid > 0 && pid !== ownPid) pids.add(pid);
  }

  if (pids.size === 0) return false;

  for (const pid of pids) {
    console.error(`[WsBridge] Killing stale process PID=${pid} on port ${port}`);
    try {
      execSync(`kill -9 ${pid}`, { stdio: "ignore" });
    } catch (e) {
      console.error(`[WsBridge] Failed to kill PID=${pid}:`, e);
    }
  }
  return true;
}
