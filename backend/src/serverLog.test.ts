/**
 * serverLog の単体テスト (#750 follow-up)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { initServerLog, log, logError, ingestClientLog, shutdownServerLog, readLogTail } from "./serverLog.js";

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
    vi.restoreAllMocks();
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

  it("console.error が EPIPE を sync throw しても log() が throw しない", () => {
    vi.spyOn(console, "error").mockImplementation(() => {
      const e: NodeJS.ErrnoException = new Error("write EPIPE");
      e.code = "EPIPE";
      throw e;
    });
    expect(() => logError("test", "test error msg", { foo: "bar" })).not.toThrow();
  });

  it("連続 logError 2 回でも両方 file に書き込まれる (再入 guard が false positive しない)", () => {
    logError("test", "msg1");
    logError("test", "msg2");
    const logsDir = path.join(tmpRoot, "logs");
    const searchDir = fs.existsSync(logsDir) ? logsDir : tmpRoot;
    const logFiles = fs.readdirSync(searchDir).filter((f) => f.startsWith("harmony-mcp-"));
    expect(logFiles.length).toBeGreaterThanOrEqual(1);
    const content = fs.readFileSync(path.join(searchDir, logFiles[0]), "utf-8");
    expect(content).toContain("msg1");
    expect(content).toContain("msg2");
  });

  it("file 書き込み失敗時にも throw しない", () => {
    const logsDir = path.join(tmpRoot, "logs");
    if (fs.existsSync(logsDir)) fs.rmSync(logsDir, { recursive: true, force: true });
    else fs.rmSync(tmpRoot, { recursive: true, force: true });
    expect(() => logError("test", "msg after rm")).not.toThrow();
  });
  it("シークレットはログに残らない (API キー・Bearer・?token=・パスワード・接続トークン)", () => {
    log("info", "test", "secrets", {
      header: "Authorization: Bearer abc123.def-456",
      url: "ws://localhost:5179/?token=s3cretTOKEN&x=1",
      key: "sk-ant-api03-ABCDEFGHIJKLMNOP",
      env: "HARMONY_AUTH_TOKEN=topsecretvalue",
      body: { password: "hunter2", apiKey: "k-12345678" },
    });
    const out = readLatestLogFile();
    for (const leaked of ["abc123.def-456", "s3cretTOKEN", "ABCDEFGHIJKLMNOP", "topsecretvalue", "hunter2", "k-12345678"]) {
      expect(out, leaked).not.toContain(leaked);
    }
    expect(out).toContain("***");
  });

  it("保持日数: 既定は 7 日、DESIGNER_LOG_RETENTION_DAYS で変えられる (不正な値は既定)", () => {
    const logDir = path.join(tmpRoot, "logs");
    const name = (daysAgo: number) => {
      const d = new Date(Date.now() - daysAgo * 86400_000);
      return `harmony-mcp-${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}.log`;
    };
    const touch = () => { for (const d of [1, 4, 10]) fs.writeFileSync(path.join(logDir, name(d)), "x"); };
    const exists = (d: number) => fs.existsSync(path.join(logDir, name(d)));

    touch(); initServerLog(tmpRoot);
    expect([exists(1), exists(4), exists(10)]).toEqual([true, true, false]);

    process.env.DESIGNER_LOG_RETENTION_DAYS = "2";
    try { touch(); initServerLog(tmpRoot); expect([exists(1), exists(4), exists(10)]).toEqual([true, false, false]); }
    finally { delete process.env.DESIGNER_LOG_RETENTION_DAYS; }

    process.env.DESIGNER_LOG_RETENTION_DAYS = "abc";
    try { touch(); initServerLog(tmpRoot); expect([exists(1), exists(4), exists(10)]).toEqual([true, true, false]); }
    finally { delete process.env.DESIGNER_LOG_RETENTION_DAYS; }
  });

  it("readLogTail は、今日のログの末尾の行を返す (書くときにマスクしてあるので、秘密は含まない)", () => {
    for (let i = 0; i < 30; i++) log("info", "tail-test", `行 ${i}`);
    log("info", "tail-test", "接続", { url: "ws://localhost/?token=SECRETVALUE123" });
    const lines = readLogTail(5);
    expect(lines).toHaveLength(5);
    expect(lines[lines.length - 1]).toContain("接続");
    expect(lines.join("\n")).not.toContain("SECRETVALUE123");
    expect(JSON.parse(lines[0]).category).toBe("tail-test");
    expect(readLogTail(100000).length).toBeLessThanOrEqual(500);
  });

  it("readLogTail は、ログの無いとき (初期化前・読めない) でも空で返す。大きなファイルの途中から読んだ先頭の行は捨てる", () => {
    shutdownServerLog();
    expect(Array.isArray(readLogTail())).toBe(true);
    initServerLog(tmpRoot);
    for (let i = 0; i < 400; i++) log("info", "big", "x".repeat(200) + i);
    const lines = readLogTail(500, 4096); // 4 KB だけ読む
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => { try { JSON.parse(l); return true; } catch { return false; } })).toBe(true); // 切れた行を含まない
  });
});

describe("ログのマスク (読み返すときも)", () => {
  beforeEach(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "backend-log-mask-")); initServerLog(tmpRoot); });
  afterEach(() => { delete process.env.HARMONY_AUTH_TOKEN; shutdownServerLog(); try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("Basic 認証・URL の認証情報・x-api-key・AWS のキー・自由な文中の接続トークンの値は、ファイルにも、返す行にも出ない", () => {
    process.env.HARMONY_AUTH_TOKEN = "tok-abcdef123456";
    log("info", "mask", "headers", { auth: "Authorization: Basic dXNlcjpwYXNz", db: "postgres://admin:s3cr3tpw@db.example/app", key: "x-api-key: ZZZ999secretvalue", aws: "AKIAIOSFODNN7EXAMPLE" });
    log("info", "mask", "接続トークンは tok-abcdef123456 です");
    const file = readLatestLogFile();
    const lines = readLogTail(10);
    for (const text of [file, lines.join("\n")]) {
      expect(text).not.toContain("dXNlcjpwYXNz");
      expect(text).not.toContain("s3cr3tpw");
      expect(text).not.toContain("ZZZ999secretvalue");
      expect(text).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(text).not.toContain("tok-abcdef123456");
    }
    expect(lines.join("\n")).toContain("db.example"); // ホスト名など、秘密でない部分は残す
  });

  it("読み返すときにも隠す: 隠す前の形で書かれていた古い行も、返すときには隠れる", () => {
    const dir = path.join(tmpRoot, "logs");
    const name = fs.readdirSync(dir).find((f) => f.endsWith(".log")) as string;
    fs.appendFileSync(path.join(dir, name), JSON.stringify({ ts: "x", level: "info", category: "old", msg: "Authorization: Basic b2xkOm9sZA==" }) + "\n");
    expect(readLogTail(5).join("\n")).not.toContain("b2xkOm9sZA==");
  });
});
