/**
 * originCheck.ts のユニットテスト (S-001, #1225)
 */

import { describe, it, expect } from "vitest";
import type { IncomingMessage } from "node:http";
import { checkRequestOrigin, getAllowedOriginHeader } from "./originCheck.js";

/**
 * テスト用の IncomingMessage モックを生成する。
 */
function makeReq(opts: {
  origin?: string;
  host?: string;
  remoteAddress?: string;
}): IncomingMessage {
  return {
    headers: {
      ...(opts.origin !== undefined ? { origin: opts.origin } : {}),
      ...(opts.host !== undefined ? { host: opts.host } : {}),
    },
    socket: {
      remoteAddress: opts.remoteAddress,
    },
  } as unknown as IncomingMessage;
}

// ── checkRequestOrigin ────────────────────────────────────────────────────────

describe("checkRequestOrigin", () => {
  it("正常: Origin あり + allowlist 内 (localhost:5173) → null", () => {
    const req = makeReq({ origin: "http://localhost:5173", host: "localhost:5179" });
    expect(checkRequestOrigin(req)).toBeNull();
  });

  it("正常: Origin あり + allowlist 内 (127.0.0.1:5173) → null", () => {
    const req = makeReq({ origin: "http://127.0.0.1:5173", host: "localhost:5179" });
    expect(checkRequestOrigin(req)).toBeNull();
  });

  it("異常: Origin あり + allowlist 外 → 拒否文字列を返す", () => {
    const req = makeReq({ origin: "http://evil.com", host: "localhost:5179" });
    const result = checkRequestOrigin(req);
    expect(result).not.toBeNull();
    expect(result).toContain("Origin not allowed");
    expect(result).toContain("http://evil.com");
  });

  it("正常: Origin なし + remoteAddress=127.0.0.1 → null (loopback)", () => {
    const req = makeReq({ remoteAddress: "127.0.0.1", host: "localhost:5179" });
    expect(checkRequestOrigin(req)).toBeNull();
  });

  it("正常: Origin なし + remoteAddress=::1 → null (IPv6 loopback)", () => {
    const req = makeReq({ remoteAddress: "::1", host: "localhost:5179" });
    expect(checkRequestOrigin(req)).toBeNull();
  });

  it("正常: Origin なし + remoteAddress=::ffff:127.0.0.1 → null (IPv4-mapped loopback)", () => {
    const req = makeReq({ remoteAddress: "::ffff:127.0.0.1", host: "localhost:5179" });
    expect(checkRequestOrigin(req)).toBeNull();
  });

  it("正常: Origin なし + remoteAddress=127.0.0.2 → null (127.x.x.x範囲)", () => {
    const req = makeReq({ remoteAddress: "127.0.0.2", host: "localhost:5179" });
    expect(checkRequestOrigin(req)).toBeNull();
  });

  it("異常: Origin なし + remoteAddress=192.168.1.5 → 拒否文字列を返す", () => {
    const req = makeReq({ remoteAddress: "192.168.1.5", host: "localhost:5179" });
    const result = checkRequestOrigin(req);
    expect(result).not.toBeNull();
    expect(result).toContain("not loopback");
    expect(result).toContain("192.168.1.5");
  });

  it("異常: Origin なし + remoteAddress なし → 拒否文字列を返す", () => {
    const req = makeReq({ host: "localhost:5179" });
    const result = checkRequestOrigin(req);
    expect(result).not.toBeNull();
    expect(result).toContain("not loopback");
  });

  it("異常: Host header が allowlist 外のホスト名 → 拒否文字列を返す (DNS rebinding 対策)", () => {
    const req = makeReq({ origin: "http://localhost:5173", host: "evil.com:80" });
    const result = checkRequestOrigin(req);
    expect(result).not.toBeNull();
    expect(result).toContain("Host header not allowed");
    expect(result).toContain("evil.com:80");
  });

  it("正常: Host header が localhost:5179 → null", () => {
    const req = makeReq({ origin: "http://localhost:5173", host: "localhost:5179" });
    expect(checkRequestOrigin(req)).toBeNull();
  });

  it("正常: Host header が localhost:5201 (テスト用ポート) → null", () => {
    const req = makeReq({ origin: "http://localhost:5173", host: "localhost:5201" });
    expect(checkRequestOrigin(req)).toBeNull();
  });

  it("正常: Host header が 127.0.0.1:5179 → null", () => {
    const req = makeReq({ origin: "http://127.0.0.1:5173", host: "127.0.0.1:5179" });
    expect(checkRequestOrigin(req)).toBeNull();
  });

  it("正常: Host header なし + Origin あり + allowlist 内 → null", () => {
    // Host なしの場合は Host チェックをスキップ
    const req = makeReq({ origin: "http://localhost:5173" });
    expect(checkRequestOrigin(req)).toBeNull();
  });
});

// ── getAllowedOriginHeader ─────────────────────────────────────────────────────

describe("getAllowedOriginHeader", () => {
  it("正常: allowlist 内の Origin → echo する", () => {
    const req = makeReq({ origin: "http://localhost:5173" });
    expect(getAllowedOriginHeader(req)).toBe("http://localhost:5173");
  });

  it("正常: allowlist 内の Origin (127.0.0.1 版) → echo する", () => {
    const req = makeReq({ origin: "http://127.0.0.1:5173" });
    expect(getAllowedOriginHeader(req)).toBe("http://127.0.0.1:5173");
  });

  it("異常: allowlist 外の Origin → null (省略)", () => {
    const req = makeReq({ origin: "http://evil.com" });
    expect(getAllowedOriginHeader(req)).toBeNull();
  });

  it("正常: Origin なし → null", () => {
    const req = makeReq({});
    expect(getAllowedOriginHeader(req)).toBeNull();
  });
});
