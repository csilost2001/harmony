/**
 * backend 物理ログ (ファイル) 出力 (#750 follow-up)
 *
 * 目的:
 *  - ブラウザの uiLog は揮発・リフレッシュで消える → サーバ側で永続化
 *  - 無限ループ系・WS エラー系・ハンドラ例外を後追い調査可能にする
 *  - ブラウザから flush された log エントリも同ファイルに統合 (client_uilog)
 *
 * 出力先: <projectRoot>/logs/harmony-mcp-YYYY-MM-DD.log (UTF-8 / 1 行 1 JSON)
 *
 * ローテーション: 日付別ファイル名で自動切替 (Date.now() 経由で即時切替)。
 * 7 日分以上のログは自動削除 (起動時)。
 *
 * バグ報告フロー:
 *   1. ユーザーがブラウザコンソールで __uiLogDump() 実行 → JSON を貼る
 *   2. 別途 logs/ ディレクトリの最新ファイルを共有
 *   3. AI 側はクライアント側 + サーバ側ログを突き合わせて root cause 特定
 */

import * as fs from "node:fs";
import * as path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  ts: string;       // ISO timestamp
  level: LogLevel;
  category: string; // e.g. "ws-bridge" / "workspace" / "handler" / "client-uilog"
  msg: string;
  ctx?: Record<string, unknown>;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
/** ログの保持日数 (既定 7 日)。DESIGNER_LOG_RETENTION_DAYS で変えられる (正の整数。不正な値は既定) */
function retentionDays(): number {
  const n = Number(process.env.DESIGNER_LOG_RETENTION_DAYS);
  return Number.isInteger(n) && n > 0 ? n : 7;
}

let _logDir: string | null = null;
let _minLevel: LogLevel = "info";
let _inLog = false;

// ── S-007: ログ出力前のシークレットマスキング ─────────────────────────────────

/**
 * JSON 文字列中のシークレット (APIキー / Bearer トークン / パスワード) をマスクする。
 * ファイルへの書き込み前に適用することで、ログ経由の機密情報漏洩 (S-007) を防ぐ。
 */
function maskSecrets(json: string): string {
  let out = json
    // Anthropic / OpenAI / 汎用 APIキー (sk-... / ant-... / claude-...)
    .replace(/\b(sk|ant|claude)-[A-Za-z0-9_-]{8,}/g, "***")
    // AWS のアクセスキー ID
    .replace(/\b(AKIA|ASIA)[A-Z0-9]{12,}\b/g, "***")
    // Authorization ヘッダの値 (Bearer / Basic / Token など。種類のあとの値を隠す)
    .replace(/((?:Bearer|Basic|Token)\s+)[^\s"',}\\]+/gi, "$1***")
    // x-api-key などの API キーのヘッダ
    .replace(/(x-api-key["']?\s*[:=]\s*)["']?[^"',}\s\\]+["']?/gi, "$1***")
    // URL に埋め込まれた認証情報 (scheme://user:password@host)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\/\s"'@:]*:[^\/\s"'@]+@/gi, "$1***@")
    // URL の ?token= / &token= (接続トークン。WebSocket の接続 URL に付く)
    .replace(/([?&](?:token|access_token|auth)=)[^&\s"',}\\]+/gi, "$1***")
    // 接続トークンそのもの (HARMONY_AUTH_TOKEN)
    .replace(/(HARMONY_AUTH_TOKEN["']?\s*[:=]\s*)["']?[^"',}\s]+["']?/gi, "$1***")
    // パスワード・シークレットフィールド (JSON の key:value 形式)
    .replace(/(["']?(?:password|passwd|secret|apiKey|api_key|token)["']?\s*[:=]\s*)["']?[^"',}\s]+["']?/gi, "$1***");
  // サーバが持っている接続トークンの値そのものは、どんな書き方 (自由な文中など) でも隠す
  const authToken = process.env.HARMONY_AUTH_TOKEN;
  if (authToken && authToken.length >= 6) out = out.split(authToken).join("***");
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────

/** logger 初期化。projectRoot は data/ の親ディレクトリ。 */
export function initServerLog(projectRoot: string): void {
  _logDir = path.join(projectRoot, "logs");
  try {
    fs.mkdirSync(_logDir, { recursive: true });
  } catch (e) {
    console.error(`[serverLog] Failed to create log dir ${_logDir}:`, e);
    _logDir = null;
    return;
  }
  _minLevel = (process.env.DESIGNER_MCP_LOG_LEVEL as LogLevel) ?? "info";
  _rotateRetention();
  // 起動 banner
  log("info", "server-log", "logger initialized", { dir: _logDir, level: _minLevel });
}

function _rotateRetention(): void {
  if (!_logDir) return;
  try {
    const files = fs.readdirSync(_logDir).filter((f) => f.startsWith("harmony-mcp-") && f.endsWith(".log"));
    const cutoff = Date.now() - retentionDays() * 86400_000;
    for (const f of files) {
      const m = f.match(/harmony-mcp-(\d{4})-(\d{2})-(\d{2})\.log/);
      if (!m) continue;
      const fileDate = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`).getTime();
      if (fileDate < cutoff) {
        try { fs.unlinkSync(path.join(_logDir, f)); } catch { /* ignore */ }
      }
    }
  } catch (e) {
    console.error("[serverLog] retention rotation failed:", e);
  }
}

function _todayFileName(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `harmony-mcp-${y}-${m}-${d}.log`;
}

/** メイン log 出力関数。category は短い文字列推奨。 */
export function log(
  level: LogLevel,
  category: string,
  msg: string,
  ctx?: Record<string, unknown>,
): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[_minLevel]) return;
  if (_inLog) return;
  _inLog = true;
  try {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      category,
      msg,
      ctx,
    };
    // ファイル出力 — appendFileSync で確実に flush (テスト容易性 + クラッシュ時の log 保全)。
    // 高頻度ログでもボトルネックにならない (server-side は秒間 100 件もない想定)。
    // 日付ロールオーバーは _todayFileName() が UTC 日付ベースで毎回算出するので自動切替。
    if (_logDir) {
      try {
        // S-007: シークレットをマスクしてからファイルに書き込む
        fs.appendFileSync(path.join(_logDir, _todayFileName()), maskSecrets(JSON.stringify(entry)) + "\n", "utf-8");
      } catch (e) {
        try { console.error("[serverLog] write failed:", e); } catch { /* swallow */ }
      }
    }
    // 重要度高は console にも出す (既存挙動互換 + 開発時の視認性)
    if (level === "warn" || level === "error") {
      const prefix = `[${entry.ts}][${category}]`;
      try {
        if (level === "error") console.error(prefix, msg, ctx ?? "");
        else console.warn(prefix, msg, ctx ?? "");
      } catch { /* swallow EPIPE */ }
    }
  } finally {
    _inLog = false;
  }
}

/** 今日のログの末尾 (新しい順ではなく、古い順の最後の `maxLines` 行)。不具合の報告に添える用。書くときにマスクしてあるので、そのまま返せる */
export function readLogTail(maxLines = 100, maxBytes = 96 * 1024): string[] {
  if (!_logDir) return [];
  const file = path.join(_logDir, _todayFileName());
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString("utf-8").split("\n").filter(Boolean);
    if (start > 0) lines.shift(); // 途中から読んだ先頭の行は、切れているので捨てる
    // 書いたあとに増えた規則・変えた環境変数にも追従するよう、返すときにもう一度隠す
    return lines.slice(-Math.min(Math.max(1, maxLines), 500)).map(maskSecrets);
  } catch { return []; }
  finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* ignore */ } } }
}

export const logDebug = (cat: string, msg: string, ctx?: Record<string, unknown>) => log("debug", cat, msg, ctx);
export const logInfo = (cat: string, msg: string, ctx?: Record<string, unknown>) => log("info", cat, msg, ctx);
export const logWarn = (cat: string, msg: string, ctx?: Record<string, unknown>) => log("warn", cat, msg, ctx);
export const logError = (cat: string, msg: string, ctx?: Record<string, unknown>) => log("error", cat, msg, ctx);

/**
 * クライアント (ブラウザ) から ui-log エントリを受け取って物理ログに統合する。
 * wsBridge の "client.log.flush" メソッドから呼ばれる想定。
 */
export function ingestClientLog(entries: ReadonlyArray<{
  ts: number;
  level: LogLevel;
  category: string;
  msg: string;
  ctx?: Record<string, unknown>;
}>): { count: number } {
  for (const e of entries) {
    log(e.level, `client-${e.category}`, e.msg, {
      ...e.ctx,
      _clientTs: new Date(e.ts).toISOString(),
    });
  }
  return { count: entries.length };
}

/** プロセス終了時のクリーンアップ。appendFileSync 利用なので buffer flush は不要 (no-op、API 互換のみ)。 */
export function shutdownServerLog(): void {
  /* no-op: appendFileSync で同期書き込み済 */
}
