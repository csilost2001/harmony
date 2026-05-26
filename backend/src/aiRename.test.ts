/**
 * aiRename.ts のユニットテスト
 *
 * I-7 Round 8 B (#1299): screenId validator が UUID 専用 → kebab-case EntityId 受容に
 * 変更された regression test。RFC #1284 後の全 Screen で AI 再命名操作が動作する
 * ことを保証する。
 *
 * handlePropose は claude CLI を spawn するため、本テストでは認証確認を mock して
 * input validation 層 (screenId format) のみを決定的に検証する。
 */

import { describe, it, expect, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handlePropose } from "./aiRename.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => { throw new Error("not authenticated in unit test"); }),
  spawn: vi.fn(),
}));

/** ServerResponse mock */
function makeRes(): ServerResponse & { _status?: number; _body?: string; _headers?: Record<string, string | string[]> } {
  const headers: Record<string, string | string[]> = {};
  const obj: any = {
    _status: undefined as number | undefined,
    _body: undefined as string | undefined,
    _headers: headers,
    writeHead(status: number, h?: Record<string, string | string[]>) {
      obj._status = status;
      if (h) Object.assign(headers, h);
      return obj;
    },
    end(body?: string) {
      obj._body = body;
      return obj;
    },
  };
  return obj as ServerResponse & { _status?: number; _body?: string; _headers?: Record<string, string | string[]> };
}

/** IncomingMessage mock — POST body は data/end イベントで配信 */
function makeReq(opts: { method?: string; body?: string; origin?: string; host?: string }): IncomingMessage {
  const listeners: Record<string, ((...a: any[]) => void)[]> = {};
  const req: any = {
    method: opts.method ?? "POST",
    headers: {
      ...(opts.origin !== undefined ? { origin: opts.origin } : {}),
      ...(opts.host !== undefined ? { host: opts.host } : { host: "localhost:5179" }),
    },
    socket: { remoteAddress: "127.0.0.1" },
    on(event: string, cb: (...a: any[]) => void) {
      (listeners[event] ??= []).push(cb);
      return req;
    },
  };
  // body 配信を queueMicrotask で予約
  queueMicrotask(() => {
    if (opts.body !== undefined) {
      listeners.data?.forEach((cb) => cb(Buffer.from(opts.body!)));
    }
    listeners.end?.forEach((cb) => cb());
  });
  return req as IncomingMessage;
}

describe("handlePropose — screenId validation (I-7 Round 8 B)", () => {
  it("kebab-case EntityId screenId は validation を通過し auth-check 層で 503 を返す", async () => {
    const req = makeReq({
      method: "POST",
      body: JSON.stringify({ screenId: "user-list", clientId: "c1" }),
      origin: "http://localhost:5173",
    });
    const res = makeRes();
    await handlePropose(req, res);
    expect(res._status).toBe(503);
    expect(res._body).toContain("claude CLI が未認証です");
  });

  it("UUID 形式 screenId は I-7 後の strict validator で 400 を返す", async () => {
    const req = makeReq({
      method: "POST",
      body: JSON.stringify({
        screenId: "f81dd9e0-794c-4539-9000-000000000001",
        clientId: "c1",
      }),
      origin: "http://localhost:5173",
    });
    const res = makeRes();
    await handlePropose(req, res);
    expect(res._status).toBe(400);
    expect(res._body).toContain("kebab-case EntityId");
  });

  it("非文字列 screenId は 400 を返す", async () => {
    const req = makeReq({
      method: "POST",
      body: JSON.stringify({ screenId: 123, clientId: "c1" }),
      origin: "http://localhost:5173",
    });
    const res = makeRes();
    await handlePropose(req, res);
    expect(res._status).toBe(400);
  });

  it("不正な文字を含む screenId (大文字 / 記号) は 400 を返す", async () => {
    const req = makeReq({
      method: "POST",
      body: JSON.stringify({ screenId: "User_List!", clientId: "c1" }),
      origin: "http://localhost:5173",
    });
    const res = makeRes();
    await handlePropose(req, res);
    expect(res._status).toBe(400);
  });

  it("Origin header が allowlist 外なら 403 を返す (validation 前)", async () => {
    const req = makeReq({
      method: "POST",
      body: JSON.stringify({ screenId: "user-list", clientId: "c1" }),
      origin: "http://evil.example.com",
    });
    const res = makeRes();
    await handlePropose(req, res);
    expect(res._status).toBe(403);
  });
});
