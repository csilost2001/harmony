/**
 * 要求の大きさ・頻度の上限。1 つの接続・1 回の要求で backend (単一スレッド) を占有されないようにする。
 * 上限は環境変数で変えられる (正の整数。不正な値は既定に戻す)。仕様: docs/spec/server-security.md
 */
import type { IncomingMessage } from "node:http";

function envInt(name: string, fallback: number, env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** WebSocket の 1 メッセージの上限 (バイト)。HARMONY_MAX_WS_PAYLOAD_BYTES */
export const maxWsPayloadBytes = (env: NodeJS.ProcessEnv = process.env): number => envInt("HARMONY_MAX_WS_PAYLOAD_BYTES", 32 * 1024 * 1024, env);
/** HTTP の 1 リクエストの本文の上限 (バイト)。HARMONY_MAX_HTTP_BODY_BYTES (MCP の SDK は別に 4 MB で打ち切る) */
export const maxHttpBodyBytes = (env: NodeJS.ProcessEnv = process.env): number => envInt("HARMONY_MAX_HTTP_BODY_BYTES", 8 * 1024 * 1024, env);
/** 1 つの接続が、10 秒間に出せる要求の数。HARMONY_MAX_WS_REQUESTS_PER_10S */
export const maxWsRequestsPer10s = (env: NodeJS.ProcessEnv = process.env): number => envInt("HARMONY_MAX_WS_REQUESTS_PER_10S", 3000, env);

/** Content-Length が上限を超えていれば、拒否の理由。通してよければ null (本文を読む前に弾く) */
export function checkContentLength(req: IncomingMessage, limit = maxHttpBodyBytes()): string | null {
  const raw = req.headers["content-length"];
  if (typeof raw !== "string") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > limit ? `リクエストが大きすぎます (上限 ${Math.round(limit / 1024 / 1024)} MB)` : null;
}

/** 固定窓の回数制限。key (接続) ごとに、windowMs のあいだに max 回まで */
export class RateLimiter {
  private hits = new Map<string, { start: number; count: number }>();
  constructor(private readonly max: number, private readonly windowMs: number) {}

  /** 1 回数える。上限を超えたら false */
  allow(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h || now - h.start >= this.windowMs) {
      this.hits.set(key, { start: now, count: 1 });
      return true;
    }
    h.count++;
    return h.count <= this.max;
  }

  forget(key: string): void { this.hits.delete(key); }
}
