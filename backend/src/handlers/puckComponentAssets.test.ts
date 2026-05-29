/**
 * puckComponentAssets.test.ts — 外部 component 静的配信ハンドラのテスト (#1409 P-1)。
 *
 * - active workspace 未設定 → 404
 * - 許可拡張子の Content-Type + CORS header
 * - path traversal → 403
 * - 拡張子非許可 → 404
 * - OPTIONS preflight → 204
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handlePuckComponentAsset } from "./puckComponentAssets.js";
import { setGlobalDefaultPath, _resetForTest } from "../workspaceState.js";

interface MockRes extends ServerResponse {
  _status?: number;
  _body?: string | Buffer;
  _headers: Record<string, string | string[]>;
}

function makeRes(): MockRes {
  const headers: Record<string, string | string[]> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {
    _status: undefined,
    _body: undefined,
    _headers: headers,
    writeHead(status: number, h?: Record<string, string | string[]>) {
      obj._status = status;
      if (h) Object.assign(headers, h);
      return obj;
    },
    end(body?: string | Buffer) {
      obj._body = body;
      return obj;
    },
  };
  return obj as MockRes;
}

function makeReq(url: string, method = "GET"): IncomingMessage {
  // origin / host は wsBridge 側で検証済の前提のため、ハンドラ単体テストでは付与不要。
  // CORS echo 確認用に origin を allowlist 内の値で付ける。
  return {
    url,
    method,
    headers: { origin: "http://localhost:5173", host: "localhost:5179" },
    socket: { remoteAddress: "127.0.0.1" },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

let tmpRoot: string;
let dataRoot: string;

beforeEach(() => {
  _resetForTest();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "puck-assets-test-"));
  // harmony.json で dataDir を指定
  fs.writeFileSync(
    path.join(tmpRoot, "harmony.json"),
    JSON.stringify({ dataDir: "data" }),
    "utf-8",
  );
  dataRoot = path.join(tmpRoot, "data");
  const puckDir = path.join(dataRoot, "puck-components", "dist");
  fs.mkdirSync(puckDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataRoot, "puck-components", "manifest.json"),
    JSON.stringify({ schemaVersion: "1", components: [] }),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(puckDir, "foo.mjs"),
    "export default function Foo(){return null;}",
    "utf-8",
  );
});

afterEach(() => {
  _resetForTest();
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

const PREFIX = "/workspace-assets/puck-components/";

describe("handlePuckComponentAsset", () => {
  it("active workspace 未設定なら 404", async () => {
    // setGlobalDefaultPath を呼ばない → resolveActiveRoot() = null
    const res = makeRes();
    await handlePuckComponentAsset(makeReq(`${PREFIX}manifest.json`), res);
    expect(res._status).toBe(404);
  });

  it("manifest.json を application/json + CORS header で配信する", async () => {
    setGlobalDefaultPath(tmpRoot);
    const res = makeRes();
    await handlePuckComponentAsset(makeReq(`${PREFIX}manifest.json`), res);
    expect(res._status).toBe(200);
    expect(res._headers["Content-Type"]).toContain("application/json");
    expect(res._headers["Access-Control-Allow-Origin"]).toBe(
      "http://localhost:5173",
    );
    expect(String(res._body)).toContain("schemaVersion");
  });

  it(".mjs を text/javascript で配信する", async () => {
    setGlobalDefaultPath(tmpRoot);
    const res = makeRes();
    await handlePuckComponentAsset(makeReq(`${PREFIX}dist/foo.mjs`), res);
    expect(res._status).toBe(200);
    expect(res._headers["Content-Type"]).toContain("text/javascript");
    expect(String(res._body)).toContain("export default");
  });

  it("存在しないファイルは 404", async () => {
    setGlobalDefaultPath(tmpRoot);
    const res = makeRes();
    await handlePuckComponentAsset(makeReq(`${PREFIX}dist/missing.mjs`), res);
    expect(res._status).toBe(404);
  });

  it("許可されない拡張子は 404", async () => {
    setGlobalDefaultPath(tmpRoot);
    const res = makeRes();
    await handlePuckComponentAsset(makeReq(`${PREFIX}secret.env`), res);
    expect(res._status).toBe(404);
  });

  it("path traversal (..) は 403", async () => {
    setGlobalDefaultPath(tmpRoot);
    const res = makeRes();
    // ../../harmony.json を狙う (decode 後に .. を含む) → base 外なので 403
    await handlePuckComponentAsset(
      makeReq(`${PREFIX}..%2f..%2fharmony.json`),
      res,
    );
    expect(res._status).toBe(403);
  });

  it("OPTIONS preflight は 204 + CORS header", async () => {
    setGlobalDefaultPath(tmpRoot);
    const res = makeRes();
    await handlePuckComponentAsset(
      makeReq(`${PREFIX}manifest.json`, "OPTIONS"),
      res,
    );
    expect(res._status).toBe(204);
    expect(res._headers["Access-Control-Allow-Methods"]).toContain("GET");
  });

  it("GET / OPTIONS 以外は 405", async () => {
    setGlobalDefaultPath(tmpRoot);
    const res = makeRes();
    await handlePuckComponentAsset(
      makeReq(`${PREFIX}manifest.json`, "POST"),
      res,
    );
    expect(res._status).toBe(405);
  });

  it("query 付き URL でも relpath を正しく解決する", async () => {
    setGlobalDefaultPath(tmpRoot);
    const res = makeRes();
    await handlePuckComponentAsset(
      makeReq(`${PREFIX}dist/foo.mjs?v=123`),
      res,
    );
    expect(res._status).toBe(200);
  });
});
