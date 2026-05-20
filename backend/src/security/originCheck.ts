/**
 * Origin / loopback 検証ヘルパー (S-001, #1225)
 *
 * WS connection イベントと HTTP ハンドラ共通で呼ぶ。
 * OK なら null、NG なら拒否理由文字列を返す。
 *
 * 設計方針:
 * - bind は 0.0.0.0 維持 (WSL2 cross-OS 経路維持、CLAUDE.md / AGENTS.md 前提)
 * - Origin ヘッダーあり → allowlist と照合
 * - Origin ヘッダーなし (CLI クライアント) → remote IP が loopback なら許可
 * - Host ヘッダー → allowlist で DNS rebinding 対策
 */

import type { IncomingMessage } from "node:http";

const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

// ホスト名のみで DNS rebinding を防ぐ (ポートは問わない)。
// 外部 DNS が localhost や 127.0.0.1 を名前解決することは通常できないため、
// これらだけを許可することで DNS rebinding を防止できる。
const ALLOWED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
]);

const LOOPBACK_IPS = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
]);

function isLoopback(remoteAddr: string | undefined): boolean {
  if (!remoteAddr) return false;
  if (LOOPBACK_IPS.has(remoteAddr)) return true;
  // 127.0.0.0/8 範囲
  if (/^127\./.test(remoteAddr)) return true;
  // IPv4-mapped 127.x.x.x
  if (/^::ffff:127\./.test(remoteAddr)) return true;
  return false;
}

/**
 * WS connection / HTTP request の受信時に呼ぶ。
 * OK なら null、NG なら拒否理由文字列を返す。
 */
export function checkRequestOrigin(req: IncomingMessage): string | null {
  const origin = req.headers.origin;
  const host = req.headers.host;
  const remoteAddr = req.socket?.remoteAddress ?? undefined;

  // Host header allowlist (DNS rebinding 対策)
  // ポートは問わず、ホスト名のみで照合する
  if (host) {
    const hostname = host.split(":")[0];
    if (!ALLOWED_HOSTNAMES.has(hostname)) {
      return `Host header not allowed: ${host}`;
    }
  }

  if (typeof origin === "string") {
    // Origin あり → allowlist チェック
    if (!ALLOWED_ORIGINS.has(origin)) {
      return `Origin not allowed: ${origin}`;
    }
    return null;
  }

  // Origin なし → loopback のみ許可 (CLI クライアント想定)
  if (!isLoopback(remoteAddr)) {
    return `Origin missing and remote is not loopback: ${remoteAddr ?? "unknown"}`;
  }

  return null;
}

/**
 * 動的 CORS Origin: allowlist に一致する場合は echo、それ以外は省略 (ブラウザがブロック)。
 */
export function getAllowedOriginHeader(req: IncomingMessage): string | null {
  const origin = req.headers.origin;
  if (typeof origin === "string" && ALLOWED_ORIGINS.has(origin)) {
    return origin;
  }
  return null;
}
