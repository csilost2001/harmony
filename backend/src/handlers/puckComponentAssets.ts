/**
 * puckComponentAssets.ts — 外部 React Component 静的配信ハンドラ (#1409 P-1)。
 *
 * GET /workspace-assets/puck-components/<relpath>
 *   active workspace の <dataRoot>/puck-components/ 配下の `.mjs` / `.js` / `.json` / `.map`
 *   を配信する。manifest.json と各 component の ESM bundle (dist/*.mjs) を frontend ローダ
 *   (externalComponents.ts) が fetch / import() で読み込む経路。
 *
 * セキュリティ:
 * - origin / host 検証は wsBridge._handleHttp が全 route に強制済 (追加不要)。
 * - path traversal は assertPathContained で防御 (resolved target が base 配下のみ許可)。
 * - 拡張子 allowlist で配信対象を限定 (任意ファイル露出を防ぐ)。
 * - エラー本文は最小 (内部情報を漏らさない、既存 S-013 方針)。
 *
 * RFC #1405 シリーズ P-1。
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getLockdownPath, getGlobalDefaultPath } from "../workspaceState.js";
import { resolveDataRoot } from "../projectStorage.js";
import { assertPathContained } from "../security/idValidator.js";
import { getAllowedOriginHeader } from "../security/originCheck.js";
import { logWarn, logError } from "../serverLog.js";

const ROUTE_PREFIX = "/workspace-assets/puck-components/";

/** 拡張子 → Content-Type の allowlist。これ以外は 404。 */
const CONTENT_TYPES: Record<string, string> = {
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function corsHeaders(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  const allowedOrigin = getAllowedOriginHeader(req);
  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
    headers["Vary"] = "Origin";
  }
  return headers;
}

function sendStatus(
  res: ServerResponse,
  req: IncomingMessage,
  status: number,
  body: string,
): void {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    ...corsHeaders(req),
  });
  res.end(body);
}

/** active workspace root を解決する。lockdown 優先、なければ global default。null なら未選択。 */
function resolveActiveRoot(): string | null {
  return getLockdownPath() ?? getGlobalDefaultPath();
}

export async function handlePuckComponentAsset(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  if (req.method !== "GET") {
    sendStatus(res, req, 405, "Method Not Allowed");
    return;
  }

  const activeRoot = resolveActiveRoot();
  if (!activeRoot) {
    sendStatus(res, req, 404, "No active workspace");
    return;
  }

  // URL から prefix と query を除いた relpath を decode する
  const rawUrl = req.url ?? "";
  const pathPart = rawUrl.split("?")[0];
  if (!pathPart.startsWith(ROUTE_PREFIX)) {
    sendStatus(res, req, 404, "Not Found");
    return;
  }
  let relpath: string;
  try {
    relpath = decodeURIComponent(pathPart.slice(ROUTE_PREFIX.length));
  } catch {
    sendStatus(res, req, 400, "Bad Request");
    return;
  }
  if (relpath.length === 0) {
    sendStatus(res, req, 404, "Not Found");
    return;
  }

  // 拡張子 allowlist
  const ext = path.extname(relpath).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) {
    sendStatus(res, req, 404, "Not Found");
    return;
  }

  // dataRoot 解決 → base = <dataRoot>/puck-components/
  let base: string;
  try {
    const dataRoot = await resolveDataRoot(activeRoot);
    base = path.join(dataRoot, "puck-components");
  } catch (e) {
    logWarn("puck-assets", "Failed to resolve dataRoot", {
      error: e instanceof Error ? e.message : String(e),
    });
    sendStatus(res, req, 404, "Not Found");
    return;
  }

  // path traversal 防御
  const target = path.join(base, relpath);
  try {
    assertPathContained(target, base);
  } catch {
    logWarn("puck-assets", "Path traversal blocked", { relpath });
    sendStatus(res, req, 403, "Forbidden");
    return;
  }

  // file 読込
  let content: Buffer;
  try {
    content = await fs.readFile(target);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || code === "EISDIR") {
      sendStatus(res, req, 404, "Not Found");
      return;
    }
    logError("puck-assets", "Failed to read asset", {
      relpath,
      error: e instanceof Error ? e.message : String(e),
    });
    sendStatus(res, req, 500, "Internal Server Error");
    return;
  }

  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
    ...corsHeaders(req),
  });
  res.end(content);
}
