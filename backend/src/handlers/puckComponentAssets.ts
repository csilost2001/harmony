/**
 * puckComponentAssets.ts — 外部 React Component 静的配信ハンドラ (#1409 P-1 / #1415 P2-1)。
 *
 * GET /workspace-assets/<wsId>/puck-components/<relpath>
 *   URL 内の <wsId> で **要求ごとに** workspace を解決し、その <dataRoot>/puck-components/
 *   配下の `.mjs` / `.js` / `.json` / `.map` を配信する。manifest.json と各 component の
 *   ESM bundle (dist/*.mjs) を frontend ローダ (externalComponents.ts) が fetch / import()
 *   で読み込む経路。
 *
 * #1415 P2-1 (per-session workspace scoping):
 *   旧実装は process-global な resolveActiveRoot() (lockdown ?? globalDefault) を使っていたが、
 *   backend のデータ層は #679 (v2) で per-session active workspace (workspaceContextManager) に
 *   なっており、HTTP の静的 asset GET はセッション文脈を持たないため、複数タブが別 workspace を
 *   active にしていると別 workspace の外部 component を読みうる cap5 violation があった。
 *   asset URL に wsId を埋め込み、recentStore.findById(wsId) で当該 workspace root を解決する
 *   ことで要求ごとに scope する。lockdown モード時は recent を使わず lockdown path に固定する。
 *
 * セキュリティ:
 * - origin / host 検証は wsBridge._handleHttp が全 route に強制済 (追加不要)。
 * - wsId は recentStore に登録済 (= 既知) の workspace のみ解決、未登録 / 不正なら 404 (SSRF 防止)。
 * - path traversal は assertPathContained で防御 (resolved target が base 配下のみ許可、字句的)。
 * - symlink escape は fs.realpath で実体パスを解決し、base の realpath 配下に収まるか
 *   再検証することで防御 (P2-7、多層防御)。allowed 拡張子の symlink で base 外の任意ファイル
 *   (例 /etc/passwd) を指しても字句 check を通過し fs.readFile が follow する穴を塞ぐ。
 * - 拡張子 allowlist で配信対象を限定 (任意ファイル露出を防ぐ)。
 * - エラー本文は最小 (内部情報を漏らさない、既存 S-013 方針)。
 *
 * RFC #1405 シリーズ P-1 / #1415 P2-1。
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  getLockdownPath,
  isLockdown,
  LOCKDOWN_WORKSPACE_ID,
} from "../workspaceState.js";
import { findById } from "../recentStore.js";
import { resolveDataRoot } from "../projectStorage.js";
import { assertPathContained } from "../security/idValidator.js";
import { getAllowedOriginHeader } from "../security/originCheck.js";
import { logWarn, logError } from "../serverLog.js";

/**
 * route prefix。wsBridge は url === prefix / startsWith(prefix + "/") でマッチするため、
 * wsId を URL path segment に含める本 handler は親 prefix `/workspace-assets` で登録する。
 * handler 内で `/workspace-assets/<wsId>/puck-components/<relpath>` を parse する。
 */
const ROUTE_PREFIX = "/workspace-assets";
/** wsId の後ろに来る固定 segment。 */
const PUCK_SEGMENT = "puck-components";

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

/**
 * URL から `/workspace-assets/<wsId>/puck-components/<relpath>` を parse する。
 * 失敗時は null (= 404 扱い)。relpath は decode 済。
 */
function parseAssetUrl(
  rawUrl: string,
): { wsId: string; relpath: string } | null {
  const pathPart = rawUrl.split("?")[0];
  // ROUTE_PREFIX (`/workspace-assets`) で登録されているため必ず prefix で始まる前提だが、
  // 念のため確認し、`/workspace-assets/` の後ろを segment 分解する。
  if (pathPart !== ROUTE_PREFIX && !pathPart.startsWith(ROUTE_PREFIX + "/")) {
    return null;
  }
  const rest = pathPart.slice(ROUTE_PREFIX.length).replace(/^\//, "");
  // rest = "<wsId>/puck-components/<relpath...>"
  const firstSlash = rest.indexOf("/");
  if (firstSlash < 0) return null;
  const wsIdRaw = rest.slice(0, firstSlash);
  const afterWsId = rest.slice(firstSlash + 1);
  if (!afterWsId.startsWith(PUCK_SEGMENT + "/")) return null;
  const relpathRaw = afterWsId.slice(PUCK_SEGMENT.length + 1);
  let wsId: string;
  let relpath: string;
  try {
    wsId = decodeURIComponent(wsIdRaw);
    relpath = decodeURIComponent(relpathRaw);
  } catch {
    return null;
  }
  if (wsId.length === 0 || relpath.length === 0) return null;
  return { wsId, relpath };
}

/**
 * wsId から workspace root を解決する。
 * - lockdown モード時は wsId に関わらず lockdown path に固定する (recent は読み書きしない仕様)。
 *   ただし frontend は lockdown 時 wsId="lockdown" を送るため、それ以外の wsId は不正として拒否。
 * - 通常モードは recentStore.findById(wsId) で既知の workspace のみ解決する (SSRF 防止)。
 * 解決できなければ null。
 */
async function resolveRootForWsId(wsId: string): Promise<string | null> {
  if (isLockdown()) {
    if (wsId !== LOCKDOWN_WORKSPACE_ID) return null;
    return getLockdownPath();
  }
  const entry = await findById(wsId);
  return entry ? entry.path : null;
}

/**
 * child が parent ディレクトリ配下に収まるか判定する (realpath 同士の比較を想定、P2-7)。
 * path separator を付与して prefix 比較することで、`/a/bc` が `/a/b` 配下と誤判定されるのを防ぐ。
 */
function isWithin(parent: string, child: string): boolean {
  if (child === parent) return true;
  const rel = path.relative(parent, child);
  return (
    rel.length > 0 &&
    !rel.startsWith("..") &&
    !path.isAbsolute(rel)
  );
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

  // URL から wsId / relpath を parse する。
  const parsed = parseAssetUrl(req.url ?? "");
  if (!parsed) {
    sendStatus(res, req, 404, "Not Found");
    return;
  }
  const { wsId, relpath } = parsed;

  // wsId → workspace root を要求ごとに解決 (per-session scoping、#1415 P2-1)。
  const root = await resolveRootForWsId(wsId);
  if (!root) {
    sendStatus(res, req, 404, "No such workspace");
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
    const dataRoot = await resolveDataRoot(root);
    base = path.join(dataRoot, "puck-components");
  } catch (e) {
    logWarn("puck-assets", "Failed to resolve dataRoot", {
      error: e instanceof Error ? e.message : String(e),
    });
    sendStatus(res, req, 404, "Not Found");
    return;
  }

  // path traversal 防御 (字句的)
  const target = path.join(base, relpath);
  try {
    assertPathContained(target, base);
  } catch {
    logWarn("puck-assets", "Path traversal blocked", { relpath });
    sendStatus(res, req, 403, "Forbidden");
    return;
  }

  // symlink escape 防御 (P2-7、多層防御): 実体パスを realpath で解決し、
  // base の realpath 配下に収まることを再検証する。allowed 拡張子の symlink で
  // base 外 (例 /etc/passwd) を指しても、字句 check を通過した後ここで弾く。
  // base 自体も realpath 化して比較する (base が symlink 経由のケースも正しく扱う)。
  try {
    const realBase = await fs.realpath(base);
    const realTarget = await fs.realpath(target);
    if (!isWithin(realBase, realTarget)) {
      logWarn("puck-assets", "Symlink escape blocked", { relpath });
      sendStatus(res, req, 403, "Forbidden");
      return;
    }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    // 実体が存在しない / 中間 component が file 等は 404 扱い (ENOENT / ENOTDIR)。
    if (code === "ENOENT" || code === "ENOTDIR") {
      sendStatus(res, req, 404, "Not Found");
      return;
    }
    logError("puck-assets", "Failed to realpath asset", {
      relpath,
      error: e instanceof Error ? e.message : String(e),
    });
    sendStatus(res, req, 500, "Internal Server Error");
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
