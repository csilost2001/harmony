/**
 * Origin / loopback 検証ヘルパー (S-001, #1225)
 *
 * WS connection イベントと HTTP ハンドラ共通で呼ぶ。
 * OK なら null、NG なら拒否理由文字列を返す。
 *
 * 設計方針:
 * - bind は 0.0.0.0 維持 (WSL2 cross-OS 経路維持、CLAUDE.md / AGENTS.md 前提)
 * - Origin ヘッダーあり → allowlist、または localhost/127.0.0.1 の same-host と照合
 * - Origin ヘッダーなし (CLI クライアント) → remote IP が loopback、または Host が localhost/127.0.0.1 なら許可
 * - Host ヘッダー → allowlist で DNS rebinding 対策
 */

import type { IncomingMessage } from "node:http";

const BACKEND_PORT = process.env.DESIGNER_MCP_PORT ?? "5179";

const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  `http://localhost:${BACKEND_PORT}`,
  `http://127.0.0.1:${BACKEND_PORT}`,
  // #1342 Proposal A: lockdown e2e config (playwright.lockdown.config.ts) は main
  // config (5173/5179) と port 衝突回避のため frontend=5183 / backend=5189 で起動する。
  // localhost に閉じた dev/test 用 port のため allowlist に追加する。
  "http://localhost:5183",
  "http://127.0.0.1:5183",
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

function hostnameFromHostHeader(host: string | undefined): string | null {
  if (!host) return null;
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end >= 0 ? host.slice(1, end) : null;
  }
  return host.split(":")[0] || null;
}

function hostnameFromOrigin(origin: string): string | null {
  try {
    return new URL(origin).hostname;
  } catch {
    return null;
  }
}

function isAllowedHost(hostname: string | null): boolean {
  return hostname !== null && ALLOWED_HOSTNAMES.has(hostname);
}

function isSameAllowedHostOrigin(origin: string, host: string | undefined): boolean {
  const originHost = hostnameFromOrigin(origin);
  const requestHost = hostnameFromHostHeader(host);
  return isAllowedHost(originHost) && originHost === requestHost;
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
    const hostname = hostnameFromHostHeader(host);
    if (!isAllowedHost(hostname)) {
      return `Host header not allowed: ${host}`;
    }
  }

  if (typeof origin === "string") {
    // Origin あり → dev fixed ports または packaged same-host port remap を許可
    if (!ALLOWED_ORIGINS.has(origin) && !isSameAllowedHostOrigin(origin, host)) {
      return `Origin not allowed: ${origin}`;
    }
    return null;
  }

  // Origin なし → CLI クライアント想定。Docker published port 経由では remoteAddress が
  // bridge gateway (172.x 等) になりうるため、Host が localhost/127.0.0.1 なら許可する。
  const isTrustedDockerPublishedPort = remoteAddr !== undefined && isAllowedHost(hostnameFromHostHeader(host));
  if (!isLoopback(remoteAddr) && !isTrustedDockerPublishedPort) {
    return `Origin missing and remote is not loopback: ${remoteAddr ?? "unknown"}`;
  }

  return null;
}

/**
 * 動的 CORS Origin: allowlist に一致する場合は echo、それ以外は省略 (ブラウザがブロック)。
 */
export function getAllowedOriginHeader(req: IncomingMessage): string | null {
  const origin = req.headers.origin;
  if (typeof origin === "string" && (ALLOWED_ORIGINS.has(origin) || isSameAllowedHostOrigin(origin, req.headers.host))) {
    return origin;
  }
  return null;
}
