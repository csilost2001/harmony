/**
 * backend の接続トークン (HARMONY_AUTH_TOKEN を設定したサーバへ接続するとき) の保管。
 * トークンはこのブラウザの localStorage にだけ置く (サーバ・設計データには送らない。接続時の URL に付けるだけ)。
 * 仕様: docs/spec/server-security.md
 */
const KEY = "harmony.authToken";

export function getAuthToken(): string | null {
  try { return localStorage.getItem(KEY) || null; } catch { return null; }
}

export function setAuthToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch { /* 保存できない環境 (プライベートウィンドウなど): このページの間だけ有効にならないが、接続はできる */ }
}

/** 接続 URL にトークンを付ける (無ければそのまま) */
export function wsUrlWithToken(base: string, token: string | null): string {
  if (!token) return base;
  const u = new URL(base);
  u.searchParams.set("token", token);
  return u.toString();
}

/** サーバが接続トークンを要求して切断したか (WebSocket の close: 1008 / Unauthorized) */
export function isUnauthorizedClose(ev: { code?: number; reason?: string }): boolean {
  return ev.code === 1008 && ev.reason === "Unauthorized";
}
