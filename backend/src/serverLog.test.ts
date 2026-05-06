/**
 * serverLog の単体テスト (#750 follow-up)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { initServerLog, log, ingestClientLog, shutdownServerLog } from "./serverLog.js";

let tmpRoot = "";

function readLatestLogFile(): string {
  const logDir = path.join(tmpRoot, "logs");
  if (!fs.existsSync(logDir)) return "";
  const files = fs.readdirSync(logDir).filter((f) => f.endsWith(".log"));
  if (files.length === 0) return "";
  files.sort();
  return fs.readFileSync(path.join(logDir, files[files.length - 1]), "utf-8");
}

describe("serverLog", () => {
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "backend-log-"));
    initServerLog(tmpRoot);
  });
  afterEach(() => {
    shutdownServerLog();
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("logs/ ディレクトリと日付別ファイルを作成し initialized エントリが書かれる", () => {
    const out = readLatestLogFile();
    expect(out).toContain('"category":"server-log"');
    expect(out).toContain('"msg":"logger initialized"');
  });

  it("log() が JSON Lines 形式で書き込む", () => {
    log("info", "test", "hello", { foo: "bar" });
    const out = readLatestLogFile();
    const lines = out.trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.level).toBe("info");
    expect(last.category).toBe("test");
    expect(last.msg).toBe("hello");
    expect(last.ctx).toEqual({ foo: "bar" });
    expect(last.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("ingestClientLog はカテゴリに 'client-' プレフィックスを付ける", () => {
    ingestClientLog([
      { ts: Date.now(), level: "warn", category: "redirect", msg: "/foo", ctx: { recent: 5 } },
    ]);
    const out = readLatestLogFile();
    expect(out).toContain('"category":"client-redirect"');
    expect(out).toContain('"msg":"/foo"');
  });

  it("ingestClientLog は client_ts を ctx に含める", () => {
    const clientTs = Date.UTC(2026, 0, 1, 12, 0, 0);
    ingestClientLog([{ ts: clientTs, level: "info", category: "tabsync", msg: "tab open" }]);
    const out = readLatestLogFile();
    const lines = out.trim().split("\n");
    const lastEntry = JSON.parse(lines[lines.length - 1]);
    expect(lastEntry.ctx._clientTs).toMatch(/2026-01-01T12:00:00/);
  });

  it("count を返す", () => {
    const r = ingestClientLog([
      { ts: Date.now(), level: "info", category: "a", msg: "1" },
      { ts: Date.now(), level: "warn", category: "b", msg: "2" },
    ]);
    expect(r.count).toBe(2);
  });
});
