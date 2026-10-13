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

/** 失敗が続く送信元を、しばらく断る (総当たりへの対策)。窓の中で MAX_FAILURES 回失敗したら、LOCK_MS のあいだ、正しいトークンでも断る */
export const MAX_FAILURES = 10;
export const FAILURE_WINDOW_MS = 60_000;
export const LOCK_MS = 60_000;
const failures = new Map<string, { count: number; start: number; lockedUntil: number }>();

export function _resetAuthThrottleForTest(): void { failures.clear(); }

function sourceOf(req: IncomingMessage): string {
  return (req.socket?.remoteAddress ?? "unknown").replace(/^::ffff:/, "");
}

/**
 * トークンが設定されていて、要求がそれを持っていなければ、拒否の理由 (文字列)。通してよければ null。
 * allowQuery: `?token=` も受ける (WebSocket の接続だけ true)
 */
export function checkAuthToken(req: IncomingMessage, env: NodeJS.ProcessEnv = process.env, allowQuery = false, now = Date.now()): string | null {
  const expected = configuredToken(env);
  if (!expected) return null;
  const src = sourceOf(req);
  const f = failures.get(src);
  if (f && f.lockedUntil > now) return "失敗が続いたため、しばらく受け付けません";
  const given = presentedToken(req, allowQuery);
  const ok = given !== null && safeEqual(given, expected);
  if (ok) { failures.delete(src); return null; }
  // トークンが無い要求 (画面を開いただけ・最初の接続) は、失敗に数えない。違うトークンだけ数える
  if (given !== null) {
    const cur = !f || now - f.start > FAILURE_WINDOW_MS ? { count: 0, start: now, lockedUntil: 0 } : f;
    cur.count++;
    if (cur.count >= MAX_FAILURES) cur.lockedUntil = now + LOCK_MS;
    failures.set(src, cur);
  }
  return given === null ? "トークンがありません" : "トークンが違います";
}
