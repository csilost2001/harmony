/**
 * 接続トークンによる認証 (任意)。環境変数 HARMONY_AUTH_TOKEN を設定したときだけ有効になる (未設定なら従来どおり、認証なし)。
 *
 * ローカルで自分だけが使う前提では不要だが、ポートを他の機器へ公開する (0.0.0.0 で待ち受けているため、同じネットワークから
 * 届く) 場合や、共有の環境に置く場合は、Origin の検査 (originCheck) に加えて、トークンを持つ人だけに絞る。
 *
 * - HTTP (MCP など): `Authorization: Bearer <token>` ヘッダー
 * - WebSocket (画面): 接続 URL の `?token=<token>`
 *
 * 仕様: docs/spec/server-security.md
 */
import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";

export function configuredToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const t = env.HARMONY_AUTH_TOKEN?.trim();
  return t ? t : null;
}

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function presentedToken(req: IncomingMessage, allowQuery: boolean): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === "string") {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1];
  }
  // ?token= は、ヘッダーを付けられない WebSocket (ブラウザ) だけ。HTTP で受けると、URL がログ・履歴に残りやすい
  if (allowQuery) {
    try {
      const t = new URL(req.url ?? "/", "http://localhost").searchParams.get("token");
      if (t) return t;
    } catch { /* 不正な URL は、トークンなしとして扱う */ }
  }
  return null;
}

/**
 * 総当たりへの対策: 違うトークンが続く送信元への「失敗の応答」を、だんだん遅くする (締め出さない)。
 * 締め出すと、リバースプロキシ・Docker のポート転送の背後 (全利用者が同じ送信元に見える) で、違うトークンを送るだけで
 * 正しいトークンを持つ全員を断てるため。正しいトークンの要求は、遅らせない。トークンは、推測できない長さ (32 文字以上の乱数) にする。
 */
export const FREE_FAILURES = 5;
export const FAILURE_WINDOW_MS = 60_000;
export const MAX_DELAY_MS = 5_000;
const MAX_TRACKED = 10_000;
const failures = new Map<string, { count: number; start: number }>();

export function _resetAuthThrottleForTest(): void { failures.clear(); }

function sourceOf(req: IncomingMessage): string {
  return (req.socket?.remoteAddress ?? "unknown").replace(/^::ffff:/, "");
}

/** 期限が切れた記録を捨てる。送信元が多すぎるときは、古いものから捨てる (メモリが増え続けない) */
function sweep(now: number): void {
  if (failures.size < 1000) return;
  for (const [k, f] of failures) if (now - f.start > FAILURE_WINDOW_MS) failures.delete(k);
  while (failures.size > MAX_TRACKED) failures.delete(failures.keys().next().value as string);
}

/**
 * トークンが設定されていて、要求がそれを持っていなければ、拒否の理由 (文字列)。通してよければ null。
 * allowQuery: `?token=` も受ける (WebSocket の接続だけ true)
 */
export function checkAuthToken(req: IncomingMessage, env: NodeJS.ProcessEnv = process.env, allowQuery = false, now = Date.now()): string | null {
  const expected = configuredToken(env);
  if (!expected) return null;
  const given = presentedToken(req, allowQuery);
  if (given !== null && safeEqual(given, expected)) return null;
  // トークンが無い要求 (画面を開いただけ・最初の接続) は、失敗に数えない。違うトークンだけ数える
  if (given !== null) {
    sweep(now);
    const src = sourceOf(req);
    const f = failures.get(src);
    const cur = !f || now - f.start > FAILURE_WINDOW_MS ? { count: 0, start: now } : f;
    cur.count++;
    failures.set(src, cur);
  }
  return given === null ? "トークンがありません" : "トークンが違います";
}

/** 失敗の応答を遅らせる時間 (ミリ秒)。違うトークンが FREE_FAILURES 回を超えて続く送信元だけ。倍々で、MAX_DELAY_MS まで */
export function authFailureDelayMs(req: IncomingMessage, now = Date.now()): number {
  const f = failures.get(sourceOf(req));
  if (!f || now - f.start > FAILURE_WINDOW_MS || f.count <= FREE_FAILURES) return 0;
  return Math.min(250 * 2 ** (f.count - FREE_FAILURES - 1), MAX_DELAY_MS);
}
