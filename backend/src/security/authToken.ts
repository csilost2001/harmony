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

function presentedToken(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === "string") {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1];
  }
  try {
    const t = new URL(req.url ?? "/", "http://localhost").searchParams.get("token");
    if (t) return t;
  } catch { /* 不正な URL は、トークンなしとして扱う */ }
  return null;
}

/** トークンが設定されていて、要求がそれを持っていなければ、拒否の理由 (文字列)。通してよければ null */
export function checkAuthToken(req: IncomingMessage, env: NodeJS.ProcessEnv = process.env): string | null {
  const expected = configuredToken(env);
  if (!expected) return null;
  const given = presentedToken(req);
  if (!given) return "トークンがありません";
  return safeEqual(given, expected) ? null : "トークンが違います";
}
