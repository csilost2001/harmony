/**
 * puckComponentAssets.test.ts — 外部 component 静的配信ハンドラのテスト (#1409 P-1 / #1415 P2-1)。
 *
 * URL 契約: GET /workspace-assets/<wsId>/puck-components/<relpath>
 *
 * - wsId 不正 / 未登録 → 404
 * - 許可拡張子の Content-Type + CORS header
 * - path traversal → 403
 * - 拡張子非許可 → 404
 * - OPTIONS preflight → 204
 * - per-session scoping: 別 wsId は別 root が解決される (#1415 P2-1)
 * - lockdown モード: recent を使わず lockdown path に固定する (#1415 P2-1)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handlePuckComponentAsset } from "./puckComponentAssets.js";
import { _resetForTest, initWorkspaceState } from "../workspaceState.js";
import { upsertWorkspace } from "../recentStore.js";

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

/** <root>/data/puck-components/ に manifest + dist/foo.mjs を作る fixture を仕込む。 */
function seedWorkspace(root: string): string {
  fs.writeFileSync(
    path.join(root, "harmony.json"),
    JSON.stringify({ dataDir: "data" }),
    "utf-8",
  );
  const dataRoot = path.join(root, "data");
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
  return dataRoot;
}

let tmpRoot: string;
let recentFile: string;
let wsId: string;

/** prefix builder: `/workspace-assets/<wsId>/puck-components/`。 */
function prefix(id = wsId): string {
  return `/workspace-assets/${encodeURIComponent(id)}/puck-components/`;
}

beforeEach(async () => {
  _resetForTest();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "puck-assets-test-"));
  seedWorkspace(tmpRoot);
  // recent-workspaces.json を独立 tmp file に向ける → findById がここを読む。
  recentFile = path.join(tmpRoot, "recent-workspaces.json");
  vi.stubEnv("DESIGNER_RECENT_FILE", recentFile);
  vi.stubEnv("DESIGNER_DATA_DIR", "");
  const entry = await upsertWorkspace(tmpRoot, "test-ws");
  wsId = entry.id;
});

afterEach(() => {
  vi.unstubAllEnvs();
  _resetForTest();
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("handlePuckComponentAsset", () => {
  it("未登録 wsId なら 404", async () => {
    const res = makeRes();
    await handlePuckComponentAsset(
      makeReq(`${prefix("does-not-exist")}manifest.json`),
      res,
    );
    expect(res._status).toBe(404);
  });

  it("manifest.json を application/json + CORS header で配信する", async () => {
    const res = makeRes();
    await handlePuckComponentAsset(makeReq(`${prefix()}manifest.json`), res);
    expect(res._status).toBe(200);
    expect(res._headers["Content-Type"]).toContain("application/json");
    expect(res._headers["Access-Control-Allow-Origin"]).toBe(
      "http://localhost:5173",
    );
    expect(String(res._body)).toContain("schemaVersion");
  });

  it(".mjs を text/javascript で配信する", async () => {
    const res = makeRes();
    await handlePuckComponentAsset(makeReq(`${prefix()}dist/foo.mjs`), res);
    expect(res._status).toBe(200);
    expect(res._headers["Content-Type"]).toContain("text/javascript");
    expect(String(res._body)).toContain("export default");
  });

  it("存在しないファイルは 404", async () => {
    const res = makeRes();
    await handlePuckComponentAsset(makeReq(`${prefix()}dist/missing.mjs`), res);
    expect(res._status).toBe(404);
  });

  it("許可されない拡張子は 404", async () => {
    const res = makeRes();
    await handlePuckComponentAsset(makeReq(`${prefix()}secret.env`), res);
    expect(res._status).toBe(404);
  });

  it("path traversal (..) は 403", async () => {
    const res = makeRes();
    // ../../harmony.json を狙う (decode 後に .. を含む) → base 外なので 403
    await handlePuckComponentAsset(
      makeReq(`${prefix()}..%2f..%2fharmony.json`),
      res,
    );
    expect(res._status).toBe(403);
  });

  it("OPTIONS preflight は 204 + CORS header", async () => {
    const res = makeRes();
    await handlePuckComponentAsset(
      makeReq(`${prefix()}manifest.json`, "OPTIONS"),
      res,
    );
    expect(res._status).toBe(204);
    expect(res._headers["Access-Control-Allow-Methods"]).toContain("GET");
  });

  it("GET / OPTIONS 以外は 405", async () => {
    const res = makeRes();
    await handlePuckComponentAsset(
      makeReq(`${prefix()}manifest.json`, "POST"),
      res,
    );
    expect(res._status).toBe(405);
  });

  it("query 付き URL でも relpath を正しく解決する", async () => {
    const res = makeRes();
    await handlePuckComponentAsset(makeReq(`${prefix()}dist/foo.mjs?v=123`), res);
    expect(res._status).toBe(200);
  });

  it("wsId segment が無い URL は 404", async () => {
    const res = makeRes();
    // 旧形式 (/workspace-assets/puck-components/...) は wsId が無いので 404。
    await handlePuckComponentAsset(
      makeReq(`/workspace-assets/puck-components/manifest.json`),
      res,
    );
    expect(res._status).toBe(404);
  });

  // --- #1415 P2-1: per-session workspace scoping ---
  it("別 wsId は別 root を解決する (workspace 間で混入しない)", async () => {
    // 2 つ目の workspace を別 root + 別 manifest 内容で登録する。
    const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), "puck-assets-other-"));
    try {
      fs.writeFileSync(
        path.join(otherRoot, "harmony.json"),
        JSON.stringify({ dataDir: "data" }),
        "utf-8",
      );
      const otherData = path.join(otherRoot, "data", "puck-components");
      fs.mkdirSync(otherData, { recursive: true });
      fs.writeFileSync(
        path.join(otherData, "manifest.json"),
        JSON.stringify({ schemaVersion: "1", marker: "OTHER" }),
        "utf-8",
      );
      const otherEntry = await upsertWorkspace(otherRoot, "other-ws");

      // wsId=A の manifest には marker 無し。
      const resA = makeRes();
      await handlePuckComponentAsset(makeReq(`${prefix(wsId)}manifest.json`), resA);
      expect(resA._status).toBe(200);
      expect(String(resA._body)).not.toContain("OTHER");

      // wsId=B (otherEntry) は marker:"OTHER" を返す。
      const resB = makeRes();
      await handlePuckComponentAsset(
        makeReq(`${prefix(otherEntry.id)}manifest.json`),
        resB,
      );
      expect(resB._status).toBe(200);
      expect(String(resB._body)).toContain("OTHER");
    } finally {
      fs.rmSync(otherRoot, { recursive: true, force: true });
    }
  });

  it("lockdown モード: wsId='lockdown' は lockdown path を解決し、recent は使わない", async () => {
    // DESIGNER_DATA_DIR を tmpRoot に向けて lockdown を有効化する。
    vi.stubEnv("DESIGNER_DATA_DIR", tmpRoot);
    // VITEST=true のため initWorkspaceState は harmony.json 存在検証を skip する。
    initWorkspaceState();

    const res = makeRes();
    await handlePuckComponentAsset(
      makeReq(`/workspace-assets/lockdown/puck-components/manifest.json`),
      res,
    );
    expect(res._status).toBe(200);
    expect(String(res._body)).toContain("schemaVersion");
  });

  it("lockdown モード: 'lockdown' 以外の wsId は 404 (recent を引かない)", async () => {
    vi.stubEnv("DESIGNER_DATA_DIR", tmpRoot);
    initWorkspaceState();

    // recent に登録済の wsId であっても lockdown 中は拒否する。
    const res = makeRes();
    await handlePuckComponentAsset(makeReq(`${prefix(wsId)}manifest.json`), res);
    expect(res._status).toBe(404);
  });
});
